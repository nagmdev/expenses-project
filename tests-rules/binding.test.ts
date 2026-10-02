/**
 * Architect lab: the binding model (rules-spec-v1) against the emulator, driving the REAL
 * (modified) domain from ./src. One block of legitimate operations, one adversarial test per
 * audit finding, and the heaviest transactions for the document-access / expression budgets.
 */
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, or, query, setDoc, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import { createFirestoreStore } from '../src/domain/firestoreStore';
import { disburseExpenseRequest, transitionExpenseRequest, updateExpenseRequest } from '../src/domain/requests';
import {
  adjustAccountBalance,
  createPaymentAccount,
  detachLegacyWallet,
  issueCustody,
  replenishCustody,
  returnCustodyRemainders,
  settleCustodyItem,
  transferBetweenAccounts,
  updatePaymentAccount,
} from '../src/domain/treasury';
import { createEntity, deleteEntity, updateEntity, updateMemberRecord, syncOwnMembership } from '../src/domain/directory';
import { addVisaPayment } from '../src/domain/visa';
import { uniqueKeyDocId, type Actor } from '../src/domain/common';
import { DEFAULT_EMAIL_SETTINGS } from '../src/services/emailTemplates';

const ORG = 'org-acme';
const OTHER_ORG = 'org-other';
let env: RulesTestEnvironment;

const OWNER = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
const ADMIN = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
const EMP = { uid: 'uidEmployee0000000000000001', email: 'emp@acme.test' };
const FIN = { uid: 'uidFinance00000000000000001', email: 'fin@acme.test' };
const CAIRO_FIN = { uid: 'uidCairoFin00000000000001', email: 'fin@other.test' };
const MULTI_FIN = { uid: 'uidMultiFin00000000000001', email: 'multi@other.test' }; // profile in OTHER_ORG, finance member of ORG
const NEWHIRE = { uid: 'uidNewHire000000000000001', email: 'newhire@acme.test' };

const db = (u: { uid: string; email: string }, verified = true): Firestore =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore() as unknown as Firestore;
const actor = (u: { uid: string; email: string }, role: Actor['role'], orgId?: string): Actor => ({ id: u.uid, name: u.email, email: u.email, role, ...(orgId ? { orgId } : {}) });
const notify = { settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: false } };
const notifyOn = { settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: true, notifyOnDisbursement: true } };
let n = 0;
const key = () => `key-lab${String(++n).padStart(6, '0')}`;
const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));
const read = async (c: string, id: string) => {
  let data: Record<string, any> | undefined;
  await env.withSecurityRulesDisabled(async ctx => {
    data = (await getDoc(doc(ctx.firestore(), c, id))).data();
  });
  return data;
};
const L = (id: string) => `tx-req-${id}`;

const account = (id: string, balance: number, extra: Record<string, unknown> = {}) => ({
  orgId: ORG, name: id, type: 'cash', accountIdentifier: id, currency: 'EGP', active: true,
  balance, currentBalance: balance, initialBalance: balance, totalIn: 0, totalOut: 0, ...extra,
});
const approvedRequest = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id, orgId: ORG, requestNumber: `REQ-${id}`, status: 'approved', amount, currency: 'EGP', title: 't', requestType: 'expense',
  requesterId: EMP.uid, requesterName: 'e', requesterEmail: EMP.email, timeline: [], comments: [], createdAt: '2026-10-01T00:00:00.000Z', ...extra,
});
const custody = (id: string, extra: Record<string, unknown> = {}) => ({
  id, orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, custodyNumber: `CUS-${id}`,
  totalAmount: 1000, remainingAmount: 1000, settledAmount: 0, status: 'active', currency: 'EGP', sourceAccountId: 'acc-cash', sourceAccountName: 'acc-cash', ...extra,
});

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
    for (const [u, role, org] of [[ADMIN, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [CAIRO_FIN, 'finance', OTHER_ORG]] as const) {
      await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true });
      await setDoc(doc(f, 'members', `${u.uid}_${org}`), { orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
    }
    await setDoc(doc(f, 'users', MULTI_FIN.uid), { orgId: OTHER_ORG, role: 'employee', active: true });
    await setDoc(doc(f, 'members', `${MULTI_FIN.uid}_${ORG}`), { orgId: ORG, userId: MULTI_FIN.uid, userEmail: MULTI_FIN.email, role: 'finance', active: true });
    await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), account('acc-cash', 1000));
    await setDoc(doc(f, 'paymentAccounts', 'acc-bank'), account('acc-bank', 5000, { type: 'bank' }));
    await setDoc(doc(f, 'paymentAccounts', 'acc-insta'), account('acc-insta', 5000, { type: 'instapay', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' }));
    await setDoc(doc(f, 'paymentAccounts', 'acc-bank2'), account('acc-bank2', 3000, { type: 'bank' }));
    await setDoc(doc(f, 'paymentAccounts', 'acc-insta2'), account('acc-insta2', 3000, { type: 'instapay', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2' }));
    await setDoc(doc(f, 'paymentAccounts', 'acc-wallet'), account('acc-wallet', 0, { type: 'wallet' }));
    await setDoc(doc(f, 'paymentAccounts', 'acc-wallet-old'), account('acc-wallet-old', 600, { type: 'wallet', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank', initialBalance: 1000, totalOut: 400 }));
    await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0 });
    await setDoc(doc(f, 'services', 'srv-2'), { orgId: ORG, name: 'Other', code: 'OTR', spentAmount: 0 });
    await setDoc(doc(f, 'providers', 'prov-1'), { orgId: ORG, name: 'Vodafone', totalPaid: 500, active: true });
    await setDoc(doc(f, 'custodies', 'cus-1'), custody('cus-1'));
    await setDoc(doc(f, 'custodies', 'cus-other'), custody('cus-other', { employeeId: 'someoneElse', employeeName: 'x', employeeEmail: '', totalAmount: 500, remainingAmount: 500 }));
  });
});

// ===========================================================================
// Legitimate operations (each fails on 32b1aa1 or must keep working)
// ===========================================================================
describe('legitimate operations pass', () => {
  it('[REQ-1 AGG-R1 DIR-M1] finance pays from an InstaPay (bank mirrored) a request with service + provider, notifications on (outbox)', async () => {
    await seed(f => setDoc(doc(f, 'requests', 'r1'), approvedRequest('r1', 300, { serviceCategoryId: 'srv-1', providerId: 'prov-1' })));
    const res = await disburseExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'r1', { paymentMethod: 'instapay', referenceNumber: 'T1', accountId: 'acc-insta' }, key(), notifyOn);
    expect(res.changed).toBe(true);
    expect(await read('paymentAccounts', 'acc-insta')).toMatchObject({ currentBalance: 4700, totalOut: 300, lastLedgerId: L('r1') });
    expect(await read('paymentAccounts', 'acc-bank')).toMatchObject({ currentBalance: 4700, totalOut: 300, lastLedgerId: `${L('r1')}-parent` });
    expect(await read('services', 'srv-1')).toMatchObject({ spentAmount: 300, lastDisbursedRequestId: 'r1' });
    expect(await read('providers', 'prov-1')).toMatchObject({ totalPaid: 800, lastDisbursedRequestId: 'r1' });
    expect(await read('outbox', 'request_paid__r1')).toBeTruthy();
  });

  it('[REQ-1] org admin pays; a multi-company finance member (profile elsewhere) pays; finance receives an income request', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'requests', 'r2'), approvedRequest('r2', 100, { serviceCategoryId: 'srv-1' }));
      await setDoc(doc(f, 'requests', 'r3'), approvedRequest('r3', 50, { providerId: 'prov-1' }));
      await setDoc(doc(f, 'requests', 'inc'), approvedRequest('inc', 250, { status: 'pending', requestType: 'income' }));
    });
    await disburseExpenseRequest(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'r2', { paymentMethod: 'cash', referenceNumber: 'A', accountId: 'acc-cash' }, key(), notify);
    await disburseExpenseRequest(createFirestoreStore(db(MULTI_FIN)), actor(MULTI_FIN, 'finance'), 'r3', { paymentMethod: 'cash', referenceNumber: 'M', accountId: 'acc-cash' }, key(), notify);
    await disburseExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'inc', { paymentMethod: 'cash', referenceNumber: 'I', accountId: 'acc-cash' }, key(), notify);
    expect(await read('paymentAccounts', 'acc-cash')).toMatchObject({ currentBalance: 1000 - 100 - 50 + 250, totalIn: 250, totalOut: 150, lastLedgerId: L('inc') });
    expect((await read('requests', 'inc'))!.status).toBe('disbursed');
    expect((await read('services', 'srv-1'))!.spentAmount).toBe(100);
    expect((await read('providers', 'prov-1'))!.totalPaid).toBe(550);
  });

  it('[REQ-1] the owner (super admin, no profile in the org) pays', async () => {
    await seed(f => setDoc(doc(f, 'requests', 'r4'), approvedRequest('r4', 10, { serviceCategoryId: 'srv-1', providerId: 'prov-1' })));
    const res = await disburseExpenseRequest(createFirestoreStore(db(OWNER)), actor(OWNER, 'super_admin'), 'r4', { paymentMethod: 'instapay', referenceNumber: 'O', accountId: 'acc-insta' }, key(), notify);
    expect(res.changed).toBe(true);
  });

  it('[REQ-1 REQ-6] finance approves and rejects, org admin asks (and asks again), the requester replies', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'requests', 'p1'), approvedRequest('p1', 10, { status: 'pending' }));
      await setDoc(doc(f, 'requests', 'p2'), approvedRequest('p2', 10));
      await setDoc(doc(f, 'requests', 'p3'), approvedRequest('p3', 10, { status: 'pending' }));
    });
    const fin = createFirestoreStore(db(FIN));
    expect((await transitionExpenseRequest(fin, actor(FIN, 'finance'), 'p1', { type: 'approve', note: 'ok' }, key(), notify)).value.status).toBe('approved');
    expect((await transitionExpenseRequest(fin, actor(FIN, 'finance'), 'p2', { type: 'reject', reason: 'no' }, key(), notify)).value.status).toBe('rejected');
    const adm = createFirestoreStore(db(ADMIN));
    await transitionExpenseRequest(adm, actor(ADMIN, 'org_admin'), 'p3', { type: 'clarify', question: 'why?' }, key(), notify);
    await transitionExpenseRequest(adm, actor(ADMIN, 'org_admin'), 'p3', { type: 'clarify', question: 'and?' }, key(), notify);
    expect((await transitionExpenseRequest(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), 'p3', { type: 'reply', replyText: 'because' }, key(), notify)).value.status).toBe('pending');
    expect((await read('requests', 'p3'))!.comments).toHaveLength(3);
  });

  it('[REQ-4 REQ-5] invoice attached by finance / org admin (approved and someone else\'s pending); org admin money edit re-opens; finance money edit refused by the domain', async () => {
    const att = { id: 'att-1', name: 'inv.pdf', url: 'fsattach://att-1', type: 'application/pdf', size: 10, uploadedAt: 'x' };
    await seed(async f => {
      await setDoc(doc(f, 'requests', 'a1'), approvedRequest('a1', 100));
      await setDoc(doc(f, 'requests', 'p1'), approvedRequest('p1', 100, { status: 'pending' }));
    });
    await updateExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'a1', { invoiceAttachment: att as any, attachments: [att as any] }, key());
    await updateExpenseRequest(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'a1', { invoiceAttachment: { ...att, id: 'att-2' } as any }, key());
    await updateExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'p1', { invoiceAttachment: att as any, attachments: [att as any] }, key());
    await expect(updateExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'a1', { amount: 500 }, key())).rejects.toMatchObject({ code: 'forbidden' });
    const reopened = await updateExpenseRequest(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'a1', { amount: 500 }, key());
    expect(reopened.value.status).toBe('pending');
    // the requester still edits their own pending request
    await updateExpenseRequest(createFirestoreStore(db(EMP)), { ...actor(EMP, 'employee') }, 'p1', { title: 'new title', amount: 120 }, key());
  });

  it('[REQ-2 TRE-1] piaster amounts: 70.82 out of 1000; 150.50 in then 100.10 out; opening 1234.56 then 100.10 in', async () => {
    await seed(f => setDoc(doc(f, 'requests', 'd1'), approvedRequest('d1', 70.82)));
    await disburseExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'd1', { paymentMethod: 'cash', referenceNumber: 'D', accountId: 'acc-cash' }, key(), notify);
    expect((await read('paymentAccounts', 'acc-cash'))!.currentBalance).toBe(929.18);
    const fin = createFirestoreStore(db(FIN));
    await adjustAccountBalance(fin, actor(FIN, 'finance'), { accountId: 'acc-wallet', type: 'in', amount: 150.5, description: 'x' }, key());
    await adjustAccountBalance(fin, actor(FIN, 'finance'), { accountId: 'acc-wallet', type: 'out', amount: 100.1, description: 'x' }, key());
    expect((await read('paymentAccounts', 'acc-wallet'))!.currentBalance).toBe(50.4);
    const opened = await createPaymentAccount(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), { orgId: ORG, name: 'N', type: 'bank', accountIdentifier: 'EG-123', currency: 'EGP', active: true, initialBalance: 1234.56 } as any, key());
    expect(await read('paymentAccounts', opened.value.id)).toMatchObject({ lastLedgerId: `tx-open-${opened.value.id}`, currentBalance: 1234.56 });
    await adjustAccountBalance(fin, actor(FIN, 'finance'), { accountId: opened.value.id, type: 'in', amount: 100.1, description: 'x' }, key());
    expect((await read('paymentAccounts', opened.value.id))!.currentBalance).toBe(1334.66);
  });

  it('[TRE-2 TRE-4] legacy accounts: no balance fields at all, no initialBalance, drifted totals, overdrawn, unrounded totals', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'paymentAccounts', 'acc-bare'), { orgId: ORG, name: 'bare', type: 'bank', accountIdentifier: 'L-1', bankName: 'CIB', currency: 'EGP', active: true, createdAt: 'x' });
      await setDoc(doc(f, 'paymentAccounts', 'acc-moved'), { orgId: ORG, name: 'moved', type: 'bank', accountIdentifier: 'L-2', currency: 'EGP', active: true, currentBalance: 700, balance: 700, totalIn: 1000, totalOut: 300 });
      await setDoc(doc(f, 'paymentAccounts', 'acc-drift'), { ...account('acc-drift', 900), initialBalance: 1000, totalIn: 0, totalOut: 0 });
      await setDoc(doc(f, 'paymentAccounts', 'acc-neg'), { ...account('acc-neg', -500), initialBalance: 0, totalOut: 500 });
      await setDoc(doc(f, 'paymentAccounts', 'acc-raw'), { ...account('acc-raw', 0.30000000000000004), totalIn: 0.30000000000000004, initialBalance: 0 });
      await setDoc(doc(f, 'paymentAccounts', 'acc-stale'), { ...account('acc-stale', 800), balance: 650 }); // old visa code: balance left stale
      await setDoc(doc(f, 'requests', 'leg'), approvedRequest('leg', 50));
    });
    const fin = createFirestoreStore(db(FIN));
    await adjustAccountBalance(fin, actor(FIN, 'finance'), { accountId: 'acc-bare', type: 'in', amount: 1000, description: 'x' }, key());
    await adjustAccountBalance(fin, actor(FIN, 'finance'), { accountId: 'acc-moved', type: 'out', amount: 100, description: 'x' }, key());
    await disburseExpenseRequest(fin, actor(FIN, 'finance'), 'leg', { paymentMethod: 'cash', referenceNumber: 'L', accountId: 'acc-drift' }, key(), notify);
    await adjustAccountBalance(fin, actor(FIN, 'finance'), { accountId: 'acc-neg', type: 'in', amount: 200, description: 'x' }, key());
    await adjustAccountBalance(fin, actor(FIN, 'finance'), { accountId: 'acc-raw', type: 'out', amount: 0.1, description: 'x' }, key());
    await adjustAccountBalance(fin, actor(FIN, 'finance'), { accountId: 'acc-stale', type: 'out', amount: 100, description: 'x' }, key());
    expect((await read('paymentAccounts', 'acc-neg'))!.currentBalance).toBe(-300);
    expect((await read('paymentAccounts', 'acc-drift'))!.currentBalance).toBe(850);
    // profile edits of legacy accounts
    await updatePaymentAccount(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'acc-moved', { active: false }, key());
    await updatePaymentAccount(fin, actor(FIN, 'finance'), 'acc-bare', { name: 'renamed' }, key());
  });

  it('[TRE-3] edit forms: bankName added to a default account, unchanged currency re-sent, currency of an empty account; locked with history', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'paymentAccounts', 'acc-empty'), { ...account('acc-empty', 0) });
      await setDoc(doc(f, 'paymentAccounts', 'acc-nocur'), { orgId: ORG, name: 'nocur', type: 'cash', accountIdentifier: 'NC', active: true, currentBalance: 10, balance: 10 });
    });
    const adm = createFirestoreStore(db(ADMIN));
    await updatePaymentAccount(adm, actor(ADMIN, 'org_admin'), 'acc-cash', { name: 'Main cash', type: 'cash', accountIdentifier: 'acc-cash', bankName: '', currency: 'EGP', description: '', orgId: ORG } as any, key());
    await updatePaymentAccount(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'acc-bank', { bankName: 'CIB' }, key());
    await updatePaymentAccount(adm, actor(ADMIN, 'org_admin'), 'acc-empty', { currency: 'USD' }, key());
    await updatePaymentAccount(adm, actor(ADMIN, 'org_admin'), 'acc-nocur', { name: 'nc', currency: 'EGP' }, key());
    await expect(updatePaymentAccount(adm, actor(ADMIN, 'org_admin'), 'acc-cash', { currency: 'USD' }, key())).rejects.toMatchObject({ code: 'currency_locked' });
    await assertFails(updateDoc(doc(db(ADMIN), 'paymentAccounts', 'acc-cash'), { currency: 'USD' }));
  });

  it('[TRE-5] org admin detaches a legacy wallet with a correction that overdraws the bank', async () => {
    await seed(f => setDoc(doc(f, 'paymentAccounts', 'acc-bank-low'), account('acc-bank-low', 1000, { type: 'bank' })));
    await seed(f => setDoc(doc(f, 'paymentAccounts', 'acc-w5'), account('acc-w5', 5000, { type: 'wallet', parentAccountId: 'acc-bank-low', parentAccountName: 'acc-bank-low', initialBalance: 0, totalIn: 5000 })));
    const res = await detachLegacyWallet(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'),
      { walletId: 'acc-w5', bankCorrection: -5000, expectedWalletTotals: { totalIn: 5000, totalOut: 0 } }, key());
    expect(res.changed).toBe(true);
    expect((await read('paymentAccounts', 'acc-bank-low'))!.currentBalance).toBe(-4000);
    expect((await read('paymentAccounts', 'acc-w5'))!.parentAccountId).toBe('');
  });

  it('[TRE-9] account number, provider name, service code, department name and member email changes release the old key', async () => {
    const adm = createFirestoreStore(db(ADMIN));
    const acc = await createPaymentAccount(adm, actor(ADMIN, 'org_admin'), { orgId: ORG, name: 'K', type: 'bank', accountIdentifier: 'EG001', currency: 'EGP', active: true, initialBalance: 0 } as any, key());
    await updatePaymentAccount(adm, actor(ADMIN, 'org_admin'), acc.value.id, { accountIdentifier: 'EG002' }, key());
    await updatePaymentAccount(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), acc.value.id, { accountIdentifier: 'EG003' }, key());
    await updatePaymentAccount(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), acc.value.id, { accountIdentifier: 'eg-003' }, key()); // same key
    expect(await read('uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'EG001'))).toBeUndefined();
    expect(await read('uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'EG003'))).toMatchObject({ entityId: acc.value.id });
    const prov = await createEntity(adm, actor(ADMIN, 'org_admin'), 'provider', (id: string) => ({ id, orgId: ORG, name: 'Orange', totalPaid: 0, active: true } as any), () => 'x', key());
    await updateEntity(adm, actor(ADMIN, 'org_admin'), 'provider', prov.value.id, { name: 'Orange Egypt' }, () => ({ actionType: 'rename', details: 'x' }), key());
    await updateEntity(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'provider', prov.value.id, { name: 'Orange-Egypt ' }, () => ({ actionType: 'rename', details: 'x' }), key());
    const svc = await createEntity(adm, actor(ADMIN, 'org_admin'), 'service', (id: string) => ({ id, orgId: ORG, name: 'S', code: 'S1', spentAmount: 0 } as any), () => 'x', key());
    await updateEntity(adm, actor(ADMIN, 'org_admin'), 'service', svc.value.id, { code: 'S2' }, () => ({ actionType: 'update', details: 'x' }), key());
    const dept = await createEntity(adm, actor(ADMIN, 'org_admin'), 'department', (id: string) => ({ id, orgId: ORG, name: 'IT', createdAt: 'x' } as any), () => 'x', key());
    await updateEntity(adm, actor(ADMIN, 'org_admin'), 'department', dept.value.id, { name: 'Tech' }, () => ({ actionType: 'rename', details: 'x' }), key());
    await seed(f => setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('member_email', ORG, EMP.email)), { scope: 'member_email', orgId: ORG, value: 'emp@acmetest', entityCollection: 'members', entityId: `${EMP.uid}_${ORG}` }));
    await updateMemberRecord(adm, actor(ADMIN, 'org_admin'), `${EMP.uid}_${ORG}`, { userEmail: 'emp2@acme.test' }, [], key());
    expect(await read('uniqueKeys', uniqueKeyDocId('member_email', ORG, EMP.email))).toBeUndefined();
  });

  it('[REG-1 REG-2 REG-3] replenish a settled / returned / over-settled custody; piaster settle, replenish and return', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'custodies', 'c-settled'), custody('c-settled', { remainingAmount: 0, settledAmount: 1000, status: 'settled' }));
      await setDoc(doc(f, 'custodies', 'c-over'), custody('c-over', { remainingAmount: 0, settledAmount: 1200, status: 'settled' }));
      await setDoc(doc(f, 'custodies', 'c-dec'), custody('c-dec', { totalAmount: 100.3, remainingAmount: 100.3 }));
      await setDoc(doc(f, 'custodies', 'c-dec2'), custody('c-dec2', { totalAmount: 500, remainingAmount: 499.3, settledAmount: 0.7 }));
      await setDoc(doc(f, 'custodies', 'c-dec3'), custody('c-dec3', { totalAmount: 100.3, remainingAmount: 50.2, settledAmount: 50.1 }));
      await setDoc(doc(f, 'custodies', 'c-raw'), custody('c-raw', { totalAmount: 100, remainingAmount: 49.900000000000006, settledAmount: 50.1 }));
    });
    const fin = createFirestoreStore(db(FIN));
    await replenishCustody(fin, actor(FIN, 'finance'), { custodyId: 'c-settled', amount: 500, sourceAccountId: 'acc-bank' }, key());
    expect(await read('custodies', 'c-settled')).toMatchObject({ status: 'active', totalAmount: 1500, remainingAmount: 500 });
    await replenishCustody(fin, actor(FIN, 'finance'), { custodyId: 'c-over', amount: 500, sourceAccountId: 'acc-bank' }, key());
    await settleCustodyItem(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), { custodyId: 'c-dec', amount: 50.1, description: 'x' }, key());
    await settleCustodyItem(fin, actor(FIN, 'finance'), { custodyId: 'c-dec', amount: 50.2, description: 'x' }, key());
    expect(await read('custodies', 'c-dec')).toMatchObject({ remainingAmount: 0, status: 'settled' });
    await replenishCustody(fin, actor(FIN, 'finance'), { custodyId: 'c-dec2', amount: 0.1, sourceAccountId: 'acc-bank' }, key());
    await returnCustodyRemainders(fin, actor(FIN, 'finance'), { custodyIds: ['c-dec3', 'c-raw'] }, key());
    // a returned custody is replenished again
    await replenishCustody(fin, actor(FIN, 'finance'), { custodyId: 'c-dec3', amount: 10, sourceAccountId: 'acc-bank' }, key());
    expect((await read('custodies', 'c-dec3'))!.status).toBe('active');
  });

  it('issue from an InstaPay, transfer InstaPay → another bank\'s InstaPay, visa payment from an InstaPay, opening an InstaPay with a balance', async () => {
    const fin = createFirestoreStore(db(FIN));
    const c = await issueCustody(fin, actor(FIN, 'finance'), { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount: 250, sourceAccountId: 'acc-insta' }, key());
    expect(await read('custodies', c.value.id)).toMatchObject({ lastLedgerId: expect.stringMatching(/^tx-/) });
    const t = await transferBetweenAccounts(fin, actor(FIN, 'finance'), { fromAccountId: 'acc-insta', toAccountId: 'acc-insta2', amount: 100 }, key());
    expect(t.changed).toBe(true);
    expect((await read('paymentAccounts', 'acc-bank2'))!.currentBalance).toBe(3100);
    await seed(f => setDoc(doc(f, 'visaRequests', 'v1'), { orgId: ORG, requestNumber: 'V1', status: 'approved', totalAmount: 1000, paidAmount: 0, remainingBalance: 1000, payments: [], currency: 'EGP', travelerName: 'T' }));
    await addVisaPayment(fin, actor(FIN, 'finance'), 'v1', { amount: 400, accountId: 'acc-insta', method: 'instapay' } as any, key());
    expect((await read('paymentAccounts', 'acc-insta'))!.currentBalance).toBe(5000 - 250 - 100 - 400);
    const ip = await createPaymentAccount(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'),
      { orgId: ORG, name: 'IP', type: 'instapay', accountIdentifier: 'ip@instapay', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2', currency: 'EGP', active: true, initialBalance: 75 } as any, key());
    expect(ip.changed).toBe(true);
  });

  it('[MISS-1 BYP-5] employees list their own custodies and settlements (uid or verified email); the org-wide query stays refused', async () => {
    await seed(f => setDoc(doc(f, 'custodies', 'c-mail'), custody('c-mail', { employeeId: 'pending-x' })));
    await settleCustodyItem(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), { custodyId: 'cus-1', amount: 10, description: 'x' }, key());
    const e = db(EMP);
    const mine = await assertSucceeds(getDocs(query(collection(e, 'custodies'), or(where('employeeId', '==', EMP.uid), where('employeeEmail', '==', EMP.email)))));
    expect(mine.docs.map(d => d.id).sort()).toEqual(['c-mail', 'cus-1']);
    await assertSucceeds(getDocs(query(collection(e, 'custodySettlements'), or(where('employeeId', '==', EMP.uid), where('employeeEmail', '==', EMP.email)))));
    await assertFails(getDocs(query(collection(e, 'custodies'), where('orgId', '==', ORG))));
    // unverified: the uid query only
    await assertSucceeds(getDocs(query(collection(db(EMP, false), 'custodies'), where('employeeId', '==', EMP.uid))));
    await assertFails(getDocs(query(collection(db(EMP, false), 'custodies'), where('employeeEmail', '==', EMP.email))));
  });

  it('[super admin] the owner creates and deletes a company (4 default accounts, keys) and edits a request in any state', async () => {
    const { createOrganization, removeOrganization } = await import('../src/domain/directory');
    const owner = actor(OWNER, 'super_admin');
    const res = await createOrganization(createFirestoreStore(db(OWNER)), owner, { name: 'Zeta', code: 'ZET', currency: 'EGP', budget: 0, description: '' } as any, key());
    expect(res.changed).toBe(true);
    expect(await read('paymentAccounts', `vault-insta-${res.value.id}`)).toMatchObject({ parentAccountId: `vault-bank-${res.value.id}` });
    const rm = await removeOrganization(createFirestoreStore(db(OWNER)), owner, res.value.id, 'delete', key());
    expect(rm.mode).toBe('delete');
    await seed(f => setDoc(doc(f, 'requests', 'x1'), approvedRequest('x1', 5, { status: 'disbursed' })));
    await assertSucceeds(updateDoc(doc(db(OWNER), 'requests', 'x1'), { note: 'owner fix' }));
  });

  it('[REQ-1] org admin edits someone else\'s pending request; the requester replies with an attachment', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'requests', 'e1'), approvedRequest('e1', 10, { status: 'pending' }));
      await setDoc(doc(f, 'requests', 'e2'), approvedRequest('e2', 10, { status: 'clarification_requested' }));
    });
    await updateExpenseRequest(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'e1', { title: 'fixed by admin', amount: 12 }, key());
    const att = { id: 'att-9', name: 'r.pdf', url: 'fsattach://att-9', type: 'application/pdf', size: 1, uploadedAt: 'x' };
    const r = await transitionExpenseRequest(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), 'e2', { type: 'reply', replyText: 'here', attachment: att as any }, key(), notify);
    expect(r.value.status).toBe('pending');
  });

  it('[listeners] the app\'s list queries still pass (role checks moved last)', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'requests', 'q1'), approvedRequest('q1', 10));
      await setDoc(doc(f, 'custodySettlements', 's1'), { orgId: ORG, custodyId: 'cus-1', employeeId: EMP.uid, employeeEmail: EMP.email, amount: 1 });
      await setDoc(doc(f, 'accountTransactions', 't1'), { orgId: ORG, accountId: 'acc-cash', amount: 1, type: 'in' });
    });
    for (const who of [FIN, ADMIN]) {
      for (const c of ['requests', 'custodies', 'custodySettlements', 'paymentAccounts', 'accountTransactions', 'services', 'providers', 'members']) {
        await assertSucceeds(getDocs(query(collection(db(who), c), where('orgId', '==', ORG))));
      }
    }
    await assertSucceeds(getDocs(query(collection(db(EMP), 'requests'), or(where('requesterId', '==', EMP.uid), where('requesterEmail', '==', EMP.email)))));
    await assertFails(getDocs(query(collection(db(EMP), 'requests'), where('orgId', '==', ORG))));
    await assertFails(getDocs(query(collection(db(EMP), 'paymentAccounts'), where('orgId', '==', ORG))));
    await assertFails(getDocs(query(collection(db(CAIRO_FIN), 'requests'), where('orgId', '==', ORG))));
    await assertSucceeds(getDocs(query(collection(db(EMP), 'services'), where('orgId', '==', ORG))));
    await assertSucceeds(getDocs(query(collection(db(OWNER), 'requests'))));
  });

  it('[AGG-R2] legacy service / provider without counters: renamed, deactivated, then charged by a disbursement', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'services', 'srv-legacy'), { orgId: ORG, name: 'L', code: 'L' });
      await setDoc(doc(f, 'providers', 'prov-legacy'), { orgId: ORG, name: 'P' });
      await setDoc(doc(f, 'requests', 'rl'), approvedRequest('rl', 40, { serviceCategoryId: 'srv-legacy', providerId: 'prov-legacy' }));
    });
    const adm = createFirestoreStore(db(ADMIN));
    await updateEntity(adm, actor(ADMIN, 'org_admin'), 'service', 'srv-legacy', { name: 'L2' }, () => ({ actionType: 'rename', details: 'x' }), key());
    await updateEntity(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'provider', 'prov-legacy', { phone: '1' } as any, () => ({ actionType: 'update', details: 'x' }), key());
    await disburseExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'rl', { paymentMethod: 'cash', referenceNumber: 'R', accountId: 'acc-cash' }, key(), notify);
    expect((await read('services', 'srv-legacy'))!.spentAmount).toBe(40);
    expect((await read('providers', 'prov-legacy'))!.totalPaid).toBe(40);
    expect((await deleteEntity(adm, actor(ADMIN, 'org_admin'), 'service', 'srv-legacy', 'delete', key())).removal).toBe('deactivated');
  });

  it('[budget] bulk return of 6 custodies into an InstaPay (one transaction each), and a retry is a no-op', async () => {
    const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
    await seed(async f => { for (const id of ids) await setDoc(doc(f, 'custodies', id), custody(id, { totalAmount: 100.5, remainingAmount: 100.5 })); });
    const fin = createFirestoreStore(db(FIN));
    const k = key();
    const res = await returnCustodyRemainders(fin, actor(FIN, 'finance'), { custodyIds: ids, targetAccountId: 'acc-insta' }, k);
    expect(res.value.totalReturned).toBe(603);
    expect((await read('paymentAccounts', 'acc-bank'))!.currentBalance).toBe(5603);
    expect((await returnCustodyRemainders(fin, actor(FIN, 'finance'), { custodyIds: ids, targetAccountId: 'acc-insta' }, k)).changed).toBe(false);
  });

  it('[budget] worst cases: owner (role lookups fail first) and a multi-company finance member pay from an InstaPay with service + provider + outbox, and transfer InstaPay → InstaPay', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'requests', 'w1'), approvedRequest('w1', 120, { serviceCategoryId: 'srv-1', providerId: 'prov-1' }));
      await setDoc(doc(f, 'requests', 'w2'), approvedRequest('w2', 130, { serviceCategoryId: 'srv-1', providerId: 'prov-1' }));
      await setDoc(doc(f, 'super_admins', 'someone-else'), { email: 'x@y.z' });
    });
    for (const [who, role, id] of [[OWNER, 'super_admin', 'w1'], [MULTI_FIN, 'finance', 'w2']] as const) {
      const store = createFirestoreStore(db(who));
      const res = await disburseExpenseRequest(store, actor(who, role), id, { paymentMethod: 'instapay', referenceNumber: id, accountId: 'acc-insta' }, key(), notifyOn);
      expect(res.changed).toBe(true);
      // custodies-/transfers- counters only accept the role of the caller's PROFILE company (pre-existing,
      // unchanged): a finance member of a second company issues / transfers through FIN here.
      const numbering = who === MULTI_FIN ? createFirestoreStore(db(FIN)) : store;
      const numberingActor = who === MULTI_FIN ? actor(FIN, 'finance') : actor(who, role);
      const t = await transferBetweenAccounts(numbering, numberingActor, { fromAccountId: 'acc-insta', toAccountId: 'acc-insta2', amount: 10 }, key());
      expect(t.changed).toBe(true);
      const c = await issueCustody(numbering, numberingActor, { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount: 20, sourceAccountId: 'acc-insta' }, key());
      await replenishCustody(store, actor(who, role), { custodyId: c.value.id, amount: 5, sourceAccountId: 'acc-insta2' }, key());
      await settleCustodyItem(store, actor(who, role), { custodyId: c.value.id, amount: 3, description: 'x' }, key());
      await returnCustodyRemainders(store, actor(who, role), { custodyIds: [c.value.id], targetAccountId: 'acc-insta2' }, key());
    }
    expect((await read('services', 'srv-1'))!.spentAmount).toBe(250);
    expect((await read('providers', 'prov-1'))!.totalPaid).toBe(750);
  });

  it('[budget] shared service paid by the secondary company\'s finance from its InstaPay, with a provider of its own', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'services', 'srv-shared'), { orgId: ORG, orgIds: [ORG, OTHER_ORG], name: 'WE', code: 'WE', spentAmount: 0 });
      await setDoc(doc(f, 'providers', 'prov-c'), { orgId: OTHER_ORG, name: 'CP', totalPaid: 0 });
      await setDoc(doc(f, 'paymentAccounts', 'acc-cb'), { ...account('acc-cb', 9000, { type: 'bank' }), orgId: OTHER_ORG });
      await setDoc(doc(f, 'paymentAccounts', 'acc-ci'), { ...account('acc-ci', 9000, { type: 'instapay', parentAccountId: 'acc-cb' }), orgId: OTHER_ORG });
      await setDoc(doc(f, 'requests', 'rc'), { ...approvedRequest('rc', 1800, { serviceCategoryId: 'srv-shared', providerId: 'prov-c' }), orgId: OTHER_ORG, requesterEmail: 'emp@other.test' });
    });
    const res = await disburseExpenseRequest(createFirestoreStore(db(CAIRO_FIN)), actor(CAIRO_FIN, 'finance'), 'rc', { paymentMethod: 'instapay', referenceNumber: 'C', accountId: 'acc-ci' }, key(), notifyOn);
    expect(res.changed).toBe(true);
    expect((await read('services', 'srv-shared'))!.spentAmount).toBe(1800);
  });
});

// ===========================================================================
// Adversarial: one per audit finding
// ===========================================================================
describe('adversarial (one per finding)', () => {
  const fakeLine = (accountId: string, extra: Record<string, unknown> = {}) => ({
    id: 'x', orgId: ORG, accountId, accountName: accountId, type: 'out', amount: 300, balanceBefore: 1000, balanceAfter: 700,
    // 'request': the domain's disbursement line (a request is paid only by a 'request' line)
    referenceType: 'request', description: 'x', actorName: 'x', actorId: FIN.uid, createdAt: 'x', ...extra,
  });

  it('[REQ-1] finance writes are evaluated (no 1000-expression wall): invoice-only on approved passes, an amount change fails by logic', async () => {
    await seed(f => setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300)));
    await assertSucceeds(updateDoc(doc(db(FIN), 'requests', 'a'), { invoiceAttachment: { id: 'i' }, timeline: [{ id: 't' }] }));
    await assertFails(updateDoc(doc(db(FIN), 'requests', 'a'), { amount: 800 }));
  });

  it('[REQ-3 TRE-7] a request is never marked paid with a fabricated / mismatched ledger line', async () => {
    await seed(f => setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300)));
    for (const who of [ADMIN, FIN]) {
      const f = db(who);
      // fake line only (no account movement)
      await assertFails(writeBatch(f).update(doc(f, 'requests', 'a'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } })
        .set(doc(f, 'accountTransactions', L('a')), { orgId: ORG, amount: 0 }).commit());
      await assertFails(writeBatch(f).update(doc(f, 'requests', 'a'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } })
        .set(doc(f, 'accountTransactions', L('a')), { ...fakeLine('acc-cash'), id: L('a'), referenceId: 'a' }).commit());
    }
    const f = db(FIN);
    // two-step: the line alone is refused (no account movement points at it)
    await assertFails(setDoc(doc(f, 'accountTransactions', L('a')), { ...fakeLine('acc-cash'), id: L('a'), referenceId: 'a' }));
    // line + account move of the WRONG amount
    await assertFails(writeBatch(f)
      .update(doc(f, 'requests', 'a'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } })
      .set(doc(f, 'accountTransactions', L('a')), { ...fakeLine('acc-cash', { amount: 30, balanceAfter: 970 }), id: L('a'), referenceId: 'a' })
      .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 970, balance: 970, totalOut: 30, lastLedgerId: L('a') }).commit());
    // a correct line on another account than the disbursement names
    await assertFails(writeBatch(f)
      .update(doc(f, 'requests', 'a'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } })
      .set(doc(f, 'accountTransactions', L('a')), { ...fakeLine('acc-bank', { balanceBefore: 5000, balanceAfter: 4700 }), id: L('a'), referenceId: 'a' })
      .update(doc(f, 'paymentAccounts', 'acc-bank'), { currentBalance: 4700, balance: 4700, totalOut: 300, lastLedgerId: L('a') }).commit());
    // the legitimate shape is accepted (proves the refusals above are by logic)
    await assertSucceeds(writeBatch(f)
      .update(doc(f, 'requests', 'a'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } })
      .set(doc(f, 'accountTransactions', L('a')), { ...fakeLine('acc-cash'), id: L('a'), referenceId: 'a' })
      .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 700, balance: 700, totalOut: 300, lastLedgerId: L('a') }).commit());
  });

  it('[REQ-6] approval cannot redirect the payee nor name another approver; disbursement cannot move the budget; history is append-only', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'requests', 'p'), approvedRequest('p', 10, { status: 'pending', timeline: [{ id: 'tl-1' }], comments: [{ id: 'c-1' }] }));
    });
    await assertFails(updateDoc(doc(db(FIN), 'requests', 'p'), { status: 'approved', approvedBy: ADMIN.uid, approvedAt: 'x' }));
    await assertFails(updateDoc(doc(db(FIN), 'requests', 'p'), { status: 'approved', approvedBy: FIN.uid, approvedAt: 'x', paymentAccountDetails: 'evil@instapay' }));
    await assertSucceeds(updateDoc(doc(db(FIN), 'requests', 'p'), { status: 'approved', approvedBy: FIN.uid, approvedAt: 'x' }));
    await seed(f => updateDoc(doc(f, 'requests', 'p'), { status: 'pending' }));
    await assertFails(updateDoc(doc(db(EMP), 'requests', 'p'), { timeline: [] }));
    await assertFails(updateDoc(doc(db(EMP), 'requests', 'p'), { comments: [] }));
    await assertFails(updateDoc(doc(db(EMP), 'requests', 'p'), { timeline: [{ id: 'forged' }, { id: 'tl-1' }] }));
    await assertSucceeds(updateDoc(doc(db(EMP), 'requests', 'p'), { title: 'x', timeline: [{ id: 'tl-1' }, { id: 'tl-2' }] }));
    await seed(f => setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300, { serviceCategoryId: 'srv-1' })));
    const f = db(FIN);
    await assertFails(writeBatch(f)
      .update(doc(f, 'requests', 'a'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' }, serviceCategoryId: 'srv-2' })
      .set(doc(f, 'accountTransactions', L('a')), { ...fakeLine('acc-cash'), id: L('a'), referenceId: 'a' })
      .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 700, balance: 700, totalOut: 300, lastLedgerId: L('a') }).commit());
  });

  it('[AGG-B1 DIR-3] spentAmount / totalPaid only grow with the request paid in the same transaction, by its amount', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'requests', 'paid'), approvedRequest('paid', 300, { status: 'disbursed', serviceCategoryId: 'srv-1' }));
      await setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300, { serviceCategoryId: 'srv-1', providerId: 'prov-1' }));
      await setDoc(doc(f, 'requests', 'inc'), approvedRequest('inc', 300, { requestType: 'income', serviceCategoryId: 'srv-1' }));
    });
    const f = db(FIN);
    await assertFails(updateDoc(doc(f, 'services', 'srv-1'), { spentAmount: 500000, name: 'Cloud' }));
    await assertFails(updateDoc(doc(f, 'providers', 'prov-1'), { totalPaid: 999999 }));
    await assertFails(updateDoc(doc(f, 'services', 'srv-1'), { spentAmount: 300, lastDisbursedRequestId: 'paid' })); // replay of a paid request
    await assertFails(updateDoc(doc(f, 'services', 'srv-1'), { spentAmount: 300, lastDisbursedRequestId: 'a' }));    // not paid in this transaction
    await assertFails(updateDoc(doc(f, 'services', 'srv-1'), { spentAmount: 300, lastDisbursedRequestId: 'inc' }));
    const pay = (extra: (b: ReturnType<typeof writeBatch>) => void) => {
      const b = writeBatch(f)
        .update(doc(f, 'requests', 'a'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } })
        .set(doc(f, 'accountTransactions', L('a')), { ...fakeLine('acc-cash'), id: L('a'), referenceId: 'a' })
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 700, balance: 700, totalOut: 300, lastLedgerId: L('a') });
      extra(b);
      return b.commit();
    };
    await assertFails(pay(b => b.update(doc(f, 'services', 'srv-1'), { spentAmount: 3000, lastDisbursedRequestId: 'a' })));  // 10x
    await assertFails(pay(b => b.update(doc(f, 'services', 'srv-2'), { spentAmount: 300, lastDisbursedRequestId: 'a' })));   // another budget
    await assertFails(pay(b => b.update(doc(f, 'providers', 'prov-1'), { totalPaid: 900, lastDisbursedRequestId: 'a' })));   // 500 + 400
    await assertSucceeds(pay(b => b.update(doc(f, 'services', 'srv-1'), { spentAmount: 300, lastDisbursedRequestId: 'a' })
      .update(doc(f, 'providers', 'prov-1'), { totalPaid: 800, lastDisbursedRequestId: 'a' })));
    // cross-tenant: the shared company cannot touch a service of another company
    await seed(f2 => setDoc(doc(f2, 'services', 'srv-shared'), { orgId: ORG, orgIds: [ORG, OTHER_ORG], name: 'WE', code: 'WE', spentAmount: 0 }));
    await assertFails(updateDoc(doc(db(CAIRO_FIN), 'services', 'srv-shared'), { spentAmount: 1e9 }));
  });

  it('[AGG-B2] counters are never created non-zero nor erased by delete + re-create', async () => {
    await seed(f => updateDoc(doc(f, 'services', 'srv-1'), { spentAmount: 10 }));
    await assertFails(deleteDoc(doc(db(ADMIN), 'services', 'srv-1')));
    await assertFails(setDoc(doc(db(ADMIN), 'services', 'srv-new'), { orgId: ORG, name: 'n', code: 'N', spentAmount: 5 }));
    await assertSucceeds(setDoc(doc(db(ADMIN), 'services', 'srv-new'), { orgId: ORG, name: 'n', code: 'N', spentAmount: 0 }));
    await assertFails(setDoc(doc(db(ADMIN), 'providers', 'prov-new'), { orgId: ORG, name: 'n', totalPaid: 5000 }));
    await assertFails(deleteDoc(doc(db(ADMIN), 'providers', 'prov-1')));
  });

  it('[TRE-6] no balance change without a NEW ledger line of exactly that amount; no opening balance without its line', async () => {
    const f = db(FIN);
    await assertFails(updateDoc(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 6000, balance: 6000, totalIn: 5000 }));
    await assertFails(updateDoc(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 0, balance: 0, totalOut: 1000 }));
    // a real movement, then an attempt to re-use its line
    await adjustAccountBalance(createFirestoreStore(f), actor(FIN, 'finance'), { accountId: 'acc-cash', type: 'in', amount: 100, description: 'x' }, 'key-reuse00001');
    await adjustAccountBalance(createFirestoreStore(f), actor(FIN, 'finance'), { accountId: 'acc-cash', type: 'in', amount: 5, description: 'x' }, 'key-reuse00002');
    await assertFails(updateDoc(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 1205, balance: 1205, totalIn: 205, lastLedgerId: 'tx-key-reuse00001' }));
    // a new line that does not match the change
    await assertFails(writeBatch(f)
      .set(doc(f, 'accountTransactions', 'tx-forge-1'), fakeLine('acc-cash', { id: 'tx-forge-1', type: 'in', amount: 1, balanceBefore: 1105, balanceAfter: 1106 }))
      .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 9999, balance: 9999, totalIn: 9999, lastLedgerId: 'tx-forge-1' }).commit());
    // two lines for one account in one transaction (the second one is not the account's line)
    await assertFails(writeBatch(f)
      .set(doc(f, 'accountTransactions', 'tx-forge-2'), fakeLine('acc-cash', { id: 'tx-forge-2', type: 'in', amount: 1, balanceBefore: 1105, balanceAfter: 1106 }))
      .set(doc(f, 'accountTransactions', 'tx-forge-3'), fakeLine('acc-cash', { id: 'tx-forge-3', type: 'in', amount: 500, balanceBefore: 1105, balanceAfter: 1605 }))
      .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 1106, balance: 1106, totalIn: 206, lastLedgerId: 'tx-forge-2' }).commit());
    // org admin opens an account with a balance but no opening line
    await assertFails(setDoc(doc(db(ADMIN), 'paymentAccounts', 'acc-x'), { orgId: ORG, name: 'x', type: 'cash', accountIdentifier: 'x', currency: 'EGP', active: true, initialBalance: 1e6, currentBalance: 1e6, balance: 1e6, totalIn: 0, totalOut: 0 }));
    // an out movement may not overdraw (outside the wallet detach)
    await assertFails(writeBatch(f)
      .set(doc(f, 'accountTransactions', 'tx-forge-4'), fakeLine('acc-cash', { id: 'tx-forge-4', amount: 5000, balanceBefore: 1105, balanceAfter: -3895 }))
      .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: -3895, balance: -3895, totalOut: 5000, lastLedgerId: 'tx-forge-4' }).commit());
  });

  it('[TRE-8] finance cannot unlink a legacy wallet, relink a standalone one, or retype a linked account', async () => {
    const f = db(FIN);
    await assertFails(updateDoc(doc(f, 'paymentAccounts', 'acc-wallet-old'), { parentAccountId: '', parentAccountName: '' }));
    await assertFails(updateDoc(doc(f, 'paymentAccounts', 'acc-wallet-old'), { type: 'instapay' }));
    await assertFails(updateDoc(doc(f, 'paymentAccounts', 'acc-wallet'), { parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' }));
    await assertFails(updateDoc(doc(f, 'paymentAccounts', 'acc-insta'), { type: 'cash' }));
    await assertFails(updateDoc(doc(f, 'paymentAccounts', 'acc-insta'), { operationKey: 'x' }));
    // what finance may do: relink an InstaPay to another bank of the company, unlink it
    await assertSucceeds(updateDoc(doc(f, 'paymentAccounts', 'acc-insta'), { parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2' }));
    await assertSucceeds(updateDoc(doc(f, 'paymentAccounts', 'acc-insta'), { parentAccountId: '', parentAccountName: '' }));
    await expect(updatePaymentAccount(createFirestoreStore(f), actor(FIN, 'finance'), 'acc-wallet-old', { type: 'instapay' }, key())).rejects.toMatchObject({ code: 'linked_account' });
  });

  it('[TRE-9] a key is released only when its record no longer holds the value', async () => {
    const k = uniqueKeyDocId('account_identifier', ORG, 'acc-cash');
    await seed(f => setDoc(doc(f, 'uniqueKeys', k), { scope: 'account_identifier', orgId: ORG, value: 'acccash', entityCollection: 'paymentAccounts', entityId: 'acc-cash' }));
    await assertFails(deleteDoc(doc(db(FIN), 'uniqueKeys', k)));
    await assertFails(deleteDoc(doc(db(ADMIN), 'uniqueKeys', k)));
    const f = db(FIN);
    await assertFails(writeBatch(f).update(doc(f, 'paymentAccounts', 'acc-cash'), { name: 'renamed' }).delete(doc(f, 'uniqueKeys', k)).commit());
    await assertSucceeds(writeBatch(f).update(doc(f, 'paymentAccounts', 'acc-cash'), { accountIdentifier: 'NEW-1' }).delete(doc(f, 'uniqueKeys', k)).commit());
  });

  it('[REG-1] no reopening without a top-up', async () => {
    await seed(f => setDoc(doc(f, 'custodies', 'c-s'), custody('c-s', { remainingAmount: 0, settledAmount: 1000, status: 'settled' })));
    await assertFails(updateDoc(doc(db(FIN), 'custodies', 'c-s'), { status: 'active' }));
    await assertFails(updateDoc(doc(db(EMP), 'custodies', 'c-s'), { status: 'active' }));
  });

  it('[REG-2 REG-3] an unbalanced custody change stays refused', async () => {
    await assertFails(updateDoc(doc(db(FIN), 'custodies', 'cus-1'), { remainingAmount: 800, settledAmount: 100 }));
    await assertFails(updateDoc(doc(db(FIN), 'custodies', 'cus-1'), { remainingAmount: 600 }));
    await assertFails(updateDoc(doc(db(FIN), 'custodies', 'cus-1'), { totalAmount: 500 }));
  });

  it('[BYP-1] renaming oneself to a colleague\'s custody name grants nothing', async () => {
    await assertSucceeds(updateDoc(doc(db(EMP), 'members', `${EMP.uid}_${ORG}`), { userName: 'x' }));
    await assertFails(getDoc(doc(db(EMP), 'custodies', 'cus-other')));
    await assertFails(getDocs(query(collection(db(EMP), 'custodies'), where('orgId', '==', ORG), where('employeeName', '==', 'x'))));
    await assertFails(setDoc(doc(db(EMP), 'custodySettlements', 'stl-imp'), { custodyId: 'cus-other', orgId: ORG, employeeId: 'someoneElse', amount: 1 }));
    await assertFails(updateDoc(doc(db(EMP), 'custodies', 'cus-other'), { remainingAmount: 0, settledAmount: 500, status: 'settled' }));
    // the domain no longer matches by name either (and the custody is not even readable)
    await assertFails(settleCustodyItem(createFirestoreStore(db(EMP)), { ...actor(EMP, 'employee', ORG), name: 'x' }, { custodyId: 'cus-other', amount: 1, description: 'x' }, key()));
  });

  it('[BYP-2] finance cannot mark custody cash returned / settled / topped up without the ledger line or settlement', async () => {
    const f = db(FIN);
    await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { remainingAmount: 0, returnedAmount: 1000, status: 'settled' }));
    await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { remainingAmount: 0, settledAmount: 1000, status: 'settled' }));
    await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { totalAmount: 6000, remainingAmount: 6000 }));
    await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { totalAmount: 6000, remainingAmount: 6000, status: 'active', lastLedgerId: 'tx-nothing' }));
    // a return bound to a line of the wrong amount
    await assertFails(writeBatch(f)
      .update(doc(f, 'custodies', 'cus-1'), { remainingAmount: 0, returnedAmount: 1000, status: 'settled', returnedToAccountId: 'acc-cash', lastLedgerId: 'tx-ret-1' })
      .set(doc(f, 'accountTransactions', 'tx-ret-1'), fakeLine('acc-cash', { id: 'tx-ret-1', type: 'in', amount: 1, balanceAfter: 1001, referenceType: 'custody_return', referenceId: 'cus-1' }))
      .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 1001, balance: 1001, totalIn: 1, lastLedgerId: 'tx-ret-1' }).commit());
    // a custody created without its issue line
    await assertFails(setDoc(doc(f, 'custodies', 'cus-new'), { ...custody('cus-new'), lastLedgerId: 'tx-none' }));
    await assertFails(setDoc(doc(f, 'custodies', 'cus-new2'), custody('cus-new2')));
    // employee details are frozen (BYP-6)
    await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { employeeEmail: 'other@acme.test' }));
    await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { employeeName: 'Other' }));
  });

  it('[BYP-3] an employee (active or suspended) cannot write off a custody without an invoice', async () => {
    await assertFails(updateDoc(doc(db(EMP), 'custodies', 'cus-1'), { remainingAmount: 0, settledAmount: 1000, status: 'settled', updatedAt: 'x' }));
    await seed(async f => {
      await updateDoc(doc(f, 'users', EMP.uid), { active: false });
      await updateDoc(doc(f, 'members', `${EMP.uid}_${ORG}`), { active: false });
    });
    await assertFails(settleCustodyItem(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), { custodyId: 'cus-1', amount: 100, description: 'x' }, key()));
  });

  it('[BYP-4] no settlement without its custody debit, one debit backs one settlement', async () => {
    const e = db(EMP);
    await assertFails(setDoc(doc(e, 'custodySettlements', 'stl-p1'), { custodyId: 'cus-1', orgId: ORG, employeeId: EMP.uid, amount: 1000 }));
    await assertFails(writeBatch(e)
      .set(doc(e, 'custodySettlements', 'stl-p1'), { custodyId: 'cus-1', orgId: ORG, employeeId: EMP.uid, amount: 1000 })
      .set(doc(e, 'custodySettlements', 'stl-p2'), { custodyId: 'cus-1', orgId: ORG, employeeId: EMP.uid, amount: 1000 })
      .update(doc(e, 'custodies', 'cus-1'), { remainingAmount: 0, settledAmount: 1000, status: 'settled', lastSettlementId: 'stl-p1' }).commit());
    await assertSucceeds(writeBatch(e)
      .set(doc(e, 'custodySettlements', 'stl-p1'), { custodyId: 'cus-1', orgId: ORG, employeeId: EMP.uid, amount: 1000 })
      .update(doc(e, 'custodies', 'cus-1'), { remainingAmount: 0, settledAmount: 1000, status: 'settled', lastSettlementId: 'stl-p1' }).commit());
    // re-using that settlement for another debit (directly, or after a newer settlement)
    await seed(f => updateDoc(doc(f, 'custodies', 'cus-1'), { totalAmount: 2000, remainingAmount: 1000, status: 'active' }));
    await assertFails(updateDoc(doc(e, 'custodies', 'cus-1'), { remainingAmount: 0, settledAmount: 2000, status: 'settled', lastSettlementId: 'stl-p1' }));
    await settleCustodyItem(createFirestoreStore(e), actor(EMP, 'employee'), { custodyId: 'cus-1', amount: 10, description: 'x' }, key());
    await assertFails(updateDoc(doc(e, 'custodies', 'cus-1'), { remainingAmount: 0, settledAmount: 2000, status: 'settled', lastSettlementId: 'stl-p1' }));
  });

  it('[BYP-5] an unverified sign-up with an invitee\'s email gets nothing; verified + member settles', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'custodies', 'cus-pend'), custody('cus-pend', { employeeId: 'pending-x', employeeEmail: NEWHIRE.email, totalAmount: 300, remainingAmount: 300 }));
    });
    const attacker = db(NEWHIRE, false);
    await assertFails(getDoc(doc(attacker, 'custodies', 'cus-pend')));
    await assertFails(updateDoc(doc(attacker, 'custodies', 'cus-pend'), { remainingAmount: 0, settledAmount: 300, status: 'settled' }));
    await assertFails(settleCustodyItem(createFirestoreStore(attacker), actor(NEWHIRE, 'employee'), { custodyId: 'cus-pend', amount: 10, description: 'x' }, key()));
    // verified but not a member yet: still nothing to write
    await assertFails(settleCustodyItem(createFirestoreStore(db(NEWHIRE)), actor(NEWHIRE, 'employee'), { custodyId: 'cus-pend', amount: 10, description: 'x' }, key()));
    await seed(async f => {
      await setDoc(doc(f, 'members', `pending-x_${ORG}`), { orgId: ORG, userId: 'pending-x', userEmail: NEWHIRE.email, role: 'employee', active: true });
      await setDoc(doc(f, 'users', NEWHIRE.uid), { orgId: ORG, role: 'employee', active: true, memberId: `pending-x_${ORG}` });
    });
    await assertSucceeds(getDoc(doc(db(NEWHIRE), 'custodies', 'cus-pend')));
    await settleCustodyItem(createFirestoreStore(db(NEWHIRE)), actor(NEWHIRE, 'employee'), { custodyId: 'cus-pend', amount: 10, description: 'x' }, key());
  });

  it('[ORG-2] an org admin keeps the recipient list but cannot un-archive or re-identify the company', async () => {
    await seed(f => updateDoc(doc(f, 'organizations', ORG), { archived: true, status: 'archived' }));
    await assertFails(updateDoc(doc(db(ADMIN), 'organizations', ORG), { archived: false, status: 'active' }));
    await assertFails(updateDoc(doc(db(ADMIN), 'organizations', ORG), { currency: 'USD' }));
    await assertFails(updateDoc(doc(db(ADMIN), 'organizations', ORG), { code: 'NEW' }));
    await assertSucceeds(updateDoc(doc(db(ADMIN), 'organizations', ORG), { notificationRecipients: ['admin@acme.test'], updatedAt: 'x' }));
    await assertFails(updateDoc(doc(db(FIN), 'organizations', ORG), { notificationRecipients: [] }));
  });

  it('[ledger] ledger lines are immutable and only exist as their account\'s movement', async () => {
    await adjustAccountBalance(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), { accountId: 'acc-cash', type: 'in', amount: 1, description: 'x' }, 'key-ledger0001');
    await assertFails(updateDoc(doc(db(FIN), 'accountTransactions', 'tx-key-ledger0001'), { amount: 1000 }));
    await assertFails(deleteDoc(doc(db(ADMIN), 'accountTransactions', 'tx-key-ledger0001')));
    await assertFails(setDoc(doc(db(FIN), 'accountTransactions', 'tx-alone'), fakeLine('acc-cash', { id: 'tx-alone' })));
    // a movement attributed to someone else
    const f = db(FIN);
    await assertFails(writeBatch(f)
      .set(doc(f, 'accountTransactions', 'tx-forged-actor'), { ...fakeLine('acc-cash', { id: 'tx-forged-actor', type: 'in', amount: 1, balanceBefore: 1001, balanceAfter: 1002 }), actorId: ADMIN.uid })
      .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 1002, balance: 1002, totalIn: 2, lastLedgerId: 'tx-forged-actor' }).commit());
    await assertSucceeds(writeBatch(f)
      .set(doc(f, 'accountTransactions', 'tx-own-actor'), { ...fakeLine('acc-cash', { id: 'tx-own-actor', type: 'in', amount: 1, balanceBefore: 1001, balanceAfter: 1002 }), actorId: FIN.uid })
      .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 1002, balance: 1002, totalIn: 2, lastLedgerId: 'tx-own-actor' }).commit());
  });

  it('[syncOwnMembership] self-service rename still works (BYP-1 does not remove it)', async () => {
    const res = await syncOwnMembership(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), `${EMP.uid}_${ORG}`, { userName: 'سارة' });
    expect(res.changed).toBe(true);
  });
});
