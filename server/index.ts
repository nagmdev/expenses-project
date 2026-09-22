import express from 'express';
import cors from 'cors';
import { initDB, dbAll, dbRun, dbGet } from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;

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
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS policy'));
    }
  },
  credentials: true,
}));

app.use(express.json());

// Initialize database
await initDB();

// ======================= ORGANIZATIONS =======================
app.get('/api/organizations', async (req, res) => {
  try {
    const orgs = await dbAll('SELECT * FROM organizations ORDER BY createdAt DESC');
    res.json(orgs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/organizations', async (req, res) => {
  try {
    const { name, code, currency, budget, description } = req.body;
    const id = `org-${Date.now()}`;
    const createdAt = new Date().toISOString();
    
    await dbRun(
      'INSERT INTO organizations (id, name, code, currency, budget, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, code, currency, Number(budget) || 0, description || '', createdAt]
    );

    // Automatically create default admin member for the new org
    const memberId = `mem-${Date.now()}`;
    await dbRun(
      'INSERT INTO members (id, orgId, userId, userName, userEmail, role, department, jobTitle, joinedAt, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [memberId, id, 'user-admin', 'المدير العام', 'admin@org.com', 'org_admin', 'الإدارة العامة', 'المدير العام', createdAt.split('T')[0], 1]
    );

    const created = await dbGet('SELECT * FROM organizations WHERE id = ?', [id]);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ======================= MEMBERS =======================
app.get('/api/members', async (req, res) => {
  try {
    const { orgId } = req.query;
    let members;
    if (orgId && orgId !== 'all') {
      members = await dbAll('SELECT * FROM members WHERE orgId = ? ORDER BY joinedAt DESC', [String(orgId)]);
    } else {
      members = await dbAll('SELECT * FROM members ORDER BY joinedAt DESC');
    }
    res.json(members.map(m => ({ ...m, active: Boolean(m.active) })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/members', async (req, res) => {
  try {
    const { orgId, userId, userName, userEmail, role, department, jobTitle } = req.body;
    const id = `mem-${Date.now()}`;
    const joinedAt = new Date().toISOString().split('T')[0];

    await dbRun(
      'INSERT INTO members (id, orgId, userId, userName, userEmail, role, department, jobTitle, joinedAt, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, orgId, userId || `user-${Date.now()}`, userName, userEmail, role || 'employee', department || '', jobTitle || '', joinedAt, 1]
    );

    const created = await dbGet('SELECT * FROM members WHERE id = ?', [id]);
    res.status(201).json({ ...created, active: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/members/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM members WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ======================= SERVICES =======================
app.get('/api/services', async (req, res) => {
  try {
    const { orgId } = req.query;
    let services;
    if (orgId && orgId !== 'all') {
      services = await dbAll('SELECT * FROM services WHERE orgId = ?', [String(orgId)]);
    } else {
      services = await dbAll('SELECT * FROM services');
    }
    res.json(services);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const { orgId, name, code, description, budgetLimit, color, iconName } = req.body;
    const id = `srv-${Date.now()}`;

    await dbRun(
      'INSERT INTO services (id, orgId, name, code, description, budgetLimit, spentAmount, color, iconName) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, orgId, name, code || 'SRV', description || '', Number(budgetLimit) || 0, 0, color || '#10b981', iconName || 'Layers']
    );

    const created = await dbGet('SELECT * FROM services WHERE id = ?', [id]);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/services/:id', async (req, res) => {
  try {
    const { name, code, description, budgetLimit, color } = req.body;
    await dbRun(
      'UPDATE services SET name = ?, code = ?, description = ?, budgetLimit = ?, color = ? WHERE id = ?',
      [name, code, description, Number(budgetLimit) || 0, color, req.params.id]
    );
    const updated = await dbGet('SELECT * FROM services WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/services/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM services WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ======================= PROVIDERS =======================
app.get('/api/providers', async (req, res) => {
  try {
    const { orgId } = req.query;
    let rows;
    if (orgId && orgId !== 'all') {
      rows = await dbAll('SELECT * FROM providers WHERE orgId = ?', [String(orgId)]);
    } else {
      rows = await dbAll('SELECT * FROM providers');
    }
    const providers = rows.map(r => ({
      ...r,
      serviceCategoryIds: JSON.parse(r.serviceCategoryIds || '[]'),
      serviceCategoryNames: JSON.parse(r.serviceCategoryNames || '[]'),
      active: Boolean(r.active)
    }));
    res.json(providers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/providers', async (req, res) => {
  try {
    const { 
      orgId, name, serviceCategoryIds, serviceCategoryNames, contactPerson, 
      phone, email, taxNumber, crNumber, bankName, iban, address, rating, notes 
    } = req.body;

    const id = `prov-${Date.now()}`;
    await dbRun(
      `INSERT INTO providers (
        id, orgId, name, serviceCategoryIds, serviceCategoryNames, contactPerson,
        phone, email, taxNumber, crNumber, bankName, iban, address, rating, totalPaid, active, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, orgId, name, 
        JSON.stringify(serviceCategoryIds || []),
        JSON.stringify(serviceCategoryNames || []),
        contactPerson || '', phone || '', email || '', taxNumber || '', crNumber || '',
        bankName || '', iban || '', address || '', Number(rating) || 5.0, 0, 1, notes || ''
      ]
    );

    const created = await dbGet('SELECT * FROM providers WHERE id = ?', [id]);
    res.status(201).json({
      ...created,
      serviceCategoryIds: JSON.parse(created.serviceCategoryIds || '[]'),
      serviceCategoryNames: JSON.parse(created.serviceCategoryNames || '[]'),
      active: true
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/providers/:id', async (req, res) => {
  try {
    const { 
      name, serviceCategoryIds, serviceCategoryNames, contactPerson, 
      phone, email, taxNumber, crNumber, bankName, iban, address, rating, notes 
    } = req.body;

    await dbRun(
      `UPDATE providers SET 
        name = ?, serviceCategoryIds = ?, serviceCategoryNames = ?, contactPerson = ?,
        phone = ?, email = ?, taxNumber = ?, crNumber = ?, bankName = ?, iban = ?,
        address = ?, rating = ?, notes = ?
      WHERE id = ?`,
      [
        name,
        JSON.stringify(serviceCategoryIds || []),
        JSON.stringify(serviceCategoryNames || []),
        contactPerson, phone, email, taxNumber, crNumber, bankName, iban,
        address, Number(rating) || 5.0, notes, req.params.id
      ]
    );

    const updated = await dbGet('SELECT * FROM providers WHERE id = ?', [req.params.id]);
    res.json({
      ...updated,
      serviceCategoryIds: JSON.parse(updated.serviceCategoryIds || '[]'),
      serviceCategoryNames: JSON.parse(updated.serviceCategoryNames || '[]'),
      active: Boolean(updated.active)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/providers/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM providers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ======================= REQUESTS =======================
const parseRequest = (row: any) => {
  if (!row) return null;
  return {
    ...row,
    attachments: JSON.parse(row.attachments || '[]'),
    comments: JSON.parse(row.comments || '[]'),
    timeline: JSON.parse(row.timeline || '[]'),
    disbursement: row.disbursement ? JSON.parse(row.disbursement) : undefined
  };
};

app.get('/api/requests', async (req, res) => {
  try {
    const { orgId } = req.query;
    let rows;
    if (orgId && orgId !== 'all') {
      rows = await dbAll('SELECT * FROM requests WHERE orgId = ? ORDER BY createdAt DESC', [String(orgId)]);
    } else {
      rows = await dbAll('SELECT * FROM requests ORDER BY createdAt DESC');
    }
    res.json(rows.map(parseRequest));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/requests', async (req, res) => {
  try {
    const { 
      orgId, requesterId, requesterName, requesterDepartment,
      serviceCategoryId, serviceCategoryName, providerId, providerName,
      title, description, justification, amount, currency, urgency, attachmentNames 
    } = req.body;

    const countRow = await dbGet('SELECT COUNT(*) as count FROM requests');
    const seq = (countRow?.count || 0) + 1;
    const requestNumber = `REQ-2026-${String(seq).padStart(3, '0')}`;
    const id = `req-${Date.now()}`;
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const attachments = (attachmentNames || []).map((name: string, i: number) => ({
      id: `att-${Date.now()}-${i}`,
      name,
      size: '1.2 MB',
      type: 'pdf',
      uploadedAt: dateFormatted
    }));

    const timeline = [{
      id: `tl-${Date.now()}`,
      status: 'created',
      title: 'تم تقديم طلب الصرف',
      description: `قدم ${requesterName} طلباً بمبلغ ${Number(amount).toLocaleString()} ${currency} لبند ${serviceCategoryName}.`,
      actorName: requesterName,
      timestamp: dateFormatted
    }];

    await dbRun(
      `INSERT INTO requests (
        id, requestNumber, orgId, requesterId, requesterName, requesterDepartment,
        serviceCategoryId, serviceCategoryName, providerId, providerName,
        title, description, justification, amount, currency, status, urgency,
        attachments, comments, timeline, disbursement, rejectionReason, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, requestNumber, orgId, requesterId, requesterName, requesterDepartment || 'الشؤون الإدارية',
        serviceCategoryId, serviceCategoryName, providerId, providerName,
        title, description, justification, Number(amount), currency, 'pending', urgency || 'medium',
        JSON.stringify(attachments), JSON.stringify([]), JSON.stringify(timeline),
        null, null, now.toISOString(), now.toISOString()
      ]
    );

    const created = await dbGet('SELECT * FROM requests WHERE id = ?', [id]);
    res.status(201).json(parseRequest(created));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Approve
app.put('/api/requests/:id/approve', async (req, res) => {
  try {
    const { note, actorName } = req.body;
    const reqRow = await dbGet('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });

    const current = parseRequest(reqRow);
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const timeline = [
      ...current.timeline,
      {
        id: `tl-${Date.now()}`,
        status: 'approved',
        title: 'تم اعتماد الطلب من مدير المؤسسة',
        description: note || `تمت مراجعة الطلب والموافقة عليه من ${actorName || 'المدير'}.`,
        actorName: actorName || 'المدير',
        timestamp: dateFormatted
      }
    ];

    const comments = [...current.comments];
    if (note) {
      comments.push({
        id: `comm-${Date.now()}`,
        authorId: 'user-admin',
        authorName: `${actorName || 'المدير'} (المدير العام)`,
        authorRole: 'org_admin',
        content: note,
        type: 'internal_note',
        createdAt: now.toISOString()
      });
    }

    await dbRun(
      'UPDATE requests SET status = ?, timeline = ?, comments = ?, updatedAt = ? WHERE id = ?',
      ['approved', JSON.stringify(timeline), JSON.stringify(comments), now.toISOString(), req.params.id]
    );

    const updated = await dbGet('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    res.json(parseRequest(updated));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reject
app.put('/api/requests/:id/reject', async (req, res) => {
  try {
    const { reason, actorName } = req.body;
    const reqRow = await dbGet('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });

    const current = parseRequest(reqRow);
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const timeline = [
      ...current.timeline,
      {
        id: `tl-${Date.now()}`,
        status: 'rejected',
        title: 'تم رفض طلب الصرف',
        description: `سبب الرفض: ${reason}`,
        actorName: actorName || 'المدير',
        timestamp: dateFormatted
      }
    ];

    await dbRun(
      'UPDATE requests SET status = ?, rejectionReason = ?, timeline = ?, updatedAt = ? WHERE id = ?',
      ['rejected', reason, JSON.stringify(timeline), now.toISOString(), req.params.id]
    );

    const updated = await dbGet('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    res.json(parseRequest(updated));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Clarify
app.put('/api/requests/:id/clarify', async (req, res) => {
  try {
    const { question, actorName } = req.body;
    const reqRow = await dbGet('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });

    const current = parseRequest(reqRow);
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const comment = {
      id: `comm-${Date.now()}`,
      authorId: 'user-admin',
      authorName: `${actorName || 'المدير'} (المدير)`,
      authorRole: 'org_admin',
      content: question,
      type: 'clarification_request',
      createdAt: now.toISOString()
    };

    const timeline = [
      ...current.timeline,
      {
        id: `tl-${Date.now()}`,
        status: 'clarification_requested',
        title: 'طُلب توضيح من مدير المؤسسة',
        description: question,
        actorName: actorName || 'المدير',
        timestamp: dateFormatted
      }
    ];

    await dbRun(
      'UPDATE requests SET status = ?, comments = ?, timeline = ?, updatedAt = ? WHERE id = ?',
      ['clarification_requested', JSON.stringify([...current.comments, comment]), JSON.stringify(timeline), now.toISOString(), req.params.id]
    );

    const updated = await dbGet('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    res.json(parseRequest(updated));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reply
app.put('/api/requests/:id/reply', async (req, res) => {
  try {
    const { replyText, attachmentName, actorName } = req.body;
    const reqRow = await dbGet('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });

    const current = parseRequest(reqRow);
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const comment = {
      id: `comm-${Date.now()}`,
      authorId: 'user-employee',
      authorName: actorName || 'طالب الصرف',
      authorRole: 'employee',
      content: replyText,
      type: 'clarification_reply',
      createdAt: now.toISOString(),
      attachmentName
    };

    const attachments = [...current.attachments];
    if (attachmentName) {
      attachments.push({
        id: `att-${Date.now()}`,
        name: attachmentName,
        size: '850 KB',
        type: 'pdf',
        uploadedAt: dateFormatted
      });
    }

    const timeline = [
      ...current.timeline,
      {
        id: `tl-${Date.now()}`,
        status: 'pending',
        title: 'قام طالب الصرف بتقديم التوضيح والمستندات',
        description: replyText,
        actorName: actorName || 'طالب الصرف',
        timestamp: dateFormatted
      }
    ];

    await dbRun(
      'UPDATE requests SET status = ?, comments = ?, attachments = ?, timeline = ?, updatedAt = ? WHERE id = ?',
      ['pending', JSON.stringify([...current.comments, comment]), JSON.stringify(attachments), JSON.stringify(timeline), now.toISOString(), req.params.id]
    );

    const updated = await dbGet('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    res.json(parseRequest(updated));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Disburse
app.put('/api/requests/:id/disburse', async (req, res) => {
  try {
    const { paymentMethod, referenceNumber, bankName, notes, actorName } = req.body;
    const reqRow = await dbGet('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });

    const current = parseRequest(reqRow);
    if (current.status !== 'approved') {
      return res.status(400).json({ error: `Cannot disburse request with status '${current.status}'. Must be approved.` });
    }
    const now = new Date();
    const dateFormatted = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const disbursement = {
      paymentMethod,
      referenceNumber,
      bankName: bankName || 'المصرف الرئيسي',
      notes,
      disbursedAt: dateFormatted,
      disbursedBy: actorName || 'المدير العام'
    };

    const methodLabel = 
      paymentMethod === 'bank_transfer' ? 'تحويل بنكي' :
      paymentMethod === 'cash' ? 'نقداً / خزينة' : 'شيك مصرفي';

    const timeline = [
      ...current.timeline,
      {
        id: `tl-${Date.now()}`,
        status: 'disbursed',
        title: 'تم تنفيذ وصرف المبلغ المالي بنجاح',
        description: `طريقة الصرف: ${methodLabel} | رقم المرجع: ${referenceNumber}`,
        actorName: actorName || 'المدير العام',
        timestamp: dateFormatted
      }
    ];

    await dbRun(
      'UPDATE requests SET status = ?, disbursement = ?, timeline = ?, updatedAt = ? WHERE id = ?',
      ['disbursed', JSON.stringify(disbursement), JSON.stringify(timeline), now.toISOString(), req.params.id]
    );

    // Update service spentAmount
    await dbRun(
      'UPDATE services SET spentAmount = spentAmount + ? WHERE id = ?',
      [current.amount, current.serviceCategoryId]
    );

    // Update provider totalPaid
    await dbRun(
      'UPDATE providers SET totalPaid = totalPaid + ? WHERE id = ?',
      [current.amount, current.providerId]
    );

    const updated = await dbGet('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    res.json(parseRequest(updated));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend API Server running on http://localhost:${PORT}`);
});
