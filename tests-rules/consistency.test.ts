/**
 * The owner's READ-ONLY financial consistency check (src/domain/reconciliation.ts) reads every
 * collection it needs with an unfiltered getDocs (AppContext → runFinancialConsistencyCheck).
 * The rules let only the platform owner list them whole; data written by the real domain
 * operations under the rules comes out clean.
 */
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import { createFirestoreStore } from '../src/domain/firestoreStore';
import { createExpenseRequest, disburseExpenseRequest, transitionExpenseRequest } from '../src/domain/requests';
import { adjustAccountBalance, createPaymentAccount, issueCustody, settleCustodyItem } from '../src/domain/treasury';
import { CONSISTENCY_COLLECTIONS, checkFinancialConsistency, type ConsistencyData } from '../src/domain/reconciliation';
import type { Actor } from '../src/domain/common';
import { DEFAULT_EMAIL_SETTINGS } from '../src/services/emailTemplates';

const ORG = 'org-acme';
const OTHER_ORG = 'org-other';
let env: RulesTestEnvironment;

const OWNER = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
const ADMIN = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
const EMP = { uid: 'uidEmployee0000000000000001', email: 'emp@acme.test' };
const FIN = { uid: 'uidFinance00000000000000001', email: 'fin@acme.test' };

const db = (u: { uid: string; email: string }, verified = true): Firestore =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore() as unknown as Firestore;
const store = (u: { uid: string; email: string }) => createFirestoreStore(db(u));
const actor = (u: { uid: string; email: string }, role: Actor['role'], orgId?: string): Actor => ({ id: u.uid, name: u.email, email: u.email, role, ...(orgId ? { orgId } : {}) });
const notify = { settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: false } };
let n = 0;
const key = () => `key-chk${String(++n).padStart(6, '0')}`;
const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));

/** What runFinancialConsistencyCheck does: every collection, unfiltered. */
async function readAll(f: Firestore): Promise<ConsistencyData> {
  const data: Record<string, unknown> = {};
  for (const name of CONSISTENCY_COLLECTIONS) {
    const snap = await getDocs(collection(f, name));
    data[name] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
  }
  return data as ConsistencyData;
}

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');
  env = await initializeTestEnvironment({ projectId: 'demo-expenses-rules', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } });
});
afterAll(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await seed(async f => {
    await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [] });
    await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [] });
    for (const [u, role] of [[ADMIN, 'org_admin'], [FIN, 'finance'], [EMP, 'employee']] as const) {
      await setDoc(doc(f, 'users', u.uid), { orgId: ORG, role, active: true });
      await setDoc(doc(f, 'members', `${u.uid}_${ORG}`), { orgId: ORG, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
    }
    await setDoc(doc(f, 'services', 'srv-1'), { id: 'srv-1', orgId: ORG, name: 'Cloud', code: 'CLD', budgetLimit: 0, spentAmount: 0, color: '#000', iconName: 'x', description: '' });
    await setDoc(doc(f, 'providers', 'prov-1'), { id: 'prov-1', orgId: ORG, name: 'AWS', totalPaid: 0, active: true });
    // A record of every collection in the other company too (the owner reads across companies).
    await setDoc(doc(f, 'paymentAccounts', 'acc-other'), { orgId: OTHER_ORG, name: 'O', type: 'cash', accountIdentifier: 'O', currency: 'EGP', active: true, balance: 0, currentBalance: 0, initialBalance: 0, totalIn: 0, totalOut: 0 });
    await setDoc(doc(f, 'accountTransactions', 'tx-other'), { orgId: OTHER_ORG, accountId: 'acc-x', type: 'in', amount: 1, referenceType: 'manual_adjustment', operationLedgerId: 'tx-other' });
    await setDoc(doc(f, 'requests', 'req-other'), { orgId: OTHER_ORG, status: 'pending', amount: 1, requesterId: 'someone', requesterEmail: 'x@other.test' });
    await setDoc(doc(f, 'visaRequests', 'visa-other'), { orgId: OTHER_ORG, status: 'pending', requesterId: 'someone' });
    await setDoc(doc(f, 'services', 'srv-other'), { orgId: OTHER_ORG, name: 'S', spentAmount: 0 });
    await setDoc(doc(f, 'providers', 'prov-other'), { orgId: OTHER_ORG, name: 'P', totalPaid: 0 });
    await setDoc(doc(f, 'custodies', 'cus-other'), { orgId: OTHER_ORG, employeeId: 'someone', employeeEmail: 'x@other.test', totalAmount: 0, remainingAmount: 0, settledAmount: 0 });
    await setDoc(doc(f, 'pettyCashCustodies', 'pc-other'), { orgId: OTHER_ORG, employeeId: 'someone', employeeEmail: 'x@other.test', totalAmount: 0, remainingAmount: 0 });
    await setDoc(doc(f, 'custodySettlements', 'stl-other'), { orgId: OTHER_ORG, custodyId: 'cus-other', employeeId: 'someone', employeeEmail: 'x@other.test', amount: 0, status: 'approved' });
  });
});

describe('financial consistency check: who may read every collection whole', () => {
  it('the platform owner lists every collection the check needs, across companies', async () => {
    const f = db(OWNER);
    for (const name of CONSISTENCY_COLLECTIONS) {
      const snap = await assertSucceeds(getDocs(collection(f, name)));
      expect(snap.docs.some(d => d.data().orgId === OTHER_ORG), name).toBe(true);
    }
  });

  it('nobody else can (a company admin / finance read only their company, by query), nor the owner with an unverified email', async () => {
    for (const u of [ADMIN, FIN, EMP]) {
      for (const name of CONSISTENCY_COLLECTIONS) {
        await assertFails(getDocs(collection(db(u), name)));
      }
    }
    await assertFails(getDocs(collection(db(OWNER, false), 'paymentAccounts')));
  });

  it('data written by the domain operations under the rules comes out clean (no write by the check)', async () => {
    const acc = await createPaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, name: 'Cash', type: 'cash', accountIdentifier: 'CASH-1', currency: 'EGP', active: true, initialBalance: 1000 }, key());
    await adjustAccountBalance(store(FIN), actor(FIN, 'finance', ORG), { accountId: acc.value.id, type: 'in', amount: 0.1, description: 'a' }, key());
    await adjustAccountBalance(store(FIN), actor(FIN, 'finance', ORG), { accountId: acc.value.id, type: 'in', amount: 0.2, description: 'b' }, key());
    const req = await createExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), {
      orgId: ORG, requesterDepartment: 'IT', serviceCategoryId: 'srv-1', serviceCategoryName: 'Cloud', providerId: 'prov-1', providerName: 'AWS',
      title: 't', description: 'd', justification: 'j', amount: 250.5, currency: 'EGP', urgency: 'low', requestType: 'expense', attachments: [],
    } as any, key(), notify);
    await transitionExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), req.value.id, { type: 'approve' }, key(), notify);
    await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), req.value.id, { paymentMethod: 'cash', referenceNumber: 'R-1', accountId: acc.value.id }, key(), notify);
    const cus = await issueCustody(store(FIN), actor(FIN, 'finance', ORG), { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount: 300, sourceAccountId: acc.value.id }, key());
    await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: cus.value.id, amount: 120.3, description: 'inv' }, key());

    const data = await readAll(db(OWNER));
    const ours = Object.fromEntries(
      Object.entries(data).map(([c, list]) => [c, (list as Array<{ orgId?: string }>).filter(r => r.orgId === ORG)]),
    ) as ConsistencyData;
    const report = checkFinancialConsistency(ours);
    expect(report.issues).toEqual([]);
    expect(report.totals.account_ledger_sum.checked).toBe(1);
    expect(report.totals.request_ledger_line.checked).toBe(1);
    expect(report.totals.custody_settled.checked).toBe(1);
  });
});
