/**
 * Standalone Express + SQLite API.
 *
 * NOTE: the web app does NOT use this server — Cloud Firestore is the single source
 * of truth for all business data. This API is kept as a self-contained, safe
 * reference implementation; it must never be used as a second write path for the
 * same data as Firestore.
 *
 * Guarantees:
 *  - IDs are UUIDs (a client-supplied UUID id is honoured, so a retried create is a no-op).
 *  - `Idempotency-Key` header: the first response is stored in the SAME transaction as
 *    the write and replayed for retries (different payload + same key → 422).
 *  - Request numbers come from a transactional sequence + UNIQUE index (no COUNT(*)+1).
 *  - State transitions are conditional updates (pending→approved once; approved→disbursed once).
 *  - Disbursement (status + budget + provider totals) is one atomic transaction.
 */
import express, { type Request } from 'express';
import cors from 'cors';
import { createHash, randomUUID } from 'crypto';
import type { Database, Queryable } from './db.js';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Result {
  status: number;
  body: any;
}

const CLIENT_ID = /^[a-z]{2,10}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.\-]{8,200}$/;

const newId = (prefix: string) => `${prefix}-${randomUUID()}`;
const idFrom = (candidate: unknown, prefix: string) =>
  typeof candidate === 'string' && CLIENT_ID.test(candidate) && candidate.startsWith(`${prefix}-`) ? candidate : newId(prefix);

const stamp = (now: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
};

const hashBody = (body: unknown) => createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

const parseRequest = (row: any) => {
  if (!row) return null;
  return {
    ...row,
    attachments: JSON.parse(row.attachments || '[]'),
    comments: JSON.parse(row.comments || '[]'),
    timeline: JSON.parse(row.timeline || '[]'),
    disbursement: row.disbursement ? JSON.parse(row.disbursement) : undefined,
  };
};

const parseProvider = (r: any) =>
  r && {
    ...r,
    serviceCategoryIds: JSON.parse(r.serviceCategoryIds || '[]'),
    serviceCategoryNames: JSON.parse(r.serviceCategoryNames || '[]'),
    active: Boolean(r.active),
  };

async function nextSequence(q: Queryable, name: string, seedSql?: string, seedParams: any[] = []) {
  if (seedSql) {
    // Seed from existing data the first time so legacy numbers are never reissued.
    await q.run(`INSERT OR IGNORE INTO sequences (name, value) SELECT ?, COALESCE((${seedSql}), 0)`, [name, ...seedParams]);
  }
  const row = await q.get<{ value: number }>(
    `INSERT INTO sequences (name, value) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1
     RETURNING value`,
    [name]
  );
  return row!.value;
}

export function createApp(db: Database) {
  const app = express();

  const allowedOrigins = [
    'https://expenses-project-xi.vercel.app',
    'https://expenses-project-ce1f9.firebaseapp.com',
    'https://expenses-project-ce1f9.web.app',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4173',
  ];

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || /^https:\/\/expenses-project(?:-[a-z0-9-]+)?\.vercel\.app$/.test(origin)) callback(null, true);
      else callback(new Error('Blocked by CORS policy'));
    },
    credentials: true,
    exposedHeaders: ['Idempotent-Replayed'],
  }));
  app.use(express.json({ limit: '2mb' }));

  /**
   * Wraps a write handler: one transaction for the idempotency lookup, the business
   * write and the stored response — so "processed" and "response recorded" can never
   * diverge (a lost response + retry replays instead of writing twice).
   */
  const mutation = (handler: (req: Request, q: Queryable) => Promise<Result>) =>
    async (req: Request, res: express.Response) => {
      const key = req.header('idempotency-key');
      if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) {
        return res.status(400).json({ error: 'Invalid Idempotency-Key header' });
      }
      const requestHash = hashBody(req.body);
      try {
        const result = await db.transaction(async q => {
          if (key) {
            const row = await q.get<any>('SELECT * FROM idempotency_keys WHERE key = ?', [key]);
            if (row) {
              if (row.method !== req.method || row.path !== req.originalUrl || row.requestHash !== requestHash) {
                return { status: 422, body: { error: 'Idempotency-Key was already used for a different request' }, replayed: false };
              }
              return { status: row.statusCode, body: JSON.parse(row.responseBody), replayed: true };
            }
          }
          const out = await handler(req, q);
          if (key) {
            await q.run(
              'INSERT INTO idempotency_keys (key, method, path, requestHash, statusCode, responseBody, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [key, req.method, req.originalUrl, requestHash, out.status, JSON.stringify(out.body ?? null), new Date().toISOString()]
            );
          }
          return { ...out, replayed: false };
        });
        if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
        return res.status(result.status).json(result.body);
      } catch (err: any) {
        if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
        if (String(err?.code) === 'SQLITE_CONSTRAINT' || /UNIQUE constraint/i.test(err?.message || '')) {
          return res.status(409).json({ error: 'Duplicate: a record with the same unique value already exists.' });
        }
        console.error('[API] write failed:', err);
        return res.status(500).json({ error: err?.message || 'Internal Server Error' });
      }
    };

  const reader = (handler: (req: Request, q: Queryable) => Promise<any>) =>
    async (req: Request, res: express.Response) => {
      try {
        res.json(await db.read(q => handler(req, q)));
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    };

  const byOrg = (table: string, order = '') => reader(async (req, q) => {
    const { orgId } = req.query;
    return orgId && orgId !== 'all'
      ? q.all(`SELECT * FROM ${table} WHERE orgId = ? ${order}`, [String(orgId)])
      : q.all(`SELECT * FROM ${table} ${order}`);
  });

  // ======================= ORGANIZATIONS =======================
  app.get('/api/organizations', reader((_req, q) => q.all('SELECT * FROM organizations ORDER BY createdAt DESC')));

  app.post('/api/organizations', mutation(async (req, q) => {
    const { name, code, currency, budget, description } = req.body || {};
    if (!name || !code || !currency) throw new HttpError(400, 'name, code and currency are required');
    const id = idFrom(req.body?.id, 'org');
    const existing = await q.get('SELECT * FROM organizations WHERE id = ?', [id]);
    if (existing) return { status: 200, body: existing };
    const createdAt = new Date().toISOString();
    await q.run(
      'INSERT INTO organizations (id, name, code, currency, budget, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, String(name).trim(), String(code).trim().toUpperCase(), currency, Number(budget) || 0, description || '', createdAt]
    );
    return { status: 201, body: await q.get('SELECT * FROM organizations WHERE id = ?', [id]) };
  }));

  // ======================= MEMBERS =======================
  app.get('/api/members', reader(async (req, q) => {
    const { orgId } = req.query;
    const rows = orgId && orgId !== 'all'
      ? await q.all('SELECT * FROM members WHERE orgId = ? ORDER BY joinedAt DESC', [String(orgId)])
      : await q.all('SELECT * FROM members ORDER BY joinedAt DESC');
    return rows.map((m: any) => ({ ...m, active: Boolean(m.active) }));
  }));

  app.post('/api/members', mutation(async (req, q) => {
    const { orgId, userId, userName, userEmail, role, department, jobTitle } = req.body || {};
    if (!orgId || !userName || !userEmail) throw new HttpError(400, 'orgId, userName and userEmail are required');
    const id = idFrom(req.body?.id, 'mem');
    const existing = await q.get('SELECT * FROM members WHERE id = ?', [id]);
    if (existing) return { status: 200, body: { ...existing, active: Boolean(existing.active) } };
    await q.run(
      'INSERT INTO members (id, orgId, userId, userName, userEmail, role, department, jobTitle, joinedAt, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, orgId, userId || newId('user'), userName, String(userEmail).trim().toLowerCase(), role || 'employee', department || '', jobTitle || '', new Date().toISOString().split('T')[0], 1]
    );
    const created = await q.get('SELECT * FROM members WHERE id = ?', [id]);
    return { status: 201, body: { ...created, active: true } };
  }));

  app.delete('/api/members/:id', mutation(async (req, q) => {
    await q.run('DELETE FROM members WHERE id = ?', [req.params.id]);
    return { status: 200, body: { success: true } };
  }));

  // ======================= SERVICES =======================
  app.get('/api/services', byOrg('services'));

  app.post('/api/services', mutation(async (req, q) => {
    const { orgId, name, code, description, budgetLimit, color, iconName } = req.body || {};
    if (!orgId || !name) throw new HttpError(400, 'orgId and name are required');
    const id = idFrom(req.body?.id, 'srv');
    const existing = await q.get('SELECT * FROM services WHERE id = ?', [id]);
    if (existing) return { status: 200, body: existing };
    await q.run(
      'INSERT INTO services (id, orgId, name, code, description, budgetLimit, spentAmount, color, iconName) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, orgId, name, code || id.slice(-6).toUpperCase(), description || '', Number(budgetLimit) || 0, 0, color || '#10b981', iconName || 'Layers']
    );
    return { status: 201, body: await q.get('SELECT * FROM services WHERE id = ?', [id]) };
  }));

  app.put('/api/services/:id', mutation(async (req, q) => {
    const { name, code, description, budgetLimit, color } = req.body || {};
    // spentAmount is only ever changed by disbursements, never by this endpoint.
    const r = await q.run(
      'UPDATE services SET name = ?, code = ?, description = ?, budgetLimit = ?, color = ? WHERE id = ?',
      [name, code, description, Number(budgetLimit) || 0, color, req.params.id]
    );
    if (r.changes === 0) throw new HttpError(404, 'Service not found');
    return { status: 200, body: await q.get('SELECT * FROM services WHERE id = ?', [req.params.id]) };
  }));

  app.delete('/api/services/:id', mutation(async (req, q) => {
    await q.run('DELETE FROM services WHERE id = ?', [req.params.id]);
    return { status: 200, body: { success: true } };
  }));

  // ======================= PROVIDERS =======================
  app.get('/api/providers', reader(async (req, q) => {
    const { orgId } = req.query;
    const rows = orgId && orgId !== 'all'
      ? await q.all('SELECT * FROM providers WHERE orgId = ?', [String(orgId)])
      : await q.all('SELECT * FROM providers');
    return rows.map(parseProvider);
  }));

  app.post('/api/providers', mutation(async (req, q) => {
    const b = req.body || {};
    if (!b.orgId || !b.name) throw new HttpError(400, 'orgId and name are required');
    const id = idFrom(b.id, 'prov');
    const existing = await q.get('SELECT * FROM providers WHERE id = ?', [id]);
    if (existing) return { status: 200, body: parseProvider(existing) };
    await q.run(
      `INSERT INTO providers (
        id, orgId, name, serviceCategoryIds, serviceCategoryNames, contactPerson,
        phone, email, taxNumber, crNumber, bankName, iban, address, rating, totalPaid, active, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, b.orgId, b.name, JSON.stringify(b.serviceCategoryIds || []), JSON.stringify(b.serviceCategoryNames || []),
        b.contactPerson || '', b.phone || '', b.email || '', b.taxNumber || '', b.crNumber || '',
        b.bankName || '', b.iban || '', b.address || '', Number(b.rating) || 5.0, 0, 1, b.notes || '',
      ]
    );
    return { status: 201, body: parseProvider(await q.get('SELECT * FROM providers WHERE id = ?', [id])) };
  }));

  app.put('/api/providers/:id', mutation(async (req, q) => {
    const b = req.body || {};
    const r = await q.run(
      `UPDATE providers SET
        name = ?, serviceCategoryIds = ?, serviceCategoryNames = ?, contactPerson = ?,
        phone = ?, email = ?, taxNumber = ?, crNumber = ?, bankName = ?, iban = ?,
        address = ?, rating = ?, notes = ?
      WHERE id = ?`,
      [
        b.name, JSON.stringify(b.serviceCategoryIds || []), JSON.stringify(b.serviceCategoryNames || []),
        b.contactPerson, b.phone, b.email, b.taxNumber, b.crNumber, b.bankName, b.iban,
        b.address, Number(b.rating) || 5.0, b.notes, req.params.id,
      ]
    );
    if (r.changes === 0) throw new HttpError(404, 'Provider not found');
    return { status: 200, body: parseProvider(await q.get('SELECT * FROM providers WHERE id = ?', [req.params.id])) };
  }));

  app.delete('/api/providers/:id', mutation(async (req, q) => {
    await q.run('DELETE FROM providers WHERE id = ?', [req.params.id]);
    return { status: 200, body: { success: true } };
  }));

  // ======================= REQUESTS =======================
  app.get('/api/requests', reader(async (req, q) => {
    const { orgId } = req.query;
    const rows = orgId && orgId !== 'all'
      ? await q.all('SELECT * FROM requests WHERE orgId = ? ORDER BY createdAt DESC', [String(orgId)])
      : await q.all('SELECT * FROM requests ORDER BY createdAt DESC');
    return rows.map(parseRequest);
  }));

  app.post('/api/requests', mutation(async (req, q) => {
    const b = req.body || {};
    const required = ['orgId', 'requesterId', 'requesterName', 'serviceCategoryId', 'serviceCategoryName', 'providerId', 'providerName', 'title', 'amount', 'currency'];
    const missing = required.filter(f => b[f] === undefined || b[f] === '');
    if (missing.length) throw new HttpError(400, `Missing fields: ${missing.join(', ')}`);
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'amount must be a positive number');

    // The frontend-supplied UUID is honoured (single ID for the whole lifecycle):
    // a retried POST with the same id returns the existing request instead of a second one.
    const id = idFrom(b.id, 'req');
    const existing = await q.get('SELECT * FROM requests WHERE id = ?', [id]);
    if (existing) return { status: 200, body: parseRequest(existing) };

    const now = new Date();
    const year = now.getFullYear();
    const prefix = `REQ-${year}-`;
    const seq = await nextSequence(
      q,
      `requests-${year}`,
      'SELECT MAX(CAST(substr(requestNumber, ?) AS INTEGER)) FROM requests WHERE requestNumber LIKE ?',
      [prefix.length + 1, `${prefix}%`]
    );
    const requestNumber = `${prefix}${String(seq).padStart(6, '0')}`;
    const ts = stamp(now);

    const attachments = (b.attachmentNames || []).map((name: string) => ({
      id: newId('att'), name, size: '1.2 MB', type: 'pdf', uploadedAt: ts,
    }));
    const timeline = [{
      id: newId('tl'),
      status: 'created',
      title: 'تم تقديم طلب الصرف',
      description: `قدم ${b.requesterName} طلباً بمبلغ ${amount.toLocaleString()} ${b.currency} لبند ${b.serviceCategoryName}.`,
      actorName: b.requesterName,
      timestamp: ts,
    }];

    await q.run(
      `INSERT INTO requests (
        id, requestNumber, orgId, requesterId, requesterName, requesterDepartment,
        serviceCategoryId, serviceCategoryName, providerId, providerName,
        title, description, justification, amount, currency, status, urgency,
        attachments, comments, timeline, disbursement, rejectionReason, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, requestNumber, b.orgId, b.requesterId, b.requesterName, b.requesterDepartment || 'الشؤون الإدارية',
        b.serviceCategoryId, b.serviceCategoryName, b.providerId, b.providerName,
        b.title, b.description || '', b.justification || '', amount, b.currency, 'pending', b.urgency || 'medium',
        JSON.stringify(attachments), '[]', JSON.stringify(timeline), null, null, now.toISOString(), now.toISOString(),
      ]
    );
    return { status: 201, body: parseRequest(await q.get('SELECT * FROM requests WHERE id = ?', [id])) };
  }));

  /**
   * Guarded state transition: only moves from an allowed state; repeating a
   * transition that already happened is a no-op (200 + current state, no second
   * timeline entry, no second side effect).
   */
  const transition = (
    to: string,
    from: string[],
    build: (current: any, req: Request, ts: string, nowIso: string) => { fields: Record<string, any>; timeline: any; comment?: any }
  ) =>
    mutation(async (req, q) => {
      const current = parseRequest(await q.get('SELECT * FROM requests WHERE id = ?', [req.params.id]));
      if (!current) throw new HttpError(404, 'Request not found');
      if (current.status === to && to !== 'clarification_requested') return { status: 200, body: current };
      if (!from.includes(current.status)) {
        throw new HttpError(409, `Cannot move request from '${current.status}' to '${to}'.`);
      }
      const now = new Date();
      const { fields, timeline, comment } = build(current, req, stamp(now), now.toISOString());
      const next = {
        ...fields,
        status: to,
        timeline: JSON.stringify([...current.timeline, timeline]),
        comments: JSON.stringify(comment ? [...current.comments, comment] : current.comments),
        updatedAt: now.toISOString(),
      };
      const cols = Object.keys(next);
      // Conditional update: succeeds only if nobody changed the status meanwhile.
      const r = await q.run(
        `UPDATE requests SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ? AND status = ?`,
        [...cols.map(c => (next as any)[c]), req.params.id, current.status]
      );
      if (r.changes !== 1) throw new HttpError(409, 'Request was modified concurrently; retry.');
      return { status: 200, body: parseRequest(await q.get('SELECT * FROM requests WHERE id = ?', [req.params.id])) };
    });

  app.put('/api/requests/:id/approve', transition('approved', ['pending', 'clarification_requested'], (cur, req, ts, iso) => {
    const { note, actorName } = req.body || {};
    return {
      fields: {},
      timeline: { id: newId('tl'), status: 'approved', title: 'تم اعتماد الطلب من مدير المؤسسة', description: note || `تمت مراجعة الطلب والموافقة عليه من ${actorName || 'المدير'}.`, actorName: actorName || 'المدير', timestamp: ts },
      comment: note
        ? { id: newId('comm'), authorId: 'user-admin', authorName: `${actorName || 'المدير'} (المدير العام)`, authorRole: 'org_admin', content: note, type: 'internal_note', createdAt: iso }
        : undefined,
    };
  }));

  app.put('/api/requests/:id/reject', transition('rejected', ['pending', 'clarification_requested', 'approved'], (cur, req, ts) => {
    const { reason, actorName } = req.body || {};
    if (!reason) throw new HttpError(400, 'reason is required');
    return {
      fields: { rejectionReason: reason },
      timeline: { id: newId('tl'), status: 'rejected', title: 'تم رفض طلب الصرف', description: `سبب الرفض: ${reason}`, actorName: actorName || 'المدير', timestamp: ts },
    };
  }));

  app.put('/api/requests/:id/clarify', transition('clarification_requested', ['pending', 'clarification_requested'], (cur, req, ts, iso) => {
    const { question, actorName } = req.body || {};
    if (!question) throw new HttpError(400, 'question is required');
    return {
      fields: {},
      timeline: { id: newId('tl'), status: 'clarification_requested', title: 'طُلب توضيح من مدير المؤسسة', description: question, actorName: actorName || 'المدير', timestamp: ts },
      comment: { id: newId('comm'), authorId: 'user-admin', authorName: `${actorName || 'المدير'} (المدير)`, authorRole: 'org_admin', content: question, type: 'clarification_request', createdAt: iso },
    };
  }));

  app.put('/api/requests/:id/reply', transition('pending', ['clarification_requested'], (cur, req, ts, iso) => {
    const { replyText, attachmentName, actorName } = req.body || {};
    if (!replyText) throw new HttpError(400, 'replyText is required');
    const attachments = attachmentName
      ? [...cur.attachments, { id: newId('att'), name: attachmentName, size: '850 KB', type: 'pdf', uploadedAt: ts }]
      : cur.attachments;
    return {
      fields: { attachments: JSON.stringify(attachments) },
      timeline: { id: newId('tl'), status: 'pending', title: 'قام طالب الصرف بتقديم التوضيح والمستندات', description: replyText, actorName: actorName || 'طالب الصرف', timestamp: ts },
      comment: { id: newId('comm'), authorId: 'user-employee', authorName: actorName || 'طالب الصرف', authorRole: 'employee', content: replyText, type: 'clarification_reply', createdAt: iso, attachmentName },
    };
  }));

  // Disburse: one atomic transaction for status + service budget + provider totals.
  app.put('/api/requests/:id/disburse', mutation(async (req, q) => {
    const { paymentMethod, referenceNumber, bankName, notes, actorName } = req.body || {};
    if (!referenceNumber) throw new HttpError(400, 'referenceNumber is required');
    const current = parseRequest(await q.get('SELECT * FROM requests WHERE id = ?', [req.params.id]));
    if (!current) throw new HttpError(404, 'Request not found');
    if (current.status === 'disbursed') return { status: 200, body: current }; // never pay twice
    if (current.status !== 'approved') {
      throw new HttpError(400, `Cannot disburse request with status '${current.status}'. Must be approved.`);
    }
    const now = new Date();
    const ts = stamp(now);
    const disbursement = { paymentMethod, referenceNumber, bankName: bankName || 'المصرف الرئيسي', notes, disbursedAt: ts, disbursedBy: actorName || 'المدير العام' };
    const methodLabel = paymentMethod === 'bank_transfer' ? 'تحويل بنكي' : paymentMethod === 'cash' ? 'نقداً / خزينة' : 'شيك مصرفي';
    const timeline = [...current.timeline, {
      id: newId('tl'), status: 'disbursed', title: 'تم تنفيذ وصرف المبلغ المالي بنجاح',
      description: `طريقة الصرف: ${methodLabel} | رقم المرجع: ${referenceNumber}`, actorName: actorName || 'المدير العام', timestamp: ts,
    }];

    const r = await q.run(
      "UPDATE requests SET status = 'disbursed', disbursement = ?, timeline = ?, updatedAt = ? WHERE id = ? AND status = 'approved'",
      [JSON.stringify(disbursement), JSON.stringify(timeline), now.toISOString(), req.params.id]
    );
    if (r.changes !== 1) throw new HttpError(409, 'Request was modified concurrently; retry.');
    await q.run('UPDATE services SET spentAmount = spentAmount + ? WHERE id = ?', [current.amount, current.serviceCategoryId]);
    await q.run('UPDATE providers SET totalPaid = totalPaid + ? WHERE id = ?', [current.amount, current.providerId]);
    return { status: 200, body: parseRequest(await q.get('SELECT * FROM requests WHERE id = ?', [req.params.id])) };
  }));

  return app;
}
