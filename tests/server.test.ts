/**
 * Phase 5 — HTTP-level duplicate tests against the Express/SQLite API
 * (real server on an ephemeral port, real SQLite file, concurrent requests).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../server/app';
import { initDB, openDatabase, isSqliteAvailable, type Database } from '../server/db';

describe.skipIf(!isSqliteAvailable())('Express/SQLite API duplicate tests', () => {
  let db: Database;
  let server: Server;
  let base = '';
  let dir = '';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'expenses-api-'));
    db = await openDatabase(path.join(dir, 'test.sqlite'));
    await initDB(db);
    await db.transaction(async q => {
      await q.run("INSERT INTO services (id, orgId, name, code, description, budgetLimit, spentAmount, color, iconName) VALUES ('srv-1','org-1','Cloud','CLD','',100000,0,'#000','x')");
      await q.run("INSERT INTO providers (id, orgId, name, serviceCategoryIds, serviceCategoryNames, totalPaid, active) VALUES ('prov-1','org-1','AWS','[]','[]',0,1)");
    });
    server = createApp(db).listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise(r => server.close(r));
    if (db) await db.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const body = (extra: Record<string, any> = {}) => ({
    orgId: 'org-1', requesterId: 'u1', requesterName: 'Emp', serviceCategoryId: 'srv-1', serviceCategoryName: 'Cloud',
    providerId: 'prov-1', providerName: 'AWS', title: 'Servers', description: 'd', justification: 'j', amount: 250, currency: 'EGP',
    ...extra,
  });

  const post = (url: string, data: any, key?: string) =>
    fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(data) });
  const put = (url: string, data: any, key?: string) =>
    fetch(base + url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(data) });
  const count = async (sql: string, params: any[] = []) => (await db.read(q => q.get<{ n: number }>(sql, params)))!.n;

  describe('POST /api/requests', () => {
    it('two concurrent POSTs with the same Idempotency-Key → one row; the replay returns the same record', async () => {
      const key = randomUUID();
      const title = `idem-${key}`;
      const [a, b] = await Promise.all([post('/api/requests', body({ title }), key), post('/api/requests', body({ title }), key)]);
      const [ja, jb] = [await a.json(), await b.json()];
      expect(ja.id).toBe(jb.id);
      expect(ja.requestNumber).toBe(jb.requestNumber);
      expect([a.headers.get('idempotent-replayed'), b.headers.get('idempotent-replayed')]).toContain('true');
      expect(await count('SELECT COUNT(*) n FROM requests WHERE title = ?', [title])).toBe(1);
    });

    it('rapid ×10 with the same key → one row', async () => {
      const key = randomUUID();
      const title = `burst-${key}`;
      await Promise.all(Array.from({ length: 10 }, () => post('/api/requests', body({ title }), key)));
      expect(await count('SELECT COUNT(*) n FROM requests WHERE title = ?', [title])).toBe(1);
    });

    it('same key with a different payload → 422, nothing written', async () => {
      const key = randomUUID();
      expect((await post('/api/requests', body({ title: `k-${key}` }), key)).status).toBe(201);
      const res = await post('/api/requests', body({ title: `k-${key}`, amount: 999 }), key);
      expect(res.status).toBe(422);
      expect(await count('SELECT COUNT(*) n FROM requests WHERE title = ?', [`k-${key}`])).toBe(1);
    });

    it('the client-generated ID is honoured: a retried POST without a key does not create a second request', async () => {
      const id = `req-${randomUUID()}`;
      const first = await post('/api/requests', body({ id }));
      const retry = await post('/api/requests', body({ id }));
      expect(first.status).toBe(201);
      expect(retry.status).toBe(200);
      expect((await first.json()).id).toBe(id);
      expect(await count('SELECT COUNT(*) n FROM requests WHERE id = ?', [id])).toBe(1);
    });

    it('20 concurrent DIFFERENT requests → 20 unique request numbers (no COUNT(*)+1 race)', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => post('/api/requests', body(), randomUUID()).then(r => r.json())));
      const numbers = results.map((r: any) => r.requestNumber);
      expect(new Set(numbers).size).toBe(20);
      const dupes = await count('SELECT COUNT(*) n FROM (SELECT requestNumber FROM requests GROUP BY requestNumber HAVING COUNT(*) > 1)');
      expect(dupes).toBe(0);
    });
  });

  describe('state transitions', () => {
    const create = async () => (await (await post('/api/requests', body(), randomUUID())).json()).id as string;

    it('two concurrent approvals → one transition, one timeline entry', async () => {
      const id = await create();
      const [a, b] = await Promise.all([put(`/api/requests/${id}/approve`, { actorName: 'A' }), put(`/api/requests/${id}/approve`, { actorName: 'B' })]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const row = await db.read(q => q.get<any>('SELECT * FROM requests WHERE id = ?', [id]));
      expect(row.status).toBe('approved');
      expect(JSON.parse(row.timeline).filter((t: any) => t.status === 'approved')).toHaveLength(1);
    });

    it('two concurrent payments → paid once (budget and provider totals incremented once)', async () => {
      const id = await create();
      await put(`/api/requests/${id}/approve`, {});
      const spentBefore = (await db.read(q => q.get<any>("SELECT spentAmount FROM services WHERE id = 'srv-1'"))).spentAmount;
      const paidBefore = (await db.read(q => q.get<any>("SELECT totalPaid FROM providers WHERE id = 'prov-1'"))).totalPaid;
      const results = await Promise.all(Array.from({ length: 5 }, () => put(`/api/requests/${id}/disburse`, { paymentMethod: 'cash', referenceNumber: 'R1' })));
      expect(results.every(r => r.status === 200)).toBe(true);
      const spentAfter = (await db.read(q => q.get<any>("SELECT spentAmount FROM services WHERE id = 'srv-1'"))).spentAmount;
      const paidAfter = (await db.read(q => q.get<any>("SELECT totalPaid FROM providers WHERE id = 'prov-1'"))).totalPaid;
      expect(spentAfter - spentBefore).toBe(250);
      expect(paidAfter - paidBefore).toBe(250);
    });

    it('a disbursed request cannot be rejected or re-approved', async () => {
      const id = await create();
      await put(`/api/requests/${id}/approve`, {});
      await put(`/api/requests/${id}/disburse`, { paymentMethod: 'cash', referenceNumber: 'R2' });
      expect((await put(`/api/requests/${id}/reject`, { reason: 'late' })).status).toBe(409);
      const row = await db.read(q => q.get<any>('SELECT status FROM requests WHERE id = ?', [id]));
      expect(row.status).toBe('disbursed');
    });
  });

  describe('uniqueness constraints', () => {
    it('duplicate member email in the same org → 409', async () => {
      const m = { orgId: 'org-1', userName: 'Ali', userEmail: 'Ali@Example.com' };
      expect((await post('/api/members', m, randomUUID())).status).toBe(201);
      expect((await post('/api/members', { ...m, userEmail: 'ali@example.com' }, randomUUID())).status).toBe(409);
    });

    it('duplicate organization code → 409', async () => {
      const o = { name: 'Org', code: 'DUPX', currency: 'EGP', budget: 1 };
      expect((await post('/api/organizations', o, randomUUID())).status).toBe(201);
      expect((await post('/api/organizations', { ...o, name: 'Other' }, randomUUID())).status).toBe(409);
    });
  });
});
