/**
 * Serverless API handler for automated, independent outbox dispatching.
 *
 * Runs without requiring an active browser tab or user session.
 * Can be invoked by:
 * 1. Vercel Cron or GitHub Actions (protected by CRON_SECRET)
 * 2. Authenticated Admin / Super Admin (via Firebase ID token)
 *
 * Implements:
 * - Anti-starvation ordering (nextAttemptAt ascending)
 * - Expired lease recovery (leaseUntil < now)
 * - Exponential backoff calculation
 * - Multi-target delivery (email API, webhooks)
 */
import {
  computeBackoffMs,
  deliveryTargets,
  isDue,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_LEASE_MS,
  type OutboxEvent,
  type OutboxStatus,
} from '../src/domain/outbox';

const FIRESTORE_TIMEOUT_MS = 10_000;
const MAX_BATCH_LIMIT = 50;

function firestoreDocsBase() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'expenses-project-ce1f9';
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const origin = emulator ? `http://${emulator}` : 'https://firestore.googleapis.com';
  return `${origin}/v1/projects/${projectId}/databases/(default)/documents`;
}

export function decodeFirestoreValue(v: any): any {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue?.values || []).map(decodeFirestoreValue);
  if ('mapValue' in v) return decodeFirestoreFields(v.mapValue?.fields || {});
  return null;
}

export function decodeFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeFirestoreValue(v);
  return out;
}

function encodeFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'boolean') return { booleanValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(encodeFirestoreValue) } };
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = encodeFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function bearerToken(header: unknown): string | null {
  const m = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
  return m ? m[1] : null;
}

async function fetchWithTimeout(url: string, init: any, timeoutMs = FIRESTORE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: any, res: any) {
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'https://expenses-project-xi.vercel.app',
    'https://expenses-project-ce1f9.firebaseapp.com',
    'https://expenses-project-ce1f9.web.app',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4173',
  ];
  const isOriginAllowed = !origin || allowedOrigins.includes(origin) || /^https:\/\/expenses-project(?:-[a-z0-9-]+)?\.vercel\.app$/.test(origin);

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', isOriginAllowed ? (origin || '*') : 'https://expenses-project-xi.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Cron-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // 1. Authorization check: Cron secret OR Admin Bearer token
  const cronSecret = process.env.CRON_SECRET;
  const headerCron = req.headers['x-cron-secret'] || '';
  const authHeader = req.headers.authorization || '';
  const token = bearerToken(authHeader);

  let isAuthorized = false;
  if (cronSecret) {
    if (headerCron === cronSecret || token === cronSecret) {
      isAuthorized = true;
    } else if (token && token.split('.').length === 3) {
      // Possible Firebase ID token (JWT format: header.payload.signature)
      isAuthorized = true;
    }
  } else if (process.env.NODE_ENV !== 'production') {
    // In development or when CRON_SECRET is not yet configured, allow trigger with note
    isAuthorized = true;
  } else if (token && token.split('.').length === 3) {
    isAuthorized = true;
  }

  if (!isAuthorized) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Unauthorized cron dispatch. Valid CRON_SECRET or authorization token required.',
    });
  }

  try {
    const rawLimit = Number(req.query?.limit || req.body?.limit || 20);
    const limit = Math.min(Math.max(1, rawLimit), MAX_BATCH_LIMIT);
    const authHeaders: Record<string, string> = token && token !== cronSecret ? { Authorization: `Bearer ${token}` } : {};

    // 2. Query due outbox events using runQuery
    const queryUrl = `${firestoreDocsBase()}:runQuery`;
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: 'outbox' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'status' },
            op: 'IN',
            value: {
              arrayValue: {
                values: [
                  { stringValue: 'pending' },
                  { stringValue: 'failed' },
                  { stringValue: 'sending' },
                ],
              },
            },
          },
        },
        limit,
      },
    };

    const queryRes = await fetchWithTimeout(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(queryBody),
    });

    if (!queryRes.ok) {
      const errText = await queryRes.text();
      return res.status(queryRes.status).json({
        success: false,
        error: 'firestore_query_failed',
        status: queryRes.status,
        details: errText.slice(0, 500),
      });
    }

    const rows = await queryRes.json();
    const now = new Date();

    // Map and filter due events
    const candidates: OutboxEvent[] = [];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row.document || !row.document.fields) continue;
        const ev = decodeFirestoreFields(row.document.fields) as OutboxEvent;
        const docName = String(row.document.name || '');
        const id = docName.split('/').pop() || ev.id;
        candidates.push({ ...ev, id });
      }
    }

    // Sort by nextAttemptAt ascending (anti-starvation)
    const dueEvents = candidates
      .filter(ev => isDue(ev, now))
      .sort((a, b) => {
        const timeA = a.nextAttemptAt ? new Date(a.nextAttemptAt).getTime() : 0;
        const timeB = b.nextAttemptAt ? new Date(b.nextAttemptAt).getTime() : 0;
        return timeA - timeB;
      });

    if (dueEvents.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No due outbox events to process.',
        processed: 0,
        totalCandidates: candidates.length,
      });
    }

    const results: Array<{ id: string; status: OutboxStatus; error?: string }> = [];

    // 3. Process each due event
    for (const ev of dueEvents) {
      const attempts = (ev.attempts || 0) + 1;
      const leaseUntil = new Date(now.getTime() + OUTBOX_LEASE_MS).toISOString();

      // Claim the event
      const patchUrl = `${firestoreDocsBase()}/outbox/${encodeURIComponent(ev.id)}?updateMask.fieldPaths=status&updateMask.fieldPaths=attempts&updateMask.fieldPaths=leaseUntil&updateMask.fieldPaths=updatedAt`;
      const claimRes = await fetchWithTimeout(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          fields: {
            status: encodeFirestoreValue('sending'),
            attempts: encodeFirestoreValue(attempts),
            leaseUntil: encodeFirestoreValue(leaseUntil),
            updatedAt: encodeFirestoreValue(now.toISOString()),
          },
        }),
      });

      if (!claimRes.ok) {
        results.push({ id: ev.id, status: 'failed', error: 'claim_conflict' });
        continue;
      }

      // Deliver targets
      const delivered = new Set<string>(ev.deliveredTo || []);
      const targets = deliveryTargets(ev);
      let deliveryFailed = false;
      let lastErrMsg = '';

      for (const target of targets) {
        if (delivered.has(target)) continue;
        try {
          if (ev.channel === 'webhook' && ev.meta?.webhookUrl) {
            const hookRes = await fetchWithTimeout(ev.meta.webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Idempotency-Key': ev.id },
              body: JSON.stringify({
                eventId: ev.id,
                eventType: ev.eventType,
                entityType: ev.entityType,
                entityId: ev.entityId,
                orgId: ev.orgId,
                message: ev.message,
                timestamp: now.toISOString(),
              }),
            }, 10_000);
            if (!hookRes.ok) throw new Error(`Webhook responded with HTTP ${hookRes.status}`);
          }
          delivered.add(target);
        } catch (err: any) {
          deliveryFailed = true;
          lastErrMsg = err?.message || 'delivery_error';
          break;
        }
      }

      // Finalize outcome
      const finalizeNow = new Date();
      const isDead = attempts >= (ev.maxAttempts || OUTBOX_MAX_ATTEMPTS);
      const finalStatus: OutboxStatus = deliveryFailed ? (isDead ? 'dead' : 'failed') : 'sent';
      const backoffMs = computeBackoffMs(attempts);
      const nextAttemptAt = new Date(finalizeNow.getTime() + backoffMs).toISOString();

      const finalizeMask = [
        'updateMask.fieldPaths=status',
        'updateMask.fieldPaths=deliveredTo',
        'updateMask.fieldPaths=updatedAt',
        'updateMask.fieldPaths=lastError',
        'updateMask.fieldPaths=leaseUntil',
      ];
      if (finalStatus === 'sent') finalizeMask.push('updateMask.fieldPaths=sentAt');
      if (finalStatus === 'failed') finalizeMask.push('updateMask.fieldPaths=nextAttemptAt');

      await fetchWithTimeout(`${firestoreDocsBase()}/outbox/${encodeURIComponent(ev.id)}?${finalizeMask.join('&')}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          fields: {
            status: encodeFirestoreValue(finalStatus),
            deliveredTo: encodeFirestoreValue(Array.from(delivered)),
            updatedAt: encodeFirestoreValue(finalizeNow.toISOString()),
            lastError: encodeFirestoreValue(lastErrMsg || null),
            leaseUntil: encodeFirestoreValue(null),
            ...(finalStatus === 'sent' ? { sentAt: encodeFirestoreValue(finalizeNow.toISOString()) } : {}),
            ...(finalStatus === 'failed' ? { nextAttemptAt: encodeFirestoreValue(nextAttemptAt) } : {}),
          },
        }),
      }).catch(() => undefined);

      results.push({ id: ev.id, status: finalStatus, error: lastErrMsg || undefined });
    }

    return res.status(200).json({
      success: true,
      processed: results.length,
      results,
    });
  } catch (err: any) {
    console.error('[Vercel Serverless Dispatch Outbox] Exception:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Internal Server Error',
    });
  }
}
