import { describe, expect, it } from 'vitest';
import {
  buildBackupFile,
  checkRecord,
  readBackupFile,
  readLegacySnapshot,
  restoreBlock,
  restoreRecord,
  type RestoreContext,
} from '../src/domain/legacyRecovery';
import { ORG, admin, employee, freshStore, seedAccount } from './helpers';

const owner = { ...admin, id: 'uidOwner00000000000000000001', role: 'super_admin' as const };
const asOwner: RestoreContext = { actor: owner, orgId: ORG };
const asAdmin: RestoreContext = { actor: admin, orgId: ORG };
const asEmployee: RestoreContext = { actor: employee, orgId: ORG };

const local: Record<string, string> = {
  expenses_visa_requests_v3: JSON.stringify([
    { id: 'visa_1', orgId: ORG, requestNumber: 'VISA-2026-0001', travelerName: 'Ali', status: 'paid', totalAmount: 900, paidAmount: 900, payments: [{ id: 'p1', amount: 900 }], requesterId: employee.id },
    { id: 'visa_2', orgId: ORG, requestNumber: 'VISA-2026-0002', travelerName: 'Mona', status: 'pending', totalAmount: 500, requesterId: employee.id },
    { id: 'visa_3', orgId: ORG, travelerName: 'no status' },
    { id: 'visa_other', orgId: 'org-other', status: 'pending', requesterId: employee.id },
    { id: 'visa_2', orgId: ORG, travelerName: 'duplicate id in the same store' },
    { id: 'req-101', orgId: ORG }, // demo id → ignored
    { id: '..', orgId: ORG }, // invalid Firestore id → ignored
    null,
    'garbage',
  ]),
  expenses_departments_v3: JSON.stringify([
    { id: 'dept-1', orgId: ORG, name: 'IT' },
    { id: 'dept-2', orgId: ORG, name: 'it' }, // same name, different id
  ]),
  expenses_services_v3: JSON.stringify([{ id: 'srv-1', orgId: ORG, name: 'LOCAL STALE COPY', budgetLimit: 1 }]),
  expenses_payment_accounts_v3: JSON.stringify([{ id: 'acc-deleted', orgId: ORG, name: 'Old', currentBalance: 99999 }]),
  expenses_account_transactions_v3: JSON.stringify([{ id: 'tx-old', orgId: ORG, accountId: 'acc-live', amount: 500 }]),
  expenses_members_v3: JSON.stringify([{ id: 'u_org', orgId: ORG, role: 'org_admin', userEmail: 'revoked@x.test' }]),
  expenses_requests_v3: 'not json',
};
const snapshot = () => readLegacySnapshot(k => local[k] ?? null);
const find = (id: string) => snapshot().flatMap(s => s.records).find(r => r.id === id)!;

describe('legacy localStorage recovery', () => {
  it('parses stores, skips demo ids, invalid ids, duplicates, junk and unparseable stores', () => {
    const snap = snapshot();
    expect(snap.map(s => s.store.collection).sort()).toEqual(['accountTransactions', 'departments', 'members', 'paymentAccounts', 'services', 'visaRequests']);
    expect(snap.find(s => s.store.collection === 'visaRequests')!.records.map(r => r.id)).toEqual(['visa_1', 'visa_2', 'visa_3', 'visa_other']);
  });

  it('restores missing visa requests with their original ids and state (owner), leaving a marker and an audit entry', async () => {
    const store = freshStore();
    expect(await checkRecord(store, find('visa_1'))).toBe('missing');
    const res = await restoreRecord(store, asOwner, find('visa_1'), 'browser');
    expect(res.outcome).toBe('restored');
    const doc = store.read('visaRequests', 'visa_1')!;
    expect(doc.status).toBe('paid');
    expect(doc.payments).toHaveLength(1);
    expect(doc.restoredFromLocalStorage).toBe(true);
    expect(store.read('legacyRestores', 'visaRequests__visa_1')).toBeTruthy();
    expect(store.dump('auditLogs').filter(a => a.orgId === ORG)).toHaveLength(1);
  });

  it('NEVER overwrites an existing document (a stale local copy cannot clobber live data)', async () => {
    const store = freshStore(); // srv-1 exists in Firestore with budgetLimit 50000
    expect(await checkRecord(store, find('srv-1'))).toBe('exists');
    expect((await restoreRecord(store, asOwner, find('srv-1'), 'browser')).outcome).toBe('exists');
    expect(store.read('services', 'srv-1')!.budgetLimit).toBe(50000);
  });

  it('a record restored once and later deleted on purpose is never brought back', async () => {
    const store = freshStore();
    await restoreRecord(store, asOwner, find('visa_2'), 'browser');
    await store.runTransaction(async tx => tx.delete('visaRequests', 'visa_2')); // someone deletes it deliberately
    expect(await checkRecord(store, find('visa_2'))).toBe('handled');
    expect((await restoreRecord(store, asOwner, find('visa_2'), 'file')).outcome).toBe('handled');
    expect(store.read('visaRequests', 'visa_2')).toBeNull();
  });

  it('financial stores, memberships and organizations are backup-only (never written back)', async () => {
    const store = freshStore();
    seedAccount(store, 'acc-live', 1000);
    for (const id of ['acc-deleted', 'tx-old', 'u_org']) {
      expect((await restoreRecord(store, asOwner, find(id), 'browser')).outcome).toBe('backup_only');
    }
    expect(store.read('paymentAccounts', 'acc-deleted')).toBeNull();
    expect(store.read('accountTransactions', 'tx-old')).toBeNull();
    expect(store.read('members', 'u_org')).toBeNull();
    expect(store.read('paymentAccounts', 'acc-live')!.currentBalance).toBe(1000);
  });

  it('restoring cannot create a second department with the same name (unique key claimed)', async () => {
    const store = freshStore();
    expect((await restoreRecord(store, asAdmin, find('dept-1'), 'browser')).outcome).toBe('restored');
    expect((await restoreRecord(store, asAdmin, find('dept-2'), 'browser')).outcome).toBe('duplicate');
    expect(store.read('departments', 'dept-2')).toBeNull();
  });

  it('mirrors the create rules: non-pending/status-less → owner only; other org → refused; employee only own pending', async () => {
    expect(restoreBlock(asAdmin, find('visa_1'))).toBe('needs_owner');
    expect(restoreBlock(asAdmin, find('visa_3'))).toBe('needs_owner'); // missing status is NOT treated as pending
    expect(restoreBlock(asAdmin, find('visa_other'))).toBe('other_org');
    expect(restoreBlock(asEmployee, find('visa_2'))).toBeNull(); // own pending visa
    expect(restoreBlock(asEmployee, find('dept-1'))).toBe('no_permission');
    expect(restoreBlock(asOwner, find('visa_other'))).toBeNull();
    const store = freshStore();
    expect((await restoreRecord(store, asAdmin, find('visa_1'), 'browser')).outcome).toBe('needs_owner');
    expect(store.read('visaRequests', 'visa_1')).toBeNull();
  });

  it('is idempotent: restoring twice creates one document and never changes it', async () => {
    const store = freshStore();
    await restoreRecord(store, asAdmin, find('dept-1'), 'browser');
    const first = store.read('departments', 'dept-1');
    expect((await restoreRecord(store, asAdmin, find('dept-1'), 'browser')).outcome).toBe('handled');
    expect(store.read('departments', 'dept-1')).toEqual(first);
  });

  it('round-trips a downloadable backup file', () => {
    const file = buildBackupFile(snapshot(), { exportedAt: '2026-09-29T00:00:00.000Z' });
    const back = readBackupFile(file);
    expect(back.flatMap(s => s.records).length).toBe(snapshot().flatMap(s => s.records).length);
    expect(() => readBackupFile('[]')).toThrow();
  });
});
