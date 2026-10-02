/**
 * Adversarial and legitimacy suite for firestore.rules (rules-spec-v1, round r1).
 *
 * An attacker uses the raw Firestore Web SDK with their own credentials (single writes,
 * batches, transactions, chosen ids, fields the domain never writes); every legitimate
 * operation goes through the REAL domain functions (src/domain/*) as the role the UI
 * allows, on realistic and legacy data.
 *
 * A test whose name carries a finding id ([RQ-n], [AG-n], [CUS-n], [O1], [U1], [M1], [C1],
 * [A1], [L1]...) reproduces that round-r1 finding and asserts the now-correct outcome
 * (the attack is refused / the legitimate operation works). "[known, accepted]" tests
 * document a behaviour that is deliberately NOT enforced by the rules (see the commit
 * message / spec §11). Every other test is coverage.
 *
 * Sections (each seeds its own data): requests and counters, custodies, tenancy and
 * identity, legitimate operations.
 */
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, or, query, setDoc, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import { createFirestoreStore } from '../src/domain/firestoreStore';
import { createExpenseRequest, disburseExpenseRequest, transitionExpenseRequest, updateExpenseRequest } from '../src/domain/requests';
import {
  adjustAccountBalance,
  createPaymentAccount,
  deletePaymentAccount,
  detachLegacyWallet,
  issueCustody,
  replenishCustody,
  returnCustodyRemainders,
  settleCustodyItem,
  transferBetweenAccounts,
  updatePaymentAccount,
} from '../src/domain/treasury';
import {
  createEntity,
  createEntityInOrgs,
  createMember,
  createMemberInOrgs,
  createOrganization,
  deleteEntity,
  ensureOrgNotificationRecipients,
  removeMember,
  removeOrganization,
  syncOwnMembership,
  updateEntity,
  updateMemberRecord,
  updateOrganization,
} from '../src/domain/directory';
import { addVisaPayment, createVisaRequest, decideVisaRequest, deleteVisaRequest, updateVisaRequest } from '../src/domain/visa';
import { LEGACY_STORES, restoreBlock, restoreRecord, type LegacyRecord } from '../src/domain/legacyRecovery';
import { toMoney, uniqueKeyDocId, type Actor } from '../src/domain/common';
import { DEFAULT_EMAIL_SETTINGS } from '../src/services/emailTemplates';

const ORG = 'org-acme';
const OTHER_ORG = 'org-other';
const THIRD_ORG = 'org-third';
let env: RulesTestEnvironment;

const OWNER = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
const ADMIN = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
const EMP = { uid: 'uidEmployee0000000000000001', email: 'emp@acme.test' };
const EMP2 = { uid: 'uidEmployee0000000000000002', email: 'emp2@acme.test' };
const FIN = { uid: 'uidFinance00000000000000001', email: 'fin@acme.test' };
const DE = { uid: 'uidDataEntry000000000000001', email: 'de@acme.test' };
const CAIRO_FIN = { uid: 'uidCairoFin00000000000001', email: 'fin@other.test' };
const CAIRO_ADMIN = { uid: 'uidCairoAdmin000000000001', email: 'admin@other.test' };
const CAIRO_EMP = { uid: 'uidCairoEmp00000000000001', email: 'emp@other.test' };
const MULTI_FIN = { uid: 'uidMultiFin00000000000001', email: 'multi@other.test' };   // profile OTHER (employee), finance member of ORG
const MULTI2 = { uid: 'uidMultiFin00000000000002', email: 'multi2@acme.test' };      // profile ORG (employee), finance member of OTHER
const MULTI_EMP = { uid: 'uidMultiEmp00000000000001', email: 'memp@other.test' };    // profile OTHER (employee), employee member of ORG
const MULTI_ADMIN = { uid: 'uidMultiAdmin00000000001', email: 'madmin@other.test' }; // profile OTHER (employee), org admin member of ORG
const BOTH_FIN = { uid: 'uidBothFin000000000000001', email: 'both@acme.test' };      // finance in ORG (profile) and OTHER (member)
const SUSP_FIN = { uid: 'uidSuspFin000000000000001', email: 'susp@acme.test' };      // suspended finance of ORG
const STRANGER = { uid: 'uidStranger00000000000001', email: 'stranger@evil.test' };   // no profile, no membership
const NEWHIRE = { uid: 'uidNewHire000000000000001', email: 'newhire@acme.test' };    // invited by email
const INVITED = { uid: 'uidInvited00000000000000001', email: 'invited@acme.test' };  // custody issued by email before first sign-in

const db = (u: { uid: string; email: string }, verified = true): Firestore =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore() as unknown as Firestore;
const store = (u: { uid: string; email: string }, verified = true) => createFirestoreStore(db(u, verified));
const actor = (u: { uid: string; email: string }, role: Actor['role'], orgId?: string): Actor => ({ id: u.uid, name: u.email, email: u.email, role, ...(orgId ? { orgId } : {}) });
const notify = { settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: false } };
const notifyOff = notify;
const notifyOn = { settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: true, notifyOnDisbursement: true } };
const notifyAll = {
  settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: true, notifyOnNewRequest: true, notifyOnApproval: true, notifyOnDisbursement: true, notifyOnClarification: true, notifyOnRejection: true },
  adminRecipients: ['mahmoud@tieapps.com'],
};
let n = 0;
const key = () => `key-att${String(++n).padStart(7, '0')}`;
const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));
const read = async (c: string, id: string) => {
  let data: Record<string, any> | undefined;
  await env.withSecurityRulesDisabled(async ctx => {
    data = (await getDoc(doc(ctx.firestore(), c, id))).data();
  });
  return data;
};

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

describe('requests, disbursement binding, service / provider counters', () => {
  const L = (id: string) => `tx-req-${id}`;
  const fakeLine = (accountId: string, extra: Record<string, unknown> = {}) => ({
    id: 'x', orgId: ORG, accountId, accountName: accountId, type: 'out', amount: 300, balanceBefore: 1000, balanceAfter: 700,
    referenceType: 'request', description: 'x', actorName: 'x', actorId: FIN.uid, createdAt: 'x', ...extra,
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [ADMIN.email] });
      await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [CAIRO_ADMIN.email] });
      for (const [u, role, org] of [
        [ADMIN, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [EMP2, 'employee', ORG], [DE, 'data_entry', ORG],
        [CAIRO_FIN, 'finance', OTHER_ORG], [CAIRO_ADMIN, 'org_admin', OTHER_ORG], [CAIRO_EMP, 'employee', OTHER_ORG],
        [BOTH_FIN, 'finance', ORG],
      ] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true });
        await setDoc(doc(f, 'members', `${u.uid}_${org}`), { orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      await setDoc(doc(f, 'members', `${BOTH_FIN.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: BOTH_FIN.uid, userEmail: BOTH_FIN.email, role: 'finance', active: true });
      await setDoc(doc(f, 'users', MULTI_FIN.uid), { orgId: OTHER_ORG, role: 'employee', active: true });
      await setDoc(doc(f, 'members', `${MULTI_FIN.uid}_${ORG}`), { orgId: ORG, userId: MULTI_FIN.uid, userEmail: MULTI_FIN.email, role: 'finance', active: true });
      await setDoc(doc(f, 'users', MULTI2.uid), { orgId: ORG, role: 'employee', active: true });
      await setDoc(doc(f, 'members', `${MULTI2.uid}_${ORG}`), { orgId: ORG, userId: MULTI2.uid, userEmail: MULTI2.email, role: 'employee', active: true });
      await setDoc(doc(f, 'members', `${MULTI2.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: MULTI2.uid, userEmail: MULTI2.email, role: 'finance', active: true });
      await setDoc(doc(f, 'super_admins', 'someone-else'), { email: 'x@y.z' });

      await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), account('acc-cash', 1000));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank'), account('acc-bank', 5000, { type: 'bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-insta'), account('acc-insta', 5000, { type: 'instapay', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-ob'), { ...account('acc-ob', 9000, { type: 'bank' }), orgId: OTHER_ORG });
      await setDoc(doc(f, 'paymentAccounts', 'acc-oi'), { ...account('acc-oi', 9000, { type: 'instapay', parentAccountId: 'acc-ob', parentAccountName: 'acc-ob' }), orgId: OTHER_ORG });
      await setDoc(doc(f, 'paymentAccounts', 'acc-oc'), { ...account('acc-oc', 1000), orgId: OTHER_ORG });

      await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0 });
      await setDoc(doc(f, 'services', 'srv-2'), { orgId: ORG, name: 'Other', code: 'OTR', spentAmount: 0 });
      await setDoc(doc(f, 'services', 'srv-shared'), { orgId: ORG, orgIds: [ORG, OTHER_ORG], name: 'WE', code: 'WE', spentAmount: 0 });
      await setDoc(doc(f, 'services', 'srv-o'), { orgId: OTHER_ORG, name: 'OS', code: 'OS', spentAmount: 0 });
      await setDoc(doc(f, 'providers', 'prov-1'), { orgId: ORG, name: 'Vodafone', totalPaid: 500, active: true });
      await setDoc(doc(f, 'providers', 'prov-c'), { orgId: OTHER_ORG, name: 'CP', totalPaid: 0, active: true });
    });
  });

  // Builds the legitimate disbursement shape for request `id` (amount, account balance before) by `f`.
  const payBatch = (f: Firestore, id: string, accountId: string, before: number, amount: number, extra: Record<string, unknown> = {}, actorUid = FIN.uid) =>
    writeBatch(f)
      .update(doc(f, 'requests', id), { status: 'disbursed', disbursement: { accountId } })
      .set(doc(f, 'accountTransactions', L(id)), { ...fakeLine(accountId, { amount, balanceBefore: before, balanceAfter: before - amount, actorId: actorUid }), id: L(id), referenceId: id, ...extra })
      .update(doc(f, 'paymentAccounts', accountId), { currentBalance: before - amount, balance: before - amount, totalOut: amount, lastLedgerId: L(id) });

  // ===========================================================================
  // Request transitions
  // ===========================================================================
  describe('request transitions (attacker)', () => {
    it('approval: no forged approver, no self-approval by an employee / data entry / other company; timestamps only via approve', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'p'), approvedRequest('p', 10, { status: 'pending', requesterId: EMP.uid }));
        await setDoc(doc(f, 'requests', 'pde'), approvedRequest('pde', 10, { status: 'pending', requesterId: DE.uid, requesterEmail: DE.email }));
      });
      await assertFails(updateDoc(doc(db(ADMIN), 'requests', 'p'), { status: 'approved', approvedBy: FIN.uid, approvedAt: 'x' }));
      await assertFails(updateDoc(doc(db(EMP), 'requests', 'p'), { status: 'approved', approvedBy: EMP.uid, approvedAt: 'x' }));
      await assertFails(updateDoc(doc(db(DE), 'requests', 'pde'), { status: 'approved', approvedBy: DE.uid, approvedAt: 'x' }));
      await assertFails(updateDoc(doc(db(DE), 'requests', 'p'), { status: 'approved', approvedBy: DE.uid, approvedAt: 'x' }));
      await assertFails(updateDoc(doc(db(CAIRO_FIN), 'requests', 'p'), { status: 'approved', approvedBy: CAIRO_FIN.uid, approvedAt: 'x' }));
      await assertFails(updateDoc(doc(db(MULTI2), 'requests', 'p'), { status: 'approved', approvedBy: MULTI2.uid, approvedAt: 'x' }));   // finance only in OTHER
      // requester sets approvedBy / approvedAt while pending (frozen)
      await assertFails(updateDoc(doc(db(EMP), 'requests', 'p'), { approvedBy: ADMIN.uid, approvedAt: 'x' }));
      // approve + money change in the same write
      await assertFails(updateDoc(doc(db(FIN), 'requests', 'p'), { status: 'approved', approvedBy: FIN.uid, approvedAt: 'x', amount: 9999 }));
      // approve + requestType switch / service switch
      await assertFails(updateDoc(doc(db(FIN), 'requests', 'p'), { status: 'approved', approvedBy: FIN.uid, approvedAt: 'x', requestType: 'income' }));
      // multi-company finance member approves in its member company (control)
      await assertSucceeds(updateDoc(doc(db(MULTI_FIN), 'requests', 'p'), { status: 'approved', approvedBy: MULTI_FIN.uid, approvedAt: 'x' }));
    });

    it('data entry / employee / other company cannot edit someone else\'s request, attach an invoice, clarify, reject or delete', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'p'), approvedRequest('p', 10, { status: 'pending' })));
      for (const who of [DE, EMP2, CAIRO_FIN, CAIRO_ADMIN, MULTI2]) {
        const f = db(who);
        await assertFails(updateDoc(doc(f, 'requests', 'p'), { title: 'x' }));
        await assertFails(updateDoc(doc(f, 'requests', 'p'), { invoiceAttachment: { id: 'i' } }));
        await assertFails(updateDoc(doc(f, 'requests', 'p'), { paymentAccountDetails: 'evil@instapay' }));
        await assertFails(updateDoc(doc(f, 'requests', 'p'), { status: 'rejected', rejectionReason: 'x' }));
        await assertFails(updateDoc(doc(f, 'requests', 'p'), { status: 'clarification_requested', comments: [{ id: 'c' }] }));
        await assertFails(deleteDoc(doc(f, 'requests', 'p')));
      }
      // FIN cannot ask for clarification (org admin only) nor change the payee of someone else's pending request
      await assertFails(updateDoc(doc(db(FIN), 'requests', 'p'), { status: 'clarification_requested', comments: [{ id: 'c' }] }));
      await assertFails(updateDoc(doc(db(FIN), 'requests', 'p'), { paymentAccountDetails: 'evil@instapay' }));
      await assertFails(updateDoc(doc(db(FIN), 'requests', 'p'), { iban: 'EG00EVIL', beneficiaryName: 'x' }));
    });

    it('create: only pending, only in a company the caller belongs to, only for oneself unless org admin', async () => {
      const base = approvedRequest('c', 10, { status: 'pending' });
      await assertFails(setDoc(doc(db(EMP), 'requests', 'c1'), { ...base, id: 'c1', status: 'approved' }));
      await assertFails(setDoc(doc(db(EMP), 'requests', 'c2'), { ...base, id: 'c2', status: 'disbursed' }));
      await assertFails(setDoc(doc(db(EMP), 'requests', 'c3'), { ...base, id: 'c3', requesterId: EMP2.uid }));
      await assertFails(setDoc(doc(db(DE), 'requests', 'c4'), { ...base, id: 'c4', requesterId: EMP.uid }));
      await assertFails(setDoc(doc(db(FIN), 'requests', 'c5'), { ...base, id: 'c5', requesterId: EMP.uid }));
      await assertFails(setDoc(doc(db(CAIRO_EMP), 'requests', 'c6'), { ...base, id: 'c6', requesterId: CAIRO_EMP.uid }));
      await assertSucceeds(setDoc(doc(db(EMP), 'requests', 'c7'), { ...base, id: 'c7' }));
      await assertSucceeds(setDoc(doc(db(ADMIN), 'requests', 'c8'), { ...base, id: 'c8' }));
    });

    it('[RQ-3] a requester cannot create a pending request that already carries decision records (approver, payment, fake history)', async () => {
      await assertFails(setDoc(doc(db(EMP), 'requests', 'forged'), approvedRequest('forged', 300, {
        status: 'pending',
        approvedBy: ADMIN.uid, approvedAt: '2026-10-01T00:00:00.000Z',
        disbursement: { accountId: 'acc-cash', paymentMethod: 'instapay', referenceNumber: 'PAID-1', disbursedBy: 'CFO', disbursedAt: 'x' },
        comments: [{ id: 'c-x', authorId: ADMIN.uid, authorName: 'Org Admin', text: 'approved by phone, pay quickly' }],
        timeline: [{ id: 'tl-x', status: 'approved', title: 'approved', actorName: 'Org Admin', timestamp: 'x' }],
      })));
    });

    it('skip states: pending / clarification / rejected expense cannot be disbursed even with a perfect line + movement', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'sp'), approvedRequest('sp', 300, { status: 'pending' }));
        await setDoc(doc(f, 'requests', 'sc'), approvedRequest('sc', 300, { status: 'clarification_requested' }));
        await setDoc(doc(f, 'requests', 'sr'), approvedRequest('sr', 300, { status: 'rejected', rejectionReason: 'no' }));
      });
      for (const id of ['sp', 'sc', 'sr']) {
        for (const who of [FIN, ADMIN]) await assertFails(payBatch(db(who), id, 'acc-cash', 1000, 300, {}, who.uid).commit());
      }
      // control: approved works
      await seed(f => setDoc(doc(f, 'requests', 'ok'), approvedRequest('ok', 300)));
      await assertSucceeds(payBatch(db(FIN), 'ok', 'acc-cash', 1000, 300).commit());
    });

    it('re-open: disbursed and rejected requests are terminal for every non-owner role', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'd'), approvedRequest('d', 300, { status: 'disbursed', disbursement: { accountId: 'acc-cash' } }));
        await setDoc(doc(f, 'requests', 'r'), approvedRequest('r', 300, { status: 'rejected', rejectionReason: 'no' }));
      });
      for (const who of [ADMIN, FIN, EMP]) {
        const f = db(who);
        for (const id of ['d', 'r']) {
          await assertFails(updateDoc(doc(f, 'requests', id), { status: 'approved', approvedBy: who.uid, approvedAt: 'x' }));
          await assertFails(updateDoc(doc(f, 'requests', id), { status: 'pending' }));
          await assertFails(updateDoc(doc(f, 'requests', id), { status: 'pending', amount: 301 }));
          await assertFails(updateDoc(doc(f, 'requests', id), { status: 'clarification_requested', comments: [{ id: 'c' }] }));
          await assertFails(updateDoc(doc(f, 'requests', id), { amount: 1 }));
          await assertFails(updateDoc(doc(f, 'requests', id), { invoiceAttachment: { id: 'i' } }));
          await assertFails(updateDoc(doc(f, 'requests', id), { status: 'cancelled' }));
        }
        await assertFails(updateDoc(doc(f, 'requests', 'd'), { status: 'rejected', rejectionReason: 'x' }));
        await assertFails(updateDoc(doc(f, 'requests', 'd'), { disbursement: { accountId: 'acc-bank' } }));
      }
    });

    it('after approval: finance and the requester cannot change amount, currency, payee or type; finance approved→pending is refused', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300, { paymentAccountDetails: 'emp@instapay' })));
      for (const patch of [{ amount: 3000 }, { currency: 'USD' }, { paymentAccountDetails: 'evil@instapay' }, { iban: 'EG00EVIL' },
        { beneficiaryName: 'evil' }, { requestType: 'income' }, { serviceCategoryId: 'srv-2' }, { requesterId: FIN.uid }]) {
        await assertFails(updateDoc(doc(db(FIN), 'requests', 'a'), patch));
        await assertFails(updateDoc(doc(db(EMP), 'requests', 'a'), patch));
      }
      await assertFails(updateDoc(doc(db(FIN), 'requests', 'a'), { status: 'pending', amount: 3000 }));
      await assertFails(updateDoc(doc(db(EMP), 'requests', 'a'), { status: 'pending', amount: 3000 }));
      // invoice-only by finance stays allowed (control)
      await assertSucceeds(updateDoc(doc(db(FIN), 'requests', 'a'), { invoiceAttachment: { id: 'inv' } }));
    });

    it('[RQ-1] org admin cannot change the money of an approved request while keeping it approved (must go back to pending)', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300, { approvedBy: FIN.uid, approvedAt: 'x' })));
      // raw write: amount 300 -> 4000, status stays 'approved', approval of 300 kept
      await assertFails(updateDoc(doc(db(ADMIN), 'requests', 'a'), { amount: 4000 }));
    });

    it('[RQ-1] org admin cannot change the currency of an approved request while keeping it approved', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300, { approvedBy: FIN.uid, approvedAt: 'x' })));
      await assertFails(updateDoc(doc(db(ADMIN), 'requests', 'a'), { currency: 'USD' }));
    });

    it('[RQ-1] impact: the inflated amount is then paid by finance on the strength of the old approval', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300, { approvedBy: FIN.uid, approvedAt: 'x' })));
      try { await updateDoc(doc(db(ADMIN), 'requests', 'a'), { amount: 900, requestType: 'expense' }); } catch { /* refused = secure */ }
      await disburseExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'a', { paymentMethod: 'cash', referenceNumber: 'X', accountId: 'acc-cash' }, key(), notify);
      // secure outcome: only the approved 300 left the account
      expect((await read('paymentAccounts', 'acc-cash'))!.currentBalance).toBe(700);
    });

    it('timeline / comments: no truncation, rewrite or prepend by any role, in any transition', async () => {
      const tl = [{ id: 'tl-1', title: 'created' }, { id: 'tl-2', title: 'asked' }];
      const cm = [{ id: 'c-1', text: 'why?' }];
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'c'), approvedRequest('c', 10, { status: 'clarification_requested', timeline: tl, comments: cm }));
        await setDoc(doc(f, 'requests', 'p'), approvedRequest('p', 10, { status: 'pending', timeline: tl, comments: cm }));
        await setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 10, { timeline: tl, comments: cm }));
      });
      // requester reply rewriting history
      await assertFails(updateDoc(doc(db(EMP), 'requests', 'c'), { status: 'pending', comments: [{ id: 'c-1', text: 'nothing asked' }, { id: 'c-2' }], timeline: [...tl, { id: 'tl-3' }] }));
      await assertFails(updateDoc(doc(db(EMP), 'requests', 'c'), { status: 'pending', comments: [...cm, { id: 'c-2' }], timeline: [{ id: 'tl-1' }, { id: 'tl-3' }] }));
      // requester reply that also changes the amount / approves
      await assertFails(updateDoc(doc(db(EMP), 'requests', 'c'), { status: 'pending', amount: 999, comments: [...cm, { id: 'c-2' }], timeline: [...tl, { id: 'tl-3' }] }));
      await assertFails(updateDoc(doc(db(EMP), 'requests', 'c'), { status: 'approved', approvedBy: EMP.uid, approvedAt: 'x', comments: [...cm, { id: 'c-2' }], timeline: [...tl, { id: 'tl-3' }] }));
      // a reply by someone else than the requester
      await assertFails(updateDoc(doc(db(EMP2), 'requests', 'c'), { status: 'pending', comments: [...cm, { id: 'c-2' }], timeline: [...tl, { id: 'tl-3' }] }));
      await assertFails(updateDoc(doc(db(FIN), 'requests', 'c'), { status: 'pending', comments: [...cm, { id: 'c-2' }], timeline: [...tl, { id: 'tl-3' }] }));
      // org admin decisions rewriting history
      await assertFails(updateDoc(doc(db(ADMIN), 'requests', 'p'), { status: 'rejected', rejectionReason: 'x', comments: [], timeline: [...tl, { id: 'tl-3' }] }));
      await assertFails(updateDoc(doc(db(ADMIN), 'requests', 'p'), { status: 'approved', approvedBy: ADMIN.uid, approvedAt: 'x', timeline: [{ id: 'tl-3' }] }));
      await assertFails(updateDoc(doc(db(ADMIN), 'requests', 'c'), { comments: [{ id: 'c-0' }, ...cm], timeline: [...tl, { id: 'tl-3' }] }));
      // finance invoice that truncates the timeline
      await assertFails(updateDoc(doc(db(FIN), 'requests', 'a'), { invoiceAttachment: { id: 'i' }, timeline: [] }));
      // disbursement rewriting the timeline
      const fd = db(FIN);
      await assertFails(writeBatch(fd)
        .update(doc(fd, 'requests', 'a'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' }, timeline: [] })
        .set(doc(fd, 'accountTransactions', L('a')), { ...fakeLine('acc-cash', { amount: 10, balanceBefore: 1000, balanceAfter: 990 }), id: L('a'), referenceId: 'a' })
        .update(doc(fd, 'paymentAccounts', 'acc-cash'), { currentBalance: 990, balance: 990, totalOut: 10, lastLedgerId: L('a') }).commit());
      // controls
      await assertSucceeds(updateDoc(doc(db(EMP), 'requests', 'c'), { status: 'pending', comments: [...cm, { id: 'c-2' }], timeline: [...tl, { id: 'tl-3' }] }));
    });

    it('[known §11.4, not new] an unverified sign-up using the requester\'s email can still edit the payee of a pending request', async () => {
      const IMPOSTOR = { uid: 'uidImpostor0000000000001', email: EMP.email };
      await seed(f => setDoc(doc(f, 'requests', 'p'), approvedRequest('p', 10, { status: 'pending' })));
      // documented (spec §11.4): the requester path accepts an unverified token email
      await assertSucceeds(updateDoc(doc(db(IMPOSTOR, false), 'requests', 'p'), { paymentAccountDetails: 'evil@instapay' }));
    });
  });

  // ===========================================================================
  // Disbursement binding
  // ===========================================================================
  describe('disbursement binding (attacker)', () => {
    it('a line on another company\'s account (moved by a finance user of both companies) does not pay the request', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300)));
      const f = db(BOTH_FIN);
      await assertFails(payBatch(f, 'a', 'acc-oc', 1000, 300, { orgId: OTHER_ORG }, BOTH_FIN.uid).commit());
      // control: same user, own company account
      await assertSucceeds(payBatch(f, 'a', 'acc-cash', 1000, 300, {}, BOTH_FIN.uid).commit());
    });

    it('wrong direction: expense paid with an IN line, income received with an OUT line', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300));
        await setDoc(doc(f, 'requests', 'inc'), approvedRequest('inc', 300, { status: 'pending', requestType: 'income' }));
      });
      const f = db(FIN);
      const inBatch = (id: string) => writeBatch(f)
        .update(doc(f, 'requests', id), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } })
        .set(doc(f, 'accountTransactions', L(id)), { ...fakeLine('acc-cash', { type: 'in', amount: 300, balanceBefore: 1000, balanceAfter: 1300 }), id: L(id), referenceId: id })
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 1300, balance: 1300, totalIn: 300, lastLedgerId: L(id) });
      await assertFails(inBatch('a').commit());
      await assertFails(payBatch(f, 'inc', 'acc-cash', 1000, 300).commit());
      await assertSucceeds(inBatch('inc').commit());
    });

    it('another request\'s line, no line, a line with the wrong reference, two requests on one account movement', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300));
        await setDoc(doc(f, 'requests', 'b'), approvedRequest('b', 300));
      });
      const f = db(FIN);
      await assertSucceeds(payBatch(f, 'a', 'acc-cash', 1000, 300).commit());
      // b names a's account and a's (already existing) line: no line tx-req-b exists
      await assertFails(updateDoc(doc(f, 'requests', 'b'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } }));
      // b with its own line id but referencing a
      await assertFails(payBatch(f, 'b', 'acc-cash', 700, 300, { referenceId: 'a' }).commit());
      // a line tx-req-b created but the account pointer names a different line
      await assertFails(writeBatch(f)
        .update(doc(f, 'requests', 'b'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } })
        .set(doc(f, 'accountTransactions', L('b')), { ...fakeLine('acc-cash', { balanceBefore: 700, balanceAfter: 400 }), id: L('b'), referenceId: 'b' })
        .set(doc(f, 'accountTransactions', 'tx-other'), { ...fakeLine('acc-cash', { balanceBefore: 700, balanceAfter: 400 }), id: 'tx-other', referenceId: 'b' })
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 400, balance: 400, totalOut: 600, lastLedgerId: 'tx-other' }).commit());
      // two requests, one movement of 300 on one account
      await seed(async g => {
        await setDoc(doc(g, 'requests', 'c'), approvedRequest('c', 300));
        await setDoc(doc(g, 'requests', 'd'), approvedRequest('d', 300));
      });
      await assertFails(writeBatch(f)
        .update(doc(f, 'requests', 'c'), { status: 'disbursed', disbursement: { accountId: 'acc-bank' } })
        .update(doc(f, 'requests', 'd'), { status: 'disbursed', disbursement: { accountId: 'acc-bank' } })
        .set(doc(f, 'accountTransactions', L('c')), { ...fakeLine('acc-bank', { balanceBefore: 5000, balanceAfter: 4700 }), id: L('c'), referenceId: 'c' })
        .set(doc(f, 'accountTransactions', L('d')), { ...fakeLine('acc-bank', { balanceBefore: 5000, balanceAfter: 4700 }), id: L('d'), referenceId: 'd' })
        .update(doc(f, 'paymentAccounts', 'acc-bank'), { currentBalance: 4700, balance: 4700, totalOut: 300, lastLedgerId: L('c') }).commit());
    });

    it('[RQ-2] a deleted-and-recreated disbursed request is marked paid again with NO money moving, re-using its old ledger line', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'r'), approvedRequest('r', 300, { serviceCategoryId: 'srv-1', providerId: 'prov-1' })));
      await disburseExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'r', { paymentMethod: 'cash', referenceNumber: 'R', accountId: 'acc-cash' }, key(), notify);
      expect(await read('paymentAccounts', 'acc-cash')).toMatchObject({ currentBalance: 700, lastLedgerId: L('r') });
      const a = db(ADMIN);
      const ok = (p: Promise<unknown>) => p.then(() => true, () => false);
      // 1. org admin deletes the paid request, 2. re-creates it (pending, same id, on behalf of another employee)
      // (each step refused = attack stopped = secure outcome)
      if (!(await ok(deleteDoc(doc(a, 'requests', 'r'))))) return;
      if (!(await ok(setDoc(doc(a, 'requests', 'r'), approvedRequest('r', 300, {
        status: 'pending', requesterId: EMP2.uid, requesterEmail: EMP2.email, requesterName: 'e2', serviceCategoryId: 'srv-1', providerId: 'prov-1',
      }))))) return;
      // 3. approves it
      await assertSucceeds(updateDoc(doc(a, 'requests', 'r'), { status: 'approved', approvedBy: ADMIN.uid, approvedAt: 'x' }));
      // 4. marks it disbursed with no movement at all, and counts it a second time in the budget and the provider
      await assertFails(writeBatch(a)
        .update(doc(a, 'requests', 'r'), { status: 'disbursed', disbursement: { accountId: 'acc-cash', referenceNumber: 'R2' } })
        .update(doc(a, 'services', 'srv-1'), { spentAmount: 600, lastDisbursedRequestId: 'r' })
        .update(doc(a, 'providers', 'prov-1'), { totalPaid: 1100, lastDisbursedRequestId: 'r' })
        .commit());
    });

    it('[RQ-2] variant: finance (no delete right) pays a request in a commit that moves no money, using a line booked earlier under its id', async () => {
      // FIN books an "adjustment" whose line id is tx-req-<id> (money out once), then later marks the request paid
      // AND raises the service in a commit that moves nothing. Net money effect is one movement, but the
      // disbursement is not bound to a movement of ITS commit; with RQ-2 above the same line pays twice.
      await seed(f => setDoc(doc(f, 'requests', 'q'), approvedRequest('q', 300, { serviceCategoryId: 'srv-1' })));
      const f = db(FIN);
      await assertSucceeds(writeBatch(f)
        .set(doc(f, 'accountTransactions', L('q')), { ...fakeLine('acc-cash', { referenceType: 'manual_adjustment' }), id: L('q'), referenceId: 'q' })
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 700, balance: 700, totalOut: 300, lastLedgerId: L('q') }).commit());
      await assertFails(writeBatch(f)
        .update(doc(f, 'requests', 'q'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } })
        .update(doc(f, 'services', 'srv-1'), { spentAmount: 300, lastDisbursedRequestId: 'q' })
        .commit());
    });

    it('the domain cannot pay the re-created request again either (its line id is taken): no double payment', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'r'), approvedRequest('r', 300)));
      await disburseExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'r', { paymentMethod: 'cash', referenceNumber: 'R', accountId: 'acc-cash' }, key(), notify);
      const a = db(ADMIN);
      if (!(await deleteDoc(doc(a, 'requests', 'r')).then(() => true, () => false))) return; // delete refused: nothing to re-pay
      await setDoc(doc(a, 'requests', 'r'), approvedRequest('r', 300, { status: 'pending' }));
      await updateDoc(doc(a, 'requests', 'r'), { status: 'approved', approvedBy: ADMIN.uid, approvedAt: 'x' });
      await expect(disburseExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'r', { paymentMethod: 'cash', referenceNumber: 'R2', accountId: 'acc-bank' }, key(), notify)).rejects.toBeTruthy();
      expect((await read('paymentAccounts', 'acc-bank'))!.currentBalance).toBe(5000);
    });
  });

  // ===========================================================================
  // services.spentAmount / providers.totalPaid
  // ===========================================================================
  describe('service / provider counters (attacker)', () => {
    it('marker tricks: request of another service / provider / company, unshared company, decrease, partial, no-role, income', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'a'), approvedRequest('a', 300, { serviceCategoryId: 'srv-2', providerId: 'prov-1' }));
        await setDoc(doc(f, 'requests', 'oc'), { ...approvedRequest('oc', 300, { serviceCategoryId: 'srv-1', providerId: 'prov-1' }), orgId: OTHER_ORG, requesterEmail: CAIRO_EMP.email });
        await setDoc(doc(f, 'requests', 'os'), { ...approvedRequest('os', 300, { serviceCategoryId: 'srv-shared', providerId: 'prov-c' }), orgId: OTHER_ORG, requesterEmail: CAIRO_EMP.email });
      });
      const f = db(FIN);
      // a links srv-2: raising srv-1 with marker a
      await assertFails(payBatch(f, 'a', 'acc-cash', 1000, 300).update(doc(f, 'services', 'srv-1'), { spentAmount: 300, lastDisbursedRequestId: 'a' }).commit());
      // decrease / partial / double
      await assertFails(payBatch(f, 'a', 'acc-cash', 1000, 300).update(doc(f, 'services', 'srv-2'), { spentAmount: -300, lastDisbursedRequestId: 'a' }).commit());
      await assertFails(payBatch(f, 'a', 'acc-cash', 1000, 300).update(doc(f, 'providers', 'prov-1'), { totalPaid: 200, lastDisbursedRequestId: 'a' }).commit());
      await assertFails(payBatch(f, 'a', 'acc-cash', 1000, 300).update(doc(f, 'services', 'srv-2'), { spentAmount: 600, lastDisbursedRequestId: 'a' }).commit());
      // marker + a profile change smuggled in
      await assertFails(payBatch(f, 'a', 'acc-cash', 1000, 300).update(doc(f, 'services', 'srv-2'), { spentAmount: 300, lastDisbursedRequestId: 'a', name: 'x' }).commit());
      await assertFails(payBatch(f, 'a', 'acc-cash', 1000, 300).update(doc(f, 'services', 'srv-2'), { spentAmount: 300, lastDisbursedRequestId: 'a', orgIds: [ORG, OTHER_ORG] }).commit());
      // OTHER request linked to ORG's (unshared) srv-1 and ORG's prov-1, paid by CAIRO_FIN from its own account
      const c = db(CAIRO_FIN);
      await assertFails(payBatch(c, 'oc', 'acc-oc', 1000, 300, { orgId: OTHER_ORG }, CAIRO_FIN.uid).update(doc(c, 'services', 'srv-1'), { spentAmount: 300, lastDisbursedRequestId: 'oc' }).commit());
      await assertFails(payBatch(c, 'oc', 'acc-oc', 1000, 300, { orgId: OTHER_ORG }, CAIRO_FIN.uid).update(doc(c, 'providers', 'prov-1'), { totalPaid: 800, lastDisbursedRequestId: 'oc' }).commit());
      // shared service paid by CAIRO, but the share is removed first? (CAIRO cannot edit orgIds)
      await assertFails(updateDoc(doc(c, 'services', 'srv-shared'), { orgIds: [ORG, OTHER_ORG, 'org-x'] }));
      // OTHER request linked to srv-shared: legit (control), then a replay of the same marker
      await assertSucceeds(payBatch(c, 'os', 'acc-oc', 1000, 300, { orgId: OTHER_ORG }, CAIRO_FIN.uid)
        .update(doc(c, 'services', 'srv-shared'), { spentAmount: 300, lastDisbursedRequestId: 'os' })
        .update(doc(c, 'providers', 'prov-c'), { totalPaid: 300, lastDisbursedRequestId: 'os' }).commit());
      await assertFails(updateDoc(doc(c, 'services', 'srv-shared'), { spentAmount: 600, lastDisbursedRequestId: 'os' }));
      await assertFails(updateDoc(doc(db(FIN), 'services', 'srv-shared'), { spentAmount: 600, lastDisbursedRequestId: 'os' }));
      // the service of the secondary company cannot be raised by ORG via a shared marker
      await assertFails(updateDoc(doc(db(FIN), 'services', 'srv-o'), { spentAmount: 300, lastDisbursedRequestId: 'os' }));
      // marker only (no amount) / reset of the marker by a profile edit
      await assertFails(updateDoc(doc(db(ADMIN), 'services', 'srv-shared'), { lastDisbursedRequestId: 'zzz' }));
      await assertFails(updateDoc(doc(db(ADMIN), 'services', 'srv-shared'), { spentAmount: 0 }));
    });

    it('a non-finance user who files and gets approved a request cannot disburse it and raise counters', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'e'), approvedRequest('e', 300, { serviceCategoryId: 'srv-1' })));
      for (const who of [EMP, DE, CAIRO_FIN, MULTI2]) {
        const g = db(who);
        await assertFails(payBatch(g, 'e', 'acc-cash', 1000, 300, {}, who.uid)
          .update(doc(g, 'services', 'srv-1'), { spentAmount: 300, lastDisbursedRequestId: 'e' }).commit());
      }
    });

    it('create/delete/re-create: a counter is never created non-zero (numbers), nor erased by delete', async () => {
      await assertFails(setDoc(doc(db(DE), 'providers', 'p-new'), { orgId: ORG, name: 'n', totalPaid: 10 }));
      await assertFails(setDoc(doc(db(ADMIN), 'services', 's-new'), { orgId: ORG, name: 'n', code: 'n', spentAmount: -10 }));
      await assertFails(setDoc(doc(db(DE), 'providers', 'p-new2'), { orgId: OTHER_ORG, name: 'n', totalPaid: 0 }));
      await assertFails(setDoc(doc(db(ADMIN), 'services', 's-new2'), { orgId: ORG, name: 'n', code: 'n', spentAmount: 0, orgIds: [ORG, OTHER_ORG] }));
      await assertFails(deleteDoc(doc(db(ADMIN), 'providers', 'prov-1')));
      await assertFails(deleteDoc(doc(db(DE), 'providers', 'prov-c')));
      // a re-created provider with the same id starts at 0 (control)
      await seed(f => updateDoc(doc(f, 'providers', 'prov-1'), { totalPaid: 0 }));
      await assertSucceeds(deleteDoc(doc(db(ADMIN), 'providers', 'prov-1')));
      await assertFails(setDoc(doc(db(ADMIN), 'providers', 'prov-1'), { orgId: ORG, name: 'n', totalPaid: 500 }));
      await assertSucceeds(setDoc(doc(db(DE), 'providers', 'prov-1'), { orgId: ORG, name: 'n', totalPaid: 0, lastDisbursedRequestId: 'old' }));
    });

    it('[AG-1] data entry / org admin cannot create a provider / service whose counter is a non-number (shown as paid, blocks payments)', async () => {
      // counterIsZero() treats ANY non-number as zero; the UI and the domain read it with Number()
      await assertFails(setDoc(doc(db(DE), 'providers', 'p-str'), { orgId: ORG, name: 'Fake', totalPaid: '250000', active: true }));
    });

    it('[AG-1] impact: a request linked to a provider created with totalPaid "250000" can no longer be disbursed (rules refuse the domain\'s increment)', async () => {
      try { await setDoc(doc(db(DE), 'providers', 'p-str'), { orgId: ORG, name: 'Fake', totalPaid: '250000', active: true }); } catch { /* refused = secure */ }
      try { await setDoc(doc(db(ADMIN), 'services', 's-str'), { orgId: ORG, name: 'Fake', code: 'FK', spentAmount: '500000' }); } catch { /* refused */ }
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'rp'), approvedRequest('rp', 100, { providerId: 'p-str' }));
        await setDoc(doc(f, 'requests', 'rs'), approvedRequest('rs', 100, { serviceCategoryId: 's-str' }));
      });
      // legitimate disbursements by finance must keep working
      await disburseExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'rp', { paymentMethod: 'cash', referenceNumber: 'P', accountId: 'acc-cash' }, key(), notify);
      await disburseExpenseRequest(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), 'rs', { paymentMethod: 'cash', referenceNumber: 'S', accountId: 'acc-cash' }, key(), notify);
    });

    it('[AG-1] org admin deletes a service whose spending is stored as a string (history erased)', async () => {
      await seed(f => setDoc(doc(f, 'services', 's-legacy-str'), { orgId: ORG, name: 'L', code: 'L', spentAmount: '1200' }));
      await assertFails(deleteDoc(doc(db(ADMIN), 'services', 's-legacy-str')));
    });
  });

  // ===========================================================================
  // Budgets: heaviest legitimate disbursements through the REAL domain
  // ===========================================================================
  describe('budgets: shared service + provider + InstaPay (bank parent) + outbox', () => {
    const longHistory = {
      timeline: Array.from({ length: 60 }, (_, i) => ({ id: `tl-${i}`, status: 'pending', title: 'x'.repeat(40), actorName: 'a', timestamp: 'x' })),
      comments: Array.from({ length: 30 }, (_, i) => ({ id: `c-${i}`, text: 'y'.repeat(40), authorId: 'a', authorName: 'a' })),
    };

    it('primary company (ORG) request on the shared service: finance, org admin, multi-company finance member, owner', async () => {
      const payers = [[FIN, 'finance'], [ADMIN, 'org_admin'], [MULTI_FIN, 'finance'], [OWNER, 'super_admin']] as const;
      await seed(async f => {
        for (const [i] of payers.entries()) {
          await setDoc(doc(f, 'requests', `h${i}`), approvedRequest(`h${i}`, 100.1, { serviceCategoryId: 'srv-shared', providerId: 'prov-1', ...longHistory }));
        }
      });
      for (const [i, [who, role]] of payers.entries()) {
        const res = await disburseExpenseRequest(createFirestoreStore(db(who)), actor(who, role), `h${i}`, { paymentMethod: 'instapay', referenceNumber: `H${i}`, accountId: 'acc-insta' }, key(), notifyOn);
        expect(res.changed).toBe(true);
      }
      expect((await read('services', 'srv-shared'))!.spentAmount).toBe(400.4);
      expect((await read('providers', 'prov-1'))!.totalPaid).toBe(900.4);
      expect((await read('paymentAccounts', 'acc-bank'))!.currentBalance).toBe(4599.6);
    });

    it('secondary company (OTHER) request on the shared service: finance, org admin, multi-company finance member, owner', async () => {
      const payers = [[CAIRO_FIN, 'finance'], [CAIRO_ADMIN, 'org_admin'], [MULTI2, 'finance'], [OWNER, 'super_admin'], [BOTH_FIN, 'finance']] as const;
      await seed(async f => {
        for (const [i] of payers.entries()) {
          await setDoc(doc(f, 'requests', `k${i}`), {
            ...approvedRequest(`k${i}`, 200, { serviceCategoryId: 'srv-shared', providerId: 'prov-c', ...longHistory }),
            orgId: OTHER_ORG, requesterId: CAIRO_EMP.uid, requesterEmail: CAIRO_EMP.email,
          });
        }
      });
      for (const [i, [who, role]] of payers.entries()) {
        const res = await disburseExpenseRequest(createFirestoreStore(db(who)), actor(who, role), `k${i}`, { paymentMethod: 'instapay', referenceNumber: `K${i}`, accountId: 'acc-oi' }, key(), notifyOn);
        expect(res.changed).toBe(true);
      }
      expect((await read('services', 'srv-shared'))!.spentAmount).toBe(1000);
      expect((await read('providers', 'prov-c'))!.totalPaid).toBe(1000);
      expect((await read('paymentAccounts', 'acc-ob'))!.currentBalance).toBe(8000);
    });

    it('[L1] [AG-2] budget: multi-company finance member whose PROFILE company neither owns nor shares the service pays a shared-service request (InstaPay + provider + outbox)', async () => {
      // srv-third: owned by a third company, shared with OTHER. MULTI2: profile ORG (employee), finance member of OTHER.
      await seed(async f => {
        await setDoc(doc(f, 'organizations', 'org-third'), { id: 'org-third', name: 'Third', code: 'THR', currency: 'EGP', notificationRecipients: [] });
        await setDoc(doc(f, 'services', 'srv-third'), { orgId: 'org-third', orgIds: ['org-third', OTHER_ORG], name: 'T', code: 'T', spentAmount: 0 });
        await setDoc(doc(f, 'requests', 'm1'), {
          ...approvedRequest('m1', 75, { serviceCategoryId: 'srv-third', providerId: 'prov-c' }),
          orgId: OTHER_ORG, requesterId: CAIRO_EMP.uid, requesterEmail: CAIRO_EMP.email,
        });
      });
      const res = await disburseExpenseRequest(createFirestoreStore(db(MULTI2)), actor(MULTI2, 'finance'), 'm1', { paymentMethod: 'instapay', referenceNumber: 'M1', accountId: 'acc-oi' }, key(), notifyOn);
      expect(res.changed).toBe(true);
      expect((await read('services', 'srv-third'))!.spentAmount).toBe(75);
    });

    it('income request (pending → received) into an InstaPay by the multi-company member and the owner; approve/reject/clarify/reply on a long history', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'i1'), approvedRequest('i1', 50, { status: 'pending', requestType: 'income', ...longHistory }));
        await setDoc(doc(f, 'requests', 'i2'), approvedRequest('i2', 50, { status: 'pending', requestType: 'income', ...longHistory }));
        await setDoc(doc(f, 'requests', 't1'), approvedRequest('t1', 50, { status: 'pending', ...longHistory }));
        await setDoc(doc(f, 'requests', 't2'), approvedRequest('t2', 50, { status: 'pending', ...longHistory }));
      });
      await disburseExpenseRequest(createFirestoreStore(db(MULTI_FIN)), actor(MULTI_FIN, 'finance'), 'i1', { paymentMethod: 'instapay', referenceNumber: 'I1', accountId: 'acc-insta' }, key(), notifyOn);
      await disburseExpenseRequest(createFirestoreStore(db(OWNER)), actor(OWNER, 'super_admin'), 'i2', { paymentMethod: 'instapay', referenceNumber: 'I2', accountId: 'acc-insta' }, key(), notifyOn);
      expect((await read('paymentAccounts', 'acc-bank'))!.currentBalance).toBe(5100);
      const adm = createFirestoreStore(db(ADMIN));
      await transitionExpenseRequest(adm, actor(ADMIN, 'org_admin'), 't1', { type: 'clarify', question: 'q' }, key(), notifyOn);
      await transitionExpenseRequest(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), 't1', { type: 'reply', replyText: 'a' }, key(), notifyOn);
      await transitionExpenseRequest(createFirestoreStore(db(MULTI_FIN)), actor(MULTI_FIN, 'finance'), 't1', { type: 'approve', note: 'ok' }, key(), notifyOn);
      await transitionExpenseRequest(createFirestoreStore(db(MULTI_FIN)), actor(MULTI_FIN, 'finance'), 't2', { type: 'reject', reason: 'no' }, key(), notifyOn);
      await updateExpenseRequest(createFirestoreStore(db(MULTI_FIN)), actor(MULTI_FIN, 'finance'), 't1', { invoiceAttachment: { id: 'i', name: 'i', url: 'fsattach://i', type: 'application/pdf', size: 1, uploadedAt: 'x' } as any }, key());
      expect((await read('requests', 't1'))!.status).toBe('approved');
    });

    it('directory domain still works around the counters (data entry creates a provider, org admin deactivates a paid one)', async () => {
      const p = await createEntity(createFirestoreStore(db(DE)), actor(DE, 'data_entry'), 'provider', (id: string) => ({ id, orgId: ORG, name: 'Etisalat', totalPaid: 0, active: true } as any), () => 'x', key());
      expect(p.changed).toBe(true);
      expect((await deleteEntity(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'provider', 'prov-1', 'delete', key())).removal).toBe('deactivated');
    });
  });

  // ===========================================================================
  // Round r1 fixes: request delete, legacy restore gates
  // ===========================================================================
  describe('round r1 fixes (requests)', () => {
    it('[RQ-2] org admin deletes a pending request, never a paid one (the owner still may)', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'pd'), approvedRequest('pd', 10, { status: 'pending' }));
        await setDoc(doc(f, 'requests', 'dd'), approvedRequest('dd', 10, { status: 'disbursed', disbursement: { accountId: 'acc-cash' } }));
      });
      await assertSucceeds(deleteDoc(doc(db(ADMIN), 'requests', 'pd')));
      await assertFails(deleteDoc(doc(db(ADMIN), 'requests', 'dd')));
      await assertFails(deleteDoc(doc(db(FIN), 'requests', 'dd')));
      await assertSucceeds(deleteDoc(doc(db(OWNER), 'requests', 'dd')));
    });

    it('[RQ-3] [AG-1] legacy restore: a pending request with decision records, or a counter that is not a number, goes to the owner', () => {
      const rec = (collection: string, data: Record<string, unknown>): LegacyRecord =>
        ({ store: LEGACY_STORES.find(s => s.collection === collection)!, id: 'x', data: { id: 'x', ...data }, title: 'x' });
      const adminCtx = { actor: actor(ADMIN, 'org_admin', ORG), orgId: ORG };
      expect(restoreBlock(adminCtx, rec('requests', { orgId: ORG, status: 'pending', requesterId: EMP.uid, approvedBy: ADMIN.uid }))).toBe('needs_owner');
      expect(restoreBlock(adminCtx, rec('requests', { orgId: ORG, status: 'pending', requesterId: EMP.uid, disbursement: { accountId: 'a' } }))).toBe('needs_owner');
      expect(restoreBlock(adminCtx, rec('requests', { orgId: ORG, status: 'pending', requesterId: EMP.uid }))).toBeNull();
      expect(restoreBlock(adminCtx, rec('providers', { orgId: ORG, name: 'p', totalPaid: '250000' }))).toBe('needs_owner');
      expect(restoreBlock(adminCtx, rec('services', { orgId: ORG, name: 's', code: 's', spentAmount: '0' }))).toBe('needs_owner');
      expect(restoreBlock(adminCtx, rec('providers', { orgId: ORG, name: 'p', totalPaid: null }))).toBeNull();
      expect(restoreBlock(adminCtx, rec('services', { orgId: ORG, name: 's', code: 's' }))).toBeNull();
      expect(restoreBlock({ actor: actor(OWNER, 'super_admin'), orgId: '' }, rec('requests', { orgId: ORG, status: 'pending', approvedBy: ADMIN.uid }))).toBeNull();
    });

    it('[AG-1] legacy counters: missing / null still count as zero (create and delete), a string blocks the delete', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'services', 's-null'), { orgId: ORG, name: 'N', code: 'N', spentAmount: null });
        await setDoc(doc(f, 'providers', 'p-none'), { orgId: ORG, name: 'none' });
        await setDoc(doc(f, 'providers', 'p-str'), { orgId: ORG, name: 'str', totalPaid: '0' });
      });
      await assertSucceeds(deleteDoc(doc(db(ADMIN), 'services', 's-null')));
      await assertSucceeds(deleteDoc(doc(db(ADMIN), 'providers', 'p-none')));
      await assertFails(deleteDoc(doc(db(ADMIN), 'providers', 'p-str')));
      await assertSucceeds(setDoc(doc(db(DE), 'providers', 'p-new'), { orgId: ORG, name: 'new', totalPaid: null }));
      await assertSucceeds(setDoc(doc(db(ADMIN), 'services', 's-new'), { orgId: ORG, name: 'new', code: 'new' }));
    });
  });
});

describe('custodies', () => {
  // A ledger line as the domain writes it (createMovementBatch), attributed to `by`.
  const line = (id: string, accountId: string, type: 'in' | 'out', amount: number, before: number, after: number, refType: string, refId: string, by = FIN, extra: Record<string, unknown> = {}) => ({
    id, operationLedgerId: id, orgId: ORG, accountId, accountName: accountId, type, amount, balanceBefore: before, balanceAfter: after,
    referenceType: refType, referenceId: refId, description: 'x', actorName: by.email, actorId: by.uid, createdAt: '2026-10-03T00:00:00.000Z', ...extra,
  });
  const settlement = (id: string, custodyId: string, amount: number, extra: Record<string, unknown> = {}) => ({
    id, custodyId, orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount, currency: 'EGP', description: 'x', status: 'approved', createdAt: 'x', ...extra,
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [] });
      await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [] });
      for (const [u, role, org] of [[ADMIN, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [EMP2, 'employee', ORG],
        [CAIRO_FIN, 'finance', OTHER_ORG], [CAIRO_ADMIN, 'org_admin', OTHER_ORG]] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true, memberId: `${u.uid}_${org}` });
        await setDoc(doc(f, 'members', `${u.uid}_${org}`), { orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      await setDoc(doc(f, 'users', MULTI_FIN.uid), { orgId: OTHER_ORG, role: 'employee', active: true });
      await setDoc(doc(f, 'members', `${MULTI_FIN.uid}_${ORG}`), { orgId: ORG, userId: MULTI_FIN.uid, userEmail: MULTI_FIN.email, role: 'finance', active: true });
      await setDoc(doc(f, 'users', BOTH_FIN.uid), { orgId: ORG, role: 'finance', active: true });
      await setDoc(doc(f, 'members', `${BOTH_FIN.uid}_${ORG}`), { orgId: ORG, userId: BOTH_FIN.uid, userEmail: BOTH_FIN.email, role: 'finance', active: true });
      await setDoc(doc(f, 'members', `${BOTH_FIN.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: BOTH_FIN.uid, userEmail: BOTH_FIN.email, role: 'finance', active: true });
      await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), account('acc-cash', 1000));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank'), account('acc-bank', 5000, { type: 'bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-insta'), account('acc-insta', 5000, { type: 'instapay', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-o'), account('acc-o', 1000, { orgId: OTHER_ORG }));
      await setDoc(doc(f, 'custodies', 'cus-1'), custody('cus-1'));
      await setDoc(doc(f, 'custodies', 'cus-2'), custody('cus-2', { employeeId: EMP2.uid, employeeName: 'emp2', employeeEmail: EMP2.email, totalAmount: 500, remainingAmount: 500 }));
      await setDoc(doc(f, 'custodies', 'cus-closed'), custody('cus-closed', { remainingAmount: 0, settledAmount: 1000, status: 'settled' }));
      await setDoc(doc(f, 'custodies', 'cus-o'), custody('cus-o', { orgId: OTHER_ORG, employeeId: 'uidOtherEmp', employeeEmail: 'e@other.test', sourceAccountId: 'acc-o' }));
      await setDoc(doc(f, 'custodySettlements', 'stl-old'), settlement('stl-old', 'cus-1', 10));
      await setDoc(doc(f, 'pettyCashCustodies', 'pc-1'), { orgId: ORG, employeeId: EMP.uid, employeeEmail: EMP.email, employeeName: 'emp', totalAmount: 300, remainingAmount: 300, status: 'active' });
      await setDoc(doc(f, 'pettyCashCustodies', 'pc-2'), { orgId: ORG, employeeId: EMP2.uid, employeeEmail: EMP2.email, employeeName: 'emp2', totalAmount: 300, remainingAmount: 300, status: 'active' });
    });
  });

  // ===========================================================================
  // Findings
  // ===========================================================================
  describe('findings', () => {
    it('[CUS-1] one request disbursement line also issues a custody (request id = custody id): cash leaves once, books record it twice', async () => {
      const f = db(FIN);
      // Finance files its own request with a chosen id, approves it (self-approval is known/allowed).
      await assertSucceeds(setDoc(doc(f, 'requests', 'cus-dup'), {
        id: 'cus-dup', orgId: ORG, requestNumber: 'REQ-X', status: 'pending', amount: 100, currency: 'EGP', title: 't', requestType: 'expense',
        requesterId: FIN.uid, requesterName: 'fin', requesterEmail: FIN.email, timeline: [], comments: [], createdAt: 'x',
      }));
      await assertSucceeds(updateDoc(doc(f, 'requests', 'cus-dup'), { status: 'approved', approvedBy: FIN.uid, approvedAt: 'x' }));
      // ONE out-line of 100 (tx-req-cus-dup), typed 'custody' -> request disbursed AND custody issued.
      await assertFails(writeBatch(f)
        .update(doc(f, 'requests', 'cus-dup'), { status: 'disbursed', disbursement: { accountId: 'acc-cash', paymentMethod: 'cash' }, updatedAt: 'x' })
        .set(doc(f, 'accountTransactions', 'tx-req-cus-dup'), line('tx-req-cus-dup', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'cus-dup'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 900, balance: 900, totalOut: 100, updatedAt: 'x', lastLedgerId: 'tx-req-cus-dup' })
        .set(doc(f, 'custodies', 'cus-dup'), { ...custody('cus-dup', { totalAmount: 100, remainingAmount: 100 }), lastLedgerId: 'tx-req-cus-dup' })
        .commit());
    });

    it('[CUS-1] consequence: the phantom custody is then returned into the account -> account back to 1000 although 100 was paid out', async () => {
      const f = db(FIN);
      await seed(f2 => setDoc(doc(f2, 'requests', 'cus-dup'), {
        id: 'cus-dup', orgId: ORG, requestNumber: 'REQ-X', status: 'approved', amount: 100, currency: 'EGP', title: 't', requestType: 'expense',
        requesterId: EMP.uid, requesterName: 'e', requesterEmail: EMP.email, timeline: [], comments: [], createdAt: 'x',
      }));
      const attack = await writeBatch(f)
        .update(doc(f, 'requests', 'cus-dup'), { status: 'disbursed', disbursement: { accountId: 'acc-cash', paymentMethod: 'cash' }, updatedAt: 'x' })
        .set(doc(f, 'accountTransactions', 'tx-req-cus-dup'), line('tx-req-cus-dup', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'cus-dup'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 900, balance: 900, totalOut: 100, updatedAt: 'x', lastLedgerId: 'tx-req-cus-dup' })
        .commit().then(() => true, () => false);
      // second commit, later: the custody is issued against the (old, non-fresh) disbursement line
      const issued = attack && await setDoc(doc(f, 'custodies', 'cus-dup'), { ...custody('cus-dup', { totalAmount: 100, remainingAmount: 100 }), lastLedgerId: 'tx-req-cus-dup' })
        .then(() => true, () => false);
      if (issued) await returnCustodyRemainders(createFirestoreStore(f), actor(FIN, 'finance'), { custodyIds: ['cus-dup'], targetAccountId: 'acc-cash' }, key());
      expect((await read('requests', 'cus-dup'))!.status).toBe(attack ? 'disbursed' : 'approved');
      console.log('[CUS-1 observed]', { attack, issued, request: (await read('requests', 'cus-dup'))!.status, accCash: (await read('paymentAccounts', 'acc-cash'))!.currentBalance, custody: await read('custodies', 'cus-dup') });
      // secure outcome: the custody issue on a stale line of another operation is refused
      expect(issued).toBe(false);
    });

    it('[CUS-2] one income line both receives an income request AND closes a custody as returned (custody cash never comes back)', async () => {
      const f = db(FIN);
      await assertSucceeds(setDoc(doc(f, 'requests', 'cus-1'), {
        id: 'cus-1', orgId: ORG, requestNumber: 'INC-X', status: 'pending', amount: 1000, currency: 'EGP', title: 'customer payment', requestType: 'income',
        requesterId: FIN.uid, requesterName: 'fin', requesterEmail: FIN.email, timeline: [], comments: [], createdAt: 'x',
      }));
      await assertFails(writeBatch(f)
        .update(doc(f, 'requests', 'cus-1'), { status: 'disbursed', disbursement: { accountId: 'acc-cash', paymentMethod: 'cash' }, updatedAt: 'x' })
        .set(doc(f, 'accountTransactions', 'tx-req-cus-1'), line('tx-req-cus-1', 'acc-cash', 'in', 1000, 1000, 2000, 'custody_return', 'cus-1'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 2000, balance: 2000, totalIn: 1000, updatedAt: 'x', lastLedgerId: 'tx-req-cus-1' })
        .update(doc(f, 'custodies', 'cus-1'), { remainingAmount: 0, returnedAmount: 1000, status: 'settled', settledAt: 'x', returnedAt: 'x', returnedToAccountId: 'acc-cash', returnedToAccountName: 'acc-cash', updatedAt: 'x', lastLedgerId: 'tx-req-cus-1' })
        .commit());
    });

    it('[CUS-3] one expense disbursement line also replenishes a custody (same commit)', async () => {
      const f = db(FIN);
      await seed(f2 => setDoc(doc(f2, 'requests', 'cus-2'), {
        id: 'cus-2', orgId: ORG, requestNumber: 'REQ-Y', status: 'approved', amount: 200, currency: 'EGP', title: 't', requestType: 'expense',
        requesterId: EMP.uid, requesterName: 'e', requesterEmail: EMP.email, timeline: [], comments: [], createdAt: 'x',
      }));
      await assertFails(writeBatch(f)
        .update(doc(f, 'requests', 'cus-2'), { status: 'disbursed', disbursement: { accountId: 'acc-cash', paymentMethod: 'cash' }, updatedAt: 'x' })
        .set(doc(f, 'accountTransactions', 'tx-req-cus-2'), line('tx-req-cus-2', 'acc-cash', 'out', 200, 1000, 800, 'custody', 'cus-2'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 800, balance: 800, totalOut: 200, updatedAt: 'x', lastLedgerId: 'tx-req-cus-2' })
        .update(doc(f, 'custodies', 'cus-2'), { totalAmount: 700, remainingAmount: 700, status: 'active', updatedAt: 'x', lastLedgerId: 'tx-req-cus-2' })
        .commit());
    });

    it('[CUS-4] custody issued from an InstaPay channel without moving its parent bank, then returned into the bank (bank +250 minted)', async () => {
      const f = db(FIN);
      const ok = await writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-ip'), line('tx-ip', 'acc-insta', 'out', 250, 5000, 4750, 'custody', 'cus-ip'))
        .update(doc(f, 'paymentAccounts', 'acc-insta'), { currentBalance: 4750, balance: 4750, totalOut: 250, updatedAt: 'x', lastLedgerId: 'tx-ip' })
        .set(doc(f, 'custodies', 'cus-ip'), { ...custody('cus-ip', { totalAmount: 250, remainingAmount: 250, sourceAccountId: 'acc-insta' }), lastLedgerId: 'tx-ip' })
        .commit().then(() => true, () => false);
      if (ok) await returnCustodyRemainders(createFirestoreStore(f), actor(FIN, 'finance'), { custodyIds: ['cus-ip'], targetAccountId: 'acc-bank' }, key());
      // the domain (issueCustody from acc-insta) would have moved acc-bank by -250 too
      console.log('[CUS-4 observed]', { ok, insta: (await read('paymentAccounts', 'acc-insta'))!.currentBalance, bank: (await read('paymentAccounts', 'acc-bank'))!.currentBalance });
      expect(ok).toBe(false);
      expect((await read('paymentAccounts', 'acc-bank'))!.currentBalance).toBe(5000);
    });

    it('[CUS-4] (variants) the mirror must be the bank\'s NEW line of the same direction and amount, in the same commit', async () => {
      const f = db(FIN);
      // a bank line booked earlier under <lid>-parent is not this movement's mirror
      await assertSucceeds(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-z-parent'), line('tx-z-parent', 'acc-bank', 'out', 250, 5000, 4750, 'manual_adjustment', 'acc-bank'))
        .update(doc(f, 'paymentAccounts', 'acc-bank'), { currentBalance: 4750, balance: 4750, totalOut: 250, updatedAt: 'x', lastLedgerId: 'tx-z-parent' }).commit());
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-z'), line('tx-z', 'acc-insta', 'out', 250, 5000, 4750, 'manual_adjustment', 'acc-insta'))
        .update(doc(f, 'paymentAccounts', 'acc-insta'), { currentBalance: 4750, balance: 4750, totalOut: 250, updatedAt: 'x', lastLedgerId: 'tx-z' }).commit());
      // a mirror in the other direction, or of another amount
      const mirror = (id: string, type: 'in' | 'out', amount: number) => writeBatch(f)
        .set(doc(f, 'accountTransactions', id), line(id, 'acc-insta', 'out', 100, 5000, 4900, 'manual_adjustment', 'acc-insta'))
        .update(doc(f, 'paymentAccounts', 'acc-insta'), { currentBalance: 4900, balance: 4900, totalOut: 100, updatedAt: 'x', lastLedgerId: id })
        .set(doc(f, 'accountTransactions', `${id}-parent`), line(`${id}-parent`, 'acc-bank', type, amount, 4750, type === 'in' ? 4750 + amount : 4750 - amount, 'manual_adjustment', 'acc-insta'))
        .update(doc(f, 'paymentAccounts', 'acc-bank'), { currentBalance: type === 'in' ? 4750 + amount : 4750 - amount, balance: type === 'in' ? 4750 + amount : 4750 - amount, ...(type === 'in' ? { totalIn: amount } : { totalOut: 250 + amount }), updatedAt: 'x', lastLedgerId: `${id}-parent` })
        .commit();
      await assertFails(mirror('tx-m1', 'in', 100));
      await assertFails(mirror('tx-m2', 'out', 10));
      await assertSucceeds(mirror('tx-m3', 'out', 100));
      expect((await read('paymentAccounts', 'acc-bank'))!.currentBalance).toBe(4650);
    });

    it('[CUS-5] holder raises the custody remainder with a sub-cent "settlement" (tolerance), repeatable', async () => {
      const e = db(EMP);
      await assertFails(writeBatch(e)
        .set(doc(e, 'custodySettlements', 'stl-t1'), settlement('stl-t1', 'cus-1', 0.000001))
        .update(doc(e, 'custodies', 'cus-1'), { remainingAmount: 1000.005, settledAmount: 0.000001, lastSettlementId: 'stl-t1' })
        .commit());
    });

    it('[CUS-5] consequence: 3 sub-cent "settlements" then finance returns the custody -> the account receives more than the custody ever held', async () => {
      const e = db(EMP);
      let rem = 1000, settled = 0, ok = true;
      for (let i = 1; i <= 3 && ok; i++) {
        const next = Math.round((rem + 0.005) * 1e6) / 1e6;
        ok = await writeBatch(e)
          .set(doc(e, 'custodySettlements', `stl-acc${i}`), settlement(`stl-acc${i}`, 'cus-1', 0.000001))
          .update(doc(e, 'custodies', 'cus-1'), { remainingAmount: next, settledAmount: settled + 0.000001, lastSettlementId: `stl-acc${i}` })
          .commit().then(() => true, () => false);
        if (ok) { rem = next; settled += 0.000001; }
      }
      const r = await returnCustodyRemainders(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), { custodyIds: ['cus-1'], targetAccountId: 'acc-cash' }, key());
      console.log('[CUS-5 observed]', { custodyBeforeReturn: rem, returned: r.value.totalReturned, accCash: (await read('paymentAccounts', 'acc-cash'))!.currentBalance });
      // secure: the custody gave out 1000 (total 1000, nothing settled for real) -> at most 1000 comes back
      expect((await read('paymentAccounts', 'acc-cash'))!.currentBalance).toBeLessThanOrEqual(2000);
    });

    it('[CUS-5] holder files settlements against a fully settled / returned custody (remaining stays 0)', async () => {
      const e = db(EMP);
      await assertFails(writeBatch(e)
        .set(doc(e, 'custodySettlements', 'stl-t2'), settlement('stl-t2', 'cus-closed', 0.005))
        .update(doc(e, 'custodies', 'cus-closed'), { settledAmount: 1000.005, remainingAmount: 0, lastSettlementId: 'stl-t2' })
        .commit());
    });

    it('[CUS-6] finance re-opens a settled custody with a sub-cent line that moves no cash, and writes remainingAmount as a string', async () => {
      const f = db(FIN);
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-tiny'), line('tx-tiny', 'acc-cash', 'out', 0.004, 1000, 1000, 'custody', 'cus-closed'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { updatedAt: 'x', lastLedgerId: 'tx-tiny' })
        .update(doc(f, 'custodies', 'cus-closed'), { totalAmount: 1000.004, remainingAmount: '999999', status: 'active', updatedAt: 'x', lastLedgerId: 'tx-tiny' })
        .commit());
    });

    it('[CUS-6] (variant) the same zero-cash line re-opens a settled custody with a numeric remainder', async () => {
      const f = db(FIN);
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-tiny2'), line('tx-tiny2', 'acc-cash', 'out', 0.004, 1000, 1000, 'custody', 'cus-closed'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { updatedAt: 'x', lastLedgerId: 'tx-tiny2' })
        .update(doc(f, 'custodies', 'cus-closed'), { totalAmount: 1000.004, remainingAmount: 0.004, status: 'active', updatedAt: 'x', lastLedgerId: 'tx-tiny2' })
        .commit());
    });

    it('[CUS-7] a finance of two companies replenishes / returns a custody across companies (domain refuses cross_org)', async () => {
      const f = db(BOTH_FIN);
      // the domain refuses it
      await expect(replenishCustody(createFirestoreStore(f), actor(BOTH_FIN, 'finance'), { custodyId: 'cus-1', amount: 100, sourceAccountId: 'acc-o' }, key()))
        .rejects.toMatchObject({ code: 'cross_org' });
      // the rules do not: OTHER_ORG's account funds ORG's custody
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-x1'), line('tx-x1', 'acc-o', 'out', 100, 1000, 900, 'custody', 'cus-1', BOTH_FIN, { orgId: OTHER_ORG }))
        .update(doc(f, 'paymentAccounts', 'acc-o'), { currentBalance: 900, balance: 900, totalOut: 100, updatedAt: 'x', lastLedgerId: 'tx-x1' })
        .update(doc(f, 'custodies', 'cus-1'), { totalAmount: 1100, remainingAmount: 1100, status: 'active', updatedAt: 'x', lastLedgerId: 'tx-x1' })
        .commit());
    });

    it('[CUS-7] (variant) ORG custody remainder returned into OTHER_ORG account', async () => {
      const f = db(BOTH_FIN);
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-x2'), line('tx-x2', 'acc-o', 'in', 1000, 1000, 2000, 'custody_return', 'cus-1', BOTH_FIN, { orgId: OTHER_ORG }))
        .update(doc(f, 'paymentAccounts', 'acc-o'), { currentBalance: 2000, balance: 2000, totalIn: 1000, updatedAt: 'x', lastLedgerId: 'tx-x2' })
        .update(doc(f, 'custodies', 'cus-1'), { remainingAmount: 0, returnedAmount: 1000, status: 'settled', returnedToAccountId: 'acc-o', returnedToAccountName: 'acc-o', updatedAt: 'x', lastLedgerId: 'tx-x2' })
        .commit());
    });

    it('[CUS-8, known, accepted] custodyNumber is not bound to the custodies-<year> counter by the rules (numbering only: the money of the issue is bound)', async () => {
      const f = db(FIN);
      // the domain always takes the number from the counter in the same transaction (issueCustody);
      // a raw write may repeat a number. Accepted: binding it would not stop two custodies of one
      // commit sharing a number, and the counter is a cost-only sequence (spec §4.11).
      await assertSucceeds(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-num'), line('tx-num', 'acc-cash', 'out', 50, 1000, 950, 'custody', 'cus-num'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 950, balance: 950, totalOut: 50, updatedAt: 'x', lastLedgerId: 'tx-num' })
        .set(doc(f, 'custodies', 'cus-num'), { ...custody('cus-num', { totalAmount: 50, remainingAmount: 50, custodyNumber: 'CUS-cus-1' }), lastLedgerId: 'tx-num' })
        .commit());
      expect((await read('paymentAccounts', 'acc-cash'))!.currentBalance).toBe(950);
    });
  });

  // ===========================================================================
  // Coverage: legitimate operations keep working
  // ===========================================================================
  describe('legitimate custody operations', () => {
    it('finance issues (cash and InstaPay), replenishes, the holder settles, org admin settles, finance returns', async () => {
      const fin = createFirestoreStore(db(FIN));
      const c = await issueCustody(fin, actor(FIN, 'finance'), { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount: 300, sourceAccountId: 'acc-cash' }, key());
      expect(c.changed).toBe(true);
      const ci = await issueCustody(fin, actor(FIN, 'finance'), { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount: 100, sourceAccountId: 'acc-insta' }, key());
      expect((await read('paymentAccounts', 'acc-bank'))!.currentBalance).toBe(4900);
      await replenishCustody(fin, actor(FIN, 'finance'), { custodyId: c.value.id, amount: 50.5, sourceAccountId: 'acc-insta' }, key());
      await settleCustodyItem(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), { custodyId: c.value.id, amount: 20.25, description: 'x' }, key());
      await settleCustodyItem(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), { custodyId: c.value.id, amount: 30, description: 'x' }, key());
      await settleCustodyItem(createFirestoreStore(db(MULTI_FIN)), actor(MULTI_FIN, 'finance'), { custodyId: ci.value.id, amount: 100, description: 'x' }, key());
      expect(await read('custodies', ci.value.id)).toMatchObject({ remainingAmount: 0, status: 'settled' });
      const r = await returnCustodyRemainders(fin, actor(FIN, 'finance'), { custodyIds: [c.value.id, ci.value.id], targetAccountId: 'acc-cash' }, key());
      expect(r.value.totalReturned).toBe(300.25);
      expect((await read('paymentAccounts', 'acc-cash'))!.currentBalance).toBe(1000 - 300 + 300.25);
    });

    it('holder settles by uid with an unverified token, after renaming themselves, and by verified email on an email-issued custody', async () => {
      await settleCustodyItem(createFirestoreStore(db(EMP, false)), actor(EMP, 'employee'), { custodyId: 'cus-1', amount: 5, description: 'x' }, key());
      await syncOwnMembership(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), `${EMP.uid}_${ORG}`, { userName: 'renamed' });
      await settleCustodyItem(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), { custodyId: 'cus-1', amount: 5, description: 'x' }, key());
      await seed(async f => {
        await setDoc(doc(f, 'custodies', 'cus-mail'), custody('cus-mail', { employeeId: 'pending-nh', employeeEmail: NEWHIRE.email }));
        await setDoc(doc(f, 'members', `pending-nh`), { orgId: ORG, userId: 'pending-nh', userEmail: NEWHIRE.email, role: 'employee', active: true });
        await setDoc(doc(f, 'users', NEWHIRE.uid), { orgId: ORG, role: 'employee', active: true, memberId: 'pending-nh' });
      });
      await settleCustodyItem(createFirestoreStore(db(NEWHIRE)), actor(NEWHIRE, 'employee'), { custodyId: 'cus-mail', amount: 7, description: 'x' }, key());
      expect((await read('custodies', 'cus-mail'))!.remainingAmount).toBe(993);
      expect((await read('custodies', 'cus-1'))!.remainingAmount).toBe(990);
    });
  });

  // ===========================================================================
  // Coverage: attacks that are refused
  // ===========================================================================
  describe('custody attacks refused', () => {
    const settleBatch = (f: Firestore, cid: string, sid: string, amount: number, custPatch: Record<string, unknown>, stl: Record<string, unknown> = {}) =>
      writeBatch(f)
        .set(doc(f, 'custodySettlements', sid), settlement(sid, cid, amount, stl))
        .update(doc(f, 'custodies', cid), { settledAmount: amount, updatedAt: 'x', lastSettlementId: sid, ...custPatch })
        .commit();

    it('holder: zero / inflate without a settlement, or with a mismatched / reused / foreign one', async () => {
      const e = db(EMP);
      await assertFails(updateDoc(doc(e, 'custodies', 'cus-1'), { remainingAmount: 0, settledAmount: 1000, status: 'settled' }));
      await assertFails(updateDoc(doc(e, 'custodies', 'cus-1'), { remainingAmount: 5000 }));
      await assertFails(updateDoc(doc(e, 'custodies', 'cus-1'), { totalAmount: 5000, remainingAmount: 5000, status: 'active', lastLedgerId: 'tx-none' }));
      // lastSettlementId to a settlement that does not exist after the commit
      await assertFails(updateDoc(doc(e, 'custodies', 'cus-1'), { remainingAmount: 0, settledAmount: 1000, status: 'settled', lastSettlementId: 'stl-ghost' }));
      // re-using an existing settlement id
      await assertFails(updateDoc(doc(e, 'custodies', 'cus-1'), { remainingAmount: 990, settledAmount: 10, lastSettlementId: 'stl-old' }));
      // settlement amount smaller than the debit
      await assertFails(settleBatch(e, 'cus-1', 'stl-a', 1, { remainingAmount: 0, settledAmount: 1000, status: 'settled' }));
      // settlement bound to another custody / another company / another holder
      await assertFails(writeBatch(e)
        .set(doc(e, 'custodySettlements', 'stl-b'), settlement('stl-b', 'cus-2', 100))
        .update(doc(e, 'custodies', 'cus-1'), { remainingAmount: 900, settledAmount: 100, lastSettlementId: 'stl-b' }).commit());
      await assertFails(settleBatch(e, 'cus-1', 'stl-c', 100, { remainingAmount: 900 }, { orgId: OTHER_ORG }));
      await assertFails(settleBatch(e, 'cus-1', 'stl-d', 100, { remainingAmount: 900 }, { employeeId: EMP2.uid }));
      // one settlement for two custodies / two settlements for one debit
      await assertFails(writeBatch(e)
        .set(doc(e, 'custodySettlements', 'stl-e'), settlement('stl-e', 'cus-1', 100))
        .set(doc(e, 'custodySettlements', 'stl-f'), settlement('stl-f', 'cus-1', 100))
        .update(doc(e, 'custodies', 'cus-1'), { remainingAmount: 800, settledAmount: 200, lastSettlementId: 'stl-e' }).commit());
      // status game while settling: close a custody that still has money
      await assertFails(settleBatch(e, 'cus-1', 'stl-g', 100, { remainingAmount: 900, status: 'settled' }));
      // remaining below zero
      await assertFails(settleBatch(e, 'cus-1', 'stl-h', 1100, { remainingAmount: -100, status: 'settled' }));
      // change the holder / return fields while settling
      await assertFails(settleBatch(e, 'cus-1', 'stl-i', 100, { remainingAmount: 900, employeeId: EMP2.uid }));
      await assertFails(settleBatch(e, 'cus-1', 'stl-j', 100, { remainingAmount: 900, employeeEmail: EMP2.email }));
      await assertFails(settleBatch(e, 'cus-1', 'stl-k', 100, { remainingAmount: 900, employeeName: 'emp2' }));
      await assertFails(settleBatch(e, 'cus-1', 'stl-l', 100, { remainingAmount: 900, returnedAmount: 1 }));
      // the proper invoice passes (control)
      await assertSucceeds(settleBatch(e, 'cus-1', 'stl-ok', 100, { remainingAmount: 900 }));
    });

    it('phantom settlement on a victim custody while debiting own custody, or a settlement alone', async () => {
      const e = db(EMP);
      await assertFails(setDoc(doc(e, 'custodySettlements', 'stl-p'), settlement('stl-p', 'cus-1', 10)));
      await assertFails(writeBatch(e)
        .set(doc(e, 'custodySettlements', 'stl-v'), settlement('stl-v', 'cus-2', 10, { employeeId: EMP2.uid }))
        .update(doc(e, 'custodies', 'cus-1'), { remainingAmount: 990, settledAmount: 10, lastSettlementId: 'stl-v' }).commit());
      await assertFails(updateDoc(doc(e, 'custodySettlements', 'stl-old'), { amount: 1 }));
      await assertFails(deleteDoc(doc(e, 'custodySettlements', 'stl-old')));
      await assertFails(deleteDoc(doc(e, 'custodies', 'cus-1')));
    });

    it('another employee, a suspended holder, a removed holder, an unverified email holder, other-company staff cannot settle', async () => {
      await assertFails(settleBatch(db(EMP2), 'cus-1', 'stl-x1', 100, { remainingAmount: 900 }));
      await assertFails(settleBatch(db(CAIRO_FIN), 'cus-1', 'stl-x2', 100, { remainingAmount: 900 }));
      await assertFails(settleBatch(db(CAIRO_ADMIN), 'cus-1', 'stl-x3', 100, { remainingAmount: 900 }));
      // unverified email: custody issued by email only
      await seed(async f => {
        await setDoc(doc(f, 'custodies', 'cus-mail'), custody('cus-mail', { employeeId: 'pending-nh', employeeEmail: NEWHIRE.email }));
        await setDoc(doc(f, 'members', 'pending-nh'), { orgId: ORG, userId: 'pending-nh', userEmail: NEWHIRE.email, role: 'employee', active: true });
        await setDoc(doc(f, 'users', NEWHIRE.uid), { orgId: ORG, role: 'employee', active: true, memberId: 'pending-nh' });
      });
      await assertFails(settleBatch(db(NEWHIRE, false), 'cus-mail', 'stl-x4', 100, { remainingAmount: 900 }, { employeeId: 'pending-nh' }));
      await assertFails(getDoc(doc(db(NEWHIRE, false), 'custodies', 'cus-mail')));
      // suspended (profile + membership synced by updateMemberRecord)
      await seed(async f => {
        await updateDoc(doc(f, 'users', EMP.uid), { active: false });
        await updateDoc(doc(f, 'members', `${EMP.uid}_${ORG}`), { active: false });
      });
      await assertFails(settleBatch(db(EMP), 'cus-1', 'stl-x5', 100, { remainingAmount: 900 }));
      // removed (removeMember: member deleted, profile detached)
      await seed(async f => {
        await deleteDoc(doc(f, 'members', `${EMP.uid}_${ORG}`));
        await updateDoc(doc(f, 'users', EMP.uid), { orgId: '', role: 'employee', memberId: null, active: true });
      });
      await assertFails(settleBatch(db(EMP), 'cus-1', 'stl-x6', 100, { remainingAmount: 900 }));
      // the removed holder cannot re-attach to the org through the profile
      await assertFails(updateDoc(doc(db(EMP), 'users', EMP.uid), { orgId: ORG, role: 'employee' }));
    });

    it('the holder (or anyone but finance) cannot issue, replenish, return; other-company finance cannot touch ORG custodies', async () => {
      for (const u of [EMP, EMP2, CAIRO_FIN, CAIRO_ADMIN]) {
        const f = db(u);
        await assertFails(writeBatch(f)
          .set(doc(f, 'accountTransactions', `tx-r-${u.uid}`), line(`tx-r-${u.uid}`, 'acc-cash', 'out', 100, 1000, 900, 'custody', 'cus-1', u))
          .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 900, balance: 900, totalOut: 100, updatedAt: 'x', lastLedgerId: `tx-r-${u.uid}` })
          .update(doc(f, 'custodies', 'cus-1'), { totalAmount: 1100, remainingAmount: 1100, status: 'active', updatedAt: 'x', lastLedgerId: `tx-r-${u.uid}` }).commit());
        await assertFails(writeBatch(f)
          .set(doc(f, 'accountTransactions', `tx-i-${u.uid}`), line(`tx-i-${u.uid}`, 'acc-cash', 'out', 100, 1000, 900, 'custody', `cus-n-${u.uid}`, u))
          .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 900, balance: 900, totalOut: 100, updatedAt: 'x', lastLedgerId: `tx-i-${u.uid}` })
          .set(doc(f, 'custodies', `cus-n-${u.uid}`), { ...custody(`cus-n-${u.uid}`, { totalAmount: 100, remainingAmount: 100 }), lastLedgerId: `tx-i-${u.uid}` }).commit());
        await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { remainingAmount: 0, returnedAmount: 1000, status: 'settled', returnedToAccountId: 'acc-cash', lastLedgerId: 'tx-req-x' }));
      }
      // OTHER_ORG finance: an OTHER_ORG custody bound to an ORG line, and an ORG custody from its own account
      const c = db(CAIRO_FIN);
      await assertFails(writeBatch(c)
        .set(doc(c, 'accountTransactions', 'tx-co'), line('tx-co', 'acc-o', 'out', 100, 1000, 900, 'custody', 'cus-co', CAIRO_FIN, { orgId: OTHER_ORG }))
        .update(doc(c, 'paymentAccounts', 'acc-o'), { currentBalance: 900, balance: 900, totalOut: 100, updatedAt: 'x', lastLedgerId: 'tx-co' })
        .set(doc(c, 'custodies', 'cus-co'), { ...custody('cus-co', { totalAmount: 100, remainingAmount: 100, sourceAccountId: 'acc-o' }), lastLedgerId: 'tx-co' }).commit());
    });

    it('finance: issue / replenish / return bound to a wrong, foreign, reused or missing line', async () => {
      const f = db(FIN);
      // issue: no line, a line of another custody, a line on another account than sourceAccountId, an in-line, bad shape
      await assertFails(setDoc(doc(f, 'custodies', 'cus-n1'), { ...custody('cus-n1'), lastLedgerId: 'tx-ghost' }));
      const issue = (cid: string, l: Record<string, unknown>, c: Record<string, unknown>) => writeBatch(f)
        .set(doc(f, 'accountTransactions', l.id as string), l)
        .update(doc(f, 'paymentAccounts', l.accountId as string), { currentBalance: l.balanceAfter, balance: l.balanceAfter, ...(l.type === 'in' ? { totalIn: l.amount } : { totalOut: l.amount }), updatedAt: 'x', lastLedgerId: l.id })
        .set(doc(f, 'custodies', cid), { ...custody(cid, { totalAmount: 100, remainingAmount: 100 }), lastLedgerId: l.id, ...c }).commit();
      await assertFails(issue('cus-n2', line('tx-n2', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'cus-1'), {}));
      await assertFails(issue('cus-n3', line('tx-n3', 'acc-bank', 'out', 100, 5000, 4900, 'custody', 'cus-n3'), {}));
      await assertFails(issue('cus-n4', line('tx-n4', 'acc-cash', 'in', 100, 1000, 1100, 'custody', 'cus-n4'), {}));
      await assertFails(issue('cus-n5', line('tx-n5', 'acc-cash', 'out', 10, 1000, 990, 'custody', 'cus-n5'), {}));
      await assertFails(issue('cus-n6', line('tx-n6', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'cus-n6'), { remainingAmount: 500 }));
      await assertFails(issue('cus-n7', line('tx-n7', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'cus-n7'), { status: 'settled' }));
      await assertFails(issue('cus-n8', line('tx-n8', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'cus-n8'), { lastSettlementId: 'stl-old' }));
      await assertFails(issue('cus-n9', line('tx-n9', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'cus-n9'), { settledAmount: 50, remainingAmount: 50 }));
      await assertFails(issue('cus-n10', line('tx-n10', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'cus-n10'), { orgId: OTHER_ORG }));
      // replenish: an existing line (reuse), a line of another custody, an in-line, wrong amount, a custody_return line, no line at all
      await adjustLine(f, 'tx-old', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'cus-1');
      await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { totalAmount: 1100, remainingAmount: 1100, status: 'active', lastLedgerId: 'tx-old' }));
      const repl = (l: Record<string, unknown>, c: Record<string, unknown> = {}) => writeBatch(f)
        .set(doc(f, 'accountTransactions', l.id as string), l)
        .update(doc(f, 'paymentAccounts', l.accountId as string), { currentBalance: l.balanceAfter, balance: l.balanceAfter, ...(l.type === 'in' ? { totalIn: (l.amount as number) } : { totalOut: 100 + (l.amount as number) }), updatedAt: 'x', lastLedgerId: l.id })
        .update(doc(f, 'custodies', 'cus-1'), { totalAmount: 1100, remainingAmount: 1100, status: 'active', updatedAt: 'x', lastLedgerId: l.id, ...c }).commit();
      await assertFails(repl(line('tx-p1', 'acc-cash', 'out', 100, 900, 800, 'custody', 'cus-2')));
      await assertFails(repl(line('tx-p2', 'acc-cash', 'in', 100, 900, 1000, 'custody', 'cus-1')));
      await assertFails(repl(line('tx-p3', 'acc-cash', 'out', 10, 900, 890, 'custody', 'cus-1')));
      await assertFails(repl(line('tx-p4', 'acc-cash', 'out', 100, 900, 800, 'custody_return', 'cus-1')));
      await assertFails(repl(line('tx-p5', 'acc-cash', 'out', 100, 900, 800, 'custody', 'cus-1'), { remainingAmount: 5000 }));
      await assertFails(repl(line('tx-p6', 'acc-cash', 'out', 100, 900, 800, 'custody', 'cus-1'), { employeeId: EMP2.uid }));
      await assertFails(repl(line('tx-p7', 'acc-cash', 'out', 100, 900, 800, 'custody', 'cus-1'), { sourceAccountId: 'acc-bank' }));
      // return: into another account than returnedToAccountId, a reused line, partial, out-line, the wrong amount
      const ret = (l: Record<string, unknown>, c: Record<string, unknown> = {}) => writeBatch(f)
        .set(doc(f, 'accountTransactions', l.id as string), l)
        .update(doc(f, 'paymentAccounts', l.accountId as string), { currentBalance: l.balanceAfter, balance: l.balanceAfter, ...(l.type === 'in' ? { totalIn: (l.amount as number) } : { totalOut: 100 + (l.amount as number) }), updatedAt: 'x', lastLedgerId: l.id })
        .update(doc(f, 'custodies', 'cus-1'), { remainingAmount: 0, returnedAmount: 1000, status: 'settled', returnedToAccountId: 'acc-cash', updatedAt: 'x', lastLedgerId: l.id, ...c }).commit();
      await assertFails(ret(line('tx-q1', 'acc-bank', 'in', 1000, 5000, 6000, 'custody_return', 'cus-1')));
      await assertFails(ret(line('tx-q2', 'acc-cash', 'in', 1000, 900, 1900, 'custody_return', 'cus-1'), { remainingAmount: 500, returnedAmount: 500 }));
      await assertFails(ret(line('tx-q3', 'acc-cash', 'in', 500, 900, 1400, 'custody_return', 'cus-1'), { returnedAmount: 500 }));
      await assertFails(ret(line('tx-q4', 'acc-cash', 'in', 1000, 900, 1900, 'custody', 'cus-1')));
      await assertFails(ret(line('tx-q5', 'acc-cash', 'in', 1000, 900, 1900, 'custody_return', 'cus-2')));
      await assertFails(ret(line('tx-q6', 'acc-cash', 'in', 1000, 900, 1900, 'custody_return', 'cus-1'), { status: 'returned' }));
      await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { remainingAmount: 0, returnedAmount: 1000, status: 'settled', returnedToAccountId: 'acc-cash', lastLedgerId: 'tx-old' }));
      // a returned custody returned twice (nothing remaining)
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-q7'), line('tx-q7', 'acc-cash', 'in', 1000, 900, 1900, 'custody_return', 'cus-closed'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 1900, balance: 1900, totalIn: 1000, updatedAt: 'x', lastLedgerId: 'tx-q7' })
        .update(doc(f, 'custodies', 'cus-closed'), { remainingAmount: 0, returnedAmount: 1000, status: 'settled', returnedToAccountId: 'acc-cash', updatedAt: 'x', lastLedgerId: 'tx-q7' }).commit());
      // status games without money: settled -> active, active -> returned / settled
      await assertFails(updateDoc(doc(f, 'custodies', 'cus-closed'), { status: 'active' }));
      await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { status: 'returned' }));
      await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { status: 'settled' }));
      await assertFails(updateDoc(doc(f, 'custodies', 'cus-1'), { notes: 'x' }));
    });

    it('control: the raw issue / replenish / return shapes used above pass when they are correct', async () => {
      const f = db(FIN);
      await assertSucceeds(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-c1'), line('tx-c1', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'cus-ok'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 900, balance: 900, totalOut: 100, updatedAt: 'x', lastLedgerId: 'tx-c1' })
        .set(doc(f, 'custodies', 'cus-ok'), { ...custody('cus-ok', { totalAmount: 100, remainingAmount: 100 }), lastLedgerId: 'tx-c1' }).commit());
      await assertSucceeds(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-c2'), line('tx-c2', 'acc-cash', 'out', 100, 900, 800, 'custody', 'cus-1'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 800, balance: 800, totalOut: 200, updatedAt: 'x', lastLedgerId: 'tx-c2' })
        .update(doc(f, 'custodies', 'cus-1'), { totalAmount: 1100, remainingAmount: 1100, status: 'active', updatedAt: 'x', lastLedgerId: 'tx-c2' }).commit());
      await assertSucceeds(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-c3'), line('tx-c3', 'acc-cash', 'in', 1100, 800, 1900, 'custody_return', 'cus-1'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 1900, balance: 1900, totalIn: 1100, updatedAt: 'x', lastLedgerId: 'tx-c3' })
        .update(doc(f, 'custodies', 'cus-1'), { remainingAmount: 0, returnedAmount: 1100, status: 'settled', returnedToAccountId: 'acc-cash', updatedAt: 'x', lastLedgerId: 'tx-c3' }).commit());
    });

    // a fresh custody 'out' line that really moves acc-cash (finance adjustment style), committed alone
    async function adjustLine(f: Firestore, id: string, accountId: string, type: 'in' | 'out', amount: number, before: number, after: number, refType: string, refId: string) {
      await assertSucceeds(writeBatch(f)
        .set(doc(f, 'accountTransactions', id), line(id, accountId, type, amount, before, after, refType, refId))
        .update(doc(f, 'paymentAccounts', accountId), { currentBalance: after, balance: after, ...(type === 'in' ? { totalIn: amount } : { totalOut: amount }), updatedAt: 'x', lastLedgerId: id })
        .commit());
    }
  });

  // ===========================================================================
  // Coverage: reads / list queries / petty cash
  // ===========================================================================
  describe('custody reads and petty cash', () => {
    it('another holder\'s custodies / settlements are not readable via get or list queries', async () => {
      await seed(f => setDoc(doc(f, 'custodySettlements', 'stl-2'), settlement('stl-2', 'cus-2', 10, { employeeId: EMP2.uid, employeeEmail: EMP2.email })));
      const e = db(EMP);
      await assertFails(getDoc(doc(e, 'custodies', 'cus-2')));
      await assertFails(getDoc(doc(e, 'custodySettlements', 'stl-2')));
      await assertFails(getDocs(query(collection(e, 'custodies'), where('employeeId', '==', EMP2.uid))));
      await assertFails(getDocs(query(collection(e, 'custodies'), where('employeeEmail', '==', EMP2.email))));
      await assertFails(getDocs(query(collection(e, 'custodySettlements'), where('employeeId', '==', EMP2.uid))));
      await assertFails(getDocs(query(collection(e, 'custodySettlements'), where('custodyId', '==', 'cus-2'))));
      await assertFails(getDocs(query(collection(e, 'custodies'), where('orgId', '==', ORG))));
      await assertFails(getDocs(query(collection(e, 'custodySettlements'), where('orgId', '==', ORG))));
      await assertFails(getDocs(collection(e, 'custodies')));
      // the own-documents query passes
      const mine = await assertSucceeds(getDocs(query(collection(e, 'custodies'), or(where('employeeId', '==', EMP.uid), where('employeeEmail', '==', EMP.email)))));
      expect(mine.docs.map(d => d.id).sort()).toEqual(['cus-1', 'cus-closed']);
      // unverified token: email query refused
      await assertFails(getDocs(query(collection(db(EMP2, false), 'custodies'), where('employeeEmail', '==', EMP2.email))));
      // other company's finance / admin
      await assertFails(getDocs(query(collection(db(CAIRO_FIN), 'custodies'), where('orgId', '==', ORG))));
      await assertFails(getDocs(query(collection(db(CAIRO_ADMIN), 'custodySettlements'), where('orgId', '==', ORG))));
      await assertFails(getDoc(doc(db(CAIRO_FIN), 'custodies', 'cus-1')));
      await assertSucceeds(getDocs(query(collection(db(FIN), 'custodies'), where('orgId', '==', ORG))));
      await assertSucceeds(getDocs(query(collection(db(MULTI_FIN), 'custodySettlements'), where('orgId', '==', ORG))));
      // missing ids are readable (idempotency probes) and reveal nothing
      await assertSucceeds(getDoc(doc(e, 'custodies', 'cus-does-not-exist')));
    });

    it('pettyCashCustodies is read-only for everyone but the owner; reads limited to the holder / staff', async () => {
      for (const u of [EMP, FIN, ADMIN]) {
        const f = db(u);
        await assertFails(updateDoc(doc(f, 'pettyCashCustodies', 'pc-1'), { remainingAmount: 0 }));
        await assertFails(setDoc(doc(f, 'pettyCashCustodies', `pc-new-${u.uid}`), { orgId: ORG, employeeId: u.uid, totalAmount: 1, remainingAmount: 1 }));
        await assertFails(deleteDoc(doc(f, 'pettyCashCustodies', 'pc-1')));
      }
      await assertSucceeds(getDoc(doc(db(EMP), 'pettyCashCustodies', 'pc-1')));
      await assertFails(getDoc(doc(db(EMP), 'pettyCashCustodies', 'pc-2')));
      await assertFails(getDocs(query(collection(db(EMP), 'pettyCashCustodies'), where('orgId', '==', ORG))));
      await assertFails(getDocs(query(collection(db(EMP), 'pettyCashCustodies'), where('employeeId', '==', EMP2.uid))));
      await assertSucceeds(getDocs(query(collection(db(EMP), 'pettyCashCustodies'), where('employeeId', '==', EMP.uid))));
      await assertFails(getDocs(query(collection(db(CAIRO_FIN), 'pettyCashCustodies'), where('orgId', '==', ORG))));
      await assertSucceeds(getDocs(query(collection(db(FIN), 'pettyCashCustodies'), where('orgId', '==', ORG))));
      await assertSucceeds(updateDoc(doc(db(OWNER), 'pettyCashCustodies', 'pc-1'), { note: 'owner' }));
    });
  });
});

describe('tenancy, identity, keys, outbox, audit', () => {
  const NEWHIRE_EMAIL = NEWHIRE.email;
  const NEWHIRE_MEMBER = `pending-bmV3aGlyZQ_${ORG}`;

  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [ADMIN.email], createdAt: '2026-01-01' });
      await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [CAIRO_ADMIN.email], createdAt: '2026-01-01' });
      for (const [u, role, org] of [[ADMIN, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [DE, 'data_entry', ORG],
        [CAIRO_FIN, 'finance', OTHER_ORG], [CAIRO_ADMIN, 'org_admin', OTHER_ORG]] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true, email: u.email });
        await setDoc(doc(f, 'members', `${u.uid}_${org}`), { orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      for (const [u, role] of [[MULTI_FIN, 'finance'], [MULTI_ADMIN, 'org_admin']] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: OTHER_ORG, role: 'employee', active: true, email: u.email });
        await setDoc(doc(f, 'members', `${u.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: u.uid, userEmail: u.email, role: 'employee', active: true, userName: u.email });
        await setDoc(doc(f, 'members', `${u.uid}_${ORG}`), { orgId: ORG, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      // suspended finance: membership and profile both inactive (updateMemberRecord syncs both)
      await setDoc(doc(f, 'users', SUSP_FIN.uid), { orgId: ORG, role: 'finance', active: false, email: SUSP_FIN.email, memberId: `${SUSP_FIN.uid}_${ORG}` });
      await setDoc(doc(f, 'members', `${SUSP_FIN.uid}_${ORG}`), { orgId: ORG, userId: SUSP_FIN.uid, userEmail: SUSP_FIN.email, role: 'finance', active: false, userName: 'susp' });
      // invited by email, never signed in
      await setDoc(doc(f, 'members', NEWHIRE_MEMBER), { orgId: ORG, userId: 'pending-bmV3aGlyZQ', userEmail: NEWHIRE_EMAIL, role: 'org_admin', active: true, userName: 'New Hire', phone: '0100000000' });

      // ORG financial / directory documents
      await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), account('acc-cash', 1000, { accountIdentifier: 'EG001' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank'), account('acc-bank', 5000, { type: 'bank', accountIdentifier: 'EG777' }));
      await setDoc(doc(f, 'accountTransactions', 'tx-1'), { id: 'tx-1', orgId: ORG, accountId: 'acc-cash', type: 'in', amount: 1, actorId: FIN.uid });
      await setDoc(doc(f, 'requests', 'r1'), approvedRequest('r1', 300));
      await setDoc(doc(f, 'custodies', 'cus-1'), { id: 'cus-1', orgId: ORG, employeeId: EMP.uid, employeeEmail: EMP.email, totalAmount: 1000, remainingAmount: 1000, settledAmount: 0, status: 'active', currency: 'EGP', sourceAccountId: 'acc-cash' });
      await setDoc(doc(f, 'custodySettlements', 'stl-1'), { orgId: ORG, custodyId: 'cus-1', employeeId: EMP.uid, employeeEmail: EMP.email, amount: 1 });
      await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0 });
      await setDoc(doc(f, 'providers', 'prov-1'), { orgId: ORG, name: 'Vodafone', totalPaid: 0, active: true });
      await setDoc(doc(f, 'departments', 'dept-1'), { orgId: ORG, name: 'IT' });
      await setDoc(doc(f, 'visaRequests', 'v1'), { orgId: ORG, requesterId: EMP.uid, status: 'pending', paidAmount: 0 });
      await setDoc(doc(f, 'auditLogs', 'audit-1'), { orgId: ORG, actorId: ADMIN.uid, actionType: 'create' });
      await setDoc(doc(f, 'outbox', 'ob-1'), { orgId: ORG, createdBy: FIN.uid, status: 'pending', attempts: 0, maxAttempts: 6, recipients: [EMP.email] });
      await setDoc(doc(f, 'attachments', 'att-1'), { id: 'att-1', orgId: ORG, name: 'a.pdf', mimeType: 'application/pdf', size: 1, chunkCount: 1, createdBy: EMP.uid, createdAt: 'x', complete: true });
      // keys (as the domain writes them: value = normalizeKeyValue)
      await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'EG001')), { scope: 'account_identifier', orgId: ORG, value: 'eg001', entityCollection: 'paymentAccounts', entityId: 'acc-cash' });
      await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Vodafone')), { scope: 'provider_name', orgId: ORG, value: 'vodafone', entityCollection: 'providers', entityId: 'prov-1' });
      await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('service_code', ORG, 'CLD')), { scope: 'service_code', orgId: ORG, value: 'cld', entityCollection: 'services', entityId: 'srv-1' });
      await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('department_name', ORG, 'IT')), { scope: 'department_name', orgId: ORG, value: 'it', entityCollection: 'departments', entityId: 'dept-1' });
      await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('member_email', ORG, EMP.email)), { scope: 'member_email', orgId: ORG, value: 'emp@acmetest', entityCollection: 'members', entityId: `${EMP.uid}_${ORG}` });
      // OTHER_ORG
      await setDoc(doc(f, 'paymentAccounts', 'acc-oth'), account('acc-oth', 700, { orgId: OTHER_ORG, accountIdentifier: 'EG001' }));
      await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('account_identifier', OTHER_ORG, 'EG001')), { scope: 'account_identifier', orgId: OTHER_ORG, value: 'eg001', entityCollection: 'paymentAccounts', entityId: 'acc-oth' });
      await setDoc(doc(f, 'providers', 'prov-oth'), { orgId: OTHER_ORG, name: 'Orange', totalPaid: 0, active: true });
      await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('provider_name', OTHER_ORG, 'Orange')), { scope: 'provider_name', orgId: OTHER_ORG, value: 'orange', entityCollection: 'providers', entityId: 'prov-oth' });
    });
  });

  // ===========================================================================
  // organizations
  // ===========================================================================
  describe('organizations: identity, currency, archive state', () => {
    it('org admin cannot change currency / code / id / archived / status / archivedAt / createdAt / operationKey of its own org', async () => {
      const f = db(ADMIN);
      for (const patch of [{ currency: 'USD' }, { code: 'EVIL' }, { id: 'org-evil' }, { archived: true }, { status: 'archived' },
        { archivedAt: 'x' }, { createdAt: 'x' }, { operationKey: 'x' }, { name: 'ok', currency: 'USD' }, { notificationRecipients: [], archived: false }]) {
        await assertFails(updateDoc(doc(f, 'organizations', ORG), patch));
      }
      // un-archive an archived org
      await seed(f2 => updateDoc(doc(f2, 'organizations', ORG), { archived: true, status: 'archived' }));
      await assertFails(updateDoc(doc(f, 'organizations', ORG), { archived: false, status: 'active' }));
      // removing a field is also a change
      await assertFails(setDoc(doc(f, 'organizations', ORG), { name: 'Acme', notificationRecipients: [] }));
    });

    it('org admin may edit the descriptive fields of its own org only; finance / employee / data entry / suspended / other org admins may not', async () => {
      await assertSucceeds(updateDoc(doc(db(ADMIN), 'organizations', ORG), { name: 'Acme 2', budget: 5, description: 'd', logo: 'l', updatedAt: 'x' }));
      await assertFails(updateDoc(doc(db(ADMIN), 'organizations', OTHER_ORG), { name: 'pwned' }));
      await assertFails(updateDoc(doc(db(CAIRO_ADMIN), 'organizations', ORG), { name: 'pwned' }));
      for (const u of [FIN, EMP, DE, SUSP_FIN, MULTI_FIN, STRANGER]) {
        await assertFails(updateDoc(doc(db(u), 'organizations', ORG), { name: 'pwned' }));
      }
      await assertFails(setDoc(doc(db(ADMIN), 'organizations', 'org-new'), { id: 'org-new', name: 'n', code: 'N', currency: 'EGP' }));
      await assertFails(deleteDoc(doc(db(ADMIN), 'organizations', ORG)));
    });

    it('multi-company org admin (member doc only) edits its second company and nothing in its profile company', async () => {
      await assertSucceeds(updateDoc(doc(db(MULTI_ADMIN), 'organizations', ORG), { name: 'Acme via member' }));
      await assertFails(updateDoc(doc(db(MULTI_ADMIN), 'organizations', OTHER_ORG), { name: 'x' }));
      // suspending the membership revokes it
      await seed(f => updateDoc(doc(f, 'members', `${MULTI_ADMIN.uid}_${ORG}`), { active: false }));
      await assertFails(updateDoc(doc(db(MULTI_ADMIN), 'organizations', ORG), { name: 'x' }));
    });

    it('[T1, known, accepted] archiving is a domain-level guard (assertOrgWritable), not an access-control state: members keep their roles', async () => {
      await seed(f => updateDoc(doc(f, 'organizations', ORG), { archived: true, status: 'archived', archivedAt: '2026-09-01' }));
      // the app refuses new records in an archived company ...
      await expect(createExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), { orgId: ORG, title: 't', amount: 1, currency: 'EGP', attachments: [] } as any, key(), notify))
        .rejects.toMatchObject({ code: 'archived_org' });
      // ... the rules do not: a member keeps what its role allows (the owner suspends members to cut access)
      await assertSucceeds(setDoc(doc(db(EMP), 'requests', 'rq-arch'), {
        id: 'rq-arch', orgId: ORG, status: 'pending', requesterId: EMP.uid, requesterEmail: EMP.email, amount: 1, currency: 'EGP', title: 't', timeline: [], comments: [],
      }));
      await assertSucceeds(setDoc(doc(db(ADMIN), 'providers', 'p-arch'), { orgId: ORG, name: 'x', totalPaid: 0 }));
      // the archive state itself is the owner's
      await assertFails(updateDoc(doc(db(ADMIN), 'organizations', ORG), { archived: false, status: 'active' }));
    });

    it('cross-company reads of organizations are refused; reading a missing org reveals nothing', async () => {
      await assertFails(getDoc(doc(db(CAIRO_FIN), 'organizations', ORG)));
      await assertFails(getDoc(doc(db(STRANGER), 'organizations', ORG)));
      await assertFails(getDocs(collection(db(ADMIN), 'organizations')));
      await assertSucceeds(getDoc(doc(db(STRANGER), 'organizations', 'org-missing')));
      await assertSucceeds(getDoc(doc(db(EMP), 'organizations', ORG)));
      await assertFails(getDoc(doc(db(SUSP_FIN), 'organizations', ORG)));
    });

    it('owner currency change: refused by the domain when ANY company account (passed in accountIds) has history, allowed without history', async () => {
      const store = createFirestoreStore(db(OWNER));
      const owner = actor(OWNER, 'super_admin');
      await expect(updateOrganization(store, owner, ORG, { currency: 'USD' }, key(), new Date(), ['acc-cash'])).rejects.toMatchObject({ code: 'currency_immutable' });
      expect((await read('organizations', ORG))!.currency).toBe('EGP');
      await seed(f => setDoc(doc(f, 'organizations', 'org-empty'), { id: 'org-empty', name: 'E', code: 'E', currency: 'EGP', notificationRecipients: [] }));
      await updateOrganization(store, owner, 'org-empty', { currency: 'USD' }, key(), new Date(), []);
      expect((await read('organizations', 'org-empty'))!.currency).toBe('USD');
      // org admin through the domain: refused before the rules
      await expect(updateOrganization(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), ORG, { currency: 'USD' }, key())).rejects.toMatchObject({ code: 'currency_immutable' });
      // org admin through the domain: rename works
      await updateOrganization(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), ORG, { name: 'Acme Renamed' }, key());
      expect((await read('organizations', ORG))!.name).toBe('Acme Renamed');
    });
  });

  // ===========================================================================
  // uniqueKeys
  // ===========================================================================
  describe('uniqueKeys: release (releasedByChange), claim, read', () => {
    const kAcc = uniqueKeyDocId('account_identifier', ORG, 'EG001');
    const kProv = uniqueKeyDocId('provider_name', ORG, 'Vodafone');
    const kSvc = uniqueKeyDocId('service_code', ORG, 'CLD');
    const kDept = uniqueKeyDocId('department_name', ORG, 'IT');
    const kMem = uniqueKeyDocId('member_email', ORG, EMP.email);
    const kOthAcc = uniqueKeyDocId('account_identifier', OTHER_ORG, 'EG001');
    const kOthProv = uniqueKeyDocId('provider_name', OTHER_ORG, 'Orange');

    it('a key that still names its live record cannot be deleted alone, by anyone but the owner (all 5 scopes)', async () => {
      for (const u of [ADMIN, FIN, EMP, DE, MULTI_ADMIN, CAIRO_ADMIN, STRANGER]) {
        for (const k of [kAcc, kProv, kSvc, kDept, kMem]) await assertFails(deleteDoc(doc(db(u), 'uniqueKeys', k)));
      }
      await assertSucceeds(deleteDoc(doc(db(OWNER), 'uniqueKeys', kAcc)));
    });

    it('release needs the value to leave the record: unrelated field, case-only, dash / dot / underscore / space variants are refused', async () => {
      const f = db(FIN);
      for (const v of ['eg001', 'EG-001', 'E.G_001', ' EG 001 ', 'Eg\t001']) {
        await assertFails(writeBatch(f).update(doc(f, 'paymentAccounts', 'acc-cash'), { accountIdentifier: v }).delete(doc(f, 'uniqueKeys', kAcc)).commit());
      }
      await assertFails(writeBatch(f).update(doc(f, 'paymentAccounts', 'acc-cash'), { name: 'x' }).delete(doc(f, 'uniqueKeys', kAcc)).commit());
      const a = db(ADMIN);
      await assertFails(writeBatch(a).update(doc(a, 'providers', 'prov-1'), { name: 'VODA-FONE' }).delete(doc(a, 'uniqueKeys', kProv)).commit());
      await assertFails(writeBatch(a).update(doc(a, 'services', 'srv-1'), { code: 'c.l.d' }).delete(doc(a, 'uniqueKeys', kSvc)).commit());
      await assertFails(writeBatch(a).update(doc(a, 'departments', 'dept-1'), { name: ' it ' }).delete(doc(a, 'uniqueKeys', kDept)).commit());
      await assertFails(writeBatch(a).update(doc(a, 'members', `${EMP.uid}_${ORG}`), { userEmail: 'EMP@acme.test' }).delete(doc(a, 'uniqueKeys', kMem)).commit());
    });

    it('change-then-restore in one batch does not release (getAfter sees the final value)', async () => {
      const f = db(FIN);
      await assertFails(writeBatch(f)
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { accountIdentifier: 'TMP' })
        .delete(doc(f, 'uniqueKeys', kAcc))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { accountIdentifier: 'EG001' })
        .commit());
      expect(await read('uniqueKeys', kAcc)).toBeTruthy();
    });

    it('[U1] a Unicode-space variant of the SAME value (domain-normalized identical) releases the key that still names the live record', async () => {
      // normalizeKeyValue (JS \s) maps 'EG<U+00A0>001' to 'eg001'; the rules' keyNorm (RE2 \s = ASCII only) does not.
      const f = db(FIN);
      const res = writeBatch(f).update(doc(f, 'paymentAccounts', 'acc-cash'), { accountIdentifier: 'EG\u00a0001' }).delete(doc(f, 'uniqueKeys', kAcc)).commit();
      await assertFails(res);
    });

    it('[U1] consequence: after the Unicode-space release the domain lets a second account claim the same number', async () => {
      const f = db(FIN);
      await writeBatch(f).update(doc(f, 'paymentAccounts', 'acc-cash'), { accountIdentifier: 'EG\u00a0001' }).delete(doc(f, 'uniqueKeys', kAcc)).commit().catch(() => undefined);
      // the org admin now renames acc-bank to EG001 through the real domain: should be refused as a duplicate of acc-cash
      await expect(updatePaymentAccount(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'acc-bank', { accountIdentifier: 'EG001' }, key()))
        .rejects.toMatchObject({ code: 'duplicate' });
    });

    it('a key of another company cannot be released through a record of the caller company, nor through its own record', async () => {
      const a = db(ADMIN);
      await assertFails(writeBatch(a).update(doc(a, 'paymentAccounts', 'acc-cash'), { accountIdentifier: 'EG999' }).delete(doc(a, 'uniqueKeys', kOthAcc)).commit());
      await assertFails(writeBatch(a).update(doc(a, 'providers', 'prov-1'), { name: 'Other name' }).delete(doc(a, 'uniqueKeys', kOthProv)).commit());
      await assertFails(writeBatch(a).update(doc(a, 'providers', 'prov-oth'), { name: 'Other name' }).delete(doc(a, 'uniqueKeys', kOthProv)).commit());
      // multi-company finance of ORG cannot touch OTHER_ORG (its profile company, employee there)
      const m = db(MULTI_FIN);
      await assertFails(writeBatch(m).update(doc(m, 'paymentAccounts', 'acc-oth'), { accountIdentifier: 'EG2' }).delete(doc(m, 'uniqueKeys', kOthAcc)).commit());
      expect(await read('uniqueKeys', kOthAcc)).toBeTruthy();
      expect(await read('uniqueKeys', kOthProv)).toBeTruthy();
    });

    it('roles that cannot change the record cannot release its key (employee, data entry, suspended finance)', async () => {
      const e = db(EMP);
      await assertFails(writeBatch(e).update(doc(e, 'members', `${EMP.uid}_${ORG}`), { userEmail: 'x@acme.test' }).delete(doc(e, 'uniqueKeys', kMem)).commit());
      const d = db(DE);
      await assertFails(writeBatch(d).update(doc(d, 'providers', 'prov-1'), { name: 'Voda2' }).delete(doc(d, 'uniqueKeys', kProv)).commit());
      await assertFails(writeBatch(d).update(doc(d, 'departments', 'dept-1'), { name: 'IT2' }).delete(doc(d, 'uniqueKeys', kDept)).commit());
      const s = db(SUSP_FIN);
      await assertFails(writeBatch(s).update(doc(s, 'paymentAccounts', 'acc-cash'), { accountIdentifier: 'EG2' }).delete(doc(s, 'uniqueKeys', kAcc)).commit());
    });

    it('a forged key (scope / collection mismatch, company-less, wrong company in the data) is refused or cannot release anything', async () => {
      const e = db(EMP);
      await assertFails(setDoc(doc(e, 'uniqueKeys', uniqueKeyDocId('provider_name', OTHER_ORG, 'X')), { scope: 'provider_name', orgId: OTHER_ORG, value: 'x', entityCollection: 'providers', entityId: 'p' }));
      await assertFails(setDoc(doc(e, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'X')), { scope: 'provider_name', orgId: OTHER_ORG, value: 'x', entityCollection: 'providers', entityId: 'p' }));
      await assertFails(setDoc(doc(e, 'uniqueKeys', uniqueKeyDocId('org_code', '-', 'X')), { scope: 'org_code', orgId: '-', value: 'x', entityCollection: 'organizations', entityId: ORG }));
      // overwrite an existing key = update: refused
      await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', kAcc), { scope: 'account_identifier', orgId: ORG, value: 'eg001', entityCollection: 'paymentAccounts', entityId: 'acc-bank' }));
      // a key whose scope says provider but whose collection says paymentAccounts never releases via the account
      await seed(f => setDoc(doc(f, 'uniqueKeys', 'provider_name__org-acme__bWlzbWF0Y2g'), { scope: 'provider_name', orgId: ORG, value: 'mismatch', entityCollection: 'paymentAccounts', entityId: 'acc-cash' }));
      const fin = db(FIN);
      await assertFails(writeBatch(fin).update(doc(fin, 'paymentAccounts', 'acc-cash'), { accountIdentifier: 'Z9' }).delete(doc(fin, 'uniqueKeys', 'provider_name__org-acme__bWlzbWF0Y2g')).commit());
    });

    it('[U2] an employee can claim (squat) a key of its company naming a live record, blocking the admin\'s legitimate create', async () => {
      const squat = uniqueKeyDocId('provider_name', ORG, 'Etisalat');
      // secure outcome: an employee (who may not create providers) cannot write the provider-name registry
      await assertFails(setDoc(doc(db(EMP), 'uniqueKeys', squat), { scope: 'provider_name', orgId: ORG, value: 'etisalat', entityCollection: 'providers', entityId: 'prov-1' }));
    });

    it('[U2] consequence: the squatted key blocks createEntity (duplicate) and the org admin cannot remove it (its record exists)', async () => {
      const squat = uniqueKeyDocId('provider_name', ORG, 'Etisalat');
      await setDoc(doc(db(EMP), 'uniqueKeys', squat), { scope: 'provider_name', orgId: ORG, value: 'etisalat', entityCollection: 'providers', entityId: 'prov-1' }).catch(() => undefined);
      await assertFails(deleteDoc(doc(db(ADMIN), 'uniqueKeys', squat)));
      const res = await createEntity(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'provider',
        (id: string) => ({ id, orgId: ORG, name: 'Etisalat', totalPaid: 0, active: true } as any), () => 'x', key());
      expect(res.changed).toBe(true);
    });

    it('claim + release through the real domain in all 5 scopes, by the roles the domain allows (incl. a multi-company finance)', async () => {
      const fin = createFirestoreStore(db(FIN));
      await updatePaymentAccount(fin, actor(FIN, 'finance', ORG), 'acc-cash', { accountIdentifier: 'EG002' }, key());
      expect(await read('uniqueKeys', kAcc)).toBeUndefined();
      const multi = createFirestoreStore(db(MULTI_FIN));
      await updatePaymentAccount(multi, actor(MULTI_FIN, 'finance', ORG), 'acc-cash', { accountIdentifier: 'EG003' }, key());
      expect(await read('uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'EG003'))).toMatchObject({ entityId: 'acc-cash' });
      await updateEntity(multi, actor(MULTI_FIN, 'finance', ORG), 'provider', 'prov-1', { name: 'Vodafone EG' }, () => ({ actionType: 'rename', details: 'x' }), key());
      expect(await read('uniqueKeys', kProv)).toBeUndefined();
      await updateEntity(fin, actor(FIN, 'finance', ORG), 'service', 'srv-1', { code: 'CLD2' }, () => ({ actionType: 'update', details: 'x' }), key());
      expect(await read('uniqueKeys', kSvc)).toBeUndefined();
      const madm = createFirestoreStore(db(MULTI_ADMIN));
      await updateEntity(madm, actor(MULTI_ADMIN, 'org_admin', ORG), 'department', 'dept-1', { name: 'Tech' }, () => ({ actionType: 'rename', details: 'x' }), key());
      expect(await read('uniqueKeys', kDept)).toBeUndefined();
      await updateMemberRecord(madm, actor(MULTI_ADMIN, 'org_admin', ORG), `${EMP.uid}_${ORG}`, { userEmail: 'emp2@acme.test' }, [], key());
      expect(await read('uniqueKeys', kMem)).toBeUndefined();
      expect(await read('uniqueKeys', uniqueKeyDocId('member_email', ORG, 'emp2@acme.test'))).toMatchObject({ entityId: `${EMP.uid}_${ORG}` });
    });

    it('reads: own company (incl. via membership) only; suspended and other companies refused; org codes owner-only', async () => {
      await assertSucceeds(getDoc(doc(db(MULTI_FIN), 'uniqueKeys', kAcc)));
      await assertFails(getDoc(doc(db(MULTI_FIN), 'uniqueKeys', kOthAcc.replace(OTHER_ORG, 'org-third'))));
      await assertFails(getDoc(doc(db(SUSP_FIN), 'uniqueKeys', kAcc)));
      await assertFails(getDoc(doc(db(CAIRO_FIN), 'uniqueKeys', kAcc)));
      await assertFails(getDoc(doc(db(EMP), 'uniqueKeys', kOthAcc)));
      await assertFails(getDoc(doc(db(ADMIN), 'uniqueKeys', uniqueKeyDocId('org_code', '-', 'ACME'))));
      await assertFails(getDocs(collection(db(ADMIN), 'uniqueKeys')));
    });
  });

  // ===========================================================================
  // members / users: self-escalation, suspension, unverified emails
  // ===========================================================================
  describe('members / users identity', () => {
    it('self-escalation through members is refused (role, active, orgId, userId, userEmail, payout)', async () => {
      const e = db(EMP);
      const mine = doc(e, 'members', `${EMP.uid}_${ORG}`);
      for (const patch of [{ role: 'org_admin' }, { active: true, role: 'finance' }, { orgId: OTHER_ORG }, { userId: ADMIN.uid }, { userEmail: ADMIN.email }, { iban: 'EG00' }]) {
        await assertFails(updateDoc(mine, patch));
      }
      await assertSucceeds(updateDoc(mine, { userName: 'Emp R', phone: '011' }));
      await assertFails(setDoc(doc(e, 'members', `${EMP.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: EMP.uid, userEmail: EMP.email, role: 'org_admin', active: true }));
      await assertFails(setDoc(doc(e, 'members', `${EMP.uid}_x_${ORG}`), { orgId: ORG, userId: `${EMP.uid}_x`, userEmail: EMP.email, role: 'org_admin', active: true }));
      // suspended member cannot reactivate itself
      await assertFails(updateDoc(doc(db(SUSP_FIN), 'members', `${SUSP_FIN.uid}_${ORG}`), { active: true }));
    });

    it('self-escalation through users/{uid} is refused (role, org, active, memberId of someone else, unverified invite)', async () => {
      const e = db(EMP);
      const me = doc(e, 'users', EMP.uid);
      await assertFails(updateDoc(me, { role: 'org_admin' }));
      await assertFails(updateDoc(me, { role: 'super_admin' }));
      await assertFails(updateDoc(me, { orgId: OTHER_ORG }));
      await assertFails(updateDoc(me, { role: 'org_admin', memberId: `${ADMIN.uid}_${ORG}` }));
      await assertFails(updateDoc(me, { role: 'org_admin', memberId: NEWHIRE_MEMBER }));
      await assertFails(updateDoc(me, { email: ADMIN.email }));
      await assertSucceeds(updateDoc(me, { phone: '012', iban: 'EG11' }));
      await assertFails(setDoc(doc(e, 'users', ADMIN.uid), { orgId: ORG, role: 'employee' }));
      // suspended profile cannot reactivate itself (its membership is suspended too)
      await assertFails(updateDoc(doc(db(SUSP_FIN), 'users', SUSP_FIN.uid), { active: true }));
      await assertFails(updateDoc(doc(db(SUSP_FIN), 'users', SUSP_FIN.uid), { active: true, memberId: `${SUSP_FIN.uid}_${ORG}` }));
      // an outsider registering the invited address without verifying it gets nothing
      const imp = { uid: 'uidImpostor00000000000001', email: NEWHIRE_EMAIL };
      await assertFails(setDoc(doc(db(imp, false), 'users', imp.uid), { orgId: ORG, role: 'org_admin', active: true, memberId: NEWHIRE_MEMBER }));
      // the real invitee (verified) self-links
      await assertSucceeds(setDoc(doc(db(imp, true), 'users', imp.uid), { orgId: ORG, role: 'org_admin', active: true, memberId: NEWHIRE_MEMBER, email: NEWHIRE_EMAIL }));
    });

    it('org admin cannot move a profile / membership into another company, grant super_admin, or touch the owner / its own grant', async () => {
      const a = db(ADMIN);
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { orgId: OTHER_ORG }));
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { role: 'super_admin' }));
      await assertFails(updateDoc(doc(a, 'users', CAIRO_FIN.uid), { role: 'employee' }));
      await assertFails(updateDoc(doc(a, 'members', `${EMP.uid}_${ORG}`), { orgId: OTHER_ORG }));
      await assertFails(updateDoc(doc(a, 'members', `${CAIRO_FIN.uid}_${OTHER_ORG}`), { active: false }));
      await assertFails(setDoc(doc(a, 'members', `${EMP.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: EMP.uid, userEmail: EMP.email, role: 'org_admin', active: true }));
      await assertFails(updateDoc(doc(a, 'members', `${ADMIN.uid}_${ORG}`), { role: 'employee' }));
      await seed(f => setDoc(doc(f, 'members', `${OWNER.uid}_${ORG}`), { orgId: ORG, userId: OWNER.uid, userEmail: OWNER.email, role: 'org_admin', active: true }));
      await assertFails(updateDoc(doc(a, 'members', `${OWNER.uid}_${ORG}`), { active: false }));
      await assertFails(deleteDoc(doc(a, 'members', `${OWNER.uid}_${ORG}`)));
      await assertFails(deleteDoc(doc(db(CAIRO_ADMIN), 'members', `${EMP.uid}_${ORG}`)));
    });

    it('[M1] an outsider with an UNVERIFIED token for an invited address can read and list that membership (role, company, phone)', async () => {
      const imp = { uid: 'uidImpostor00000000000001', email: NEWHIRE_EMAIL };
      await assertFails(getDoc(doc(db(imp, false), 'members', NEWHIRE_MEMBER)));
    });

    it('[M1] (list variant) where(userEmail == token email) with an unverified token', async () => {
      const imp = { uid: 'uidImpostor00000000000001', email: NEWHIRE_EMAIL };
      await assertFails(getDocs(query(collection(db(imp, false), 'members'), where('userEmail', '==', NEWHIRE_EMAIL))));
    });

    it('real domain: multi-company org admin adds, edits and removes a member of its second company (recipients follow)', async () => {
      const store = createFirestoreStore(db(MULTI_ADMIN));
      const me = actor(MULTI_ADMIN, 'org_admin', ORG);
      const res = await createMemberInOrgs(store, me, { userId: '', userName: 'n', userEmail: 'n@acme.test', role: 'org_admin', department: 'd', jobTitle: 'j', active: true } as any, [ORG], key());
      const m = res.value.created[0];
      expect((await read('organizations', ORG))!.notificationRecipients).toContain('n@acme.test');
      await updateMemberRecord(store, me, m.id, { active: false }, [], key());
      expect((await read('organizations', ORG))!.notificationRecipients).not.toContain('n@acme.test');
      await removeMember(store, me, m.id, [], key());
      expect(await read('members', m.id)).toBeUndefined();
      await expect(createMemberInOrgs(store, me, { userId: '', userName: 'n', userEmail: 'n2@acme.test', role: 'employee', department: 'd', jobTitle: 'j', active: true } as any, [OTHER_ORG], key())).rejects.toBeTruthy();
    });
  });

  // ===========================================================================
  // counters
  // ===========================================================================
  describe('counters', () => {
    it('advance by exactly one; employees cannot advance custody / transfer counters; nobody deletes', async () => {
      await assertSucceeds(setDoc(doc(db(EMP), 'counters', 'requests-2026'), { value: 1 }));
      await assertFails(updateDoc(doc(db(EMP), 'counters', 'requests-2026'), { value: 3 }));
      await assertFails(updateDoc(doc(db(EMP), 'counters', 'requests-2026'), { value: 1 }));
      await assertFails(setDoc(doc(db(EMP), 'counters', 'custodies-2026'), { value: 1 }));
      await assertFails(setDoc(doc(db(EMP), 'counters', 'evil'), { value: 1 }));
      await assertFails(setDoc(doc(db(STRANGER), 'counters', 'requests-2027'), { value: 1 }));
      await assertFails(deleteDoc(doc(db(ADMIN), 'counters', 'requests-2026')));
      await assertSucceeds(setDoc(doc(db(FIN), 'counters', 'custodies-2026'), { value: 1 }));
    });

    it('[C1] a SUSPENDED finance user can still advance the custody / transfer counters (profile role read without active)', async () => {
      await assertFails(setDoc(doc(db(SUSP_FIN), 'counters', 'custodies-2026'), { value: 1 }));
    });

    it('[C1] (detached profile variant) a profile with orgId \'\' but a stale finance role advances the transfer counter', async () => {
      await seed(f => setDoc(doc(f, 'users', 'uidDetached00000000000001'), { orgId: '', role: 'finance', active: true }));
      await assertFails(setDoc(doc(db({ uid: 'uidDetached00000000000001', email: 'det@x.test' }), 'counters', 'transfers-2026'), { value: 1 }));
    });
  });

  // ===========================================================================
  // auditLogs
  // ===========================================================================
  describe('auditLogs', () => {
    it('only in the caller\'s own name, only in its own company, never overwritten', async () => {
      await assertFails(setDoc(doc(db(EMP), 'auditLogs', 'a-x'), { actorId: ADMIN.uid, orgId: ORG, actionType: 'approve' }));
      await assertFails(setDoc(doc(db(EMP), 'auditLogs', 'a-y'), { actorId: EMP.uid, orgId: OTHER_ORG, actionType: 'approve' }));
      await assertFails(setDoc(doc(db(SUSP_FIN), 'auditLogs', 'a-z'), { actorId: SUSP_FIN.uid, orgId: ORG, actionType: 'approve' }));
      await assertFails(setDoc(doc(db(ADMIN), 'auditLogs', 'audit-1'), { actorId: ADMIN.uid, orgId: ORG, actionType: 'delete' }));
      await assertFails(deleteDoc(doc(db(ADMIN), 'auditLogs', 'audit-1')));
      await assertFails(getDoc(doc(db(FIN), 'auditLogs', 'audit-1')));
      await assertFails(getDoc(doc(db(CAIRO_ADMIN), 'auditLogs', 'audit-1')));
    });

    it('[A1] an employee writes an audit entry that displays the org admin as the actor (actorName / actorEmail are not bound)', async () => {
      await assertFails(setDoc(doc(db(EMP), 'auditLogs', 'audit-forged-1'), {
        id: 'audit-forged-1', actorId: EMP.uid, actorName: 'admin@acme.test', actorEmail: ADMIN.email, orgId: ORG, orgName: 'Acme',
        actionType: 'approve', entityType: 'request', entityId: 'r1', entityName: 'r1', details: 'approved and paid 300', timestamp: '2026-10-01T00:00:00.000Z',
      }));
    });

    it('[A1] (company-less variant) an outsider with no company and an unverified email writes org-less entries into the platform log', async () => {
      await assertFails(setDoc(doc(db(STRANGER, false), 'auditLogs', 'audit-forged-2'), {
        actorId: STRANGER.uid, actorName: 'Mahmoud', actorEmail: OWNER.email, orgId: '', actionType: 'delete', entityType: 'organization', entityId: ORG, details: 'deleted company',
      }));
    });
  });

  // ===========================================================================
  // outbox / mail
  // ===========================================================================
  describe('outbox / mail', () => {
    const ownRequest = async (id: string) => {
      await assertSucceeds(setDoc(doc(db(EMP), 'requests', id), {
        id, orgId: ORG, status: 'pending', requesterId: EMP.uid, requesterEmail: EMP.email, requesterName: 'e', amount: 1, currency: 'EGP', title: 't', timeline: [], comments: [],
      }));
    };
    const event = (id: string, entityId: string, extra: Record<string, unknown> = {}) => ({
      id, orgId: ORG, eventType: 'new_request', entityType: 'request', entityId, channel: 'firestore_mail', recipients: [OWNER.email],
      message: { subject: 'Urgent: verify your account', html: '<a href="https://evil.test/login">Sign in</a>', text: '', snippet: '' },
      meta: { senderName: 'Google Security', senderEmail: 'no-reply@accounts.google.com', replyTo: 'attacker@evil.test', provider: 'auto' },
      status: 'pending', attempts: 0, maxAttempts: 6, nextAttemptAt: 'x', createdBy: EMP.uid, createdAt: 'x', updatedAt: 'x', ...extra,
    });

    it('bound to the requester, the request and the admin recipients; no cross-company / foreign request / other recipient', async () => {
      await ownRequest('rq-a');
      const e = db(EMP);
      await seed(f => setDoc(doc(f, 'requests', 'r-fin'), approvedRequest('r-fin', 5, { status: 'pending', requesterId: FIN.uid, requesterEmail: FIN.email })));
      await assertFails(setDoc(doc(e, 'outbox', 'new_request__r-fin'), event('new_request__r-fin', 'r-fin')));
      await assertFails(setDoc(doc(e, 'outbox', 'new_request__rq-a'), event('new_request__rq-a', 'rq-a', { recipients: ['victim@evil.test'] })));
      await assertFails(setDoc(doc(e, 'outbox', 'new_request__rq-a'), event('new_request__rq-a', 'rq-a', { orgId: OTHER_ORG })));
      await assertFails(setDoc(doc(e, 'outbox', 'request_approved__rq-a__k'), event('request_approved__rq-a__k', 'rq-a', { eventType: 'request_approved', recipients: [EMP.email] })));
      await assertFails(setDoc(doc(e, 'outbox', 'new_request__rq-a'), event('new_request__rq-a', 'rq-a', { createdBy: ADMIN.uid })));
      await assertFails(setDoc(doc(e, 'outbox', 'new_request__rq-a'), event('new_request__rq-a', 'rq-a', { status: 'sent' })));
      await assertFails(setDoc(doc(db(CAIRO_FIN), 'outbox', 'test_email__k1'), event('test_email__k1', 'test', { entityType: 'system', eventType: 'test_email', recipients: [ADMIN.email] })));
      // foreign finance cannot claim / read ORG events
      await assertFails(getDoc(doc(db(CAIRO_FIN), 'outbox', 'ob-1')));
      await assertFails(updateDoc(doc(db(CAIRO_FIN), 'outbox', 'ob-1'), { status: 'sending', attempts: 1 }));
      await assertFails(updateDoc(doc(db(FIN), 'outbox', 'ob-1'), { status: 'sending', attempts: 0, recipients: ['x@evil.test'] }));
    });

    it('[O1] an employee mails arbitrary HTML from a spoofed sender to the platform owner (outbox content / sender not bound)', async () => {
      await ownRequest('rq-b');
      // secure outcome: an event whose content / sender is not the app's own is refused
      await assertFails(setDoc(doc(db(EMP), 'outbox', 'new_request__rq-b'), event('new_request__rq-b', 'rq-b')));
    });

    it('[O1] (end to end) the same employee claims its event and writes the Trigger-Email mail doc with the spoofed From', async () => {
      await ownRequest('rq-c');
      const e = db(EMP);
      await setDoc(doc(e, 'outbox', 'new_request__rq-c'), event('new_request__rq-c', 'rq-c')).catch(() => undefined);
      await updateDoc(doc(e, 'outbox', 'new_request__rq-c'), { status: 'sending', attempts: 1, leaseUntil: 'x', updatedAt: 'x' }).catch(() => undefined);
      const ev = event('new_request__rq-c', 'rq-c');
      const mailId = `new_request__rq-c:${OWNER.email}`.replace(/[^A-Za-z0-9_-]/g, '_');
      await assertFails(setDoc(doc(e, 'mail', mailId), {
        to: [OWNER.email], message: { subject: ev.message.subject, html: ev.message.html, text: '' },
        from: `"${ev.meta.senderName}" <${ev.meta.senderEmail}>`, replyTo: ev.meta.replyTo,
        metadata: { eventId: 'new_request__rq-c' },
      }));
    });

    it('[O1] (org admin variant) org admin addresses an arbitrary outside address via notificationRecipients + test_email', async () => {
      const a = db(ADMIN);
      await updateDoc(doc(a, 'organizations', ORG), { notificationRecipients: [ADMIN.email, 'victim@evil.test'] }).catch(() => undefined);
      await assertFails(setDoc(doc(a, 'outbox', 'test_email__k9'), event('test_email__k9', 'test', {
        entityType: 'system', eventType: 'test_email', recipients: ['victim@evil.test'], createdBy: ADMIN.uid,
      })));
    });

    it('[O2] an employee-created event carries a webhook channel + URL of its choice, which ORG finance workers list and dispatch', async () => {
      await ownRequest('rq-d');
      await assertFails(setDoc(doc(db(EMP), 'outbox', 'new_request__rq-d'), event('new_request__rq-d', 'rq-d', {
        channel: 'webhook', meta: { senderName: 'x', senderEmail: 'x@x', replyTo: 'x@x', provider: 'auto', webhookUrl: 'https://evil.test/collect' },
      })));
    });

    it('[O2] (dispatch reach) finance of the company may list and claim the employee-created webhook event', async () => {
      await ownRequest('rq-e');
      await setDoc(doc(db(EMP), 'outbox', 'new_request__rq-e'), event('new_request__rq-e', 'rq-e', {
        channel: 'webhook', meta: { senderName: 'x', senderEmail: 'x@x', replyTo: 'x@x', provider: 'auto', webhookUrl: 'https://evil.test/collect' },
      })).catch(() => undefined);
      // the worker query (status in [...] and orgId == ORG) as finance, then the claim
      const snap = await getDocs(query(collection(db(FIN), 'outbox'), where('status', 'in', ['pending', 'failed', 'sending']), where('orgId', '==', ORG)));
      const hit = snap.docs.find(d => d.id === 'new_request__rq-e');
      expect(hit?.data().meta.webhookUrl ?? null).toBeNull();
    });
  });

  // ===========================================================================
  // cross-company access to every financial / directory collection
  // ===========================================================================
  describe('cross-company isolation', () => {
    const docs: Array<[string, string, Record<string, unknown>]> = [
      ['paymentAccounts', 'acc-cash', { name: 'x' }],
      ['accountTransactions', 'tx-1', { amount: 2 }],
      ['requests', 'r1', { title: 'x' }],
      ['custodies', 'cus-1', { notes: 'x' }],
      ['custodySettlements', 'stl-1', { amount: 2 }],
      ['services', 'srv-1', { name: 'x' }],
      ['providers', 'prov-1', { name: 'x' }],
      ['departments', 'dept-1', { name: 'x' }],
      ['visaRequests', 'v1', { status: 'approved' }],
      ['auditLogs', 'audit-1', { actionType: 'x' }],
      ['outbox', 'ob-1', { status: 'sending', attempts: 1 }],
      ['attachments', 'att-1', { name: 'x' }],
      ['members', `${EMP.uid}_${ORG}`, { userName: 'x' }],
      ['users', EMP.uid, { name: 'x' }],
    ];

    for (const who of [CAIRO_FIN, CAIRO_ADMIN, STRANGER, SUSP_FIN] as const) {
      it(`${who.email}: no get / list / update / delete of ORG documents in any collection`, async () => {
        const f = db(who);
        for (const [c, id, patch] of docs) {
          if (!(who === SUSP_FIN && c === 'users' && id === SUSP_FIN.uid)) {
            await assertFails(getDoc(doc(f, c, id)));
          }
          await assertFails(getDocs(query(collection(f, c), where('orgId', '==', ORG))));
          await assertFails(updateDoc(doc(f, c, id), patch));
          await assertFails(deleteDoc(doc(f, c, id)));
        }
      });
    }

    it('cross-company creates into ORG are refused (request, account, service, provider, department, custody, visa, member, attachment, legacy marker)', async () => {
      const f = db(CAIRO_ADMIN);
      await assertFails(setDoc(doc(f, 'requests', 'x1'), { orgId: ORG, status: 'pending', requesterId: CAIRO_ADMIN.uid }));
      await assertFails(setDoc(doc(f, 'paymentAccounts', 'x2'), account('x2', 0)));
      await assertFails(setDoc(doc(f, 'services', 'x3'), { orgId: ORG, name: 'x', code: 'x', spentAmount: 0 }));
      await assertFails(setDoc(doc(f, 'providers', 'x4'), { orgId: ORG, name: 'x', totalPaid: 0 }));
      await assertFails(setDoc(doc(f, 'departments', 'x5'), { orgId: ORG, name: 'x' }));
      await assertFails(setDoc(doc(f, 'visaRequests', 'x6'), { orgId: ORG, status: 'pending', requesterId: CAIRO_ADMIN.uid }));
      await assertFails(setDoc(doc(f, 'members', `${CAIRO_ADMIN.uid}_${ORG}`), { orgId: ORG, userId: CAIRO_ADMIN.uid, userEmail: CAIRO_ADMIN.email, role: 'org_admin', active: true }));
      await assertFails(setDoc(doc(f, 'attachments', 'x7'), { id: 'x7', orgId: ORG, name: 'a', mimeType: 'application/pdf', size: 1, chunkCount: 1, createdBy: CAIRO_ADMIN.uid, createdAt: 'x', complete: false }));
      await assertFails(setDoc(doc(f, 'legacyRestores', 'requests__x'), { orgId: ORG, restoredBy: CAIRO_ADMIN.uid }));
      await assertFails(setDoc(doc(f, 'users', 'uidVictim0000000000000001'), { orgId: ORG, role: 'org_admin', active: true }));
      // a service shared into ORG by another company's admin
      await assertFails(setDoc(doc(f, 'services', 'x8'), { orgId: OTHER_ORG, orgIds: [OTHER_ORG, ORG], name: 'x', code: 'x', spentAmount: 0 }));
    });

    it('multi-company finance: full finance in its second company, employee-only in its profile company', async () => {
      const m = db(MULTI_FIN);
      await assertSucceeds(getDoc(doc(m, 'paymentAccounts', 'acc-cash')));
      await assertSucceeds(getDocs(query(collection(m, 'paymentAccounts'), where('orgId', '==', ORG))));
      await assertFails(getDoc(doc(m, 'paymentAccounts', 'acc-oth')));
      await assertFails(getDocs(query(collection(m, 'paymentAccounts'), where('orgId', '==', OTHER_ORG))));
      // a real disbursement in its second company
      await seed(f => setDoc(doc(f, 'requests', 'r-m'), approvedRequest('r-m', 100)));
      const res = await disburseExpenseRequest(createFirestoreStore(m), actor(MULTI_FIN, 'finance', ORG), 'r-m', { paymentMethod: 'cash', referenceNumber: 'M1', accountId: 'acc-cash' }, key(), notify);
      expect(res.changed).toBe(true);
      expect((await read('paymentAccounts', 'acc-cash'))!.currentBalance).toBe(900);
    });
  });

  // ===========================================================================
  // Round r1 fixes: outbox sender / channel, keys, invitations, audit
  // ===========================================================================
  describe('round r1 fixes (tenancy)', () => {
    const requestDraft = (extra: Record<string, unknown> = {}) => ({
      orgId: ORG, title: 'Laptop', description: 'd', justification: 'j', amount: 10, currency: 'EGP', urgency: 'medium',
      requestType: 'expense', preferredPaymentMethod: 'instapay', paymentAccountDetails: 'x@instapay', attachments: [], ...extra,
    }) as any;
    const configured = {
      enabled: true, senderName: 'Acme Mailer', senderEmail: 'noreply@acme.test', replyToEmail: 'support@acme.test',
      deliveryMethod: 'webhook', webhookUrl: 'https://hooks.acme.test/notify', directProvider: 'auto',
    };

    it('[O1] [O2] the events the app builds pass: configured sender + webhook, and a tab still on the default settings; another sender / URL is refused', async () => {
      await seed(f => setDoc(doc(f, 'system_settings', 'email_notifications'), configured));
      const settings = { ...DEFAULT_EMAIL_SETTINGS, ...configured } as any;
      const r1 = await createExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), requestDraft(), key(), { settings, adminRecipients: [ADMIN.email] });
      expect(r1.outboxEventIds).toHaveLength(1);
      expect(await read('outbox', r1.outboxEventIds[0])).toMatchObject({ channel: 'webhook', meta: { senderName: 'Acme Mailer', webhookUrl: configured.webhookUrl } });
      // a tab whose settings listener has not caught up builds the event from the defaults
      const r2 = await createExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), requestDraft(), key(), notifyAll);
      expect(await read('outbox', r2.outboxEventIds[0])).toMatchObject({ channel: 'email_api', meta: { senderName: DEFAULT_EMAIL_SETTINGS.senderName } });
      // finance approves with the configured settings (event to the requester)
      await transitionExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), r1.value.id, { type: 'approve' }, key(), { settings });
      // raw events: another webhook URL, a webhook while the settings say otherwise, a forged sender / reply-to
      const e = db(EMP);
      await assertSucceeds(setDoc(doc(e, 'requests', 'rq-w'), { id: 'rq-w', orgId: ORG, status: 'pending', requesterId: EMP.uid, requesterEmail: EMP.email, amount: 1, currency: 'EGP', title: 't', timeline: [], comments: [] }));
      const ev = (meta: Record<string, unknown>, channel = 'webhook') => ({
        id: 'new_request__rq-w', orgId: ORG, eventType: 'new_request', entityType: 'request', entityId: 'rq-w', channel, recipients: [ADMIN.email],
        message: { subject: 's', html: 'h', text: '', snippet: '' },
        meta: { senderName: 'Acme Mailer', senderEmail: 'noreply@acme.test', replyTo: 'support@acme.test', provider: 'auto', ...meta },
        status: 'pending', attempts: 0, maxAttempts: 6, nextAttemptAt: 'x', createdBy: EMP.uid, createdAt: 'x', updatedAt: 'x',
      });
      await assertFails(setDoc(doc(e, 'outbox', 'new_request__rq-w'), ev({ webhookUrl: 'https://evil.test/collect' })));
      await assertFails(setDoc(doc(e, 'outbox', 'new_request__rq-w'), ev({ webhookUrl: 'https://evil.test/collect' }, 'email_api')));
      await assertFails(setDoc(doc(e, 'outbox', 'new_request__rq-w'), ev({ webhookUrl: configured.webhookUrl, senderName: 'Google Security' })));
      await assertFails(setDoc(doc(e, 'outbox', 'new_request__rq-w'), ev({ webhookUrl: configured.webhookUrl, replyTo: 'attacker@evil.test' })));
      await assertSucceeds(setDoc(doc(e, 'outbox', 'new_request__rq-w'), ev({ webhookUrl: configured.webhookUrl })));
      // the settings switched away from the webhook: a webhook event is refused
      await seed(f => updateDoc(doc(f, 'system_settings', 'email_notifications'), { deliveryMethod: 'firestore_mail' }));
      await assertSucceeds(setDoc(doc(e, 'requests', 'rq-w2'), { id: 'rq-w2', orgId: ORG, status: 'pending', requesterId: EMP.uid, requesterEmail: EMP.email, amount: 1, currency: 'EGP', title: 't', timeline: [], comments: [] }));
      await assertFails(setDoc(doc(e, 'outbox', 'new_request__rq-w2'), { ...ev({ webhookUrl: configured.webhookUrl }), id: 'new_request__rq-w2', entityId: 'rq-w2' }));
    });

    it('[O1, known, accepted] the message body is the client\'s template output and is not checked by the rules (sender, channel and recipients are)', async () => {
      const e = db(EMP);
      await assertSucceeds(setDoc(doc(e, 'requests', 'rq-h'), { id: 'rq-h', orgId: ORG, status: 'pending', requesterId: EMP.uid, requesterEmail: EMP.email, amount: 1, currency: 'EGP', title: 't', timeline: [], comments: [] }));
      await assertSucceeds(setDoc(doc(e, 'outbox', 'new_request__rq-h'), {
        id: 'new_request__rq-h', orgId: ORG, eventType: 'new_request', entityType: 'request', entityId: 'rq-h', channel: 'email_api', recipients: [ADMIN.email],
        message: { subject: 'any subject', html: '<p>any html</p>', text: '', snippet: '' },
        meta: { senderName: DEFAULT_EMAIL_SETTINGS.senderName, senderEmail: DEFAULT_EMAIL_SETTINGS.senderEmail, replyTo: DEFAULT_EMAIL_SETTINGS.replyToEmail, provider: 'auto' },
        status: 'pending', attempts: 0, maxAttempts: 6, nextAttemptAt: 'x', createdBy: EMP.uid, createdAt: 'x', updatedAt: 'x',
      }));
    });

    it('[U1] [U2] keys: an id that encodes another value than the key holds is refused; a name with a Unicode space is claimed, renamed and released by the domain', async () => {
      const a = db(ADMIN);
      await assertFails(writeBatch(a)
        .set(doc(a, 'providers', 'prov-z'), { orgId: ORG, name: 'Zain', totalPaid: 0, active: true })
        .set(doc(a, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Etisalat')), { scope: 'provider_name', orgId: ORG, value: 'zain', entityCollection: 'providers', entityId: 'prov-z' })
        .commit());
      // a key for a value the record does not hold
      await assertFails(writeBatch(a)
        .set(doc(a, 'providers', 'prov-z'), { orgId: ORG, name: 'Zain', totalPaid: 0, active: true })
        .set(doc(a, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Etisalat')), { scope: 'provider_name', orgId: ORG, value: 'etisalat', entityCollection: 'providers', entityId: 'prov-z' })
        .commit());
      const p = await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', (id: string) => ({ id, orgId: ORG, name: 'Etisalat\u00a0Misr\u3000EG', totalPaid: 0, active: true } as any), () => 'x', key());
      expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Etisalat Misr EG'))).toMatchObject({ entityId: p.value.id, value: 'etisalatmisreg' });
      await updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', p.value.id, { name: 'Orange\u2007Misr' } as any, () => ({ actionType: 'rename', details: 'x' }), key());
      expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Etisalat Misr EG'))).toBeUndefined();
      expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Orange Misr'))).toMatchObject({ entityId: p.value.id });
      // an employee cannot claim a key for a value the named record does not hold
      await assertFails(setDoc(doc(db(EMP), 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Vodafone EG')), { scope: 'provider_name', orgId: ORG, value: 'vodafoneeg', entityCollection: 'providers', entityId: 'prov-1' }));
    });

    it('[M1] the VERIFIED invitee still reads and lists its invitation (get, where userEmail, the app\'s or() query)', async () => {
      const inv = { uid: 'uidInvitee000000000000001', email: NEWHIRE_EMAIL };
      await assertSucceeds(getDoc(doc(db(inv), 'members', NEWHIRE_MEMBER)));
      await assertSucceeds(getDocs(query(collection(db(inv), 'members'), where('userEmail', '==', NEWHIRE_EMAIL))));
      await assertSucceeds(getDocs(query(collection(db(inv), 'members'), or(where('userId', '==', inv.uid), where('userEmail', '==', NEWHIRE_EMAIL)))));
      // unverified: only its own uid query
      await assertSucceeds(getDocs(query(collection(db(inv, false), 'members'), where('userId', '==', inv.uid))));
      await assertFails(getDocs(query(collection(db(inv, false), 'members'), or(where('userId', '==', inv.uid), where('userEmail', '==', NEWHIRE_EMAIL)))));
    });

    it('[A1] audit: the owner writes company-less entries; a member writes in its company under its own sign-in email (or none)', async () => {
      await assertSucceeds(setDoc(doc(db(OWNER), 'auditLogs', 'a-owner'), { actorId: OWNER.uid, actorEmail: OWNER.email, orgId: '', actionType: 'update', details: 'settings' }));
      await assertSucceeds(setDoc(doc(db(EMP), 'auditLogs', 'a-emp'), { actorId: EMP.uid, actorEmail: EMP.email, actorName: 'whatever', orgId: ORG, actionType: 'update', details: 'x' }));
      await assertSucceeds(setDoc(doc(db(EMP), 'auditLogs', 'a-emp2'), { actorId: EMP.uid, orgId: ORG, actionType: 'update', details: 'x' }));
      await assertFails(setDoc(doc(db(EMP), 'auditLogs', 'a-emp3'), { actorId: EMP.uid, actorEmail: EMP.email, orgId: '', actionType: 'update', details: 'x' }));
      await assertFails(setDoc(doc(db(ADMIN), 'auditLogs', 'a-adm'), { actorId: ADMIN.uid, actorEmail: OWNER.email, orgId: ORG, actionType: 'update', details: 'x' }));
    });
  });
});

describe('legitimate operations (real domain, every role, legacy data)', () => {
  const draft = (extra: Record<string, unknown> = {}) => ({
    orgId: ORG, title: 'Laptop', description: 'd', justification: 'j', amount: 120.5, currency: 'EGP', urgency: 'medium',
    requestType: 'expense', preferredPaymentMethod: 'instapay', paymentAccountDetails: 'x@instapay', serviceCategoryId: 'srv-1',
    serviceCategoryName: 'Cloud', providerId: 'prov-1', providerName: 'Vodafone', attachments: [], ...extra,
  }) as any;

  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [ADMIN.email] });
      await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [] });
      await setDoc(doc(f, 'organizations', THIRD_ORG), { id: THIRD_ORG, name: 'Third', code: 'TRD', currency: 'EGP', notificationRecipients: [] });
      for (const [u, role, org] of [[ADMIN, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [DE, 'data_entry', ORG], [CAIRO_FIN, 'finance', OTHER_ORG]] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true, memberId: `${u.uid}_${org}` });
        await setDoc(doc(f, 'members', `${u.uid}_${org}`), { orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      for (const [u, role] of [[MULTI_FIN, 'finance'], [MULTI_EMP, 'employee'], [MULTI_ADMIN, 'org_admin']] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: OTHER_ORG, role: 'employee', active: true, memberId: `${u.uid}_${OTHER_ORG}` });
        await setDoc(doc(f, 'members', `${u.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: u.uid, userEmail: u.email, role: 'employee', active: true, userName: u.email });
        await setDoc(doc(f, 'members', `${u.uid}_${ORG}`), { orgId: ORG, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      // INVITED: membership created by email (placeholder id), user signed in with a verified email.
      await setDoc(doc(f, 'members', `pending-invited_${ORG}`), { orgId: ORG, userId: 'pending-invited', userEmail: INVITED.email, role: 'employee', active: true, userName: 'invited' });
      await setDoc(doc(f, 'users', INVITED.uid), { orgId: ORG, role: 'employee', active: true, memberId: `pending-invited_${ORG}` });

      await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), account('acc-cash', 1000));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank'), account('acc-bank', 5000, { type: 'bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-insta'), account('acc-insta', 5000, { type: 'instapay', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank2'), account('acc-bank2', 3000, { type: 'bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-insta2'), account('acc-insta2', 3000, { type: 'instapay', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-wallet'), account('acc-wallet', 0, { type: 'wallet' }));
      // legacy wallet still mirroring to acc-bank2 (created before wallets became standalone)
      await setDoc(doc(f, 'paymentAccounts', 'acc-wallet-old'), account('acc-wallet-old', 600, { type: 'wallet', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2', initialBalance: 1000, totalOut: 400 }));
      await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0, active: true });
      await setDoc(doc(f, 'providers', 'prov-1'), { orgId: ORG, name: 'Vodafone', totalPaid: 500, active: true });
      await setDoc(doc(f, 'custodies', 'cus-1'), custody('cus-1'));
    });
  });

  // ===========================================================================
  // Expense requests: every role, legacy shapes, notifications on
  // ===========================================================================
  describe('requests: create / edit / decide / pay as each role', () => {
    it('employee files (notifications on), finance approves with a note, finance pays from the InstaPay; org admin rejects another one', async () => {
      const r = await createExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), draft(), key(), notifyAll);
      expect(r.outboxEventIds).toHaveLength(1);
      await transitionExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), r.value.id, { type: 'approve', note: 'ok' }, key(), notifyAll);
      const paid = await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), r.value.id, { paymentMethod: 'instapay', referenceNumber: 'R1', accountId: 'acc-insta' }, key(), notifyAll);
      expect(paid.changed).toBe(true);
      expect((await read('paymentAccounts', 'acc-bank'))!.currentBalance).toBe(4879.5);
      const r2 = await createExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), draft({ amount: 9.99 }), key(), notifyAll);
      await transitionExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), r2.value.id, { type: 'reject', reason: 'no' }, key(), notifyAll);
    });

    it('org admin, finance and data entry file their own requests; org admin approves its own; a multi-company employee files in its second company', async () => {
      const own = await createExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), draft(), key(), notifyAll);
      await transitionExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), own.value.id, { type: 'approve' }, key(), notifyAll);
      await createExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), draft(), key(), notifyAll);
      await createExpenseRequest(store(DE), actor(DE, 'data_entry', ORG), draft(), key(), notifyAll);
      const m = await createExpenseRequest(store(MULTI_EMP), actor(MULTI_EMP, 'employee', ORG), draft(), key(), notifyAll);
      expect(m.changed).toBe(true);
    });

    it('clarify / ask again / reply with an attachment, notifications on; requester edits the pending request with the full form payload', async () => {
      const r = await createExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), draft(), key(), notifyAll);
      await transitionExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), r.value.id, { type: 'clarify', question: 'why?' }, key(), notifyAll);
      await transitionExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), r.value.id, { type: 'clarify', question: 'and?' }, key(), notifyAll);
      const att = { id: 'att-1', name: 'r.pdf', url: 'fsattach://att-1', type: 'application/pdf', size: 1, uploadedAt: 'x' };
      await transitionExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), r.value.id, { type: 'reply', replyText: 'here', attachment: att as any }, key(), notifyAll);
      // NewRequestModal edit payload (orgId / undefined fields included, as the form sends them)
      await updateExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), r.value.id, {
        title: 'Laptop 2', description: 'd2', justification: 'j', amount: 133.33, currency: 'EGP', serviceCategoryId: 'srv-1', serviceCategoryName: 'Cloud',
        providerId: 'prov-1', providerName: 'Vodafone', urgency: 'high', requestType: 'expense', targetAccountId: undefined, itemsDetail: undefined,
        isPrepaidByRequester: false, invoiceNumber: undefined, invoiceDate: undefined, invoiceAttachment: undefined, attachments: [att],
        preferredPaymentMethod: 'instapay', paymentAccountDetails: 'x@instapay', beneficiaryName: 'B', orgId: ORG,
      } as any, key());
      expect((await read('requests', r.value.id))!.amount).toBe(133.33);
    });

    it('org admin edits an approved request (title only, form payload) and re-opens one by changing the money; finance attaches the invoice', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'a1'), approvedRequest('a1', 100, { serviceCategoryId: 'srv-1', providerId: 'prov-1', preferredPaymentMethod: 'cash', urgency: 'low' }));
        await setDoc(doc(f, 'requests', 'a2'), approvedRequest('a2', 100));
      });
      await updateExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'a1', { title: 'renamed', amount: 100, currency: 'EGP', orgId: ORG, urgency: 'low' } as any, key());
      const att = { id: 'att-2', name: 'inv.pdf', url: 'fsattach://att-2', type: 'application/pdf', size: 1, uploadedAt: 'x' };
      await updateExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 'a1', { invoiceAttachment: att as any, attachments: [att as any] }, key());
      const re = await updateExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'a2', { amount: 150.25 }, key());
      expect(re.value.status).toBe('pending');
    });

    it('legacy requests: no currency, no timeline / comments, mixed-case requester email, unrounded 0.1+0.2 amount; approve + pay with notifications on', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'leg1'), { orgId: ORG, requestNumber: 'OLD-1', status: 'pending', amount: 0.1 + 0.2, title: 'old', requesterId: 'usr-legacy', requesterName: 'Emp', requesterEmail: 'Emp@Acme.test ' });
        await setDoc(doc(f, 'requests', 'leg2'), { orgId: ORG, requestNumber: 'OLD-2', status: 'approved', amount: 291.65, title: 'old2', requesterId: EMP.uid, requesterName: 'Emp', requesterEmail: EMP.email, serviceCategoryId: 'srv-1' });
      });
      await transitionExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 'leg1', { type: 'approve', note: 'n' }, key(), notifyAll);
      await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 'leg1', { paymentMethod: 'cash', referenceNumber: 'L1', accountId: 'acc-cash' }, key(), notifyAll);
      await disburseExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'leg2', { paymentMethod: 'cash', referenceNumber: 'L2', accountId: 'acc-cash' }, key(), notifyAll);
      expect((await read('paymentAccounts', 'acc-cash'))!.currentBalance).toBe(toMoney(1000 - 0.3 - 291.65));
      expect((await read('services', 'srv-1'))!.spentAmount).toBe(291.65);
    });

    it('income request: employee files it, finance receives it (pending → disbursed) into the InstaPay; org admin receives one into a legacy wallet', async () => {
      const r = await createExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), draft({ requestType: 'income', amount: 75.75, serviceCategoryId: 'srv-income-general', providerId: 'prov-income-general' }), key(), notifyAll);
      await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), r.value.id, { paymentMethod: 'instapay', referenceNumber: 'IN-1', accountId: 'acc-insta' }, key(), notifyAll);
      expect((await read('paymentAccounts', 'acc-bank'))!.currentBalance).toBe(5075.75);
      const r2 = await createExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), draft({ requestType: 'income', amount: 10 }), key(), notifyAll);
      await disburseExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), r2.value.id, { paymentMethod: 'digital_wallet', referenceNumber: 'IN-2', accountId: 'acc-wallet-old' }, key(), notifyAll);
      expect((await read('paymentAccounts', 'acc-bank2'))!.currentBalance).toBe(3010);
    });

    it('batch disbursement: five approved requests paid one after the other from the same account (batchId), a retry is a no-op', async () => {
      const ids = ['b1', 'b2', 'b3', 'b4', 'b5'];
      await seed(async f => { for (const [i, id] of ids.entries()) await setDoc(doc(f, 'requests', id), approvedRequest(id, 10.1 * (i + 1), { serviceCategoryId: 'srv-1', providerId: 'prov-1' })); });
      for (const id of ids) {
        await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), id, { paymentMethod: 'bank_transfer', referenceNumber: id, accountId: 'acc-bank', batchId: 'batch-1' }, key(), notifyAll);
      }
      expect((await read('paymentAccounts', 'acc-bank'))!.currentBalance).toBe(toMoney(5000 - 151.5));
      expect((await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 'b1', { paymentMethod: 'bank_transfer', referenceNumber: 'b1', accountId: 'acc-bank' }, key(), notifyAll)).changed).toBe(false);
    });

    it('multi-company finance (profile elsewhere) and multi-company org admin pay requests of their second company (own services)', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'm1'), approvedRequest('m1', 33.3, { serviceCategoryId: 'srv-1', providerId: 'prov-1' }));
        await setDoc(doc(f, 'requests', 'm2'), approvedRequest('m2', 44.4, { serviceCategoryId: 'srv-1' }));
      });
      await disburseExpenseRequest(store(MULTI_FIN), actor(MULTI_FIN, 'finance', ORG), 'm1', { paymentMethod: 'instapay', referenceNumber: 'M1', accountId: 'acc-insta' }, key(), notifyAll);
      await disburseExpenseRequest(store(MULTI_ADMIN), actor(MULTI_ADMIN, 'org_admin', ORG), 'm2', { paymentMethod: 'cash', referenceNumber: 'M2', accountId: 'acc-cash' }, key(), notifyAll);
      expect((await read('services', 'srv-1'))!.spentAmount).toBe(77.7);
    });

    it('[L1] a multi-company finance member (profile in another company) pays a request on a service SHARED with its second company', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'services', 'srv-shared3'), { orgId: THIRD_ORG, orgIds: [THIRD_ORG, ORG], name: 'WE', code: 'WE', spentAmount: 0, active: true });
        await setDoc(doc(f, 'requests', 'sh1'), approvedRequest('sh1', 50, { serviceCategoryId: 'srv-shared3' }));
        await setDoc(doc(f, 'requests', 'sh2'), approvedRequest('sh2', 60, { serviceCategoryId: 'srv-shared3' }));
      });
      // the company's own finance (profile in ORG) pays one: works
      await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 'sh1', { paymentMethod: 'cash', referenceNumber: 'S1', accountId: 'acc-cash' }, key(), notifyOff);
      // the multi-company finance member pays the other one
      const res = await disburseExpenseRequest(store(MULTI_FIN), actor(MULTI_FIN, 'finance', ORG), 'sh2', { paymentMethod: 'cash', referenceNumber: 'S2', accountId: 'acc-cash' }, key(), notifyOff);
      expect(res.changed).toBe(true);
      expect((await read('services', 'srv-shared3'))!.spentAmount).toBe(110);
    });

    it('[L2] 1/3 shares: legacy request amount 1000/3 paid on a service / provider whose legacy totals are 1000/3 (old app stored raw thirds)', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'services', 'srv-third'), { orgId: ORG, name: 'Thirds', code: 'THR', spentAmount: 1000 / 3, active: true });
        await setDoc(doc(f, 'providers', 'prov-third'), { orgId: ORG, name: 'ThirdP', totalPaid: 1000 / 3, active: true });
        await setDoc(doc(f, 'requests', 't3'), approvedRequest('t3', 1000 / 3, { serviceCategoryId: 'srv-third', providerId: 'prov-third' }));
      });
      const res = await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 't3', { paymentMethod: 'bank_transfer', referenceNumber: 'T3', accountId: 'acc-bank' }, key(), notifyOff);
      expect(res.changed).toBe(true);
    });

    it('1/3 shares without legacy totals: request 1000/3 on a service with spentAmount 0 and a provider without totalPaid', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'providers', 'prov-bare'), { orgId: ORG, name: 'Bare' });
        await setDoc(doc(f, 'requests', 't4'), approvedRequest('t4', 1000 / 3, { serviceCategoryId: 'srv-1', providerId: 'prov-bare' }));
      });
      await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 't4', { paymentMethod: 'bank_transfer', referenceNumber: 'T4', accountId: 'acc-bank' }, key(), notifyOff);
      expect((await read('services', 'srv-1'))!.spentAmount).toBe(333.33);
    });

    it('owner pays from a legacy linked wallet with service + provider + outbox, and finance pays from an overdrawn-parent-free InstaPay', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'o1'), approvedRequest('o1', 99.99, { serviceCategoryId: 'srv-1', providerId: 'prov-1' })));
      const res = await disburseExpenseRequest(store(OWNER), actor(OWNER, 'super_admin'), 'o1', { paymentMethod: 'digital_wallet', referenceNumber: 'O1', accountId: 'acc-wallet-old' }, key(), notifyAll);
      expect(res.changed).toBe(true);
      expect((await read('paymentAccounts', 'acc-bank2'))!.currentBalance).toBe(2900.01);
    });
  });

  // ===========================================================================
  // Payment accounts: create / edit from both forms / delete
  // ===========================================================================
  describe('payment accounts: forms of the company hub and the treasury', () => {
    it('org admin opens every type from the treasury form (decimal opening, InstaPay linked with a balance, wallet with a stray link) and from the hub', async () => {
      const adm = store(ADMIN);
      const a = actor(ADMIN, 'org_admin', ORG);
      const base = { orgId: ORG, currency: 'EGP', active: true, totalIn: 0, totalOut: 0 };
      await createPaymentAccount(adm, a, { ...base, name: 'Cash 2', type: 'cash', accountIdentifier: 'C-2', initialBalance: 291.65, currentBalance: 291.65, description: undefined } as any, key());
      await createPaymentAccount(adm, a, { ...base, name: 'Bank 3', type: 'bank', accountIdentifier: 'EG-3', bankName: 'NBE', initialBalance: 0.1 + 0.2, currentBalance: 0.1 + 0.2 } as any, key());
      await createPaymentAccount(adm, a, { ...base, name: 'IP 3', type: 'instapay', accountIdentifier: 'ip3@instapay', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank', initialBalance: 1234.567, currentBalance: 1234.567 } as any, key());
      await createPaymentAccount(adm, a, { ...base, name: 'W 3', type: 'wallet', accountIdentifier: '0100', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank', initialBalance: 50, currentBalance: 50 } as any, key());
      // hub payload
      await createPaymentAccount(adm, a, { name: 'Hub', type: 'bank', accountIdentifier: 'HUB-1', bankName: '', currency: 'EGP', description: '', orgId: ORG, initialBalance: 0, currentBalance: 0, totalIn: 0, totalOut: 0, active: true } as any, key());
      // multi-company org admin (profile elsewhere) opens one in its second company
      await createPaymentAccount(store(MULTI_ADMIN), actor(MULTI_ADMIN, 'org_admin', ORG), { ...base, name: 'MA', type: 'cash', accountIdentifier: 'MA-1', initialBalance: 10, currentBalance: 10 } as any, key());
      // the owner opens one with a balance
      await createPaymentAccount(store(OWNER), actor(OWNER, 'super_admin'), { ...base, name: 'OW', type: 'bank', accountIdentifier: 'OW-1', initialBalance: 99.99, currentBalance: 99.99 } as any, key());
    });

    it('edits: hub form (finance / org admin) on the 4 default accounts of a new company; treasury form on InstaPay (rename, relink, unlink, relink) and legacy wallet', async () => {
      const created = await createOrganization(store(OWNER), actor(OWNER, 'super_admin'), { name: 'Zeta', code: 'ZET', currency: 'EGP', budget: 0, description: '' } as any, key());
      const z = created.value.id;
      await seed(async f => {
        await setDoc(doc(f, 'users', ADMIN.uid), { orgId: ORG, role: 'org_admin', active: true });
        await setDoc(doc(f, 'members', `${ADMIN.uid}_${z}`), { orgId: z, userId: ADMIN.uid, userEmail: ADMIN.email, role: 'org_admin', active: true });
        await setDoc(doc(f, 'members', `${FIN.uid}_${z}`), { orgId: z, userId: FIN.uid, userEmail: FIN.email, role: 'finance', active: true });
      });
      for (const id of [`vault-bank-${z}`, `vault-cash-${z}`, `vault-insta-${z}`, `vault-wallet-${z}`]) {
        const acc = (await read('paymentAccounts', id))!;
        // hub form (OrganizationsManagement handleSaveVault)
        await updatePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', z), id, {
          name: `${acc.name} *`, type: acc.type, accountIdentifier: acc.accountIdentifier, bankName: (acc.bankName || '').trim(), currency: acc.currency || 'EGP', description: (acc.description || '').trim(), orgId: z,
        }, key());
        await updatePaymentAccount(store(FIN), actor(FIN, 'finance', z), id, { name: `${acc.name} **`, type: acc.type, accountIdentifier: `${acc.accountIdentifier}-9`, bankName: 'X', currency: 'EGP', description: 'y', orgId: z }, key());
      }
      // treasury form (TreasuryManagement handleSaveAccount) on the InstaPay of ORG
      const tf = (extra: Record<string, unknown>) => ({ name: 'IP', type: 'instapay', accountIdentifier: 'acc-insta', bankName: undefined, currency: 'EGP', description: undefined, ...extra });
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-insta', tf({ parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' }) as any, key());
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-insta', tf({ parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2' }) as any, key());
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-insta', tf({ parentAccountId: '', parentAccountName: '' }) as any, key());
      await updatePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'acc-insta', tf({ parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' }) as any, key());
      // the bank was renamed since: the InstaPay is saved with the new parent name only
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-insta', tf({ parentAccountId: 'acc-bank', parentAccountName: 'Bank (renamed)' }) as any, key());
      // legacy linked wallet: renamed / number changed by finance from the treasury form (no link fields sent)
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-wallet-old', { name: 'Old wallet', type: 'wallet', accountIdentifier: '01111', bankName: undefined, currency: 'EGP', description: undefined } as any, key());
      // a standalone wallet retyped to an InstaPay linked to a bank
      await updatePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'acc-wallet', tf({ name: 'W→IP', accountIdentifier: 'acc-wallet', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2' }) as any, key());
      // deactivate / reactivate
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-cash', { active: false }, key());
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-cash', { active: true }, key());
    });

    it('account number changes (key released / claimed), legacy account without a number, legacy key in another shape', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'paymentAccounts', 'acc-nonum'), { orgId: ORG, name: 'nonum', type: 'bank', currency: 'EGP', active: true, currentBalance: 10, balance: 10 });
        await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'acc-cash')), { scope: 'account_identifier', orgId: ORG, value: 'acccash', entityCollection: 'paymentAccounts', entityId: 'acc-cash', createdAt: 'x' });
      });
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-nonum', { accountIdentifier: 'EG-NEW-1' }, key());
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-cash', { accountIdentifier: 'CASH-01' }, key());
      await updatePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'acc-cash', { accountIdentifier: 'cash 01' }, key());
      expect(await read('uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'acc-cash'))).toBeUndefined();
    });

    it('delete an empty account (org admin, owner); a legacy account without any balance field', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'paymentAccounts', 'acc-empty'), account('acc-empty', 0));
        await setDoc(doc(f, 'paymentAccounts', 'acc-bare'), { orgId: ORG, name: 'bare', type: 'cash', accountIdentifier: 'BARE', active: true });
        await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'acc-empty')), { scope: 'account_identifier', orgId: ORG, value: 'accempty', entityCollection: 'paymentAccounts', entityId: 'acc-empty' });
      });
      await deletePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'acc-empty', key());
      await deletePaymentAccount(store(OWNER), actor(OWNER, 'super_admin'), 'acc-bare', key());
      expect(await read('paymentAccounts', 'acc-empty')).toBeUndefined();
    });

    it('[L3] delete a legacy account whose balance and totals are float noise that rounds to 0 (the domain calls it empty)', async () => {
      // e.g. +0.1 +0.2 -0.3 recorded by an old version without rounding
      await seed(f => setDoc(doc(f, 'paymentAccounts', 'acc-noise'), account('acc-noise', 0.1 + 0.2 - 0.3, { initialBalance: 0, totalIn: 0, totalOut: 0 })));
      const res = await deletePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'acc-noise', key());
      expect(res.changed).toBe(true);
    });

    it('[L4] a legacy cash/bank account that still carries a parentAccountId (non-mirroring type) is retyped from the treasury form', async () => {
      await seed(f => setDoc(doc(f, 'paymentAccounts', 'acc-oddlink'), account('acc-oddlink', 100, { type: 'cash', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' })));
      const res = await updatePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'acc-oddlink', { name: 'odd', type: 'bank', accountIdentifier: 'acc-oddlink', currency: 'EGP' } as any, key());
      expect(res.changed).toBe(true);
    });

    it('detach legacy wallets: with a negative correction (bank overdrawn), with a positive one, and without correction (owner)', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'paymentAccounts', 'w-a'), account('w-a', 200.5, { type: 'wallet', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank', initialBalance: 0, totalIn: 300.75, totalOut: 100.25 }));
        await setDoc(doc(f, 'paymentAccounts', 'w-b'), account('w-b', 0, { type: 'wallet', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank', initialBalance: 0, totalIn: 0.1 + 0.2, totalOut: 50.3 }));
        await setDoc(doc(f, 'paymentAccounts', 'w-c'), account('w-c', 10, { type: 'wallet', parentAccountId: 'acc-gone', parentAccountName: 'deleted bank' }));
        await setDoc(doc(f, 'paymentAccounts', 'w-d'), account('w-d', 9000, { type: 'wallet', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2', initialBalance: 0, totalIn: 9000 }));
      });
      await detachLegacyWallet(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { walletId: 'w-a', bankCorrection: -200.5, expectedWalletTotals: { totalIn: 300.75, totalOut: 100.25 } }, key());
      await detachLegacyWallet(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { walletId: 'w-b', bankCorrection: toMoney(50.3 - (0.1 + 0.2)), expectedWalletTotals: { totalIn: 0.1 + 0.2, totalOut: 50.3 } }, key());
      await detachLegacyWallet(store(OWNER), actor(OWNER, 'super_admin'), { walletId: 'w-c', bankCorrection: 0 }, key());
      await detachLegacyWallet(store(MULTI_ADMIN), actor(MULTI_ADMIN, 'org_admin', ORG), { walletId: 'w-d', bankCorrection: -9000, expectedWalletTotals: { totalIn: 9000, totalOut: 0 } }, key());
      expect((await read('paymentAccounts', 'acc-bank2'))!.currentBalance).toBe(-6000);
      // the detached wallet keeps working standalone, the overdrawn bank still takes money in
      await adjustAccountBalance(store(FIN), actor(FIN, 'finance', ORG), { accountId: 'w-d', type: 'out', amount: 100, description: 'x' }, key());
      await adjustAccountBalance(store(FIN), actor(FIN, 'finance', ORG), { accountId: 'acc-bank2', type: 'in', amount: 0.01, description: 'x' }, key());
    });
  });

  const runSequenceShared = async (accountId: string, start: number, seedNo: number, other = 'acc-bank2') => {
    let s = seedNo;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const amt = (max: number) => Math.max(0.01, toMoney(rnd() * max));
    const fin = store(FIN);
    const a = actor(FIN, 'finance', ORG);
    let balance = toMoney(start);
    const steps: string[] = [];
    const custodies: string[] = [];
    await seed(f => setDoc(doc(f, 'visaRequests', 'vseq'), { orgId: ORG, requestNumber: 'VS', status: 'approved', totalAmount: 1e6, paidAmount: 0, remainingBalance: 1e6, payments: [], currency: 'EGP', travelerName: 'T' }));
    for (let i = 0; i < 20; i++) {
      const kind = Math.floor(rnd() * 10);
      try {
        if (kind === 0 || balance < 5) {
          const x = amt(700) + (rnd() < 0.5 ? 1 / 3 : 0); // a third: the domain rounds it
          const r = await adjustAccountBalance(fin, a, { accountId, type: 'in', amount: x, description: 's' }, key());
          balance = toMoney(balance + r.value.amount); steps.push(`in ${r.value.amount}`);
        } else if (kind === 1) {
          const x = Math.min(balance, amt(balance)); await adjustAccountBalance(fin, a, { accountId, type: 'out', amount: x, description: 's' }, key());
          balance = toMoney(balance - x); steps.push(`out ${x}`);
        } else if (kind === 2) {
          const x = Math.min(balance, amt(300)); const id = `rq-${seedNo}-${i}`;
          await seed(f => setDoc(doc(f, 'requests', id), approvedRequest(id, x, { serviceCategoryId: 'srv-1', providerId: 'prov-1' })));
          await disburseExpenseRequest(fin, a, id, { paymentMethod: 'cash', referenceNumber: id, accountId }, key(), notifyAll);
          balance = toMoney(balance - x); steps.push(`pay ${x}`);
        } else if (kind === 3) {
          const x = amt(200); const id = `inc-${seedNo}-${i}`;
          await seed(f => setDoc(doc(f, 'requests', id), approvedRequest(id, x, { status: 'pending', requestType: 'income' })));
          await disburseExpenseRequest(fin, a, id, { paymentMethod: 'cash', referenceNumber: id, accountId }, key(), notifyAll);
          balance = toMoney(balance + x); steps.push(`income ${x}`);
        } else if (kind === 4) {
          const x = Math.min(balance, amt(250)); await transferBetweenAccounts(fin, a, { fromAccountId: accountId, toAccountId: other, amount: x }, key());
          balance = toMoney(balance - x); steps.push(`transfer out ${x}`);
        } else if (kind === 5) {
          const x = amt(250); await transferBetweenAccounts(fin, a, { fromAccountId: other, toAccountId: accountId, amount: x }, key());
          balance = toMoney(balance + x); steps.push(`transfer in ${x}`);
        } else if (kind === 6) {
          const x = Math.min(balance, amt(150));
          const c = await issueCustody(fin, a, { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount: x, sourceAccountId: accountId }, key());
          custodies.push(c.value.id); balance = toMoney(balance - x); steps.push(`custody ${x}`);
          const st = Math.min(x, amt(x)); await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: c.value.id, amount: st, description: 'inv' }, key());
        } else if (kind === 7 && custodies.length) {
          const x = Math.min(balance, amt(100)); await replenishCustody(fin, a, { custodyId: custodies[custodies.length - 1], amount: x, sourceAccountId: accountId }, key());
          balance = toMoney(balance - x); steps.push(`replenish ${x}`);
        } else if (kind === 8 && custodies.length) {
          const cid = custodies.pop()!; const rem = toMoney((await read('custodies', cid))!.remainingAmount);
          if (rem > 0) { await returnCustodyRemainders(fin, a, { custodyIds: [cid], targetAccountId: accountId }, key()); balance = toMoney(balance + rem); steps.push(`return ${rem}`); }
        } else {
          const x = Math.min(balance, amt(120)); await addVisaPayment(fin, a, 'vseq', { amount: x, accountId, method: 'cash' } as any, key());
          balance = toMoney(balance - x); steps.push(`visa ${x}`);
        }
      } catch (e: any) {
        throw new Error(`step ${i + 1} (${kind}) after [${steps.join(', ')}] failed: ${e?.code || ''} ${e?.message || e}`);
      }
      const acc = (await read('paymentAccounts', accountId))!;
      expect(acc.currentBalance, `after step ${i + 1}: ${steps[steps.length - 1]}`).toBe(balance);
    }
    return steps;
  };

  // ===========================================================================
  // Movements on legacy data
  // ===========================================================================
  describe('movements on legacy accounts', () => {
    it('legacy shapes: currentBalance null + balance, totals null, only currentBalance (no balance field), int-typed totals, overdrawn in', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'paymentAccounts', 'l-null'), { orgId: ORG, name: 'n', type: 'cash', accountIdentifier: 'LN', currency: 'EGP', active: true, currentBalance: null, balance: 500, totalIn: null, totalOut: null });
        await setDoc(doc(f, 'paymentAccounts', 'l-cur'), { orgId: ORG, name: 'c', type: 'cash', accountIdentifier: 'LC', active: true, currentBalance: 400 });
        await setDoc(doc(f, 'paymentAccounts', 'l-neg'), { ...account('l-neg', -250.75), totalOut: 1250.75, initialBalance: 1000 });
        await setDoc(doc(f, 'paymentAccounts', 'l-third'), { ...account('l-third', 2000 / 3), totalIn: 1000 / 3, totalOut: 1000 / 3, initialBalance: 2000 / 3 });
      });
      const fin = store(FIN);
      const a = actor(FIN, 'finance', ORG);
      await adjustAccountBalance(fin, a, { accountId: 'l-null', type: 'out', amount: 0.01, description: 'x' }, key());
      await adjustAccountBalance(fin, a, { accountId: 'l-cur', type: 'out', amount: 399.99, description: 'x' }, key());
      await adjustAccountBalance(fin, a, { accountId: 'l-neg', type: 'in', amount: 0.75, description: 'x' }, key());
      await adjustAccountBalance(fin, a, { accountId: 'l-third', type: 'out', amount: 1000 / 3, description: 'x' }, key());
      await adjustAccountBalance(fin, a, { accountId: 'l-third', type: 'in', amount: 1000 / 3, description: 'x' }, key());
      expect((await read('paymentAccounts', 'l-cur'))!.currentBalance).toBe(0.01);
    });

    it('legacy linked wallet: in / out / custody issue / transfer out of it / visa payment from it (all mirrored on its bank)', async () => {
      const fin = store(FIN);
      const a = actor(FIN, 'finance', ORG);
      await adjustAccountBalance(fin, a, { accountId: 'acc-wallet-old', type: 'in', amount: 100.1, description: 'x' }, key());
      await adjustAccountBalance(fin, a, { accountId: 'acc-wallet-old', type: 'out', amount: 50.05, description: 'x' }, key());
      await issueCustody(fin, a, { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount: 20.2, sourceAccountId: 'acc-wallet-old' }, key());
      await transferBetweenAccounts(fin, a, { fromAccountId: 'acc-wallet-old', toAccountId: 'acc-cash', amount: 30.3 }, key());
      await transferBetweenAccounts(fin, a, { fromAccountId: 'acc-insta', toAccountId: 'acc-wallet-old', amount: 12.34 }, key());
      await seed(f => setDoc(doc(f, 'visaRequests', 'v1'), { orgId: ORG, requestNumber: 'V1', status: 'approved', totalAmount: 100, paidAmount: 0, remainingBalance: 100, payments: [], currency: 'EGP', travelerName: 'T' }));
      await addVisaPayment(fin, a, 'v1', { amount: 40, accountId: 'acc-wallet-old', method: 'digital_wallet' } as any, key());
      expect((await read('paymentAccounts', 'acc-wallet-old'))!.currentBalance).toBe(toMoney(600 + 100.1 - 50.05 - 20.2 - 30.3 + 12.34 - 40));
      expect((await read('paymentAccounts', 'acc-bank2'))!.currentBalance).toBe(toMoney(3000 + 100.1 - 50.05 - 20.2 - 30.3 + 12.34 - 40));
    });

    it('transfers between parent-linked accounts: InstaPay → InstaPay of another bank, bank → another bank\'s InstaPay, InstaPay → standalone wallet (finance, org admin, owner)', async () => {
      await transferBetweenAccounts(store(FIN), actor(FIN, 'finance', ORG), { fromAccountId: 'acc-insta', toAccountId: 'acc-insta2', amount: 0.1 + 0.2 }, key());
      await transferBetweenAccounts(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { fromAccountId: 'acc-bank', toAccountId: 'acc-insta2', amount: 1000 / 3 }, key());
      await transferBetweenAccounts(store(OWNER), actor(OWNER, 'super_admin'), { fromAccountId: 'acc-insta2', toAccountId: 'acc-wallet', amount: 291.65 }, key());
      expect((await read('paymentAccounts', 'acc-wallet'))!.currentBalance).toBe(291.65);
    });

    it('20-step random sequence of mixed movements with decimals on one legacy cash account (unrounded opening, no totals)', async () => {
      await seed(f => setDoc(doc(f, 'paymentAccounts', 'seq-1'), { orgId: ORG, name: 'seq', type: 'cash', accountIdentifier: 'SEQ', currency: 'EGP', active: true, currentBalance: 1000 / 3 + 500, balance: 1000 / 3 + 500 }));
      await runSequenceShared('seq-1', 1000 / 3 + 500, 42);
    });

    it('20-step random sequence on an InstaPay (every step mirrored on its bank)', async () => {
      await runSequenceShared('acc-insta', 5000, 7);
    });

    it('20-step random sequence on a legacy linked wallet (another seed)', async () => {
      await runSequenceShared('acc-wallet-old', 600, 99, 'acc-bank');
    });
  });

  // ===========================================================================
  // Custodies on legacy data
  // ===========================================================================
  describe('custodies: issue / settle / replenish / return, legacy shapes', () => {
    it('legacy custody without settledAmount / returnedAmount / currency / status: employee settles, finance replenishes, returns', async () => {
      await seed(f => setDoc(doc(f, 'custodies', 'c-leg'), { id: 'c-leg', orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, custodyNumber: 'OLD-C', totalAmount: 500, remainingAmount: 500, sourceAccountId: 'acc-cash', sourceAccountName: 'acc-cash' }));
      await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: 'c-leg', amount: 120.45, description: 'x' }, key());
      await replenishCustody(store(FIN), actor(FIN, 'finance', ORG), { custodyId: 'c-leg', amount: 0.1 + 0.2, sourceAccountId: 'acc-cash', notes: 'top' }, key());
      await returnCustodyRemainders(store(FIN), actor(FIN, 'finance', ORG), { custodyIds: ['c-leg'] }, key());
      expect(await read('custodies', 'c-leg')).toMatchObject({ remainingAmount: 0, status: 'settled', returnedAmount: toMoney(500 - 120.45 + 0.3) });
    });

    it('custody issued to a member invited by email (placeholder id): the holder settles with a verified email; org admin issues, multi-company admin settles', async () => {
      const c = await issueCustody(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, employeeId: 'pending-invited', employeeName: 'invited', employeeEmail: INVITED.email, amount: 300, sourceAccountId: 'acc-bank' }, key());
      await settleCustodyItem(store(INVITED), actor(INVITED, 'employee', ORG), { custodyId: c.value.id, amount: 100.1, description: 'x' }, key());
      await settleCustodyItem(store(MULTI_ADMIN), actor(MULTI_ADMIN, 'org_admin', ORG), { custodyId: c.value.id, amount: 199.9, description: 'x' }, key());
      expect((await read('custodies', c.value.id))!.status).toBe('settled');
    });

    it('multi-company employee holds a custody in its second company and settles it; multi-company finance replenishes and returns it', async () => {
      await seed(f => setDoc(doc(f, 'custodies', 'c-me'), custody('c-me', { employeeId: MULTI_EMP.uid, employeeEmail: MULTI_EMP.email })));
      await settleCustodyItem(store(MULTI_EMP), actor(MULTI_EMP, 'employee', ORG), { custodyId: 'c-me', amount: 10, description: 'x' }, key());
      await replenishCustody(store(MULTI_FIN), actor(MULTI_FIN, 'finance', ORG), { custodyId: 'c-me', amount: 10, sourceAccountId: 'acc-insta' }, key());
      await returnCustodyRemainders(store(MULTI_FIN), actor(MULTI_FIN, 'finance', ORG), { custodyIds: ['c-me'], targetAccountId: 'acc-insta' }, key());
    });

    it('over-settled / negative-remaining legacy custodies are replenished; a custody with a legacy status value is settled', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'custodies', 'c-neg'), custody('c-neg', { remainingAmount: -200, settledAmount: 1200, status: 'settled' }));
        await setDoc(doc(f, 'custodies', 'c-odd'), custody('c-odd', { status: 'open' }));
      });
      await replenishCustody(store(FIN), actor(FIN, 'finance', ORG), { custodyId: 'c-neg', amount: 500, sourceAccountId: 'acc-bank' }, key());
      expect(await read('custodies', 'c-neg')).toMatchObject({ remainingAmount: 300, totalAmount: 1500, status: 'active' });
      await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: 'c-odd', amount: 10, description: 'x' }, key());
      await settleCustodyItem(store(FIN), actor(FIN, 'finance', ORG), { custodyId: 'c-odd', amount: 990, description: 'x' }, key());
    });

    it('[L5] 1/3 shares: legacy custody total 1000/3 with 2/3·100 settled (old raw values) is replenished', async () => {
      await seed(f => setDoc(doc(f, 'custodies', 'c-third'), custody('c-third', { totalAmount: 1000 / 3, settledAmount: 200 / 3, remainingAmount: 1000 / 3 - 200 / 3 })));
      const res = await replenishCustody(store(FIN), actor(FIN, 'finance', ORG), { custodyId: 'c-third', amount: 10, sourceAccountId: 'acc-bank' }, key());
      expect(res.changed).toBe(true);
    });

    it('[L5] 1/3 shares: the holder files an invoice on a legacy custody total 1000/3 with 200/3 settled (old raw values)', async () => {
      await seed(f => setDoc(doc(f, 'custodies', 'c-third2'), custody('c-third2', { totalAmount: 1000 / 3, settledAmount: 200 / 3, remainingAmount: 800 / 3 })));
      const res = await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: 'c-third2', amount: 10, description: 'x' }, key());
      expect(res.changed).toBe(true);
    });

    it('1/3 shares: settle and return legacy custodies with raw thirds', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'custodies', 'c-t1'), custody('c-t1', { totalAmount: 1000, settledAmount: 1000 / 3, remainingAmount: 2000 / 3 }));
        await setDoc(doc(f, 'custodies', 'c-t2'), custody('c-t2', { totalAmount: 1000 / 3, settledAmount: 0, remainingAmount: 1000 / 3 }));
      });
      await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: 'c-t1', amount: 100, description: 'x' }, key());
      await settleCustodyItem(store(FIN), actor(FIN, 'finance', ORG), { custodyId: 'c-t2', amount: 1000 / 3, description: 'x' }, key());
      await returnCustodyRemainders(store(FIN), actor(FIN, 'finance', ORG), { custodyIds: ['c-t1'] }, key());
    });

    it('bulk return: custodies from different source accounts (no target), and into one chosen account, mixed with already-empty ones', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'custodies', 'r1'), custody('r1', { remainingAmount: 10.1, settledAmount: 989.9 }));
        await setDoc(doc(f, 'custodies', 'r2'), custody('r2', { sourceAccountId: 'acc-insta', remainingAmount: 20.2, settledAmount: 979.8 }));
        await setDoc(doc(f, 'custodies', 'r3'), custody('r3', { sourceAccountId: 'acc-wallet-old', remainingAmount: 30.3, settledAmount: 969.7 }));
        await setDoc(doc(f, 'custodies', 'r4'), custody('r4', { remainingAmount: 0, settledAmount: 1000, status: 'settled' }));
        await setDoc(doc(f, 'custodies', 'r5'), custody('r5', { remainingAmount: 1000 / 3 }));
        await setDoc(doc(f, 'custodies', 'r6'), custody('r6', { remainingAmount: 0.1 + 0.2, sourceAccountId: 'acc-insta' }));
      });
      const res = await returnCustodyRemainders(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { custodyIds: ['r1', 'r2', 'r3', 'r4'] }, key());
      expect(res.value.totalReturned).toBe(60.6);
      await returnCustodyRemainders(store(OWNER), actor(OWNER, 'super_admin'), { custodyIds: ['r5', 'r6'], targetAccountId: 'acc-insta2' }, key());
    });
  });

  // ===========================================================================
  // Visas
  // ===========================================================================
  describe('visas', () => {
    it('employee files, finance approves, pays partially from an InstaPay and fully without an account, edits; org admin deletes an unpaid one', async () => {
      const v = await createVisaRequest(store(EMP), actor(EMP, 'employee', ORG), { orgId: ORG, requesterId: EMP.uid, requesterName: 'e', travelerName: 'T', passportNumber: 'P', destinationCountry: 'X', totalAmount: 1000 / 3, currency: 'EGP', serviceProviderName: 'SP' } as any, key());
      await decideVisaRequest(store(FIN), actor(FIN, 'finance', ORG), v.value.id, { type: 'approve' }, key());
      await addVisaPayment(store(FIN), actor(FIN, 'finance', ORG), v.value.id, { amount: 100.1, accountId: 'acc-insta', method: 'instapay' } as any, key());
      await addVisaPayment(store(MULTI_FIN), actor(MULTI_FIN, 'finance', ORG), v.value.id, { amount: 233.23, method: 'cash' } as any, key());
      await updateVisaRequest(store(FIN), actor(FIN, 'finance', ORG), v.value.id, { travelerName: 'T2', notes: 'n' } as any);
      const v2 = await createVisaRequest(store(DE), actor(DE, 'data_entry', ORG), { orgId: ORG, requesterId: DE.uid, requesterName: 'd', travelerName: 'U', passportNumber: 'P', totalAmount: 50, currency: 'EGP', serviceProviderName: 'SP' } as any, key());
      await decideVisaRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), v2.value.id, { type: 'reject', reason: 'no' }, key());
      await deleteVisaRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), v2.value.id, key());
      expect((await read('visaRequests', v.value.id))!.status).toBe('paid');
    });
  });

  // ===========================================================================
  // Directory: services / providers / departments
  // ===========================================================================
  describe('directory as each role (whole-object form payloads)', () => {
    it('org admin creates and edits a service (whole object incl. stale spentAmount); finance edits it; deactivation of a used one; data entry adds providers / departments', async () => {
      const adm = store(ADMIN);
      const a = actor(ADMIN, 'org_admin', ORG);
      const svc = await createEntity(adm, a, 'service', (id: string) => ({ id, orgId: ORG, name: 'Ads', code: 'ADS', budgetLimit: 1000, spentAmount: 0 } as any), () => 'x', key());
      await seed(f => setDoc(doc(f, 'requests', 'sv'), approvedRequest('sv', 10, { serviceCategoryId: svc.value.id })));
      await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 'sv', { paymentMethod: 'cash', referenceNumber: 'SV', accountId: 'acc-cash' }, key(), notifyOff);
      // ServicesManagement: updateService({ ...editingService, ...details }) with the object loaded BEFORE the payment
      await updateEntity(adm, a, 'service', svc.value.id, { ...svc.value, name: 'Ads 2', budgetLimit: 2000 } as any, () => ({ actionType: 'update', details: 'x' }), key());
      await updateEntity(store(FIN), actor(FIN, 'finance', ORG), 'service', svc.value.id, { ...svc.value, code: 'ADS-2', active: true } as any, () => ({ actionType: 'update', details: 'x' }), key());
      expect((await deleteEntity(adm, a, 'service', svc.value.id, 'delete', key())).removal).toBe('deactivated');
      // reactivate (updateService({ ...srv, active: true }))
      await updateEntity(adm, a, 'service', svc.value.id, { ...(await read('services', svc.value.id)), id: svc.value.id, active: true } as any, () => ({ actionType: 'update', details: 'x' }), key());
      // providers: data entry adds (single + several companies it belongs to); finance edits with the whole (stale) object
      const p = await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', (id: string) => ({ id, orgId: ORG, name: 'Orange', phone: '1', totalPaid: 0, active: true } as any), () => 'x', key());
      await updateEntity(store(FIN), actor(FIN, 'finance', ORG), 'provider', p.value.id, { ...p.value, totalPaid: 0, phone: '2' } as any, () => ({ actionType: 'update', details: 'x' }), key());
      await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'department', (id: string, nowIso: string) => ({ id, orgId: ORG, name: 'IT', createdAt: nowIso } as any), () => 'x', key());
      await createEntityInOrgs(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', [ORG], (id: string, orgId: string) => ({ id, orgId, name: 'Etisalat', totalPaid: 0, active: true } as any), () => 'x', key());
      // provider rename by org admin, delete an unused one, deactivate a paid one (prov-1, totalPaid 500)
      await updateEntity(adm, a, 'provider', p.value.id, { name: 'Orange EG' } as any, () => ({ actionType: 'rename', details: 'x' }), key());
      expect((await deleteEntity(adm, a, 'provider', p.value.id, 'delete', key())).removal).toBe('deleted');
      expect((await deleteEntity(adm, a, 'provider', 'prov-1', 'delete', key())).removal).toBe('deactivated');
    });

    it('services shared by the owner: owner edits / re-shares; the owning company\'s org admin edits the shared service (orgIds unchanged)', async () => {
      await seed(f => setDoc(doc(f, 'services', 'srv-sh'), { orgId: ORG, orgIds: [ORG, OTHER_ORG], name: 'Shared', code: 'SH', spentAmount: 12.5, active: true }));
      const cur = (await read('services', 'srv-sh'))!;
      await updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'service', 'srv-sh', { ...cur, id: 'srv-sh', name: 'Shared 2' } as any, () => ({ actionType: 'update', details: 'x' }), key());
      await updateEntity(store(OWNER), actor(OWNER, 'super_admin'), 'service', 'srv-sh', { orgIds: [ORG, OTHER_ORG, THIRD_ORG] } as any, () => ({ actionType: 'update', details: 'x' }), key());
    });

    it('legacy service / provider / department without counters, active flag or key: edited, renamed, removed', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'services', 'srv-old'), { orgId: ORG, name: 'Old', code: '' });
        await setDoc(doc(f, 'providers', 'prov-old'), { orgId: ORG, name: 'OldP' });
        await setDoc(doc(f, 'departments', 'dept-old'), { orgId: ORG, name: 'OldD' });
      });
      const adm = store(ADMIN);
      const a = actor(ADMIN, 'org_admin', ORG);
      await updateEntity(adm, a, 'service', 'srv-old', { name: 'Old', code: 'OLD-1', active: true, orgIds: [] } as any, () => ({ actionType: 'update', details: 'x' }), key());
      await updateEntity(store(FIN), actor(FIN, 'finance', ORG), 'provider', 'prov-old', { name: 'Old Provider', active: true, serviceCategoryIds: [] } as any, () => ({ actionType: 'rename', details: 'x' }), key());
      await updateEntity(adm, a, 'department', 'dept-old', { name: 'Old Dept', managerName: 'm' } as any, () => ({ actionType: 'rename', details: 'x' }), key());
      expect((await deleteEntity(adm, a, 'department', 'dept-old', 'delete', key())).removal).toBe('deleted');
      expect((await deleteEntity(adm, a, 'service', 'srv-old', 'delete', key())).removal).toBe('deleted');
    });
  });

  // ===========================================================================
  // Organizations, members
  // ===========================================================================
  describe('organizations and members', () => {
    it('owner creates companies (USD, Arabic code → generated id), archives one with money, deletes an empty one', async () => {
      const owner = actor(OWNER, 'super_admin');
      const usd = await createOrganization(store(OWNER), owner, { name: 'Dollar Co', code: 'USD1', currency: 'USD', budget: 1000.5, description: '' } as any, key());
      const ar = await createOrganization(store(OWNER), owner, { name: 'شركة', code: 'شرك', currency: 'EGP', budget: 0, description: '' } as any, key());
      expect(ar.changed).toBe(true);
      await adjustAccountBalance(store(OWNER), owner, { accountId: `vault-cash-${usd.value.id}`, type: 'in', amount: 10, description: 'x' }, key());
      expect((await removeOrganization(store(OWNER), owner, usd.value.id, 'delete', key())).mode).toBe('archive');
      expect((await removeOrganization(store(OWNER), owner, ar.value.id, 'delete', key())).mode).toBe('delete');
    });

    it('[L6] the owner edits a legacy company without a currency field (and with money) from the company form', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'organizations', 'org-leg'), { name: 'Legacy', code: 'LEG', notificationRecipients: [] });
        await setDoc(doc(f, 'paymentAccounts', 'vault-cash-org-leg'), { ...account('vault-cash-org-leg', 250), orgId: 'org-leg' });
      });
      // OrganizationsManagement.handleSaveEditOrg: currency = org.currency || 'EGP'
      const res = await updateOrganization(store(OWNER), actor(OWNER, 'super_admin'), 'org-leg',
        { name: 'Legacy 2', code: 'LEG', currency: 'EGP', budget: 0, description: '' }, key(), new Date(), ['vault-cash-org-leg']);
      expect(res.changed).toBe(true);
    });

    it('owner edits a normal company; org admin initializes the recipient list; org admin adds, re-roles and removes members (profiles kept in step)', async () => {
      await updateOrganization(store(OWNER), actor(OWNER, 'super_admin'), ORG, { name: 'Acme 2', code: 'ACME', currency: 'EGP', budget: 5, description: 'd' }, key());
      await seed(f => setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP' }));
      await ensureOrgNotificationRecipients(store(MULTI_ADMIN), actor(MULTI_ADMIN, 'org_admin', ORG), ORG, []).catch(() => null); // already initialized: no-op
      const adm = store(ADMIN);
      const a = actor(ADMIN, 'org_admin', ORG);
      const NEWU = { uid: 'uidNewUser0000000000000001', email: 'new@acme.test' };
      const m = await createMember(adm, a, { orgId: ORG, userId: NEWU.uid, userEmail: NEWU.email, userName: 'New', role: 'employee', jobTitle: 'j', department: 'd', active: true } as any, key(), { writeUserProfile: true });
      await updateMemberRecord(adm, a, m.value.id, { role: 'org_admin', userName: 'New', userEmail: NEWU.email, orgId: ORG, active: true } as any, [NEWU.uid], key());
      expect((await read('organizations', ORG))!.notificationRecipients).toContain(NEWU.email);
      await updateMemberRecord(adm, a, m.value.id, { role: 'finance' } as any, [NEWU.uid], key());
      await removeMember(adm, a, m.value.id, [NEWU.uid], key());
      expect((await read('users', NEWU.uid))!.orgId).toBe('');
      // invited by email, then the profile links itself on first sign-in
      await createMember(adm, a, { orgId: ORG, userEmail: 'later@acme.test', userName: 'Later', role: 'finance', jobTitle: 'j', department: 'd' } as any, key());
    });
  });

  // ===========================================================================
  // Legacy local-data recovery
  // ===========================================================================
  describe('legacy recovery restores', () => {
    const rec = (collection: string, id: string, data: Record<string, unknown>): LegacyRecord =>
      ({ store: LEGACY_STORES.find(s => s.collection === collection)!, id, data: { id, ...data }, title: id });

    it('org admin restores a member\'s pending request, a service, a provider and a department; an employee restores its own pending request and visa; the owner restores a used service', async () => {
      const adminCtx = { actor: actor(ADMIN, 'org_admin', ORG), orgId: ORG };
      const out = [
        await restoreRecord(store(ADMIN), adminCtx, rec('requests', 'req-old-1', { orgId: ORG, status: 'pending', amount: 291.65, requesterId: EMP.uid, requesterEmail: EMP.email, title: 'x' }), 'file'),
        await restoreRecord(store(ADMIN), adminCtx, rec('services', 'srv-old-1', { orgId: ORG, name: 'S', code: 'S-OLD', spentAmount: 0 }), 'file'),
        await restoreRecord(store(ADMIN), adminCtx, rec('providers', 'prov-old-1', { orgId: ORG, name: 'P-old' }), 'file'),
        await restoreRecord(store(ADMIN), adminCtx, rec('departments', 'dept-old-1', { orgId: ORG, name: 'D-old' }), 'file'),
      ];
      const empCtx = { actor: actor(EMP, 'employee', ORG), orgId: ORG };
      out.push(await restoreRecord(store(EMP), empCtx, rec('requests', 'req-old-2', { orgId: ORG, status: 'pending', amount: 1000 / 3, requesterId: EMP.uid, title: 'y' }), 'browser'));
      out.push(await restoreRecord(store(EMP), empCtx, rec('visaRequests', 'visa-old-1', { orgId: ORG, status: 'pending', totalAmount: 10, requesterId: EMP.uid }), 'browser'));
      out.push(await restoreRecord(store(OWNER), { actor: actor(OWNER, 'super_admin'), orgId: '' }, rec('services', 'srv-old-2', { orgId: ORG, name: 'S2', code: 'S2', spentAmount: 120.5 }), 'file'));
      expect(out.map(o => `${o.record.id}:${o.outcome}${o.error ? ` ${o.error}` : ''}`)).toEqual(out.map(o => `${o.record.id}:restored`));
    });
  });

  // ===========================================================================
  // Extra probes (isolations of the findings above, more legacy shapes, more seeds)
  // ===========================================================================
  describe('extra probes', () => {
    it('[L2] (service only) legacy spentAmount 1000/3, request 1000/3', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'services', 'srv-third'), { orgId: ORG, name: 'Thirds', code: 'THR', spentAmount: 1000 / 3, active: true });
        await setDoc(doc(f, 'requests', 't5'), approvedRequest('t5', 1000 / 3, { serviceCategoryId: 'srv-third' }));
      });
      const res = await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 't5', { paymentMethod: 'cash', referenceNumber: 'T5', accountId: 'acc-bank' }, key(), notifyOff);
      expect(res.changed).toBe(true);
    });

    it('[L2] (provider only) legacy totalPaid 2000/3, request 2000/3', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'providers', 'prov-third'), { orgId: ORG, name: 'ThirdP', totalPaid: 2000 / 3, active: true });
        await setDoc(doc(f, 'requests', 't6'), approvedRequest('t6', 2000 / 3, { providerId: 'prov-third' }));
      });
      const res = await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 't6', { paymentMethod: 'cash', referenceNumber: 'T6', accountId: 'acc-bank' }, key(), notifyOff);
      expect(res.changed).toBe(true);
    });

    it('InstaPay whose bank was deleted (parent missing) moves alone; an account without a type field moves and is edited', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'paymentAccounts', 'ip-orphan'), account('ip-orphan', 100, { type: 'instapay', parentAccountId: 'acc-deleted', parentAccountName: 'gone' }));
        await setDoc(doc(f, 'paymentAccounts', 'acc-notype'), { orgId: ORG, name: 'nt', accountIdentifier: 'NT', active: true, currentBalance: 50, balance: 50 });
      });
      await adjustAccountBalance(store(FIN), actor(FIN, 'finance', ORG), { accountId: 'ip-orphan', type: 'out', amount: 10, description: 'x' }, key());
      await adjustAccountBalance(store(FIN), actor(FIN, 'finance', ORG), { accountId: 'acc-notype', type: 'out', amount: 10, description: 'x' }, key());
      await updatePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'acc-notype', { name: 'nt2', type: 'cash', accountIdentifier: 'NT', bankName: '', currency: 'EGP', description: '', orgId: ORG } as any, key());
      // the treasury form relinks the orphan InstaPay to an existing bank
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'ip-orphan', { name: 'ip', type: 'instapay', accountIdentifier: 'ip-orphan', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank', currency: 'EGP' } as any, key());
    });

    it('legacy request identified by the requester email only (old requesterId): the requester replies (notifications on) and edits it', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'em1'), approvedRequest('em1', 10, { status: 'clarification_requested', requesterId: 'usr-old-1', comments: [{ id: 'c1' }], timeline: [{ id: 't1' }] })));
      await transitionExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), 'em1', { type: 'reply', replyText: 'ok' }, key(), notifyAll);
      await updateExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), 'em1', { title: 'fixed' }, key());
    });

    it('legacy custody without totalAmount (remaining only) is replenished and settled; custody without employeeEmail is settled by its holder (uid)', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'custodies', 'c-nototal'), { id: 'c-nototal', orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', custodyNumber: 'X', remainingAmount: 70, status: 'active', sourceAccountId: 'acc-cash' });
      });
      await replenishCustody(store(FIN), actor(FIN, 'finance', ORG), { custodyId: 'c-nototal', amount: 30, sourceAccountId: 'acc-cash' }, key());
      await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: 'c-nototal', amount: 100, description: 'x' }, key());
      expect((await read('custodies', 'c-nototal'))!.status).toBe('settled');
    });

    for (const s of [1, 2, 3, 5, 8]) {
      it(`20-step random sequence, seed ${s}, on a cash account with an unrounded legacy opening`, async () => {
        await seed(f => setDoc(doc(f, 'paymentAccounts', 'seq-x'), { ...account('seq-x', 2000 / 3), totalIn: 1000 / 3, totalOut: 0.1 + 0.2 }));
        await runSequenceShared('seq-x', 2000 / 3, s);
      });
    }
  });

  describe('unverified (admin-provisioned password) accounts and multi-company admins', () => {
    it('an employee with an UNVERIFIED email files a request (notifications on), replies to a clarification, edits it, settles its own custody and files a visa', async () => {
      const e = store(EMP, false);
      const a = actor(EMP, 'employee', ORG);
      const r = await createExpenseRequest(e, a, draft(), key(), notifyAll);
      await transitionExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), r.value.id, { type: 'clarify', question: 'q' }, key(), notifyAll);
      await transitionExpenseRequest(e, a, r.value.id, { type: 'reply', replyText: 'a' }, key(), notifyAll);
      await updateExpenseRequest(e, a, r.value.id, { title: 'x2', amount: 1 / 3 }, key());
      await settleCustodyItem(e, a, { custodyId: 'cus-1', amount: 0.1 + 0.2, description: 'x' }, key());
      await createVisaRequest(e, a, { orgId: ORG, requesterId: EMP.uid, requesterName: 'e', travelerName: 'T', passportNumber: 'P', totalAmount: 10, currency: 'EGP', serviceProviderName: 'SP' } as any, key());
    });

    it('finance with an UNVERIFIED email does its whole job (approve, pay, move money, custody, visa)', async () => {
      const f = store(FIN, false);
      const a = actor(FIN, 'finance', ORG);
      await seed(f2 => setDoc(doc(f2, 'requests', 'u1'), approvedRequest('u1', 12.34, { status: 'pending', serviceCategoryId: 'srv-1', providerId: 'prov-1' })));
      await transitionExpenseRequest(f, a, 'u1', { type: 'approve' }, key(), notifyAll);
      await disburseExpenseRequest(f, a, 'u1', { paymentMethod: 'instapay', referenceNumber: 'U1', accountId: 'acc-insta' }, key(), notifyAll);
      await adjustAccountBalance(f, a, { accountId: 'acc-cash', type: 'in', amount: 5, description: 'x' }, key());
      await transferBetweenAccounts(f, a, { fromAccountId: 'acc-cash', toAccountId: 'acc-insta2', amount: 5 }, key());
      const c = await issueCustody(f, a, { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount: 10, sourceAccountId: 'acc-cash' }, key());
      await settleCustodyItem(f, a, { custodyId: c.value.id, amount: 1, description: 'x' }, key());
      await replenishCustody(f, a, { custodyId: c.value.id, amount: 1, sourceAccountId: 'acc-cash' }, key());
      await returnCustodyRemainders(f, a, { custodyIds: [c.value.id] }, key());
    });

    it('a multi-company org admin (profile elsewhere) manages members, services, providers, departments and accounts of its second company', async () => {
      const s = store(MULTI_ADMIN);
      const a = actor(MULTI_ADMIN, 'org_admin', ORG);
      const NEWU = { uid: 'uidNewUser0000000000000002', email: 'new2@acme.test' };
      const m = await createMember(s, a, { orgId: ORG, userId: NEWU.uid, userEmail: NEWU.email, userName: 'N2', role: 'finance', jobTitle: 'j', department: 'd' } as any, key());
      await updateMemberRecord(s, a, m.value.id, { role: 'org_admin' } as any, [], key());
      await removeMember(s, a, m.value.id, [], key());
      const svc = await createEntity(s, a, 'service', (id: string) => ({ id, orgId: ORG, name: 'MA svc', code: 'MAS', spentAmount: 0 } as any), () => 'x', key());
      await updateEntity(s, a, 'service', svc.value.id, { name: 'MA svc 2' } as any, () => ({ actionType: 'rename', details: 'x' }), key());
      await createEntity(s, a, 'provider', (id: string) => ({ id, orgId: ORG, name: 'MA prov', totalPaid: 0, active: true } as any), () => 'x', key());
      const d = await createEntity(s, a, 'department', (id: string, nowIso: string) => ({ id, orgId: ORG, name: 'MA dept', createdAt: nowIso } as any), () => 'x', key());
      await updateEntity(s, a, 'department', d.value.id, { name: 'MA dept 2' } as any, () => ({ actionType: 'rename', details: 'x' }), key());
      await updatePaymentAccount(s, a, 'acc-cash', { name: 'renamed by MA', accountIdentifier: 'MA-CASH' }, key());
      await adjustAccountBalance(s, a, { accountId: 'acc-cash', type: 'out', amount: 0.01, description: 'x' }, key());
    });
  });
});
