/**
 * Adversarial and legitimacy suite for firestore.rules (rules-spec-v1, rounds r1 to r5).
 *
 * An attacker uses the raw Firestore Web SDK with their own credentials (single writes,
 * batches, transactions, chosen ids, fields the domain never writes); every legitimate
 * operation goes through the REAL domain functions (src/domain/*) as the role the UI
 * allows, on realistic and legacy data.
 *
 * A test whose name carries a finding id ([RQ-n], [AG-n], [CUS-n], [O1], [U1], [M1], [C1],
 * [A1], [L1]...) reproduces that round-r1 finding and asserts the now-correct outcome
 * (the attack is refused / the legitimate operation works); [TEN2-n] and [R2-xx] do the same
 * for the round-r2 findings (tenancy lane / legitimacy lane). "[known, accepted]" tests
 * document a behaviour that is deliberately NOT enforced by the rules (see the commit
 * message / spec §11). Every other test is coverage.
 *
 * Sections (each seeds its own data): requests and counters, custodies, tenancy and
 * identity, legitimate operations, round r2 (tenancy lane, legitimacy lane), round r3 lanes,
 * round r4 (identity lane [R4-In], login lane [LOGIN-n]), round r5 (login lane [R5-L-n]).
 */
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, limit, or, query, runTransaction, setDoc, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
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
  companySwitchChoices,
  detachOrphanProfiles,
  isRealUid,
  knownLoginUidOf,
  orphanProfiles,
  pendingUserIdForEmail,
  profileMembershipState,
  removeMember,
  removeOrganization,
  switchableMemberships,
  syncOwnMembership,
  updateEntity,
  updateMemberRecord,
  updateOrganization,
  verifiedLoginUidOf,
} from '../src/domain/directory';
import { addVisaPayment, createVisaRequest, decideVisaRequest, deleteVisaRequest, updateVisaRequest } from '../src/domain/visa';
import { LEGACY_STORES, restoreBlock, restoreRecord, type LegacyRecord } from '../src/domain/legacyRecovery';
import { isDomainError, normalizeEmail, normalizeKeyValue, normalizeKeyValueV1, toMoney, uniqueKeyDocId, uniqueKeyDocIdV1, type Actor } from '../src/domain/common';
import type { OrganizationMember, Role } from '../src/types';
import { can } from '../src/utils/permissions';
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
  // R3_RULES=<path>: another rules file (a padded copy, to measure expression margins; see the round r3 money lane)
  env = await initializeTestEnvironment({ projectId: 'demo-expenses-rules', firestore: { rules: readFileSync(process.env.R3_RULES || 'firestore.rules', 'utf8'), host, port: Number(port) } });
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
      await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('member_email', ORG, EMP.email)), { scope: 'member_email', orgId: ORG, value: 'emp@acme.test', entityCollection: 'members', entityId: `${EMP.uid}_${ORG}` });
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
      // (round 4, R4-I4: refused like an existing one, so the answer tells nothing; the owner reads it)
      await assertFails(getDoc(doc(db(STRANGER), 'organizations', 'org-missing')));
      await assertSucceeds(getDoc(doc(db(OWNER), 'organizations', 'org-missing')));
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

// =============================================================================
// Round r2. [TEN2-n]: tenancy lane; [R2-xx]: legitimacy lane. Each section seeds its own data.
// =============================================================================
describe('round r2: identity, audit ids, restore markers, keys (tenancy lane)', () => {
  const SUSP_ADMIN = { uid: 'uidSuspAdmin0000000000001', email: 'sadmin@acme.test' };
  const CFO = { uid: 'uidCfoAccount000000000001', email: 'cfo@acme.test' };   // a real person of ORG, verified
  const VICTIM_EMAIL = 'cfo@other.test';                                     // not registered anywhere yet
  const verifiedEmailVia = (f: Firestore) => async (uid: string) => {
    const snap = await getDoc(doc(f, 'users', uid));
    return snap.exists() ? (snap.data()?.verifiedEmail ?? null) : null;
  };
  const allMembers = async (f: Firestore) => (await getDocs(collection(f, 'members'))).docs.map(d => ({ id: d.id, ...d.data() } as any));
  const rec = (c: string, id: string, data: Record<string, unknown>): LegacyRecord =>
    ({ store: LEGACY_STORES.find(s => s.collection === c)!, id, data: { id, ...data }, title: id });

  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [ADMIN.email], createdAt: '2026-01-01' });
      await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [CAIRO_ADMIN.email], createdAt: '2026-01-01' });
      await setDoc(doc(f, 'organizations', THIRD_ORG), { id: THIRD_ORG, name: 'Third', code: 'TRD', currency: 'EGP', notificationRecipients: [], createdAt: '2026-01-01' });
      for (const [u, role, org] of [[ADMIN, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [DE, 'data_entry', ORG], [CFO, 'employee', ORG],
        [CAIRO_FIN, 'finance', OTHER_ORG], [CAIRO_ADMIN, 'org_admin', OTHER_ORG], [CAIRO_EMP, 'employee', OTHER_ORG]] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true, email: u.email, memberId: `${u.uid}_${org}` });
        await setDoc(doc(f, 'members', `${u.uid}_${org}`), { orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      for (const [u, role] of [[MULTI_FIN, 'finance'], [MULTI_ADMIN, 'org_admin']] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: OTHER_ORG, role: 'employee', active: true, email: u.email, memberId: `${u.uid}_${OTHER_ORG}` });
        await setDoc(doc(f, 'members', `${u.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: u.uid, userEmail: u.email, role: 'employee', active: true, userName: u.email });
        await setDoc(doc(f, 'members', `${u.uid}_${ORG}`), { orgId: ORG, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      for (const [u, role] of [[SUSP_FIN, 'finance'], [SUSP_ADMIN, 'org_admin']] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: ORG, role, active: false, email: u.email, memberId: `${u.uid}_${ORG}` });
        await setDoc(doc(f, 'members', `${u.uid}_${ORG}`), { orgId: ORG, userId: u.uid, userEmail: u.email, role, active: false, userName: u.email });
      }

      await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), account('acc-cash', 1000, { accountIdentifier: 'EG001' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank'), account('acc-bank', 5000, { type: 'bank', accountIdentifier: 'EG777' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-ob'), account('acc-ob', 9000, { orgId: OTHER_ORG, type: 'bank', accountIdentifier: 'OB1' }));
      await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0 });
      await setDoc(doc(f, 'providers', 'prov-1'), { orgId: ORG, name: 'Vodafone', totalPaid: 0, active: true });
      await setDoc(doc(f, 'providers', 'prov-k'), { orgId: ORG, name: 'Kodak', totalPaid: 0, active: true });
      await setDoc(doc(f, 'departments', 'dept-1'), { orgId: ORG, name: 'IT' });
      await setDoc(doc(f, 'requests', 'r-pay'), approvedRequest('r-pay', 100));

      const k = (scope: any, org: string, v: string, coll: string, id: string) =>
        setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId(scope, org, v)), { scope, orgId: org, value: normalizeKeyValue(v, scope), entityCollection: coll, entityId: id });
      await k('account_identifier', ORG, 'EG001', 'paymentAccounts', 'acc-cash');
      await k('account_identifier', ORG, 'EG777', 'paymentAccounts', 'acc-bank');
      await k('provider_name', ORG, 'Vodafone', 'providers', 'prov-1');
      await k('provider_name', ORG, 'Kodak', 'providers', 'prov-k');
      await k('service_code', ORG, 'CLD', 'services', 'srv-1');
      await k('department_name', ORG, 'IT', 'departments', 'dept-1');
      await k('member_email', ORG, EMP.email, 'members', `${EMP.uid}_${ORG}`);
      await k('account_identifier', OTHER_ORG, 'OB1', 'paymentAccounts', 'acc-ob');
    });
  });

  describe('findings', () => {
    it('[TEN2-1] a membership pairing an account with someone else\'s email is only a claim: adding that email to another company links nobody, the attacker gets nothing there', async () => {
      // ORG's admin pairs an account it controls with the email of a person about to join OTHER_ORG.
      // Granting ORG access to any account is the org admin's call, so the write itself is allowed.
      await assertSucceeds(setDoc(doc(db(ADMIN), 'members', `${STRANGER.uid}_${ORG}`), {
        orgId: ORG, userId: STRANGER.uid, userEmail: VICTIM_EMAIL, userName: 'CFO', role: 'employee', active: true,
      }));
      const owner = db(OWNER);
      const forVictim = (await allMembers(owner)).filter(m => normalizeEmail(m.userEmail) === VICTIM_EMAIL);
      expect(knownLoginUidOf(forVictim)).toBe(STRANGER.uid);                            // the claim exists ...
      const proven = await verifiedLoginUidOf(forVictim, VICTIM_EMAIL, verifiedEmailVia(owner));
      expect(proven).toBe('');                                                          // ... but proves nothing
      const res = await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: proven, userName: 'CFO', userEmail: VICTIM_EMAIL, role: 'finance', department: 'Finance', jobTitle: 'CFO', active: true } as any, [OTHER_ORG], key());
      expect(res.value.created[0].userId).toMatch(/^pending-/);                         // an invitation by email
      await assertFails(getDoc(doc(db(STRANGER), 'paymentAccounts', 'acc-ob')));
      // ... which only the verified owner of the address can take
      await assertFails(setDoc(doc(db(STRANGER), 'users', STRANGER.uid), { orgId: OTHER_ORG, role: 'finance', active: true, memberId: res.value.created[0].id }));
      await assertFails(setDoc(doc(db({ uid: 'uidSquatter00000000000001', email: VICTIM_EMAIL }, false), 'users', 'uidSquatter00000000000001'),
        { orgId: OTHER_ORG, role: 'finance', active: true, memberId: res.value.created[0].id }));
    });

    it('[TEN2-1] users/{uid}.verifiedEmail is written by that account only, from its verified token', async () => {
      const a = db(ADMIN);
      await assertFails(setDoc(doc(a, 'users', STRANGER.uid), { orgId: ORG, role: 'employee', active: true, verifiedEmail: VICTIM_EMAIL }));
      // (round 4, R4-I1: a profile no membership backs is refused; planted here)
      await assertFails(setDoc(doc(a, 'users', STRANGER.uid), { orgId: ORG, role: 'employee', active: true }));
      await seed(f => setDoc(doc(f, 'users', STRANGER.uid), { orgId: ORG, role: 'employee', active: true }));
      await assertFails(updateDoc(doc(a, 'users', STRANGER.uid), { verifiedEmail: VICTIM_EMAIL }));
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { verifiedEmail: EMP.email }));
      await assertFails(updateDoc(doc(db(STRANGER), 'users', STRANGER.uid), { verifiedEmail: VICTIM_EMAIL }));
      await assertFails(updateDoc(doc(db(EMP, false), 'users', EMP.uid), { verifiedEmail: EMP.email }));   // unverified token
      await assertSucceeds(setDoc(doc(db(EMP), 'users', EMP.uid), { verifiedEmail: EMP.email }, { merge: true }));
      // once recorded, an org admin's edits of the profile keep it as it is
      await assertFails(setDoc(doc(a, 'users', EMP.uid), { orgId: ORG, role: 'employee', active: true }));      // whole set drops it
      await assertSucceeds(setDoc(doc(a, 'users', EMP.uid), { name: 'Emp' }, { merge: true }));
    });

    it('[TEN2-1] legit: a person who proved the email keeps the same login in another company; an unproven one is invited by email', async () => {
      await setDoc(doc(db(CFO), 'users', CFO.uid), { verifiedEmail: CFO.email }, { merge: true });
      const owner = db(OWNER);
      const members = await allMembers(owner);
      const uid = await verifiedLoginUidOf(members, CFO.email, verifiedEmailVia(owner));
      expect(uid).toBe(CFO.uid);
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: uid, userName: 'CFO', userEmail: CFO.email, role: 'finance', department: 'F', jobTitle: 'CFO', active: true } as any, [OTHER_ORG], key());
      await assertSucceeds(getDoc(doc(db(CFO), 'paymentAccounts', 'acc-ob')));
      // EMP never recorded a verified email (e.g. an admin-provisioned password account)
      expect(await verifiedLoginUidOf(members, EMP.email, verifiedEmailVia(owner))).toBe('');
      // an org admin reads only profiles of its own company: another company's profile proves nothing to it
      await setDoc(doc(db(CAIRO_EMP), 'users', CAIRO_EMP.uid), { verifiedEmail: CAIRO_EMP.email }, { merge: true });
      expect(await verifiedLoginUidOf(members, CAIRO_EMP.email, verifiedEmailVia(owner))).toBe(CAIRO_EMP.uid);
      expect(await verifiedLoginUidOf(members, CAIRO_EMP.email, verifiedEmailVia(db(ADMIN)))).toBe('');
    });

    it('[TEN2-1] (variant) a membership of a real login is never re-pointed to another UID; a placeholder still moves to the account linked to it', async () => {
      await assertFails(updateDoc(doc(db(ADMIN), 'members', `${EMP.uid}_${ORG}`), { userId: STRANGER.uid }));
      await assertFails(updateDoc(doc(db(ADMIN), 'members', `${EMP.uid}_${ORG}`), { userId: 'pending-x' }));
      // legit: invited by email (placeholder), the person signed in and linked its profile to it
      const pendingId = `pending-bmV3aGlyZUBhY21lLnRlc3Q_${ORG}`;
      await seed(async f => {
        await setDoc(doc(f, 'members', pendingId), { orgId: ORG, userId: `pending-bmV3aGlyZUBhY21lLnRlc3Q`, userEmail: NEWHIRE.email, role: 'employee', active: true, userName: 'NH' });
        // (linkOwnProfile writes the verified address with the link: the membership is addressed to it)
        await setDoc(doc(f, 'users', NEWHIRE.uid), { orgId: ORG, role: 'employee', active: true, memberId: pendingId, email: NEWHIRE.email });
      });
      // ... but not to an account whose profile does not link to it
      await assertFails(updateDoc(doc(db(ADMIN), 'members', pendingId), { userId: STRANGER.uid }));
      await updateMemberRecord(store(ADMIN), actor(ADMIN, 'org_admin', ORG), pendingId, { userName: 'New Hire' }, [NEWHIRE.uid], key());
      expect((await read('members', pendingId))!.userId).toBe(NEWHIRE.uid);
    });

    it('[TEN2-2] an audit entry pre-created by another company\'s member under the old payment id (audit-disburse-<id>) no longer blocks the payment', async () => {
      await assertSucceeds(setDoc(doc(db(CAIRO_EMP), 'auditLogs', 'audit-disburse-r-pay'), {
        actorId: CAIRO_EMP.uid, actorEmail: CAIRO_EMP.email, orgId: OTHER_ORG, actionType: 'update', details: 'x',
      }));
      const k = key();
      const res = await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 'r-pay', { paymentMethod: 'cash', referenceNumber: 'R1', accountId: 'acc-cash' } as any, k, notify);
      expect(res.changed).toBe(true);
      expect(await read('auditLogs', `audit-${k}-disburse`)).toMatchObject({ orgId: ORG, actorId: FIN.uid });
    });

    it('[TEN2-3] a restore marker is written only with the restore of its record, in the marker\'s company', async () => {
      const marker = (orgId: string, by: string, extra: Record<string, unknown> = {}) =>
        ({ collection: 'requests', docId: 'req-104', orgId, restoredBy: by, restoredAt: 'x', source: 'browser', ...extra });
      await assertFails(setDoc(doc(db(CAIRO_EMP), 'legacyRestores', 'requests__req-104'), marker(OTHER_ORG, CAIRO_EMP.uid)));
      await assertFails(setDoc(doc(db(CAIRO_EMP), 'legacyRestores', 'requests__req-104'), marker(ORG, CAIRO_EMP.uid)));
      await assertFails(setDoc(doc(db(ADMIN), 'legacyRestores', 'requests__req-104'), marker(ORG, ADMIN.uid)));           // no record
      await assertFails(setDoc(doc(db(ADMIN), 'legacyRestores', 'requests__req-999'), marker(ORG, ADMIN.uid)));           // id of another record
      await assertFails(setDoc(doc(db(ADMIN), 'legacyRestores', 'departments__dept-1'),                                     // record exists already
        marker(ORG, ADMIN.uid, { collection: 'departments', docId: 'dept-1' })));
      await assertFails(setDoc(doc(db(ADMIN), 'legacyRestores', 'paymentAccounts__acc-x'),                                  // not restorable
        marker(ORG, ADMIN.uid, { collection: 'paymentAccounts', docId: 'acc-x' })));
      const a = db(ADMIN);
      // a record of another company created in the same commit does not carry ORG's marker either
      await assertFails(writeBatch(a)
        .set(doc(a, 'departments', 'dept-r'), { id: 'dept-r', orgId: ORG, name: 'Restored' })
        .set(doc(a, 'legacyRestores', 'departments__dept-r'), marker(OTHER_ORG, ADMIN.uid, { collection: 'departments', docId: 'dept-r' }))
        .commit());
      await assertSucceeds(writeBatch(a)
        .set(doc(a, 'departments', 'dept-r'), { id: 'dept-r', orgId: ORG, name: 'Restored' })
        .set(doc(a, 'legacyRestores', 'departments__dept-r'), marker(ORG, ADMIN.uid, { collection: 'departments', docId: 'dept-r' }))
        .commit());
      // markers are permanent for everyone but the platform owner (who clears a stale one)
      await assertFails(deleteDoc(doc(a, 'legacyRestores', 'departments__dept-r')));
      await assertSucceeds(deleteDoc(doc(db(OWNER), 'legacyRestores', 'departments__dept-r')));
    });

    it('[TEN2-3] another company\'s member can no longer pre-block a restore (marker or old-format audit id): the org admin restores both records', async () => {
      await setDoc(doc(db(CAIRO_EMP), 'legacyRestores', 'requests__req-104'), { orgId: OTHER_ORG, restoredBy: CAIRO_EMP.uid }).catch(() => undefined);
      await assertSucceeds(setDoc(doc(db(CAIRO_EMP), 'auditLogs', 'audit-restore-requests__req-105'),
        { actorId: CAIRO_EMP.uid, actorEmail: CAIRO_EMP.email, orgId: OTHER_ORG, actionType: 'create', details: 'x' }));
      const ctx = { actor: actor(ADMIN, 'org_admin', ORG), orgId: ORG };
      const a = await restoreRecord(store(ADMIN), ctx, rec('requests', 'req-104', { orgId: ORG, status: 'pending', amount: 10, requesterId: EMP.uid, requesterEmail: EMP.email, title: 'x' }), 'file');
      const b = await restoreRecord(store(ADMIN), ctx, rec('requests', 'req-105', { orgId: ORG, status: 'pending', amount: 10, requesterId: EMP.uid, requesterEmail: EMP.email, title: 'x' }), 'file');
      expect([a.outcome, b.outcome]).toEqual(['restored', 'restored']);
      // a second attempt is "handled" (its marker), never a second record or audit entry
      expect((await restoreRecord(store(ADMIN), ctx, rec('requests', 'req-104', { orgId: ORG, status: 'pending', amount: 10, requesterId: EMP.uid, title: 'x' }), 'file')).outcome).toBe('handled');
    });

    it('[TEN2-4] the rules and the domain agree on which renames keep a key: same key for the domain → never released; another key → released', async () => {
      const kProvK = uniqueKeyDocId('provider_name', ORG, 'Kodak');
      // (round 3: invisible format characters such as U+180E / U+200B are dropped too)
      const same = ['KODAK', 'Ko dak', 'K-o.d_a k', 'Kodak ', '\uFEFFKodak', 'ko\u3000DAK', 'Ko\u00A0dak', 'Ko\u2028dak', 'Ko\u000Bdak', 'Kodak\u180E', 'Ko\u200Bdak'];
      const other = ['\u212Aodak', 'Kodäk', 'KODAK2', 'Ko\u0085dak'];
      const a = db(ADMIN);
      for (const v of [...same, ...other]) {
        await seed(async f => {
          await setDoc(doc(f, 'providers', 'prov-k'), { orgId: ORG, name: 'Kodak', totalPaid: 0, active: true });
          await setDoc(doc(f, 'uniqueKeys', kProvK), { scope: 'provider_name', orgId: ORG, value: 'kodak', entityCollection: 'providers', entityId: 'prov-k' });
        });
        const release = writeBatch(a).update(doc(a, 'providers', 'prov-k'), { name: v }).delete(doc(a, 'uniqueKeys', kProvK)).commit();
        if (normalizeKeyValue(v) === 'kodak') await assertFails(release);
        else await assertSucceeds(release);
      }
      expect(same.every(v => normalizeKeyValue(v) === 'kodak')).toBe(true);
      expect(other.some(v => normalizeKeyValue(v) === 'kodak')).toBe(false);
      // non-ASCII capitals are kept as they are (case-sensitive) on both sides
      expect(normalizeKeyValue('SOCIÉTÉ')).toBe('sociÉtÉ');
      expect(normalizeKeyValue('\u212Aodak')).toBe('\u212Aodak');
    });

    it('[TEN2-4] through the domain: a Kelvin-sign "Kodak" is its own key; renaming to it claims that key, so a second one is a duplicate', async () => {
      await updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', 'prov-k', { name: '\u212Aodak' } as any, () => ({ actionType: 'rename', details: 'x' }), key());
      expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, '\u212Aodak'))).toMatchObject({ entityId: 'prov-k' });
      await expect(createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', (id: string) => ({ id, orgId: ORG, name: '\u212AODAK', totalPaid: 0, active: true } as any), () => 'x', key()))
        .rejects.toMatchObject({ code: 'duplicate' });
      // renaming "société" to "SOCIÉTÉ" moves the key (both sides see two values)
      const p = await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', (id: string) => ({ id, orgId: ORG, name: 'société', totalPaid: 0, active: true } as any), () => 'x', key());
      await updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', p.value.id, { name: 'SOCIÉTÉ' } as any, () => ({ actionType: 'rename', details: 'x' }), key());
      expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'SOCIÉTÉ'))).toMatchObject({ entityId: p.value.id });
      expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'société'))).toBeUndefined();
    });

    it('[TEN2-5] legit: data entry / org admin add and rename providers and departments whose names have non-ASCII capitals', async () => {
      for (const name of ['Électricité du Caire', 'Москва Трейд', 'Öztürk Holding', 'ΔΕΗ Hellas']) {
        const p = await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', (id: string) => ({ id, orgId: ORG, name, totalPaid: 0, active: true } as any), () => 'x', key());
        expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, name))).toMatchObject({ entityId: p.value.id });
      }
      await updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'department', 'dept-1', { name: 'Équipe IT' } as any, () => ({ actionType: 'rename', details: 'x' }), key());
      expect(await read('uniqueKeys', uniqueKeyDocId('department_name', ORG, 'Équipe IT'))).toMatchObject({ entityId: 'dept-1' });
    });

    it('[TEN2-5] (U+180E) legit: a name containing U+180E (not whitespace for JavaScript) is claimed', async () => {
      const res = await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', (id: string) => ({ id, orgId: ORG, name: 'Mon\u180Egol Trade', totalPaid: 0, active: true } as any), () => 'x', key());
      expect(res.changed).toBe(true);
    });
  });

  describe('coverage', () => {
    it('organizations: suspended org admin, an unverified stranger claiming the admin email, other companies and multi-company employees cannot edit', async () => {
      await assertFails(updateDoc(doc(db(SUSP_ADMIN), 'organizations', ORG), { name: 'x' }));
      await assertFails(updateDoc(doc(db({ uid: 'uidImpostorX0000000000001', email: ADMIN.email }, false), 'organizations', ORG), { name: 'x' }));
      await assertFails(updateDoc(doc(db(MULTI_ADMIN), 'organizations', OTHER_ORG), { name: 'x' }));   // employee in its profile company
      await assertFails(updateDoc(doc(db(CAIRO_ADMIN), 'organizations', ORG), { notificationRecipients: [CAIRO_ADMIN.email] }));
      await assertFails(setDoc(doc(db(ADMIN), 'organizations', ORG), { archived: false }, { merge: true }));   // adding a missing key is a change
      await assertSucceeds(updateDoc(doc(db(ADMIN, false), 'organizations', ORG), { description: 'd' }));  // unverified org admin: uid-based
    });

    it('organizations: org admin renames a legacy company without currency / recipients through the domain; owner changes the currency of an empty company', async () => {
      await seed(f => setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', createdAt: '2026-01-01' }));
      await updateOrganization(store(ADMIN), actor(ADMIN, 'org_admin', ORG), ORG, { name: 'Acme 2', currency: 'EGP', budget: 10 } as any, key());
      expect(await read('organizations', ORG)).toMatchObject({ name: 'Acme 2', budget: 10 });
      expect((await read('organizations', ORG))!.currency).toBeUndefined();
      await ensureOrgNotificationRecipients(store(ADMIN), actor(ADMIN, 'org_admin', ORG), ORG, [{ id: 'm', orgId: ORG, userId: ADMIN.uid, userEmail: ADMIN.email, role: 'org_admin', active: true } as any]);
      expect((await read('organizations', ORG))!.notificationRecipients).toEqual([ADMIN.email]);
      await updateOrganization(store(OWNER), actor(OWNER, 'super_admin'), THIRD_ORG, { currency: 'USD' }, key(), new Date(), []);
      expect((await read('organizations', THIRD_ORG))!.currency).toBe('USD');
      await expect(updateOrganization(store(OWNER), actor(OWNER, 'super_admin'), ORG, { currency: 'USD' }, key(), new Date(), ['acc-bank'])).rejects.toMatchObject({ code: 'currency_immutable' });
    });

    it('uniqueKeys: names with Arabic, lower-case accents, ß, ligatures, zero-width and ASCII capitals are claimed and renamed by the domain', async () => {
      for (const name of ['مؤسسة النور', 'société générale', 'Straße', 'ﬁle Co', 'Zero\u200BWidth', 'ACME Ltd']) {
        const p = await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', (id: string) => ({ id, orgId: ORG, name, totalPaid: 0, active: true } as any), () => 'x', key());
        expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, name))).toMatchObject({ entityId: p.value.id });
        await updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', p.value.id, { name: `${name} 2` } as any, () => ({ actionType: 'rename', details: 'x' }), key());
        expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, name))).toBeUndefined();
      }
    });

    it('uniqueKeys: claims by another company, suspended, stranger, wrong id encoding / scope / collection / extra parts are refused', async () => {
      const kProvK = uniqueKeyDocId('provider_name', ORG, 'Kodak');
      const good = { scope: 'provider_name', orgId: ORG, value: 'kodak', entityCollection: 'providers', entityId: 'prov-k' };
      await seed(f => deleteDoc(doc(f, 'uniqueKeys', kProvK)));    // a legacy record without its key
      for (const u of [CAIRO_ADMIN, CAIRO_EMP, SUSP_FIN, STRANGER]) await assertFails(setDoc(doc(db(u), 'uniqueKeys', kProvK), good));
      await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', `${kProvK}__x`), good));
      await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', kProvK.replace('provider_name', 'department_name')), { ...good, scope: 'department_name' }));
      await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', kProvK), { ...good, entityCollection: 'departments' }));
      await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', kProvK), { ...good, value: 'Kodak' }));
      await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', 'provider_name__org-acme__S29kYWs'), { ...good }));   // id encodes 'Kodak'
      await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', kProvK), { ...good, orgId: OTHER_ORG }));
      await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', kProvK), { ...good, entityId: 'prov-k/x/y' }));
      await assertSucceeds(setDoc(doc(db(MULTI_ADMIN), 'uniqueKeys', kProvK), good));   // multi-company admin, its second company
    });

    it('uniqueKeys: no release of another company\'s key (via ORG\'s record, by ORG staff, by a multi-company member); finance may clear a number', async () => {
      const kAcc = uniqueKeyDocId('account_identifier', ORG, 'EG001');
      const kOth = uniqueKeyDocId('account_identifier', OTHER_ORG, 'OB1');
      const fin = db(FIN);
      await assertFails(writeBatch(fin).update(doc(fin, 'paymentAccounts', 'acc-cash'), { accountIdentifier: 'EG9' }).delete(doc(fin, 'uniqueKeys', kOth)).commit());
      await assertFails(writeBatch(fin).update(doc(fin, 'paymentAccounts', 'acc-ob'), { accountIdentifier: 'OB2' }).delete(doc(fin, 'uniqueKeys', kOth)).commit());
      const m = db(MULTI_FIN);
      await assertFails(writeBatch(m).update(doc(m, 'paymentAccounts', 'acc-ob'), { accountIdentifier: 'OB2' }).delete(doc(m, 'uniqueKeys', kOth)).commit());
      await assertSucceeds(writeBatch(fin).update(doc(fin, 'paymentAccounts', 'acc-cash'), { accountIdentifier: '' }).delete(doc(fin, 'uniqueKeys', kAcc)).commit());
      expect(await read('uniqueKeys', kOth)).toBeTruthy();
    });

    it('[known, accepted] the registry is cooperative: a raw record write by a role that may edit the record does not consult it', async () => {
      // (round 3, K3-1: leaving a value requires releasing the record's own key in the same commit)
      await assertFails(updateDoc(doc(db(FIN), 'paymentAccounts', 'acc-bank'), { accountIdentifier: 'EG001' }));
      const f = db(FIN);
      await assertSucceeds(writeBatch(f).update(doc(f, 'paymentAccounts', 'acc-bank'), { accountIdentifier: 'EG001' })
        .delete(doc(f, 'uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'EG777'))).commit());
      await assertFails(updateDoc(doc(db(EMP), 'paymentAccounts', 'acc-bank'), { accountIdentifier: 'EG002' }));
      expect(await read('uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'EG001'))).toMatchObject({ entityId: 'acc-cash' });
    });

    it('uniqueKeys: finance re-numbers an account through the domain; another account takes the freed number; the old one cannot be taken twice', async () => {
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-cash', { accountIdentifier: 'EG002' }, key());
      await updatePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'acc-bank', { accountIdentifier: 'EG001' }, key());
      expect(await read('uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'EG001'))).toMatchObject({ entityId: 'acc-bank' });
      await expect(updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-cash', { accountIdentifier: 'eg-001' }, key())).rejects.toMatchObject({ code: 'duplicate' });
    });

    it('members / users: self-escalation (merge, whole set, batch with a forged membership, link to a suspended / someone else\'s grant)', async () => {
      const e = db(EMP);
      await assertFails(setDoc(doc(e, 'members', `${EMP.uid}_${ORG}`), { role: 'finance' }, { merge: true }));
      await assertFails(setDoc(doc(e, 'members', `${EMP.uid}_${ORG}`), { orgId: ORG, userId: EMP.uid, userEmail: EMP.email, role: 'org_admin', active: true, userName: 'e' }));
      await assertFails(writeBatch(e)
        .set(doc(e, 'members', `${EMP.uid}_${THIRD_ORG}`), { orgId: THIRD_ORG, userId: EMP.uid, userEmail: EMP.email, role: 'org_admin', active: true })
        .update(doc(e, 'users', EMP.uid), { orgId: THIRD_ORG, role: 'org_admin', memberId: `${EMP.uid}_${THIRD_ORG}` })
        .commit());
      await assertFails(updateDoc(doc(db(SUSP_FIN), 'users', SUSP_FIN.uid), { active: true, memberId: `${ADMIN.uid}_${ORG}`, role: 'org_admin' }));
      await assertSucceeds(updateDoc(doc(db(MULTI_FIN), 'users', MULTI_FIN.uid), { orgId: ORG, role: 'finance', active: true, memberId: `${MULTI_FIN.uid}_${ORG}` }));
      await assertFails(updateDoc(doc(db(MULTI_FIN), 'users', MULTI_FIN.uid), { orgId: ORG, role: 'org_admin', active: true, memberId: `${MULTI_FIN.uid}_${ORG}` }));
    });

    it('members / users: org admin gives no membership elsewhere to itself, no super_admin, no payout data, no foreign profile edits', async () => {
      const a = db(ADMIN);
      await assertFails(setDoc(doc(a, 'members', `${ADMIN.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: ADMIN.uid, userEmail: ADMIN.email, role: 'org_admin', active: true }));
      await assertFails(setDoc(doc(a, 'members', `${STRANGER.uid}_${ORG}`), { orgId: ORG, userId: STRANGER.uid, userEmail: STRANGER.email, role: 'super_admin', active: true }));
      await assertFails(setDoc(doc(a, 'members', `${STRANGER.uid}_${ORG}`), { orgId: ORG, userId: STRANGER.uid, userEmail: STRANGER.email, role: 'employee', active: true, iban: 'EG1' }));
      await assertFails(setDoc(doc(a, 'members', `x_${ORG}`), { orgId: ORG, userId: STRANGER.uid, userEmail: STRANGER.email, role: 'employee', active: true }));
      await assertFails(updateDoc(doc(a, 'users', CAIRO_ADMIN.uid), { role: 'employee' }));
      await assertFails(setDoc(doc(a, 'users', CAIRO_ADMIN.uid), { orgId: ORG, role: 'employee' }));
    });

    it('members / users: suspended members get nothing in their company (reads and writes)', async () => {
      for (const [c, id] of [['members', `${EMP.uid}_${ORG}`], ['paymentAccounts', 'acc-cash'], ['requests', 'r-pay'], ['organizations', ORG], ['uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Vodafone')]] as const) {
        await assertFails(getDoc(doc(db(SUSP_FIN), c, id)));
        await assertFails(getDoc(doc(db(SUSP_ADMIN), c, id)));
      }
      await assertFails(setDoc(doc(db(SUSP_ADMIN), 'members', `${STRANGER.uid}_${ORG}`), { orgId: ORG, userId: STRANGER.uid, userEmail: STRANGER.email, role: 'employee', active: true }));
      await assertFails(updateDoc(doc(db(SUSP_ADMIN), 'members', `${SUSP_FIN.uid}_${ORG}`), { active: true }));
      await assertFails(setDoc(doc(db(SUSP_FIN), 'requests', 'rq-s'), { id: 'rq-s', orgId: ORG, status: 'pending', requesterId: SUSP_FIN.uid, amount: 1, timeline: [], comments: [] }));
    });

    it('members / users: org admin edits a member email (key moves), suspends and re-activates it', async () => {
      const me = actor(ADMIN, 'org_admin', ORG);
      await updateMemberRecord(store(ADMIN), me, `${EMP.uid}_${ORG}`, { userEmail: 'emp.new@acme.test' }, [EMP.uid], key());
      expect(await read('uniqueKeys', uniqueKeyDocId('member_email', ORG, EMP.email))).toBeUndefined();
      expect(await read('uniqueKeys', uniqueKeyDocId('member_email', ORG, 'emp.new@acme.test'))).toMatchObject({ entityId: `${EMP.uid}_${ORG}` });
      await updateMemberRecord(store(ADMIN), me, `${EMP.uid}_${ORG}`, { active: false }, [EMP.uid], key());
      expect((await read('users', EMP.uid))!.active).toBe(false);
      await updateMemberRecord(store(ADMIN), me, `${EMP.uid}_${ORG}`, { active: true }, [EMP.uid], key());
      expect((await read('users', EMP.uid))!.active).toBe(true);
    });

    it('counters: suspended / stranger refused, non-integer jumps refused; another company\'s member advances the shared request counter (cost only)', async () => {
      await assertFails(setDoc(doc(db(SUSP_FIN), 'counters', 'requests-2026'), { value: 1 }));
      await assertFails(setDoc(doc(db(STRANGER), 'counters', 'requests-2026'), { value: 1 }));
      await assertSucceeds(setDoc(doc(db(CAIRO_EMP), 'counters', 'requests-2026'), { value: 1 }));
      await assertFails(updateDoc(doc(db(CAIRO_EMP), 'counters', 'requests-2026'), { value: 1.5 }));
      await assertFails(updateDoc(doc(db(CAIRO_EMP), 'counters', 'requests-2026'), { value: '2' }));
      await assertFails(setDoc(doc(db(CAIRO_EMP), 'counters', 'custodies-2026'), { value: 1 }));
      await assertFails(setDoc(doc(db(MULTI_ADMIN), 'counters', 'transfers-2026'), { value: 1 }));   // known §11.4 (profile company only)
      await assertSucceeds(setDoc(doc(db(CAIRO_FIN), 'counters', 'transfers-2026'), { value: 1 }));
    });

    it('audit: only in a company the caller is an active member of, under its own sign-in email, never overwritten', async () => {
      await assertFails(setDoc(doc(db(CAIRO_EMP), 'auditLogs', 'a1'), { actorId: CAIRO_EMP.uid, orgId: ORG, actionType: 'x' }));
      await assertFails(setDoc(doc(db(SUSP_ADMIN), 'auditLogs', 'a2'), { actorId: SUSP_ADMIN.uid, orgId: ORG, actionType: 'x' }));
      await assertFails(setDoc(doc(db(MULTI_FIN), 'auditLogs', 'a3'), { actorId: MULTI_FIN.uid, actorEmail: OWNER.email, orgId: ORG, actionType: 'x' }));
      await assertSucceeds(setDoc(doc(db(MULTI_FIN), 'auditLogs', 'a4'), { actorId: MULTI_FIN.uid, actorEmail: MULTI_FIN.email, orgId: ORG, actionType: 'x' }));
      await assertFails(setDoc(doc(db(MULTI_FIN), 'auditLogs', 'a4'), { actorId: MULTI_FIN.uid, orgId: ORG, actionType: 'y' }));
      await assertFails(getDoc(doc(db(MULTI_FIN), 'auditLogs', 'a4')));
      await assertSucceeds(getDoc(doc(db(MULTI_ADMIN), 'auditLogs', 'a4')));
    });

    it('outbox: another company\'s member cannot address ORG\'s admins through its own request; foreign request ids; webhook / attempts refused', async () => {
      const c = db(CAIRO_EMP);
      await assertSucceeds(setDoc(doc(c, 'requests', 'rq-c'), { id: 'rq-c', orgId: OTHER_ORG, status: 'pending', requesterId: CAIRO_EMP.uid, requesterEmail: CAIRO_EMP.email, amount: 1, currency: 'EGP', title: 't', timeline: [], comments: [] }));
      const ev = (id: string, entityId: string, extra: Record<string, unknown> = {}) => ({
        id, orgId: OTHER_ORG, eventType: 'new_request', entityType: 'request', entityId, channel: 'email_api', recipients: [CAIRO_ADMIN.email],
        message: { subject: 's', html: 'h', text: '', snippet: '' },
        meta: { senderName: DEFAULT_EMAIL_SETTINGS.senderName, senderEmail: DEFAULT_EMAIL_SETTINGS.senderEmail, replyTo: DEFAULT_EMAIL_SETTINGS.replyToEmail, provider: 'auto' },
        status: 'pending', attempts: 0, maxAttempts: 6, nextAttemptAt: 'x', createdBy: CAIRO_EMP.uid, createdAt: 'x', updatedAt: 'x', ...extra,
      });
      await assertFails(setDoc(doc(c, 'outbox', 'new_request__rq-c'), ev('new_request__rq-c', 'rq-c', { recipients: [ADMIN.email] })));
      await assertFails(setDoc(doc(c, 'outbox', 'new_request__rq-c'), ev('new_request__rq-c', 'rq-c', { orgId: ORG, recipients: [ADMIN.email] })));
      await assertFails(setDoc(doc(c, 'outbox', 'new_request__r-pay'), ev('new_request__r-pay', 'r-pay', { orgId: ORG, recipients: [ADMIN.email] })));
      await assertFails(setDoc(doc(c, 'outbox', 'new_request__rq-c'), ev('new_request__rq-c', 'rq-c', { channel: 'webhook', meta: { ...ev('', '').meta, webhookUrl: 'https://evil.test' } })));
      await assertFails(setDoc(doc(c, 'outbox', 'new_request__rq-c'), ev('new_request__rq-c', 'rq-c', { maxAttempts: 11 })));
      await assertSucceeds(setDoc(doc(c, 'outbox', 'new_request__rq-c'), ev('new_request__rq-c', 'rq-c')));
      await assertFails(getDocs(query(collection(db(FIN), 'outbox'), where('orgId', '==', OTHER_ORG))));
      await assertFails(updateDoc(doc(c, 'outbox', 'new_request__rq-c'), { status: 'sending', attempts: 1, recipients: [ADMIN.email] }));
    });

    it('cross-company: multi-company members keep their second-company role out of their profile company in every financial collection', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'r-o'), { ...approvedRequest('r-o', 5), orgId: OTHER_ORG, requesterId: CAIRO_EMP.uid, requesterEmail: CAIRO_EMP.email });
        await setDoc(doc(f, 'custodies', 'c-o'), { id: 'c-o', orgId: OTHER_ORG, employeeId: CAIRO_EMP.uid, totalAmount: 1, remainingAmount: 1, status: 'active' });
        await setDoc(doc(f, 'accountTransactions', 't-o'), { id: 't-o', orgId: OTHER_ORG, accountId: 'acc-ob', type: 'in', amount: 1 });
        await setDoc(doc(f, 'visaRequests', 'v-o'), { orgId: OTHER_ORG, requesterId: CAIRO_EMP.uid, status: 'pending' });
      });
      for (const u of [MULTI_FIN, MULTI_ADMIN]) {
        const f = db(u);
        for (const [c, id] of [['paymentAccounts', 'acc-ob'], ['requests', 'r-o'], ['custodies', 'c-o'], ['accountTransactions', 't-o'], ['visaRequests', 'v-o']] as const) {
          await assertFails(getDoc(doc(f, c, id)));
          await assertFails(getDocs(query(collection(f, c), where('orgId', '==', OTHER_ORG))));
        }
        await assertFails(updateDoc(doc(f, 'requests', 'r-o'), { status: 'rejected', rejectionReason: 'x' }));
        await assertFails(updateDoc(doc(f, 'paymentAccounts', 'acc-ob'), { name: 'x' }));
      }
      const res = await createExpenseRequest(store(MULTI_FIN), actor(MULTI_FIN, 'finance', ORG), { orgId: ORG, title: 't', amount: 5, currency: 'EGP', attachments: [] } as any, key(), notify);
      expect(res.changed).toBe(true);
    });
  });
});

describe('round r2: legitimate operations (empty keys, multi-company forms, shared services, legacy data)', () => {
  const GROUP_ADMIN = { uid: 'uidGroupAdmin00000000001', email: 'group@acme.test' };   // org admin of ORG (profile) + of many companies (members)
  const GROUP_DE = { uid: 'uidGroupDataEntry000000001', email: 'gde@acme.test' };      // data entry of ORG (profile) + of many companies (members)
  const groupOrg = (i: number) => `org-g${String(i).padStart(2, '0')}`;
  const groupIds = (count: number) => Array.from({ length: count }, (_, i) => groupOrg(i + 1));
  const providerIn = (name: string) => (id: string, orgId: string) => ({ id, orgId, name, totalPaid: 0, active: true } as any);
  const deptIn = (name: string) => (id: string, orgId: string, nowIso: string) => ({ id, orgId, name, createdAt: nowIso } as any);
  const draft = (extra: Record<string, unknown> = {}) => ({
    orgId: ORG, title: 'Laptop', description: 'd', justification: 'j', amount: 120.5, currency: 'EGP', urgency: 'medium',
    requestType: 'expense', preferredPaymentMethod: 'instapay', paymentAccountDetails: 'x@instapay', serviceCategoryId: 'srv-1',
    serviceCategoryName: 'Cloud', providerId: 'prov-1', providerName: 'Vodafone', attachments: [], ...extra,
  }) as any;
  // Many companies: GROUP_ADMIN is org admin and GROUP_DE data entry in each (members/{uid}_{org}).
  const seedGroup = (count: number) => seed(async f => {
    for (let i = 1; i <= count; i++) {
      const o = groupOrg(i);
      await setDoc(doc(f, 'organizations', o), { id: o, name: `G${i}`, code: `G${i}`, currency: 'EGP', notificationRecipients: [] });
      await setDoc(doc(f, 'members', `${GROUP_ADMIN.uid}_${o}`), { orgId: o, userId: GROUP_ADMIN.uid, userEmail: GROUP_ADMIN.email, role: 'org_admin', active: true, userName: 'g' });
      await setDoc(doc(f, 'members', `${GROUP_DE.uid}_${o}`), { orgId: o, userId: GROUP_DE.uid, userEmail: GROUP_DE.email, role: 'data_entry', active: true, userName: 'gde' });
    }
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [ADMIN.email] });
      await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [] });
      for (const [u, role, org] of [[ADMIN, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [DE, 'data_entry', ORG], [GROUP_ADMIN, 'org_admin', ORG], [GROUP_DE, 'data_entry', ORG]] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true, memberId: `${u.uid}_${org}` });
        await setDoc(doc(f, 'members', `${u.uid}_${org}`), { orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      for (const [u, role] of [[MULTI_FIN, 'finance'], [MULTI_ADMIN, 'org_admin']] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: OTHER_ORG, role: 'employee', active: true, memberId: `${u.uid}_${OTHER_ORG}` });
        await setDoc(doc(f, 'members', `${u.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: u.uid, userEmail: u.email, role: 'employee', active: true, userName: u.email });
        await setDoc(doc(f, 'members', `${u.uid}_${ORG}`), { orgId: ORG, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), account('acc-cash', 1000));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank'), account('acc-bank', 5000, { type: 'bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-insta'), account('acc-insta', 5000, { type: 'instapay', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank2'), account('acc-bank2', 3000, { type: 'bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-insta2'), account('acc-insta2', 3000, { type: 'instapay', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-wallet-old'), account('acc-wallet-old', 600, { type: 'wallet', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2', initialBalance: 1000, totalOut: 400 }));
      await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0, active: true });
      await setDoc(doc(f, 'providers', 'prov-1'), { orgId: ORG, name: 'Vodafone', totalPaid: 500, active: true });
      await setDoc(doc(f, 'custodies', 'cus-1'), custody('cus-1'));
    });
  });

  describe('[R2-K1] unique values that normalize to nothing ("-", "...") have no key', () => {
    it('[R2-K1] org admin opens a cash box whose number is "-", and a second one with the same placeholder', async () => {
      for (const name of ['خزينة الفرع', 'خزينة 2']) {
        const res = await createPaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, name, type: 'cash', accountIdentifier: '-', currency: 'EGP', active: true, initialBalance: 250 } as any, key());
        expect(res.changed).toBe(true);
      }
      expect(await read('uniqueKeys', uniqueKeyDocId('account_identifier', ORG, '-'))).toBeUndefined();
    });

    it('[R2-K1] finance edits an account number to "-" (old key released) and back to a real number (key claimed); the empty-number account is deleted', async () => {
      await seed(f => setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'acc-cash')), { scope: 'account_identifier', orgId: ORG, value: 'acccash', entityCollection: 'paymentAccounts', entityId: 'acc-cash' }));
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-cash', { accountIdentifier: '-' }, key());
      expect(await read('uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'acc-cash'))).toBeUndefined();
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-cash', { accountIdentifier: 'EG-55' }, key());
      expect(await read('uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'EG-55'))).toMatchObject({ entityId: 'acc-cash' });
      const empty = await createPaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, name: 'e', type: 'cash', accountIdentifier: '_', currency: 'EGP', active: true, initialBalance: 0 } as any, key());
      await deletePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), empty.value.id, key());
    });

    it('[R2-K1] org admin adds a service whose code is "-"; data entry adds a provider named "..."', async () => {
      expect((await createEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'service', (id: string) => ({ id, orgId: ORG, name: 'بدون كود', code: '-', spentAmount: 0, active: true } as any), () => 'x', key())).changed).toBe(true);
      expect((await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', (id: string) => ({ id, orgId: ORG, name: '...', totalPaid: 0, active: true } as any), () => 'x', key())).changed).toBe(true);
    });

    it('the rules still refuse claiming an empty key; "0" and "N/A" are claimed normally', async () => {
      const a = db(ADMIN);
      await assertFails(writeBatch(a)
        .update(doc(a, 'paymentAccounts', 'acc-cash'), { accountIdentifier: '-' })
        .set(doc(a, 'uniqueKeys', uniqueKeyDocId('account_identifier', ORG, '-')), { scope: 'account_identifier', orgId: ORG, value: '', entityCollection: 'paymentAccounts', entityId: 'acc-cash' })
        .commit());
      for (const id of ['0', 'N/A']) {
        const r = await createPaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, name: `c${id}`, type: 'cash', accountIdentifier: id, currency: 'EGP', active: true, initialBalance: 0 } as any, key());
        expect(await read('uniqueKeys', uniqueKeyDocId('account_identifier', ORG, id))).toMatchObject({ entityId: r.value.id });
      }
    });
  });

  describe('[R2-B1] multi-company add forms ("select all companies"): ORGS_PER_TRANSACTION companies per commit', () => {
    for (const count of [17, 18, 19]) {
      it(`${count >= 18 ? '[R2-B1] ' : ''}org admin of ${count} companies adds a provider to all of them`, async () => {
        await seedGroup(count);
        const p = await createEntityInOrgs(store(GROUP_ADMIN), actor(GROUP_ADMIN, 'org_admin'), 'provider', groupIds(count), providerIn('V'), () => 'x', key());
        expect(p.value.created).toHaveLength(count);
      });
    }

    it('[R2-B1] org admin of 20 companies adds a member (employee) and a provider to all of them', async () => {
      await seedGroup(20);
      const m = await createMemberInOrgs(store(GROUP_ADMIN), actor(GROUP_ADMIN, 'org_admin'), { userId: '', userEmail: 'joiner3@group.test', userName: 'J', role: 'employee', jobTitle: 'j', department: 'd' } as any, groupIds(20), key());
      expect(m.value.created).toHaveLength(20);
      const p = await createEntityInOrgs(store(GROUP_ADMIN), actor(GROUP_ADMIN, 'org_admin'), 'provider', groupIds(20), providerIn('V'), () => 'x', key());
      expect(p.value.created).toHaveLength(20);
    });

    it('[R2-B1] data entry of 20 companies adds a department to all of them', async () => {
      await seedGroup(20);
      const d = await createEntityInOrgs(store(GROUP_DE), actor(GROUP_DE, 'data_entry'), 'department', groupIds(20), deptIn('Ops'), () => 'x', key());
      expect(d.value.created).toHaveLength(20);
    });

    it('[R2-B1] org admin of 40 companies (three commits): skipped companies, a retry with the same key is a no-op, taken everywhere is a duplicate', async () => {
      await seedGroup(40);
      await seed(f => setDoc(doc(f, 'members', `pending-x_${groupOrg(17)}`), { orgId: groupOrg(17), userId: 'pending-x', userEmail: 'joiner4@group.test', role: 'employee', active: true, userName: 'Old' }));
      await seed(f => setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('member_email', groupOrg(17), 'joiner4@group.test')), { scope: 'member_email', orgId: groupOrg(17), value: 'joiner4@group.test', entityCollection: 'members', entityId: `pending-x_${groupOrg(17)}` }));
      const k = key();
      const input = { userId: '', userEmail: 'joiner4@group.test', userName: 'J', role: 'finance', jobTitle: 'j', department: 'd' } as any;
      const m = await createMemberInOrgs(store(GROUP_ADMIN), actor(GROUP_ADMIN, 'org_admin'), input, groupIds(40), k);
      expect(m.value.created).toHaveLength(39);
      expect(m.value.skipped).toEqual([{ orgId: groupOrg(17), reason: 'already_member', existingName: 'Old' }]);
      expect(m.value.created.map(c => c.orgId)).toEqual(groupIds(40).filter(o => o !== groupOrg(17)));
      const again = await createMemberInOrgs(store(GROUP_ADMIN), actor(GROUP_ADMIN, 'org_admin'), input, groupIds(40), k);
      expect(again.changed).toBe(false);
      expect(again.value.created).toHaveLength(39);
      await expect(createMemberInOrgs(store(GROUP_ADMIN), actor(GROUP_ADMIN, 'org_admin'), input, [groupOrg(17)], key())).rejects.toMatchObject({ code: 'duplicate' });
    });

    it('owner adds a provider to 30 companies, and a provider, a department and a member to 16 companies', async () => {
      await seedGroup(30);
      const s = store(OWNER);
      const a = actor(OWNER, 'super_admin');
      expect((await createEntityInOrgs(s, a, 'provider', groupIds(30), providerIn('Group Vendor'), () => 'x', key())).value.created).toHaveLength(30);
      await createEntityInOrgs(s, a, 'department', groupIds(16), deptIn('HR'), () => 'x', key());
      await createMemberInOrgs(s, a, { userId: '', userEmail: 'joiner@group.test', userName: 'J', role: 'employee', jobTitle: 'j', department: 'd' } as any, groupIds(16), key());
    });
  });

  describe('[R2-S1] shared services: a multi-company member pays a request of a company listed late in orgIds', () => {
    const sharedWith = (orgIds: string[]) => seed(async f => {
      for (const o of orgIds) if (o.startsWith('org-g')) await setDoc(doc(f, 'organizations', o), { id: o, name: o, code: o, currency: 'EGP', notificationRecipients: [] });
      await setDoc(doc(f, 'services', 'srv-shared'), { orgId: orgIds[0], orgIds, name: 'Group Cloud', code: 'GCL', spentAmount: 0, active: true });
      await setDoc(doc(f, 'requests', 'rs1'), approvedRequest('rs1', 45.5, { serviceCategoryId: 'srv-shared', providerId: 'prov-1' }));
    });

    it('[R2-S1] request company at index 4 of orgIds, paid by the multi-company finance member', async () => {
      await sharedWith([groupOrg(1), groupOrg(2), groupOrg(3), groupOrg(4), ORG]);
      const res = await disburseExpenseRequest(store(MULTI_FIN), actor(MULTI_FIN, 'finance', ORG), 'rs1', { paymentMethod: 'cash', referenceNumber: 'S', accountId: 'acc-cash' }, key(), notifyAll);
      expect(res.changed).toBe(true);
      expect((await read('services', 'srv-shared'))!.spentAmount).toBe(45.5);
    });

    it('[R2-S1] (org admin variant) request company at index 5 (the 6th company), paid by the multi-company org admin from the InstaPay', async () => {
      await sharedWith([groupOrg(1), groupOrg(2), groupOrg(3), groupOrg(4), groupOrg(5), ORG]);
      const res = await disburseExpenseRequest(store(MULTI_ADMIN), actor(MULTI_ADMIN, 'org_admin', ORG), 'rs1', { paymentMethod: 'instapay', referenceNumber: 'S', accountId: 'acc-insta' }, key(), notifyAll);
      expect(res.changed).toBe(true);
    });

    it('[R2-S1, known limit] a member whose membership is not its profile reads a shared service only among its first six companies (single-read budget)', async () => {
      await sharedWith([groupOrg(1), groupOrg(2), groupOrg(3), groupOrg(4), groupOrg(5), groupOrg(6), ORG]);
      await assertFails(getDoc(doc(db(MULTI_FIN), 'services', 'srv-shared')));
      // the profile-company staff and the owner read it wherever it is listed
      await assertSucceeds(getDoc(doc(db(FIN), 'services', 'srv-shared')));
      await assertSucceeds(getDoc(doc(db(OWNER), 'services', 'srv-shared')));
      await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 'rs1', { paymentMethod: 'cash', referenceNumber: 'S', accountId: 'acc-cash' }, key(), notifyAll);
    });

    it('a stranger and another company\'s member read nothing; a member of the owning company does', async () => {
      await sharedWith([groupOrg(1), groupOrg(2), groupOrg(3), groupOrg(4), groupOrg(5), ORG]);
      await assertFails(getDoc(doc(db(STRANGER), 'services', 'srv-shared')));
      await assertFails(getDoc(doc(db(CAIRO_EMP), 'services', 'srv-shared')));
      await seed(f => setDoc(doc(f, 'members', `${GROUP_DE.uid}_${groupOrg(1)}`), { orgId: groupOrg(1), userId: GROUP_DE.uid, userEmail: GROUP_DE.email, role: 'data_entry', active: true }));
      await assertSucceeds(getDoc(doc(db(GROUP_DE), 'services', 'srv-shared')));
    });
  });

  describe('legacy data edge cases', () => {
    it('[R2-D1] the holder files the last invoice for exactly the remainder shown (0.80) on a legacy custody whose remainder is 0.7 + 0.1', async () => {
      await seed(f => setDoc(doc(f, 'custodies', 'c-noise'), custody('c-noise', { totalAmount: 1000, settledAmount: 999.2, remainingAmount: 0.7 + 0.1 })));
      const res = await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: 'c-noise', amount: 0.8, description: 'last invoice' }, key());
      expect(res.changed).toBe(true);
      expect((await read('custodies', 'c-noise'))!.status).toBe('settled');
    });

    it('[R2-D1] (larger value) old app remainder 1000 - 0.1 - 0.7 = 999.1999999999999, the holder settles the 999.20 shown; a cent more is refused', async () => {
      await seed(f => setDoc(doc(f, 'custodies', 'c-noise2'), custody('c-noise2', { settledAmount: 0.8, remainingAmount: 1000 - 0.1 - 0.7 })));
      await expect(settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: 'c-noise2', amount: 999.21, description: 'x' }, key())).rejects.toMatchObject({ code: 'insufficient_funds' });
      const res = await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: 'c-noise2', amount: 999.2, description: 'x' }, key());
      expect(res.changed).toBe(true);
    });

    it('noise above the shown value: remainder 0.1 + 0.2 settled with 0.30, then replenished and returned', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'custodies', 'c-up'), custody('c-up', { remainingAmount: 0.1 + 0.2, settledAmount: 999.7 }));
        await setDoc(doc(f, 'custodies', 'c-up2'), custody('c-up2', { remainingAmount: 0.1 + 0.2, settledAmount: 999.7, sourceAccountId: 'acc-insta' }));
      });
      await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: 'c-up', amount: 0.3, description: 'x' }, key());
      expect(await read('custodies', 'c-up')).toMatchObject({ remainingAmount: 0, status: 'settled' });
      await replenishCustody(store(FIN), actor(FIN, 'finance', ORG), { custodyId: 'c-up', amount: 0.01, sourceAccountId: 'acc-wallet-old' }, key());
      await returnCustodyRemainders(store(FIN), actor(FIN, 'finance', ORG), { custodyIds: ['c-up', 'c-up2'], targetAccountId: 'acc-insta2' }, key());
      expect((await read('paymentAccounts', 'acc-bank2'))!.currentBalance).toBe(toMoney(3000 - 0.01 + 0.01 + 0.3));
    });

    // NewRequestModal (edit) sends the whole form: amount: Number(amount), currency: currency || org currency || 'EGP', ...
    const formPayload = (req: Record<string, any>, extra: Record<string, unknown> = {}) => ({
      title: req.title + ' (edited)', description: 'd', justification: 'j', amount: Number(req.amount), currency: req.currency || 'EGP',
      serviceCategoryId: req.serviceCategoryId, serviceCategoryName: 'Cloud', providerId: req.providerId, providerName: 'Vodafone',
      urgency: 'medium', requestType: 'expense', attachments: [], preferredPaymentMethod: 'instapay', paymentAccountDetails: 'x', orgId: ORG, ...extra,
    });

    it('[R2-Q1] org admin fixes the title of an APPROVED legacy request without a currency field: it stays approved and finance pays it', async () => {
      const legacy = approvedRequest('lq1', 250, { serviceCategoryId: 'srv-1', providerId: 'prov-1' }) as Record<string, any>;
      delete legacy.currency;
      await seed(f => setDoc(doc(f, 'requests', 'lq1'), legacy));
      await updateExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'lq1', formPayload(legacy) as any, key());
      expect(await read('requests', 'lq1')).toMatchObject({ status: 'approved', title: 't (edited)' });
      expect((await read('requests', 'lq1'))!.currency).toBeUndefined();
      await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 'lq1', { paymentMethod: 'cash', referenceNumber: 'L', accountId: 'acc-cash' }, key(), notify);
    });

    it('[R2-Q1] org admin fixes the title of an APPROVED legacy request whose amount is an unrounded third: it stays approved; a real money change re-opens it', async () => {
      const legacy = approvedRequest('lq2', 1000 / 3, { serviceCategoryId: 'srv-1' });
      await seed(f => setDoc(doc(f, 'requests', 'lq2'), legacy));
      await updateExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'lq2', formPayload(legacy) as any, key());
      expect(await read('requests', 'lq2')).toMatchObject({ status: 'approved', amount: 1000 / 3 });
      await updateExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'lq2', formPayload(legacy, { amount: 334 }) as any, key());
      expect(await read('requests', 'lq2')).toMatchObject({ status: 'pending', amount: 334 });
    });

    it('requester edits a pending legacy request (no currency, no timeline) with the full form; finance attaches the invoice to an approved legacy one and pays it', async () => {
      const legacy = approvedRequest('lq3', 99.99, { status: 'pending' }) as Record<string, any>;
      delete legacy.currency; delete legacy.timeline; delete legacy.comments;
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'lq3'), legacy);
        const ap = approvedRequest('lq4', 10) as Record<string, any>; delete ap.currency;
        await setDoc(doc(f, 'requests', 'lq4'), ap);
      });
      await updateExpenseRequest(store(EMP), actor(EMP, 'employee', ORG), 'lq3', formPayload(legacy, { amount: 100.01 }) as any, key());
      const att = { id: 'att-x', name: 'inv.pdf', url: 'fsattach://att-x', type: 'application/pdf', size: 10, uploadedAt: 'x' };
      await updateExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 'lq4', { invoiceAttachment: att, attachments: [att] } as any, key());
      await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), 'lq4', { paymentMethod: 'cash', referenceNumber: 'L4', accountId: 'acc-cash' }, key(), notifyAll);
    });

    it('[R2-N1] an employee with an UNVERIFIED email replies to a clarification on its legacy request filed under an older id (notifications on): saved, no email', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'lr-old'), approvedRequest('lr-old', 75.5, { status: 'clarification_requested', requesterId: 'mem-legacy-emp' })));
      const res = await transitionExpenseRequest(store(EMP, false), { ...actor(EMP, 'employee', ORG), emailVerified: false }, 'lr-old', { type: 'reply', replyText: 'here' }, key(), notifyAll);
      expect(res.value.status).toBe('pending');
      expect(res.outboxEventIds).toEqual([]);
    });

    it('control: the same reply with a VERIFIED email sends the email; the unverified one with notifications off', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'lr-old2'), approvedRequest('lr-old2', 75.5, { status: 'clarification_requested', requesterId: 'mem-legacy-emp' }));
        await setDoc(doc(f, 'requests', 'lr-old3'), approvedRequest('lr-old3', 75.5, { status: 'clarification_requested', requesterId: 'mem-legacy-emp' }));
      });
      const sent = await transitionExpenseRequest(store(EMP), { ...actor(EMP, 'employee', ORG), emailVerified: true }, 'lr-old2', { type: 'reply', replyText: 'here' }, key(), notifyAll);
      expect(sent.outboxEventIds).toHaveLength(1);
      await transitionExpenseRequest(store(EMP, false), { ...actor(EMP, 'employee', ORG), emailVerified: false }, 'lr-old3', { type: 'reply', replyText: 'here' }, key(), notify);
    });

    it('full cycle by every role with notifications on: data entry files, org admin clarifies twice, reply with attachment, finance approves, multi-company finance pays from the legacy wallet', async () => {
      const r = await createExpenseRequest(store(DE), actor(DE, 'data_entry', ORG), draft({ amount: 291.65 }), key(), notifyAll);
      await transitionExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), r.value.id, { type: 'clarify', question: 'q1' }, key(), notifyAll);
      await transitionExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), r.value.id, { type: 'clarify', question: 'q2' }, key(), notifyAll);
      await transitionExpenseRequest(store(DE), actor(DE, 'data_entry', ORG), r.value.id, { type: 'reply', replyText: 'a', attachment: { id: 'a1', name: 'r.pdf', url: 'fsattach://a1', type: 'pdf', size: '1', uploadedAt: 'x' } as any }, key(), notifyAll);
      await transitionExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), r.value.id, { type: 'approve', note: 'ok' }, key(), notifyAll);
      await disburseExpenseRequest(store(MULTI_FIN), actor(MULTI_FIN, 'finance', ORG), r.value.id, { paymentMethod: 'digital_wallet', referenceNumber: 'W', accountId: 'acc-wallet-old' }, key(), notifyAll);
      expect((await read('paymentAccounts', 'acc-bank2'))!.currentBalance).toBe(toMoney(3000 - 291.65));
      expect((await read('services', 'srv-1'))!.spentAmount).toBe(291.65);
      expect((await read('providers', 'prov-1'))!.totalPaid).toBe(toMoney(500 + 291.65));
    });

    it('batch disbursement from an InstaPay: five approved requests sharing one service and one provider (bank mirrored each time), then a retry', async () => {
      const ids = ['b1', 'b2', 'b3', 'b4', 'b5'];
      const amounts = [0.1, 0.2, 1000 / 3, 291.65, 70.82];
      await seed(async f => { for (let i = 0; i < 5; i++) await setDoc(doc(f, 'requests', ids[i]), approvedRequest(ids[i], amounts[i], { serviceCategoryId: 'srv-1', providerId: 'prov-1' })); });
      const keys = ids.map(() => key());
      for (let i = 0; i < 5; i++) await disburseExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), ids[i], { paymentMethod: 'instapay', referenceNumber: `B${i}`, accountId: 'acc-insta', batchId: 'batch-1' }, keys[i], notifyAll);
      for (let i = 0; i < 5; i++) {
        const again = await disburseExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), ids[i], { paymentMethod: 'instapay', referenceNumber: `B${i}`, accountId: 'acc-insta', batchId: 'batch-1' }, keys[i], notifyAll);
        expect(again.changed).toBe(false);
      }
      const total = amounts.reduce((s, a) => toMoney(s + toMoney(a)), 0);
      expect((await read('paymentAccounts', 'acc-bank'))!.currentBalance).toBe(toMoney(5000 - total));
      expect((await read('services', 'srv-1'))!.spentAmount).toBe(total);
    });
  });

  describe('20-step random sequences with rotating roles (finance, org admin, owner, multi-company finance / org admin)', () => {
    const roles: Array<[{ uid: string; email: string }, Actor['role'], string | undefined]> = [
      [FIN, 'finance', ORG], [ADMIN, 'org_admin', ORG], [OWNER, 'super_admin', undefined], [MULTI_FIN, 'finance', ORG], [MULTI_ADMIN, 'org_admin', ORG],
    ];
    const run = async (accountId: string, start: number, seedNo: number, other: string) => {
      let s = seedNo;
      const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
      const amt = (max: number) => Math.max(0.01, toMoney(rnd() * max));
      let balance = toMoney(start);
      const custodies: string[] = [];
      const log: string[] = [];
      await seed(f => setDoc(doc(f, 'visaRequests', `vs-${seedNo}`), { orgId: ORG, requestNumber: 'VS', status: 'approved', totalAmount: 1e6, paidAmount: 0, remainingBalance: 1e6, payments: [], currency: 'EGP', travelerName: 'T' }));
      for (let i = 0; i < 20; i++) {
        const [u, role, org] = roles[Math.floor(rnd() * roles.length)];
        // multi-company members cannot advance custody / transfer counters of their second company (spec §11.4, known)
        const multi = u === MULTI_FIN || u === MULTI_ADMIN;
        const st = store(u);
        const a = actor(u, role, org);
        const kind = Math.floor(rnd() * 10);
        const label = `${i}:${u.email}:${kind}`;
        try {
          if (kind === 0 || balance < 5) {
            const x = amt(500) + (rnd() < 0.5 ? 1 / 3 : 0.1 + 0.2);
            const r = await adjustAccountBalance(st, a, { accountId, type: 'in', amount: x, description: 's' }, key());
            balance = toMoney(balance + r.value.amount); log.push(`${label} in ${r.value.amount}`);
          } else if (kind === 1) {
            const x = Math.min(balance, amt(balance)); await adjustAccountBalance(st, a, { accountId, type: 'out', amount: x, description: 's' }, key());
            balance = toMoney(balance - x); log.push(`${label} out ${x}`);
          } else if (kind === 2) {
            const x = Math.min(balance, amt(300)); const id = `rq-${seedNo}-${i}`;
            await seed(f => setDoc(doc(f, 'requests', id), approvedRequest(id, x, { serviceCategoryId: 'srv-1', providerId: 'prov-1' })));
            await disburseExpenseRequest(st, a, id, { paymentMethod: 'cash', referenceNumber: id, accountId }, key(), notifyAll);
            balance = toMoney(balance - x); log.push(`${label} pay ${x}`);
          } else if (kind === 3) {
            const x = amt(200) + 1 / 3; const id = `inc-${seedNo}-${i}`;
            await seed(f => setDoc(doc(f, 'requests', id), approvedRequest(id, x, { status: 'pending', requestType: 'income' })));
            await disburseExpenseRequest(st, a, id, { paymentMethod: 'cash', referenceNumber: id, accountId }, key(), notifyAll);
            balance = toMoney(balance + toMoney(x)); log.push(`${label} income ${toMoney(x)}`);
          } else if (kind === 4 && !multi) {
            const x = Math.min(balance, amt(250)); await transferBetweenAccounts(st, a, { fromAccountId: accountId, toAccountId: other, amount: x }, key());
            balance = toMoney(balance - x); log.push(`${label} transfer out ${x}`);
          } else if (kind === 5 && !multi) {
            const x = amt(250); await transferBetweenAccounts(st, a, { fromAccountId: other, toAccountId: accountId, amount: x }, key());
            balance = toMoney(balance + x); log.push(`${label} transfer in ${x}`);
          } else if (kind === 6 && !multi) {
            const x = Math.min(balance, amt(150));
            const c = await issueCustody(st, a, { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount: x, sourceAccountId: accountId }, key());
            custodies.push(c.value.id); balance = toMoney(balance - x); log.push(`${label} custody ${x}`);
            const inv = Math.min(x, amt(x)); await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: c.value.id, amount: inv, description: 'inv' }, key());
          } else if (kind === 7 && custodies.length) {
            const x = Math.min(balance, amt(100)); await replenishCustody(st, a, { custodyId: custodies[custodies.length - 1], amount: x, sourceAccountId: accountId }, key());
            balance = toMoney(balance - x); log.push(`${label} replenish ${x}`);
          } else if (kind === 8 && custodies.length) {
            const cid = custodies.pop()!; const rem = toMoney((await read('custodies', cid))!.remainingAmount);
            if (rem > 0) {
              await returnCustodyRemainders(st, a, { custodyIds: [cid], targetAccountId: accountId }, key());
              balance = toMoney(balance + rem); log.push(`${label} return ${rem}`);
            }
          } else {
            const x = Math.min(balance, amt(120)); await addVisaPayment(st, a, `vs-${seedNo}`, { amount: x, accountId, method: 'cash' } as any, key());
            balance = toMoney(balance - x); log.push(`${label} visa ${x}`);
          }
        } catch (err: any) {
          throw new Error(`step ${label} failed after [${log.join(' | ')}]: ${err?.code || ''} ${err?.message || err}`);
        }
        expect((await read('paymentAccounts', accountId))!.currentBalance).toBe(balance);
      }
    };

    it('seed 11: legacy cash account with drifted totals and an unrounded third balance', async () => {
      await seed(f => setDoc(doc(f, 'paymentAccounts', 'q-cash'), { ...account('q-cash', 2000 / 3 + 0.1 + 0.2), initialBalance: 5000, totalIn: 12.345, totalOut: 0.1 + 0.2 }));
      await run('q-cash', 2000 / 3 + 0.1 + 0.2, 11, 'acc-bank2');
    });

    it('seed 23: the BANK behind an InstaPay (the InstaPay is the transfer counterpart, so the bank also moves as its mirror)', async () => {
      await run('acc-bank', 5000, 23, 'acc-insta2');
    });

    it('seed 37: an InstaPay (each step mirrored on its bank), counterpart a legacy linked wallet', async () => {
      await run('acc-insta', 5000, 37, 'acc-wallet-old');
    });

    it('seed 41: a legacy account with no balance fields at all (bank, no totals, no initialBalance)', async () => {
      await seed(f => setDoc(doc(f, 'paymentAccounts', 'q-bare'), { orgId: ORG, name: 'q-bare', type: 'bank', accountIdentifier: 'QB', active: true }));
      await run('q-bare', 0, 41, 'acc-cash');
    });

    it('seed 53: an overdrawn legacy account (starts at -120.75)', async () => {
      await seed(f => setDoc(doc(f, 'paymentAccounts', 'q-neg'), { ...account('q-neg', -120.75), initialBalance: 0, totalOut: 120.75 }));
      await run('q-neg', -120.75, 53, 'acc-bank2');
    });
  });
});

// =============================================================================
// Round r3, identity lane. Each section seeds its own data (its own accounts, users and helpers).
// =============================================================================
/**
 * Round r3, identity & membership lane (attacker + provisioning legitimacy).
 *
 * Attacker: raw Firestore Web SDK with its own credentials. Legitimate operations run the
 * REAL domain functions (src/domain/directory.ts) the way AppContext calls them; the two
 * AppContext helpers that are not exported (linkedProfileIds, linkOwnProfile) are copied
 * verbatim below so the domain receives exactly what the app passes it.
 *
 * Tests named [I<n>] demonstrate a finding (they FAIL while the attack works).
 * Everything else is coverage that the round-2 identity fixes hold.
 */
describe('round r3: identity lane ([I1] memberId self-write, [I2] removal / suspension of a re-pointed profile)', () => {
  const ORG = 'org-acme';
  const OTHER_ORG = 'org-other';

  type U = { uid: string; email: string };
  const OWNER: U = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
  const ADMIN: U = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
  const ADMIN2: U = { uid: 'uidAdmin000000000000000002', email: 'admin2@acme.test' };
  const FIN: U = { uid: 'uidFinance00000000000000001', email: 'fin@acme.test' };
  const EMP: U = { uid: 'uidEmployee0000000000000001', email: 'emp@acme.test' };
  const EMP2: U = { uid: 'uidEmployee0000000000000002', email: 'emp2@acme.test' };
  const SUSP: U = { uid: 'uidSuspAdmin0000000000001', email: 'sadmin@acme.test' };
  const CAIRO_ADMIN: U = { uid: 'uidCairoAdmin000000000001', email: 'admin@other.test' };
  const CAIRO_EMP: U = { uid: 'uidCairoEmp00000000000001', email: 'emp@other.test' };
  const MULTI_ADMIN: U = { uid: 'uidMultiAdmin00000000001', email: 'madmin@other.test' }; // profile OTHER (employee), org admin member of ORG
  const STRANGER: U = { uid: 'uidStranger00000000000001', email: 'stranger@evil.test' };
  const NEWHIRE: U = { uid: 'uidNewHire000000000000001', email: 'newhire@acme.test' };
  const FRESH: U = { uid: 'uidFreshAcct00000000000001', email: 'fresh@acme.test' };

  const db = (u: U, verified = true, email = u.email): Firestore =>
    env.authenticatedContext(u.uid, { email, email_verified: verified }).firestore() as unknown as Firestore;
  const store = (u: U, verified = true) => createFirestoreStore(db(u, verified));
  const actor = (u: U, role: Actor['role'], orgId?: string): Actor => ({ id: u.uid, name: u.email, email: u.email, role, ...(orgId ? { orgId } : {}) });
  let n = 0;
  const key = () => `key-r3i${String(++n).padStart(7, '0')}`;
  const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));
  const read = async (c: string, id: string) => {
    let data: Record<string, any> | undefined;
    await env.withSecurityRulesDisabled(async ctx => {
      data = (await getDoc(doc(ctx.firestore(), c, id))).data();
    });
    return data;
  };
  const mid = (u: U, org = ORG) => `${u.uid}_${org}`;
  const allows = async (p: Promise<unknown>) => p.then(() => true, () => false);

  // ---- AppContext.linkedProfileIds, verbatim (AppContext.tsx, used by updateMember / removeMember) ----
  const linkedProfileIds = async (f: Firestore, mem: OrganizationMember | undefined): Promise<string[]> => {
    if (!mem) return [];
    const ids = new Set<string>();
    if (isRealUid(mem.userId)) {
      try {
        await getDoc(doc(f, 'users', mem.userId));
        ids.add(mem.userId);
      } catch {
        // not ours
      }
    }
    try {
      const snap = await getDocs(query(collection(f, 'users'), where('orgId', '==', mem.orgId), where('memberId', '==', mem.id)));
      snap.docs.forEach(d => ids.add(d.id));
    } catch {
      // skipped
    }
    return Array.from(ids);
  };
  const memberAs = async (f: Firestore, id: string) => ({ id, ...(await getDoc(doc(f, 'members', id))).data() } as OrganizationMember);
  // AppContext.updateMember
  const appUpdateMember = async (who: U, role: Actor['role'], memberId: string, updates: Partial<OrganizationMember>) => {
    const f = db(who);
    const mem = await memberAs(f, memberId);
    return updateMemberRecord(store(who), actor(who, role, ORG), memberId, updates, await linkedProfileIds(f, mem), key());
  };
  // AppContext.removeMember
  const appRemoveMember = async (who: U, role: Actor['role'], memberId: string) => {
    const f = db(who);
    const mem = await memberAs(f, memberId);
    const all = (await getDocs(query(collection(f, 'members'), where('orgId', '==', ORG)))).docs.map(d => ({ id: d.id, ...d.data() } as OrganizationMember));
    const email = normalizeEmail(mem.userEmail);
    const samePerson = email ? all.filter(m => m.id !== memberId && isRealUid(m.userId) && normalizeEmail(m.userEmail) === email) : [];
    const ids = new Set(await linkedProfileIds(f, mem));
    for (const other of samePerson) (await linkedProfileIds(f, other)).forEach(id => ids.add(id));
    return removeMember(store(who), actor(who, role, ORG), memberId, Array.from(ids), key());
  };
  // AppContext.linkOwnProfile, verbatim shape
  const linkOwnProfile = (f: Firestore, user: U & { emailVerified: boolean }, m: OrganizationMember) =>
    setDoc(doc(f, 'users', user.uid), {
      id: user.uid,
      ...(user.emailVerified ? { email: normalizeEmail(user.email) } : {}),
      name: m.userName || 'موظف',
      role: m.role,
      orgId: m.orgId,
      memberId: m.id,
      department: m.department || '',
      phone: m.phone || '',
      active: true,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  const verifiedEmailVia = (f: Firestore) => async (uid: string) => {
    const s = await getDoc(doc(f, 'users', uid));
    return s.exists() ? String(s.data()?.verifiedEmail || '') : null;
  };
  const allMembers = async (f: Firestore) => (await getDocs(collection(f, 'members'))).docs.map(d => ({ id: d.id, ...d.data() } as any));

  // What an account can do in ORG, observed through the rules.
  const powers = async (u: U) => ({
    readsTreasury: await allows(getDoc(doc(db(u), 'paymentAccounts', 'acc-cash'))),
    editsMembers: await allows(updateDoc(doc(db(u), 'members', mid(EMP2)), { jobTitle: `probe-${++n}` })),
  });


  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [ADMIN.email, ADMIN2.email] });
      await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [CAIRO_ADMIN.email] });
      for (const [u, role, org] of [
        [ADMIN, 'org_admin', ORG], [ADMIN2, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [EMP2, 'employee', ORG],
        [CAIRO_ADMIN, 'org_admin', OTHER_ORG], [CAIRO_EMP, 'employee', OTHER_ORG],
      ] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true, email: u.email, memberId: mid(u, org), name: u.email });
        await setDoc(doc(f, 'members', mid(u, org)), { orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
        await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('member_email', org, u.email)),
          { scope: 'member_email', orgId: org, value: normalizeKeyValue(u.email), entityCollection: 'members', entityId: mid(u, org) });
      }
      await setDoc(doc(f, 'users', SUSP.uid), { orgId: ORG, role: 'org_admin', active: false, email: SUSP.email, memberId: mid(SUSP) });
      await setDoc(doc(f, 'members', mid(SUSP)), { orgId: ORG, userId: SUSP.uid, userEmail: SUSP.email, role: 'org_admin', active: false, userName: 'S' });
      await setDoc(doc(f, 'users', MULTI_ADMIN.uid), { orgId: OTHER_ORG, role: 'employee', active: true, email: MULTI_ADMIN.email, memberId: mid(MULTI_ADMIN, OTHER_ORG) });
      await setDoc(doc(f, 'members', mid(MULTI_ADMIN, OTHER_ORG)), { orgId: OTHER_ORG, userId: MULTI_ADMIN.uid, userEmail: MULTI_ADMIN.email, role: 'employee', active: true, userName: 'M' });
      await setDoc(doc(f, 'members', mid(MULTI_ADMIN, ORG)), { orgId: ORG, userId: MULTI_ADMIN.uid, userEmail: MULTI_ADMIN.email, role: 'org_admin', active: true, userName: 'M' });
      // the platform owner's working membership in ORG
      await setDoc(doc(f, 'members', mid(OWNER)), { orgId: ORG, userId: OWNER.uid, userEmail: OWNER.email, role: 'org_admin', active: true, userName: 'Owner' });
      await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), { orgId: ORG, name: 'cash', type: 'cash', currency: 'EGP', active: true, balance: 1000, currentBalance: 1000 });
      await setDoc(doc(f, 'paymentAccounts', 'acc-ob'), { orgId: OTHER_ORG, name: 'ob', type: 'bank', currency: 'EGP', active: true, balance: 9000, currentBalance: 9000 });
    });
  });

  // =============================================================================
  // FINDINGS
  // =============================================================================
  describe('findings', () => {
    it('[I1] an employee who points its own profile at the org admin\'s membership becomes org admin on the admin\'s next routine edit of that record', async () => {
      // 1) EMP (employee) re-points its own profile's memberId at ADMIN's membership; role / orgId untouched.
      const step1 = await allows(setDoc(doc(db(EMP), 'users', EMP.uid), { memberId: mid(ADMIN) }, { merge: true }));
      // 2) ADMIN fixes its own display name through the real app path (AppContext.updateMember).
      await appUpdateMember(ADMIN, 'org_admin', mid(ADMIN), { userName: 'Acme Admin', phone: '0100' });
      const profile = await read('users', EMP.uid);
      expect({ step1, role: profile?.role, ...(await powers(EMP)) })
        .toEqual({ step1: false, role: 'employee', readsTreasury: false, editsMembers: false });
    });

    it('[I1] (finance variant) an employee pointing at the finance member\'s record becomes finance when an admin edits that member', async () => {
      const step1 = await allows(setDoc(doc(db(EMP), 'users', EMP.uid), { memberId: mid(FIN) }, { merge: true }));
      await appUpdateMember(ADMIN, 'org_admin', mid(FIN), { jobTitle: 'Senior accountant' });
      const profile = await read('users', EMP.uid);
      expect({ step1, role: profile?.role, readsTreasury: await allows(getDoc(doc(db(EMP), 'paymentAccounts', 'acc-cash'))) })
        .toEqual({ step1: false, role: 'employee', readsTreasury: false });
    });

    it('[I1] (invitation variant) an employee pointing at a pending org-admin invitation takes the invitation itself: the admin\'s edit re-points its userId to the employee', async () => {
      const pid = `${pendingUserIdForEmail('cfo@acme.test')}_${ORG}`;
      await seed(f => setDoc(doc(f, 'members', pid), { orgId: ORG, userId: pendingUserIdForEmail('cfo@acme.test'), userEmail: 'cfo@acme.test', role: 'org_admin', active: true, userName: 'CFO (invited)' }));
      const step1 = await allows(setDoc(doc(db(EMP), 'users', EMP.uid), { memberId: pid }, { merge: true }));
      // the admin corrects the invitee's name before the person ever signs in
      await appUpdateMember(ADMIN, 'org_admin', pid, { userName: 'Chief Financial Officer' });
      const mem = await read('members', pid);
      const profile = await read('users', EMP.uid);
      expect({ step1, memberUserId: mem?.userId, role: profile?.role })
        .toEqual({ step1: false, memberUserId: pendingUserIdForEmail('cfo@acme.test'), role: 'employee' });
    });

    it('[I2] a finance member that points its profile at another membership keeps finance access after the org admin REMOVES it', async () => {
      const step1 = await allows(setDoc(doc(db(FIN), 'users', FIN.uid), { memberId: mid(EMP2) }, { merge: true }));
      await appRemoveMember(ADMIN, 'org_admin', mid(FIN));
      expect(await read('members', mid(FIN))).toBeUndefined();          // the membership is gone ...
      const profile = await read('users', FIN.uid);
      expect({ step1, orgId: profile?.orgId, role: profile?.role, readsTreasury: await allows(getDoc(doc(db(FIN), 'paymentAccounts', 'acc-cash'))) })
        .toEqual({ step1: false, orgId: '', role: 'employee', readsTreasury: false });
    });

    it('[I2] (suspension variant) the same member stays active finance after the org admin SUSPENDS it', async () => {
      await setDoc(doc(db(FIN), 'users', FIN.uid), { memberId: mid(EMP2) }, { merge: true }).catch(() => undefined);
      await appUpdateMember(ADMIN, 'org_admin', mid(FIN), { active: false });
      expect((await read('members', mid(FIN)))?.active).toBe(false);
      const profile = await read('users', FIN.uid);
      expect({ active: profile?.active, readsTreasury: await allows(getDoc(doc(db(FIN), 'paymentAccounts', 'acc-cash'))) })
        .toEqual({ active: false, readsTreasury: false });
    });

    it('[I2] (org admin variant) an org admin re-points its own profile and stays org admin after the PLATFORM OWNER removes it', async () => {
      // via the org-admin branch of users update (own profile, own company) — no self-link check at all
      const step1 = await allows(updateDoc(doc(db(ADMIN2), 'users', ADMIN2.uid), { memberId: mid(EMP2) }));
      await appRemoveMember(OWNER, 'super_admin', mid(ADMIN2));
      expect(await read('members', mid(ADMIN2))).toBeUndefined();
      const profile = await read('users', ADMIN2.uid);
      expect({ step1, orgId: profile?.orgId, role: profile?.role, ...(await powers(ADMIN2)) })
        .toEqual({ step1: false, orgId: '', role: 'employee', readsTreasury: false, editsMembers: false });
    });
  });

  describe('findings: profiles re-pointed BEFORE the fix (data already planted): the domain ignores the claim', () => {
    const plant = (u: U, memberId: string) => seed(f => setDoc(doc(f, 'users', u.uid), { memberId }, { merge: true }));

    it('[I1] (planted) the admin\'s routine edits of the record a profile names never copy its role onto that profile, nor re-point an invitation to it', async () => {
      await plant(EMP, mid(ADMIN));
      await appUpdateMember(ADMIN, 'org_admin', mid(ADMIN), { userName: 'Acme Admin', phone: '0100' });
      await plant(EMP2, mid(FIN));
      await appUpdateMember(ADMIN, 'org_admin', mid(FIN), { jobTitle: 'Senior accountant', role: 'finance' });
      const pid = `${pendingUserIdForEmail('cfo@acme.test')}_${ORG}`;
      await seed(f => setDoc(doc(f, 'members', pid), { orgId: ORG, userId: pendingUserIdForEmail('cfo@acme.test'), userEmail: 'cfo@acme.test', role: 'org_admin', active: true, userName: 'CFO (invited)' }));
      await plant(CAIRO_EMP, pid); // (another company's profile: never in the query either)
      await seed(f => setDoc(doc(f, 'users', NEWHIRE.uid), { orgId: ORG, role: 'employee', active: true, email: NEWHIRE.email, memberId: pid }));
      await appUpdateMember(ADMIN, 'org_admin', pid, { userName: 'Chief Financial Officer' });
      expect({
        emp: (await read('users', EMP.uid))?.role,
        emp2: (await read('users', EMP2.uid))?.role,
        newhire: (await read('users', NEWHIRE.uid))?.role,
        invitationUserId: (await read('members', pid))?.userId,
        ...(await powers(EMP)),
      }).toEqual({ emp: 'employee', emp2: 'employee', newhire: 'employee', invitationUserId: pendingUserIdForEmail('cfo@acme.test'), readsTreasury: false, editsMembers: false });
    });

    it('[I2] (planted) removal and suspension reach the person\'s profile whatever record it names; a profile naming the removed / suspended record loses it too', async () => {
      await plant(FIN, mid(EMP2));
      await appUpdateMember(ADMIN, 'org_admin', mid(FIN), { active: false });
      expect((await read('users', FIN.uid))).toMatchObject({ active: false, role: 'finance', memberId: mid(FIN) });
      expect(await allows(getDoc(doc(db(FIN), 'paymentAccounts', 'acc-cash')))).toBe(false);
      await appUpdateMember(ADMIN, 'org_admin', mid(FIN), { active: true });
      await plant(FIN, mid(EMP2));
      await appRemoveMember(ADMIN, 'org_admin', mid(FIN));
      expect((await read('users', FIN.uid))).toMatchObject({ orgId: '', role: 'employee' });
      // the org admin variant, removed by the platform owner
      await plant(ADMIN2, mid(EMP2));
      await appRemoveMember(OWNER, 'super_admin', mid(ADMIN2));
      expect((await read('users', ADMIN2.uid))).toMatchObject({ orgId: '', role: 'employee' });
      expect(await powers(ADMIN2)).toEqual({ readsTreasury: false, editsMembers: false });
      // a profile that merely names a suspended record (not the person's) is suspended with it
      await plant(EMP, mid(EMP2));
      await appUpdateMember(ADMIN, 'org_admin', mid(EMP2), { active: false });
      expect((await read('users', EMP.uid))?.active).toBe(false);
      expect((await read('users', EMP.uid))?.role).toBe('employee');
    });

    it('[I2] (legacy duplicate) a profile linked to another live record of the SAME person keeps it when one of the two is removed', async () => {
      // FIN has two records in ORG (an old pending invitation it linked, and its uid record)
      const pid = `${pendingUserIdForEmail(FIN.email)}_${ORG}`;
      await seed(async f => {
        await setDoc(doc(f, 'members', pid), { orgId: ORG, userId: pendingUserIdForEmail(FIN.email), userEmail: FIN.email, role: 'finance', active: true, userName: 'Fin (old)' });
        await setDoc(doc(f, 'users', FIN.uid), { memberId: pid }, { merge: true });
      });
      await appRemoveMember(ADMIN, 'org_admin', mid(FIN));
      expect((await read('users', FIN.uid))).toMatchObject({ orgId: ORG, role: 'finance', memberId: pid });
      expect(await allows(getDoc(doc(db(FIN), 'paymentAccounts', 'acc-cash')))).toBe(true);
    });
  });

  // =============================================================================
  // COVERAGE: attacks that the round-2 fixes refuse
  // =============================================================================
  describe('users/{uid}.verifiedEmail', () => {
    it('own profile: unverified token, other verified address, case / whitespace / type variants are refused, on create and on update', async () => {
      const victim = 'cfo@other.test';
      // create (no profile yet)
      await assertFails(setDoc(doc(db(STRANGER, false, victim), 'users', STRANGER.uid), { verifiedEmail: victim }));
      await assertFails(setDoc(doc(db(STRANGER, false), 'users', STRANGER.uid), { verifiedEmail: STRANGER.email }));
      await assertFails(setDoc(doc(db(STRANGER), 'users', STRANGER.uid), { verifiedEmail: victim }));
      for (const v of ['Stranger@evil.test', ' stranger@evil.test', 'stranger@evil.test ', 'STRANGER@EVIL.TEST', ['stranger@evil.test'], { e: 'stranger@evil.test' }, true]) {
        await assertFails(setDoc(doc(db(STRANGER), 'users', STRANGER.uid), { verifiedEmail: v }));
      }
      // a token whose email has capitals still records the lower-case form only
      await assertFails(setDoc(doc(db(STRANGER, true, 'Stranger@Evil.test'), 'users', STRANGER.uid), { verifiedEmail: 'Stranger@Evil.test' }));
      await assertSucceeds(setDoc(doc(db(STRANGER, true, 'Stranger@Evil.test'), 'users', STRANGER.uid), { verifiedEmail: 'stranger@evil.test' }));
      // update (profile exists)
      await assertFails(updateDoc(doc(db(EMP, false), 'users', EMP.uid), { verifiedEmail: EMP.email }));
      await assertFails(updateDoc(doc(db(EMP), 'users', EMP.uid), { verifiedEmail: victim }));
      await assertFails(setDoc(doc(db(EMP, true, victim), 'users', EMP.uid), { verifiedEmail: EMP.email }, { merge: true }));
      await assertSucceeds(setDoc(doc(db(EMP), 'users', EMP.uid), { verifiedEmail: EMP.email }, { merge: true }));
      // with the proof recorded, it cannot be swapped for another address by an unverified token
      await assertFails(setDoc(doc(db(EMP, false, victim), 'users', EMP.uid), { verifiedEmail: victim }, { merge: true }));
      // the proof cannot ride on a self-written role change either
      await assertFails(setDoc(doc(db(STRANGER), 'users', STRANGER.uid), { verifiedEmail: STRANGER.email, orgId: ORG, role: 'employee' }, { merge: true }));
    });

    it('org admin / multi-company admin / other company: can neither add, change nor remove it (create, update, merge, batch)', async () => {
      await setDoc(doc(db(EMP), 'users', EMP.uid), { verifiedEmail: EMP.email }, { merge: true });
      const a = db(ADMIN);
      await assertFails(setDoc(doc(a, 'users', STRANGER.uid), { orgId: ORG, role: 'employee', active: true, verifiedEmail: 'cfo@other.test' }));
      await assertFails(setDoc(doc(a, 'users', STRANGER.uid), { orgId: ORG, role: 'employee', active: true, verifiedEmail: null }));
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { verifiedEmail: 'cfo@other.test' }));
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { verifiedEmail: deleteField() }));
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { verifiedEmail: 'EMP@acme.test' }));
      await assertFails(setDoc(doc(a, 'users', EMP.uid), { orgId: ORG, role: 'employee', active: true, memberId: mid(EMP) }));
      await assertFails(updateDoc(doc(a, 'users', EMP2.uid), { verifiedEmail: EMP2.email }));
      await assertFails(updateDoc(doc(db(MULTI_ADMIN), 'users', EMP.uid), { verifiedEmail: 'x@y.z' }));
      await assertFails(updateDoc(doc(db(CAIRO_ADMIN), 'users', EMP.uid), { verifiedEmail: CAIRO_ADMIN.email }));
      // batch: the admin creates a profile and the attacker account proves an address in the same commit is impossible
      // (one auth per commit); an admin batch carrying the field is refused as a whole
      await assertFails(writeBatch(a).set(doc(a, 'users', STRANGER.uid), { orgId: ORG, role: 'employee', active: true })
        .set(doc(a, 'users', STRANGER.uid), { verifiedEmail: 'cfo@other.test' }, { merge: true }).commit());
      // the admin's ordinary edits keep it
      await assertSucceeds(updateDoc(doc(a, 'users', EMP.uid), { name: 'Emp', phone: '1' }));
      expect((await read('users', EMP.uid))?.verifiedEmail).toBe(EMP.email);
    });

    it('a proof the account never recorded links nobody: the owner adds that email to another company as an invitation', async () => {
      // ADMIN pairs STRANGER with the victim's address in ORG, and the profile with the address (admin-written email field)
      await assertSucceeds(setDoc(doc(db(ADMIN), 'members', mid(STRANGER)), { orgId: ORG, userId: STRANGER.uid, userEmail: 'cfo@other.test', role: 'employee', active: true, userName: 'x' }));
      await assertSucceeds(setDoc(doc(db(ADMIN), 'users', STRANGER.uid), { orgId: ORG, role: 'employee', active: true, email: 'cfo@other.test', memberId: mid(STRANGER) }));
      const owner = db(OWNER);
      expect(await verifiedLoginUidOf(await allMembers(owner), 'cfo@other.test', verifiedEmailVia(owner))).toBe('');
    });
  });

  describe('users/{uid}.memberId (round 3)', () => {
    it('a self-write changes memberId only with the self-link to a membership granted to the caller; an org admin\'s own profile is a self-write', async () => {
      for (const target of [mid(ADMIN), mid(FIN), mid(EMP2), `${pendingUserIdForEmail('cfo@acme.test')}_${ORG}`, 'nope', '']) {
        await assertFails(setDoc(doc(db(EMP), 'users', EMP.uid), { memberId: target }, { merge: true }));
      }
      await assertFails(updateDoc(doc(db(EMP), 'users', EMP.uid), { memberId: deleteField() }));
      await assertFails(updateDoc(doc(db(EMP), 'users', EMP.uid), { memberId: null }));
      await assertFails(updateDoc(doc(db(ADMIN2), 'users', ADMIN2.uid), { memberId: mid(EMP2) }));
      await assertFails(updateDoc(doc(db(ADMIN2), 'users', ADMIN2.uid), { role: 'org_admin', orgId: ORG, active: true, memberId: mid(EMP2) }));
      await assertFails(updateDoc(doc(db(MULTI_ADMIN), 'users', MULTI_ADMIN.uid), { memberId: mid(MULTI_ADMIN) }));   // role / org do not match it
      // a profile without a company may clear it; the org admin still edits other profiles' memberId
      await seed(f => setDoc(doc(f, 'users', STRANGER.uid), { orgId: '', role: 'employee', memberId: 'old' }));
      await assertSucceeds(updateDoc(doc(db(STRANGER), 'users', STRANGER.uid), { memberId: null }));
      await assertFails(updateDoc(doc(db(STRANGER), 'users', STRANGER.uid), { memberId: mid(EMP) }));
      await assertSucceeds(updateDoc(doc(db(ADMIN), 'users', EMP.uid), { memberId: mid(EMP) }));
      // own ordinary edits and the self-link / resync keep working
      await assertSucceeds(updateDoc(doc(db(ADMIN2), 'users', ADMIN2.uid), { name: 'Admin 2', phone: '0100' }));
      await assertSucceeds(updateDoc(doc(db(EMP), 'users', EMP.uid), { name: 'Emp', phone: '0100', instapay: 'e@instapay' }));
      await assertSucceeds(linkOwnProfile(db(MULTI_ADMIN), { ...MULTI_ADMIN, emailVerified: true }, await memberAs(db(MULTI_ADMIN), mid(MULTI_ADMIN))));
      expect(await read('users', MULTI_ADMIN.uid)).toMatchObject({ orgId: ORG, role: 'org_admin', memberId: mid(MULTI_ADMIN) });
    });
  });

  describe('members: re-point, placeholders, self-link, invitee queries', () => {
    it('userId re-point: never away from a real login; a placeholder only to the account whose profile names it in the same commit', async () => {
      const a = db(ADMIN);
      await assertFails(updateDoc(doc(a, 'members', mid(EMP)), { userId: STRANGER.uid }));
      await assertFails(updateDoc(doc(a, 'members', mid(EMP)), { userId: 'pending-x' }));
      await assertFails(updateDoc(doc(a, 'members', mid(EMP)), { userId: 'uidStranger0000000000001-' }));
      for (const ph of ['pending-Y2ZvQGFjbWUudGVzdA', 'temp_123', 'usr-abc']) {
        const id = `${ph}_${ORG}`;
        await seed(f => setDoc(doc(f, 'members', id), { orgId: ORG, userId: ph, userEmail: 'cfo@acme.test', role: 'finance', active: true, userName: 'x' }));
        await assertFails(updateDoc(doc(a, 'members', id), { userId: STRANGER.uid }));                 // no profile names it
        await assertFails(updateDoc(doc(a, 'members', id), { userId: 'temp_999' }));                   // to another placeholder
        await assertFails(updateDoc(doc(a, 'members', id), { userId: CAIRO_EMP.uid }));                // another company's person
        // linking someone else's membership to a profile in the same commit: the admin cannot write a
        // profile of another company, and the profile in its own company must name it
        await assertFails(writeBatch(a).update(doc(a, 'members', id), { userId: CAIRO_EMP.uid })
          .update(doc(a, 'users', CAIRO_EMP.uid), { memberId: id }).commit());
      }
      // other company's admin and an employee cannot touch it at all
      await assertFails(updateDoc(doc(db(CAIRO_ADMIN), 'members', mid(EMP)), { role: 'org_admin' }));
      await assertFails(updateDoc(doc(db(EMP), 'members', mid(EMP)), { role: 'org_admin' }));
      await assertFails(updateDoc(doc(db(EMP), 'members', mid(EMP)), { userEmail: 'admin@acme.test' }));
      await assertFails(updateDoc(doc(db(EMP), 'members', mid(EMP)), { iban: 'EG00' }));
      await assertSucceeds(updateDoc(doc(db(EMP), 'members', mid(EMP)), { phone: '0100' }));
    });

    it('create: id must be <userId>_<orgId> of the admin\'s company; no super_admin, no payout, no other company', async () => {
      const a = db(ADMIN);
      const base = { userEmail: 'x@acme.test', role: 'employee', active: true, userName: 'x' };
      await assertFails(setDoc(doc(a, 'members', `pending-x_${OTHER_ORG}`), { ...base, orgId: OTHER_ORG, userId: 'pending-x' }));
      await assertFails(setDoc(doc(a, 'members', `pending-x_${ORG}`), { ...base, orgId: OTHER_ORG, userId: 'pending-x' }));
      await assertFails(setDoc(doc(a, 'members', `pending-y_${ORG}`), { ...base, orgId: ORG, userId: 'pending-x' }));
      await assertFails(setDoc(doc(a, 'members', `pending-x_${ORG}`), { ...base, orgId: ORG, userId: 'pending-x', role: 'super_admin' }));
      await assertFails(setDoc(doc(a, 'members', `pending-x_${ORG}`), { ...base, orgId: ORG, userId: 'pending-x', iban: 'EG' }));
      await assertFails(setDoc(doc(db(MULTI_ADMIN), 'members', `pending-x_${OTHER_ORG}`), { ...base, orgId: OTHER_ORG, userId: 'pending-x' }));
      await assertFails(setDoc(doc(db(SUSP), 'members', `pending-x_${ORG}`), { ...base, orgId: ORG, userId: 'pending-x' }));
      await assertSucceeds(setDoc(doc(db(MULTI_ADMIN), 'members', `pending-x_${ORG}`), { ...base, orgId: ORG, userId: 'pending-x' }));
    });

    it('self-link: unverified email, wrong role / org, suspended or someone else\'s membership are refused; escalation through the profile is impossible', async () => {
      const pid = `${pendingUserIdForEmail(NEWHIRE.email)}_${ORG}`;
      await seed(async f => {
        await setDoc(doc(f, 'members', pid), { orgId: ORG, userId: pendingUserIdForEmail(NEWHIRE.email), userEmail: NEWHIRE.email, role: 'finance', active: true, userName: 'NH' });
        await setDoc(doc(f, 'members', `pending-susp_${ORG}`), { orgId: ORG, userId: 'pending-susp', userEmail: NEWHIRE.email, role: 'org_admin', active: false, userName: 'NH' });
      });
      const link = (f: Firestore, uid: string, data: Record<string, unknown>) => setDoc(doc(f, 'users', uid), { active: true, ...data }, { merge: true });
      await assertFails(link(db(NEWHIRE, false), NEWHIRE.uid, { orgId: ORG, role: 'finance', memberId: pid }));           // unverified
      await assertFails(link(db(STRANGER, false, NEWHIRE.email), STRANGER.uid, { orgId: ORG, role: 'finance', memberId: pid }));
      await assertFails(link(db(STRANGER, true, 'NEWHIRE@acme.test '), STRANGER.uid, { orgId: ORG, role: 'finance', memberId: pid }));
      await assertFails(link(db(NEWHIRE), NEWHIRE.uid, { orgId: ORG, role: 'org_admin', memberId: pid }));                // wrong role
      await assertFails(link(db(NEWHIRE), NEWHIRE.uid, { orgId: OTHER_ORG, role: 'finance', memberId: pid }));            // wrong org
      await assertFails(link(db(NEWHIRE), NEWHIRE.uid, { orgId: ORG, role: 'org_admin', memberId: `pending-susp_${ORG}` })); // suspended
      await assertFails(link(db(NEWHIRE), NEWHIRE.uid, { orgId: ORG, role: 'finance', memberId: mid(FIN) }));            // FIN's
      await assertFails(link(db(NEWHIRE), NEWHIRE.uid, { orgId: ORG, role: 'finance', memberId: `../members/${mid(FIN)}` }));
      await assertFails(link(db(EMP), EMP.uid, { role: 'org_admin', memberId: mid(EMP) }));
      await assertFails(link(db(EMP), EMP.uid, { role: 'org_admin', memberId: mid(ADMIN) }));
      await assertFails(link(db(EMP), EMP.uid, { orgId: OTHER_ORG }));
      await assertFails(updateDoc(doc(db(EMP), 'users', EMP.uid), { role: 'super_admin', orgId: '' }));
      await assertFails(updateDoc(doc(db(SUSP), 'users', SUSP.uid), { active: true }));
      await assertFails(updateDoc(doc(db(SUSP), 'users', SUSP.uid), { active: true, memberId: mid(SUSP) }));
      // a member of another company cannot re-point itself into ORG through an ORG membership naming it by a variant email
      await seed(f => setDoc(doc(f, 'members', `pending-cairo_${ORG}`), { orgId: ORG, userId: 'pending-cairo', userEmail: ' Emp@Other.test', role: 'finance', active: true, userName: 'x' }));
      await assertFails(link(db(CAIRO_EMP), CAIRO_EMP.uid, { orgId: ORG, role: 'finance', memberId: `pending-cairo_${ORG}` }));
      // control: verified invitee
      await assertSucceeds(link(db(NEWHIRE), NEWHIRE.uid, { orgId: ORG, role: 'finance', memberId: pid }));
    });

    it('invitee get / list need a verified token; other people\'s invitations stay hidden', async () => {
      const pid = `${pendingUserIdForEmail(NEWHIRE.email)}_${ORG}`;
      await seed(f => setDoc(doc(f, 'members', pid), { orgId: ORG, userId: pendingUserIdForEmail(NEWHIRE.email), userEmail: NEWHIRE.email, role: 'org_admin', active: true, userName: 'NH', phone: '0100' }));
      const q = (f: Firestore, e: string) => getDocs(query(collection(f, 'members'), where('userEmail', '==', e)));
      await assertFails(getDoc(doc(db(STRANGER, false, NEWHIRE.email), 'members', pid)));
      await assertFails(q(db(STRANGER, false, NEWHIRE.email), NEWHIRE.email));
      await assertFails(getDoc(doc(db(STRANGER), 'members', pid)));
      await assertFails(q(db(STRANGER), NEWHIRE.email));
      await assertFails(q(db(STRANGER, true, NEWHIRE.email), 'NewHire@acme.test'));
      await assertFails(getDocs(query(collection(db(STRANGER), 'members'), where('orgId', '==', ORG))));
      await assertFails(getDocs(collection(db(CAIRO_EMP), 'members')));
      await assertSucceeds(getDoc(doc(db(NEWHIRE), 'members', pid)));
      await assertSucceeds(q(db(NEWHIRE), NEWHIRE.email));
    });

    it('protected memberships: the owner\'s and one\'s own cannot be deleted, suspended, re-roled or re-addressed by an org admin', async () => {
      const a = db(ADMIN);
      await assertFails(deleteDoc(doc(a, 'members', mid(OWNER))));
      await assertFails(updateDoc(doc(a, 'members', mid(OWNER)), { role: 'employee' }));
      await assertFails(updateDoc(doc(a, 'members', mid(OWNER)), { active: false }));
      await assertFails(updateDoc(doc(a, 'members', mid(OWNER)), { userEmail: 'x@acme.test' }));
      await assertFails(deleteDoc(doc(a, 'members', mid(ADMIN))));
      await assertFails(updateDoc(doc(a, 'members', mid(ADMIN)), { role: 'finance' }));
      await assertFails(updateDoc(doc(a, 'members', mid(ADMIN)), { userEmail: 'other@acme.test' }));
      await assertFails(deleteDoc(doc(db(MULTI_ADMIN), 'members', mid(MULTI_ADMIN))));
      await assertFails(updateDoc(doc(db(MULTI_ADMIN), 'members', mid(MULTI_ADMIN, OTHER_ORG)), { role: 'org_admin' }));
      // suspended admin: nothing
      await assertFails(updateDoc(doc(db(SUSP), 'members', mid(EMP)), { role: 'finance' }));
      await assertFails(deleteDoc(doc(db(SUSP), 'members', mid(EMP))));
      await assertFails(updateDoc(doc(db(SUSP), 'users', EMP.uid), { role: 'finance' }));
      await assertFails(updateDoc(doc(db(SUSP), 'members', mid(SUSP)), { active: true }));
      // name / contact of the owner's record stays editable
      await assertSucceeds(updateDoc(doc(a, 'members', mid(OWNER)), { phone: '0100' }));
    });

    it('profiles: an org admin never moves a profile to another company, never grants super_admin, never touches another company\'s profiles', async () => {
      const a = db(ADMIN);
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { orgId: OTHER_ORG }));
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { role: 'super_admin' }));
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { orgId: '', role: 'org_admin' }));
      await assertFails(updateDoc(doc(a, 'users', CAIRO_EMP.uid), { name: 'x' }));
      await assertFails(setDoc(doc(a, 'users', STRANGER.uid), { orgId: OTHER_ORG, role: 'employee', active: true }));
      await assertFails(updateDoc(doc(db(MULTI_ADMIN), 'users', CAIRO_EMP.uid), { role: 'finance' }));
      await assertFails(updateDoc(doc(db(MULTI_ADMIN), 'users', MULTI_ADMIN.uid), { orgId: ORG, role: 'org_admin' })); // no memberId
      await assertSucceeds(updateDoc(doc(db(MULTI_ADMIN), 'users', EMP.uid), { phone: '1' }));
    });
  });

  // =============================================================================
  // LEGITIMACY: provisioning flows (real domain functions, real roles)
  // =============================================================================
  describe('provisioning flows', () => {
    it('createCompanyUser: a fresh login gets its first company (with profile) and the other companies under the same UID', async () => {
      // AppContext.createCompanyUser → createMember(..., { writeUserProfile: true }) by the owner
      const first = await createMember(store(OWNER), actor(OWNER, 'super_admin'), {
        orgId: ORG, userId: FRESH.uid, userName: 'Fresh', userEmail: FRESH.email, role: 'finance', department: 'F', jobTitle: 'Acc', active: true, phone: '',
      } as any, key(), { writeUserProfile: true });
      expect(first.value.id).toBe(mid(FRESH));
      // OrganizationsManagement → addMemberToOrgs({ userId: res.uid }) → createMemberInOrgs
      const more = await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: FRESH.uid, userName: 'Fresh', userEmail: FRESH.email, role: 'employee', department: 'F', jobTitle: 'Acc', active: true } as any, [OTHER_ORG], key());
      expect(more.value.created[0].id).toBe(mid(FRESH, OTHER_ORG));
      const fresh = db(FRESH, false);           // an admin-provisioned password account is unverified
      await assertSucceeds(getDoc(doc(fresh, 'paymentAccounts', 'acc-cash')));
      await assertSucceeds(getDoc(doc(fresh, 'members', mid(FRESH, OTHER_ORG))));
      // same by an org admin, in its own company
      const g: U = { uid: 'uidFreshAcct00000000000002', email: 'fresh2@acme.test' };
      await createMember(store(ADMIN), actor(ADMIN, 'org_admin', ORG), {
        orgId: ORG, userId: g.uid, userName: 'Fresh2', userEmail: g.email, role: 'employee', department: 'D', jobTitle: 'J', active: true, phone: '',
      } as any, key(), { writeUserProfile: true });
      expect((await read('users', g.uid))).toMatchObject({ orgId: ORG, role: 'employee', memberId: mid(g) });
      // ... and by a multi-company org admin (profile elsewhere)
      const h: U = { uid: 'uidFreshAcct00000000000003', email: 'fresh3@acme.test' };
      await createMember(store(MULTI_ADMIN), actor(MULTI_ADMIN, 'org_admin', ORG), {
        orgId: ORG, userId: h.uid, userName: 'Fresh3', userEmail: h.email, role: 'employee', department: 'D', jobTitle: 'J', active: true, phone: '',
      } as any, key(), { writeUserProfile: true });
      expect((await read('users', h.uid))).toMatchObject({ orgId: ORG, memberId: mid(h) });
    });

    it('addMember of an existing VERIFIED user re-uses its UID; of an unverified one creates a pending invitation that opens after verification', async () => {
      // EMP2 has signed in with a verified token: AppContext recorded its proof
      await setDoc(doc(db(EMP2), 'users', EMP2.uid), { verifiedEmail: EMP2.email }, { merge: true });
      const owner = db(OWNER);
      const uid = await verifiedLoginUidOf(await allMembers(owner), EMP2.email, verifiedEmailVia(owner));
      expect(uid).toBe(EMP2.uid);
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: uid, userName: 'E2', userEmail: EMP2.email, role: 'finance', department: 'F', jobTitle: 'J', active: true } as any, [OTHER_ORG], key());
      await assertSucceeds(getDoc(doc(db(EMP2), 'paymentAccounts', 'acc-ob')));

      // EMP never proved its address (admin-provisioned password account, unverified)
      expect(await verifiedLoginUidOf(await allMembers(owner), EMP.email, verifiedEmailVia(owner))).toBe('');
      const res = await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: '', userName: 'E', userEmail: EMP.email, role: 'finance', department: 'F', jobTitle: 'J', active: true } as any, [OTHER_ORG], key());
      const inv = res.value.created[0] as OrganizationMember;
      expect(inv.userId).toBe(pendingUserIdForEmail(EMP.email));
      // before verification: no access, cannot read or take the invitation
      await assertFails(getDoc(doc(db(EMP, false), 'paymentAccounts', 'acc-ob')));
      await assertFails(getDoc(doc(db(EMP, false), 'members', inv.id)));
      await assertFails(linkOwnProfile(db(EMP, false), { ...EMP, emailVerified: false }, inv));
      // after verification: AppContext records the proof, then the profile relinks to the invitation
      await assertSucceeds(setDoc(doc(db(EMP), 'users', EMP.uid), { verifiedEmail: EMP.email }, { merge: true }));
      await assertSucceeds(getDoc(doc(db(EMP), 'members', inv.id)));
      await assertSucceeds(linkOwnProfile(db(EMP), { ...EMP, emailVerified: true }, inv));
      await assertSucceeds(getDoc(doc(db(EMP), 'paymentAccounts', 'acc-ob')));
      // now proven: a later add re-uses the UID
      expect(await verifiedLoginUidOf(await allMembers(owner), EMP.email, verifiedEmailVia(owner))).toBe(EMP.uid);
    });

    it('a brand-new Google user (no profile) with a pending invitation: proof + self-link on first sign-in', async () => {
      const pid = `${pendingUserIdForEmail(NEWHIRE.email)}_${ORG}`;
      await createMember(store(ADMIN), actor(ADMIN, 'org_admin', ORG),
        { orgId: ORG, userId: '', userName: 'NH', userEmail: NEWHIRE.email, role: 'finance', department: 'F', jobTitle: 'J', active: true, phone: '' } as any, key());
      expect(await read('members', pid)).toMatchObject({ userId: pendingUserIdForEmail(NEWHIRE.email) });
      const nh = db(NEWHIRE);
      await assertSucceeds(linkOwnProfile(nh, { ...NEWHIRE, emailVerified: true }, await memberAs(nh, pid)));
      await assertSucceeds(setDoc(doc(nh, 'users', NEWHIRE.uid), { verifiedEmail: NEWHIRE.email }, { merge: true }));
      await assertSucceeds(getDoc(doc(nh, 'paymentAccounts', 'acc-cash')));
      // the admin's next edit moves the placeholder to the linked account (userIdChangeOk)
      await appUpdateMember(ADMIN, 'org_admin', pid, { userName: 'New Hire' });
      expect((await read('members', pid))?.userId).toBe(NEWHIRE.uid);
    });

    it('routine admin edits, suspension and removal keep working for honest profiles', async () => {
      await appUpdateMember(ADMIN, 'org_admin', mid(FIN), { userName: 'Fin', role: 'employee' });
      expect(await read('users', FIN.uid)).toMatchObject({ role: 'employee', name: 'Fin' });
      await appUpdateMember(ADMIN, 'org_admin', mid(EMP), { active: false });
      expect(await read('users', EMP.uid)).toMatchObject({ active: false });
      await assertFails(getDoc(doc(db(EMP), 'members', mid(EMP2))));
      await appRemoveMember(ADMIN, 'org_admin', mid(EMP2));
      expect(await read('users', EMP2.uid)).toMatchObject({ orgId: '', role: 'employee' });
      await appRemoveMember(OWNER, 'super_admin', mid(ADMIN2));
      expect(await read('users', ADMIN2.uid)).toMatchObject({ orgId: '', role: 'employee' });
      // the admin's own relink (name resync) still passes: memberId + role + orgId of its own membership
      await assertSucceeds(linkOwnProfile(db(ADMIN), { ...ADMIN, emailVerified: true }, await memberAs(db(ADMIN), mid(ADMIN))));
    });
  });
});

// =============================================================================
// Round r3, money lane. Each section seeds its own data (its own accounts, users and helpers).
// =============================================================================
/**
 * Round r3, money lane (attacker + regression of the round r1 / r2 money fixes).
 *
 * The attacker is finance / org admin of a company using the raw Firestore Web SDK (batches with
 * chosen ids and fields). Legitimate flows run the REAL domain functions (src/domain/*).
 *
 * Tests named [M3-n] demonstrate a finding: they assert the secure outcome and FAIL while the
 * attack works. Everything else is coverage (variants that the round r1 / r2 fixes refuse, and
 * the heaviest legitimate flows against the 20-read / 1000-expression budgets).
 *
 * R3_RULES=<path> loads another rules file (used to pad one allow statement and measure the
 * expression margin of the heaviest flows; never set for the normal run).
 */
describe('round r3: money lane ([M3-1] InstaPay mirror reference, [M3-2] detach correction, [M3-3] whole cents)', () => {
  const ORG = 'org-acme';
  const OTHER_ORG = 'org-other';
  const THIRD_ORG = 'org-third';
  const X = ['org-x0', 'org-x1', 'org-x2', 'org-x3', 'org-x4'];

  const OWNER = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
  const ADMIN = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
  const EMP = { uid: 'uidEmployee0000000000000001', email: 'emp@acme.test' };
  const EMP2 = { uid: 'uidEmployee0000000000000002', email: 'emp2@acme.test' };
  const FIN = { uid: 'uidFinance00000000000000001', email: 'fin@acme.test' };
  const CAIRO_FIN = { uid: 'uidCairoFin00000000000001', email: 'fin@other.test' };
  const MULTI_FIN = { uid: 'uidMultiFin00000000000001', email: 'multi@other.test' };   // profile OTHER (employee), finance member of ORG
  const MULTI3 = { uid: 'uidMultiFin00000000000003', email: 'multi3@third.test' };    // profile THIRD (employee), finance member of ORG
  const MULTI_ADMIN = { uid: 'uidMultiAdmin00000000001', email: 'madmin@third.test' }; // profile THIRD (employee), org admin member of ORG
  const BOTH_FIN = { uid: 'uidBothFin000000000000001', email: 'both@acme.test' };      // finance in ORG (profile) and OTHER (member)

  const db = (u: { uid: string; email: string }, verified = true): Firestore =>
    env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore() as unknown as Firestore;
  const store = (u: { uid: string; email: string }) => createFirestoreStore(db(u));
  const actor = (u: { uid: string; email: string }, role: Actor['role'], orgId?: string): Actor => ({ id: u.uid, name: u.email, email: u.email, role, ...(orgId ? { orgId } : {}) });
  const notifyAll = {
    settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: true, notifyOnNewRequest: true, notifyOnApproval: true, notifyOnDisbursement: true, notifyOnClarification: true, notifyOnRejection: true },
    adminRecipients: ['mahmoud@tieapps.com'],
  };
  let n = 0;
  const key = () => `key-r3m${String(++n).padStart(7, '0')}`;
  const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));
  const read = async (c: string, id: string) => {
    let data: Record<string, any> | undefined;
    await env.withSecurityRulesDisabled(async ctx => {
      data = (await getDoc(doc(ctx.firestore(), c, id))).data();
    });
    return data;
  };
  const ok = (p: Promise<unknown>) => p.then(() => true, (e: any) => { lastError = String(e?.message || e); return false; });
  let lastError = '';

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
  // A ledger line as createMovementBatch writes it, attributed to `by`.
  const line = (id: string, accountId: string, type: 'in' | 'out', amount: number, before: number, after: number, refType: string, refId: string, by = FIN, extra: Record<string, unknown> = {}) => ({
    id, operationLedgerId: id, orgId: ORG, accountId, accountName: accountId, type, amount, balanceBefore: before, balanceAfter: after,
    referenceType: refType, referenceId: refId, description: 'x', actorName: by.email, actorId: by.uid, createdAt: '2026-10-03T00:00:00.000Z', ...extra,
  });
  const balance = async (id: string) => (await read('paymentAccounts', id))!.currentBalance as number;


  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      for (const o of [ORG, OTHER_ORG, THIRD_ORG, ...X]) {
        await setDoc(doc(f, 'organizations', o), { id: o, name: o, code: o.toUpperCase(), currency: 'EGP', notificationRecipients: [ADMIN.email, 'a2@acme.test', 'a3@acme.test'] });
      }
      for (const [u, role, org] of [
        [ADMIN, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [EMP2, 'employee', ORG], [CAIRO_FIN, 'finance', OTHER_ORG],
      ] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true, memberId: `${u.uid}_${org}` });
        await setDoc(doc(f, 'members', `${u.uid}_${org}`), { orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      await setDoc(doc(f, 'users', MULTI_FIN.uid), { orgId: OTHER_ORG, role: 'employee', active: true });
      await setDoc(doc(f, 'members', `${MULTI_FIN.uid}_${ORG}`), { orgId: ORG, userId: MULTI_FIN.uid, userEmail: MULTI_FIN.email, role: 'finance', active: true });
      await setDoc(doc(f, 'users', MULTI3.uid), { orgId: THIRD_ORG, role: 'employee', active: true });
      await setDoc(doc(f, 'members', `${MULTI3.uid}_${ORG}`), { orgId: ORG, userId: MULTI3.uid, userEmail: MULTI3.email, role: 'finance', active: true });
      await setDoc(doc(f, 'users', MULTI_ADMIN.uid), { orgId: THIRD_ORG, role: 'employee', active: true });
      await setDoc(doc(f, 'members', `${MULTI_ADMIN.uid}_${ORG}`), { orgId: ORG, userId: MULTI_ADMIN.uid, userEmail: MULTI_ADMIN.email, role: 'org_admin', active: true });
      await setDoc(doc(f, 'users', BOTH_FIN.uid), { orgId: ORG, role: 'finance', active: true });
      await setDoc(doc(f, 'members', `${BOTH_FIN.uid}_${ORG}`), { orgId: ORG, userId: BOTH_FIN.uid, userEmail: BOTH_FIN.email, role: 'finance', active: true });
      await setDoc(doc(f, 'members', `${BOTH_FIN.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: BOTH_FIN.uid, userEmail: BOTH_FIN.email, role: 'finance', active: true });
      await setDoc(doc(f, 'super_admins', 'someone-else'), { email: 'x@y.z' });
      await setDoc(doc(f, 'system_settings', 'notification_recipients'), { emails: ['ops@tieapps.com'] });
      await setDoc(doc(f, 'system_settings', 'email_notifications'), { ...DEFAULT_EMAIL_SETTINGS, enabled: true });

      await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), account('acc-cash', 1000));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank'), account('acc-bank', 5000, { type: 'bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-insta'), account('acc-insta', 5000, { type: 'instapay', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank2'), account('acc-bank2', 3000, { type: 'bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-insta2'), account('acc-insta2', 3000, { type: 'instapay', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-o'), account('acc-o', 1000, { orgId: OTHER_ORG }));

      await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0 });
      // shared service owned by org-x0, ORG listed SIXTH (index 5): the member-based get walks the whole list
      await setDoc(doc(f, 'services', 'srv-wide'), { orgId: X[0], orgIds: [...X, ORG], name: 'Wide', code: 'WIDE', spentAmount: 0 });
      await setDoc(doc(f, 'providers', 'prov-1'), { orgId: ORG, name: 'Vodafone', totalPaid: 500, active: true });
    });
  });

  // =============================================================================
  // Findings
  // =============================================================================
  describe('findings', () => {
    // ---------------------------------------------------------------------------
    // M3-1: the InstaPay mirror line <lid>-parent is only checked for type and amount. Its
    // reference (referenceType / referenceId) is free, so the bank's ONE movement can also be
    // the line of a SECOND operation (custody issue / custody return / request payment) that
    // names the bank. One real money movement then explains two operations.
    // ---------------------------------------------------------------------------
    it('[M3-1] one bank outflow issues TWO custodies (InstaPay line + its bank mirror), returning both mints 300 in the bank', async () => {
      const f = db(FIN);
      const issued = await ok(writeBatch(f)
        // custody cus-a issued from the InstaPay (domain shape)
        .set(doc(f, 'accountTransactions', 'tx-dup1'), line('tx-dup1', 'acc-insta', 'out', 300, 5000, 4700, 'custody', 'cus-a'))
        .update(doc(f, 'paymentAccounts', 'acc-insta'), { currentBalance: 4700, balance: 4700, totalOut: 300, updatedAt: 'x', lastLedgerId: 'tx-dup1' })
        .set(doc(f, 'custodies', 'cus-a'), { ...custody('cus-a', { totalAmount: 300, remainingAmount: 300, sourceAccountId: 'acc-insta' }), lastLedgerId: 'tx-dup1' })
        // the bank's mirror of that movement is ALSO the issue line of custody cus-b (source: the bank)
        .set(doc(f, 'accountTransactions', 'tx-dup1-parent'), line('tx-dup1-parent', 'acc-bank', 'out', 300, 5000, 4700, 'custody', 'cus-b'))
        .update(doc(f, 'paymentAccounts', 'acc-bank'), { currentBalance: 4700, balance: 4700, totalOut: 300, updatedAt: 'x', lastLedgerId: 'tx-dup1-parent' })
        .set(doc(f, 'custodies', 'cus-b'), { ...custody('cus-b', { employeeId: EMP2.uid, employeeEmail: EMP2.email, totalAmount: 300, remainingAmount: 300, sourceAccountId: 'acc-bank' }), lastLedgerId: 'tx-dup1-parent' })
        .commit());
      if (issued) {
        // both holders hand back their (never fully funded) 300 through the real domain
        await returnCustodyRemainders(store(FIN), actor(FIN, 'finance'), { custodyIds: ['cus-a', 'cus-b'], targetAccountId: 'acc-bank' }, key());
      }
      console.log('[M3-1 observed issue]', { issued, bank: await balance('acc-bank'), insta: await balance('acc-insta'), a: await read('custodies', 'cus-a'), b: (await read('custodies', 'cus-b'))?.status });
      // issuing both through the domain takes 600 from the bank; returning both puts 600 back: 5000
      expect(issued).toBe(false);
      expect(await balance('acc-bank')).toBe(5000);
    });

    it('[M3-1] (return variant) one bank inflow closes TWO custodies: the second holder keeps 300 that never came back', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'custodies', 'cus-r1'), custody('cus-r1', { totalAmount: 300, remainingAmount: 300 }));
        await setDoc(doc(f, 'custodies', 'cus-r2'), custody('cus-r2', { employeeId: EMP2.uid, employeeEmail: EMP2.email, totalAmount: 300, remainingAmount: 300 }));
      });
      const f = db(FIN);
      const ret = (id: string, acc: string, lid: string) => ({
        remainingAmount: 0, returnedAmount: 300, status: 'settled', settledAt: 'x', returnedAt: 'x', returnedToAccountId: acc, returnedToAccountName: acc, updatedAt: 'x', lastLedgerId: lid,
      });
      const closed = await ok(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-ret1'), line('tx-ret1', 'acc-insta', 'in', 300, 5000, 5300, 'custody_return', 'cus-r1'))
        .update(doc(f, 'paymentAccounts', 'acc-insta'), { currentBalance: 5300, balance: 5300, totalIn: 300, updatedAt: 'x', lastLedgerId: 'tx-ret1' })
        .update(doc(f, 'custodies', 'cus-r1'), ret('cus-r1', 'acc-insta', 'tx-ret1'))
        .set(doc(f, 'accountTransactions', 'tx-ret1-parent'), line('tx-ret1-parent', 'acc-bank', 'in', 300, 5000, 5300, 'custody_return', 'cus-r2'))
        .update(doc(f, 'paymentAccounts', 'acc-bank'), { currentBalance: 5300, balance: 5300, totalIn: 300, updatedAt: 'x', lastLedgerId: 'tx-ret1-parent' })
        .update(doc(f, 'custodies', 'cus-r2'), ret('cus-r2', 'acc-bank', 'tx-ret1-parent'))
        .commit());
      console.log('[M3-1 observed return]', { closed, bank: await balance('acc-bank'), r1: (await read('custodies', 'cus-r1'))!.status, r2: (await read('custodies', 'cus-r2'))!.status });
      // two returns of 300 put 600 in the bank (the InstaPay one through its mirror)
      expect(closed).toBe(false);
    });

    it('[M3-1] (request variant) one bank outflow pays TWO approved requests (r and r-parent): the budget counts 600, the bank paid 300', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'rq'), approvedRequest('rq', 300, { serviceCategoryId: 'srv-1' }));
        await setDoc(doc(f, 'requests', 'rq-parent'), approvedRequest('rq-parent', 300, { requesterId: EMP2.uid, requesterEmail: EMP2.email }));
      });
      const f = db(FIN);
      const paid = await ok(writeBatch(f)
        .update(doc(f, 'requests', 'rq'), { status: 'disbursed', disbursement: { accountId: 'acc-insta' } })
        .set(doc(f, 'accountTransactions', 'tx-req-rq'), line('tx-req-rq', 'acc-insta', 'out', 300, 5000, 4700, 'request', 'rq'))
        .update(doc(f, 'paymentAccounts', 'acc-insta'), { currentBalance: 4700, balance: 4700, totalOut: 300, updatedAt: 'x', lastLedgerId: 'tx-req-rq' })
        .update(doc(f, 'services', 'srv-1'), { spentAmount: 300, lastDisbursedRequestId: 'rq', updatedAt: 'x' })
        // the bank's mirror of rq's payment is also the payment line of request rq-parent
        .update(doc(f, 'requests', 'rq-parent'), { status: 'disbursed', disbursement: { accountId: 'acc-bank' } })
        .set(doc(f, 'accountTransactions', 'tx-req-rq-parent'), line('tx-req-rq-parent', 'acc-bank', 'out', 300, 5000, 4700, 'request', 'rq-parent'))
        .update(doc(f, 'paymentAccounts', 'acc-bank'), { currentBalance: 4700, balance: 4700, totalOut: 300, updatedAt: 'x', lastLedgerId: 'tx-req-rq-parent' })
        .commit());
      console.log('[M3-1 observed requests]', { paid, bank: await balance('acc-bank'), rq: (await read('requests', 'rq'))!.status, rqp: (await read('requests', 'rq-parent'))!.status });
      expect(paid).toBe(false);
    });

    it('coverage: the domain-shaped mirror (same reference as the InstaPay line) still passes for the same operations', async () => {
      const f = db(FIN);
      await assertSucceeds(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-ok1'), line('tx-ok1', 'acc-insta', 'out', 300, 5000, 4700, 'custody', 'cus-ok'))
        .update(doc(f, 'paymentAccounts', 'acc-insta'), { currentBalance: 4700, balance: 4700, totalOut: 300, updatedAt: 'x', lastLedgerId: 'tx-ok1' })
        .set(doc(f, 'custodies', 'cus-ok'), { ...custody('cus-ok', { totalAmount: 300, remainingAmount: 300, sourceAccountId: 'acc-insta' }), lastLedgerId: 'tx-ok1' })
        .set(doc(f, 'accountTransactions', 'tx-ok1-parent'), line('tx-ok1-parent', 'acc-bank', 'out', 300, 5000, 4700, 'custody', 'cus-ok'))
        .update(doc(f, 'paymentAccounts', 'acc-bank'), { currentBalance: 4700, balance: 4700, totalOut: 300, updatedAt: 'x', lastLedgerId: 'tx-ok1-parent' })
        .commit());
    });

    // ---------------------------------------------------------------------------
    // M3-2: detachCorrection (the only overdraft exception) only checks that SOME account named in
    // referenceId leaves this bank in the same commit. Finance may unlink an InstaPay (linkOk), so
    // finance (not the org admin, not a legacy wallet, no amount bound) overdraws any bank at will.
    // ---------------------------------------------------------------------------
    it('[M3-2] finance unlinks an InstaPay and in the same commit books an unbounded overdraft on its bank (repeatable after a relink)', async () => {
      const f = db(FIN);
      // the domain refuses both ways of doing this
      await expect(adjustAccountBalance(store(FIN), actor(FIN, 'finance'), { accountId: 'acc-bank', type: 'out', amount: 1_000_000, description: 'x' }, key())).rejects.toMatchObject({ code: 'insufficient_funds' });
      await expect(detachLegacyWallet(store(FIN), actor(FIN, 'finance'), { walletId: 'acc-insta', bankCorrection: -1_000_000 }, key())).rejects.toMatchObject({ code: 'forbidden' });
      const overdraw = (lid: string, before: number, amount: number, totalOut: number) => writeBatch(f)
        .update(doc(f, 'paymentAccounts', 'acc-insta'), { parentAccountId: '', parentAccountName: '', updatedAt: 'x' })
        .set(doc(f, 'accountTransactions', lid), line(lid, 'acc-bank', 'out', amount, before, before - amount, 'manual_adjustment', 'acc-insta'))
        .update(doc(f, 'paymentAccounts', 'acc-bank'), { currentBalance: before - amount, balance: before - amount, totalOut, updatedAt: 'x', lastLedgerId: lid })
        .commit();
      const first = await ok(overdraw('tx-od1', 5000, 1_000_000, 1_000_000));
      let second = false;
      if (first) {
        await assertSucceeds(updateDoc(doc(f, 'paymentAccounts', 'acc-insta'), { parentAccountId: 'acc-bank', parentAccountName: 'acc-bank', updatedAt: 'x' }));
        second = await ok(overdraw('tx-od2', 5000 - 1_000_000, 2_000_000, 3_000_000));
      }
      console.log('[M3-2 observed]', { first, second, bank: await balance('acc-bank'), err: lastError.slice(0, 200) });
      expect(first).toBe(false);
      expect(await balance('acc-bank')).toBe(5000);
    });

    it('coverage: the real detach (org admin, legacy wallet) still overdraws as designed; a plain out still cannot', async () => {
      await seed(f => setDoc(doc(f, 'paymentAccounts', 'w-old'), account('w-old', 600, { type: 'wallet', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank', initialBalance: 1000, totalOut: 400 })));
      const res = await detachLegacyWallet(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { walletId: 'w-old', bankCorrection: -9000, expectedWalletTotals: { totalIn: 0, totalOut: 400 } }, key());
      expect(res.changed).toBe(true);
      expect(await balance('acc-bank')).toBe(-4000);
      const f = db(FIN);
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-od3'), line('tx-od3', 'acc-cash', 'out', 2000, 1000, -1000, 'manual_adjustment', 'acc-cash'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: -1000, balance: -1000, totalOut: 2000, updatedAt: 'x', lastLedgerId: 'tx-od3' }).commit());
    });

    // ---------------------------------------------------------------------------
    // M3-3: lineMovesAccount compares the balance / totals deltas with the line amount within
    // 0.0051 and never requires cent values. Each movement may therefore move the balance by up to
    // half a cent more than its line; a finance user drifts a balance (or a total) without bound
    // while the ledger sums to zero (hidden money, not a manual adjustment line).
    // ---------------------------------------------------------------------------
    it('[M3-3] 40 one-cent lines that sum to ZERO raise the cash balance by 0.20 (half a cent per movement, unbounded)', async () => {
      const f = db(FIN);
      let bal = 1000, tin = 0, tout = 0, i = 0, allOk = true;
      for (; i < 20 && allOk; i++) {
        const inId = `tx-drift-in-${i}`;
        const nb = Math.round((bal + 0.015) * 1000) / 1000;                     // +0.015 for an 'in' of 0.01
        allOk = await ok(writeBatch(f)
          .set(doc(f, 'accountTransactions', inId), line(inId, 'acc-cash', 'in', 0.01, bal, nb, 'manual_adjustment', 'acc-cash'))
          .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: nb, balance: nb, totalIn: Math.round((tin + 0.01) * 100) / 100, updatedAt: 'x', lastLedgerId: inId }).commit());
        if (!allOk) break;
        bal = nb; tin = Math.round((tin + 0.01) * 100) / 100;
        const outId = `tx-drift-out-${i}`;
        const nb2 = Math.round((bal - 0.005) * 1000) / 1000;                    // -0.005 for an 'out' of 0.01
        allOk = await ok(writeBatch(f)
          .set(doc(f, 'accountTransactions', outId), line(outId, 'acc-cash', 'out', 0.01, bal, nb2, 'manual_adjustment', 'acc-cash'))
          .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: nb2, balance: nb2, totalOut: Math.round((tout + 0.01) * 100) / 100, updatedAt: 'x', lastLedgerId: outId }).commit());
        if (allOk) { bal = nb2; tout = Math.round((tout + 0.01) * 100) / 100; }
      }
      const acc = (await read('paymentAccounts', 'acc-cash'))!;
      console.log('[M3-3 observed]', { pairs: i, balance: acc.currentBalance, totalIn: acc.totalIn, totalOut: acc.totalOut, err: lastError.slice(0, 160) });
      // the balance must equal the opening balance plus the lines (totalIn - totalOut = 0)
      expect(acc.currentBalance).toBe(1000 + acc.totalIn - acc.totalOut);
    });

    it('[M3-3] (holder variant) the custody holder files 20 invoices of 0.01 and lowers the remainder by 0.015 each: 0.10 leaves the books unexplained', async () => {
      await seed(f => setDoc(doc(f, 'custodies', 'hc'), custody('hc', { totalAmount: 10, remainingAmount: 10 })));
      const e = db(EMP);
      let rem = 10, settled = 0, i = 0, allOk = true;
      for (; i < 20 && allOk; i++) {
        const sid = `stl-h${i}`;
        const nr = Math.round((rem - 0.015) * 1000) / 1000;
        allOk = await ok(writeBatch(e)
          .set(doc(e, 'custodySettlements', sid), { id: sid, custodyId: 'hc', orgId: ORG, employeeId: EMP.uid, employeeName: 'e', employeeEmail: EMP.email, amount: 0.01, currency: 'EGP', description: 'x', status: 'approved', createdAt: 'x' })
          .update(doc(e, 'custodies', 'hc'), { remainingAmount: nr, settledAmount: Math.round((settled + 0.01) * 100) / 100, lastSettlementId: sid, updatedAt: 'x' })
          .commit());
        if (allOk) { rem = nr; settled = Math.round((settled + 0.01) * 100) / 100; }
      }
      const c = (await read('custodies', 'hc'))!;
      console.log('[M3-3 holder observed]', { invoices: i, remaining: c.remainingAmount, settled: c.settledAmount, err: lastError.slice(0, 160) });
      // remaining + settled must still equal the custody's total
      expect(Math.round((c.remainingAmount + c.settledAmount) * 1000) / 1000).toBe(10);
    });

    it('coverage: sub-cent and drift probes that ARE refused (amount < 0.01, delta off by more than half a cent)', async () => {
      const f = db(FIN);
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-sc1'), line('tx-sc1', 'acc-cash', 'in', 0.009, 1000, 1000.009, 'manual_adjustment', 'acc-cash'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 1000.009, balance: 1000.009, totalIn: 0.009, updatedAt: 'x', lastLedgerId: 'tx-sc1' }).commit());
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-sc2'), line('tx-sc2', 'acc-cash', 'in', 0.01, 1000, 1000.016, 'manual_adjustment', 'acc-cash'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 1000.016, balance: 1000.016, totalIn: 0.01, updatedAt: 'x', lastLedgerId: 'tx-sc2' }).commit());
    });
  });

  // =============================================================================
  // Regression of the round r1 / r2 money fixes (variants that must stay refused)
  // =============================================================================
  describe('regression variants (refused)', () => {
    it('disburseOk !exists: a line booked earlier (manual) under tx-req-<id> cannot pay the request later, nor a request re-created under the id', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'q1'), approvedRequest('q1', 300)));
      const f = db(FIN);
      await assertSucceeds(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-req-q1'), line('tx-req-q1', 'acc-cash', 'out', 300, 1000, 700, 'request', 'q1'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 700, balance: 700, totalOut: 300, updatedAt: 'x', lastLedgerId: 'tx-req-q1' }).commit());
      await assertFails(updateDoc(doc(f, 'requests', 'q1'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } }));
      // org admin deletes the (approved, unpaid) request, re-creates it, approves: still not payable without money
      await assertSucceeds(deleteDoc(doc(db(ADMIN), 'requests', 'q1')));
      await assertSucceeds(setDoc(doc(db(ADMIN), 'requests', 'q1'), { ...approvedRequest('q1', 300), status: 'pending' }));
      await assertSucceeds(updateDoc(doc(db(ADMIN), 'requests', 'q1'), { status: 'approved', approvedBy: ADMIN.uid, approvedAt: 'x' }));
      await assertFails(updateDoc(doc(f, 'requests', 'q1'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } }));
    });

    it('a disbursed request is terminal: no delete by the org admin, no edit, no reopen, no second payment', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'q2'), approvedRequest('q2', 100, { serviceCategoryId: 'srv-1' })));
      await disburseExpenseRequest(store(FIN), actor(FIN, 'finance'), 'q2', { paymentMethod: 'cash', referenceNumber: 'Q2', accountId: 'acc-cash' }, key(), { settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: false } });
      await assertFails(deleteDoc(doc(db(ADMIN), 'requests', 'q2')));
      await assertFails(updateDoc(doc(db(ADMIN), 'requests', 'q2'), { status: 'approved' }));
      await assertFails(updateDoc(doc(db(ADMIN), 'requests', 'q2'), { status: 'pending', amount: 5 }));
      await assertFails(updateDoc(doc(db(ADMIN), 'requests', 'q2'), { amount: 5 }));
      // pay "again" with a fresh line: the request is not in a payable state
      const f = db(FIN);
      await assertFails(writeBatch(f)
        .update(doc(f, 'services', 'srv-1'), { spentAmount: 200, lastDisbursedRequestId: 'q2', updatedAt: 'x' }).commit());
    });

    it('approved money edits: amount / currency changes go back to pending (org admin) and finance cannot change them at all', async () => {
      await seed(f => setDoc(doc(f, 'requests', 'q3'), approvedRequest('q3', 100)));
      await assertFails(updateDoc(doc(db(ADMIN), 'requests', 'q3'), { amount: 100000 }));
      await assertFails(updateDoc(doc(db(ADMIN), 'requests', 'q3'), { currency: 'USD' }));
      await assertFails(updateDoc(doc(db(FIN), 'requests', 'q3'), { status: 'pending', amount: 100000 }));
      await assertFails(updateDoc(doc(db(EMP), 'requests', 'q3'), { amount: 100000 }));
      await assertSucceeds(updateDoc(doc(db(ADMIN), 'requests', 'q3'), { status: 'pending', amount: 100000 }));
      // a re-priced request is paid only after a new approval
      await assertFails(updateDoc(doc(db(FIN), 'requests', 'q3'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } }));
    });

    it('counters: a payment raises only its own service / provider, by its cent-rounded amount; legacy unrounded amounts cannot inflate it', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'q4'), approvedRequest('q4', 100 / 3, { serviceCategoryId: 'srv-1', providerId: 'prov-1' }));
        await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 10 / 3 });
      });
      const f = db(FIN);
      const pay = (svc: number, prov: number) => writeBatch(f)
        .update(doc(f, 'requests', 'q4'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } })
        .set(doc(f, 'accountTransactions', 'tx-req-q4'), line('tx-req-q4', 'acc-cash', 'out', 33.33, 1000, 966.67, 'request', 'q4'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 966.67, balance: 966.67, totalOut: 33.33, updatedAt: 'x', lastLedgerId: 'tx-req-q4' })
        .update(doc(f, 'services', 'srv-1'), { spentAmount: svc, lastDisbursedRequestId: 'q4', updatedAt: 'x' })
        .update(doc(f, 'providers', 'prov-1'), { totalPaid: prov, lastDisbursedRequestId: 'q4', updatedAt: 'x' })
        .commit();
      await assertFails(pay(10 / 3 + 33.34, 533.33));     // service +1 cent
      await assertFails(pay(10 / 3 + 33.33, 533.35));     // provider +2 cents
      await assertFails(pay(10 / 3 + 66.66, 533.33));     // counted twice
      await assertSucceeds(pay(10 / 3 + 33.33, 533.33));
    });

    it('custody: issue / replenish / return lines explain one operation; settle strictly decreases; no cross-company account', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'custodies', 'c1'), custody('c1', { totalAmount: 300, remainingAmount: 300 }));
        await setDoc(doc(f, 'custodies', 'c2'), custody('c2', { totalAmount: 300, remainingAmount: 300 }));
      });
      const f = db(FIN);
      // one replenish line for two custodies (referenceId names one)
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-rp1'), line('tx-rp1', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'c1'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 900, balance: 900, totalOut: 100, updatedAt: 'x', lastLedgerId: 'tx-rp1' })
        .update(doc(f, 'custodies', 'c1'), { totalAmount: 400, remainingAmount: 400, status: 'active', updatedAt: 'x', lastLedgerId: 'tx-rp1' })
        .update(doc(f, 'custodies', 'c2'), { totalAmount: 400, remainingAmount: 400, status: 'active', updatedAt: 'x', lastLedgerId: 'tx-rp1' })
        .commit());
      // a replenish line that is a request payment line
      await seed(f2 => setDoc(doc(f2, 'requests', 'c1'), approvedRequest('c1', 100)));
      await assertFails(writeBatch(f)
        .update(doc(f, 'requests', 'c1'), { status: 'disbursed', disbursement: { accountId: 'acc-cash' } })
        .set(doc(f, 'accountTransactions', 'tx-req-c1'), line('tx-req-c1', 'acc-cash', 'out', 100, 1000, 900, 'request', 'c1'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 900, balance: 900, totalOut: 100, updatedAt: 'x', lastLedgerId: 'tx-req-c1' })
        .update(doc(f, 'custodies', 'c1'), { totalAmount: 400, remainingAmount: 400, status: 'active', updatedAt: 'x', lastLedgerId: 'tx-req-c1' })
        .commit());
      // replenish total +100 but remaining +200 (amount2)
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-rp2'), line('tx-rp2', 'acc-cash', 'out', 100, 1000, 900, 'custody', 'c1'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 900, balance: 900, totalOut: 100, updatedAt: 'x', lastLedgerId: 'tx-rp2' })
        .update(doc(f, 'custodies', 'c1'), { totalAmount: 400, remainingAmount: 500, status: 'active', updatedAt: 'x', lastLedgerId: 'tx-rp2' })
        .commit());
      // a finance user of both companies returns the custody into the OTHER company's account
      const b = db(BOTH_FIN);
      await assertFails(writeBatch(b)
        .set(doc(b, 'accountTransactions', 'tx-rt9'), line('tx-rt9', 'acc-o', 'in', 300, 1000, 1300, 'custody_return', 'c1', BOTH_FIN, { orgId: OTHER_ORG }))
        .update(doc(b, 'paymentAccounts', 'acc-o'), { currentBalance: 1300, balance: 1300, totalIn: 300, updatedAt: 'x', lastLedgerId: 'tx-rt9' })
        .update(doc(b, 'custodies', 'c1'), { remainingAmount: 0, returnedAmount: 300, status: 'settled', returnedToAccountId: 'acc-o', updatedAt: 'x', lastLedgerId: 'tx-rt9' })
        .commit());
      // ... and the same commit into its own company's account passes (control)
      await assertSucceeds(writeBatch(b)
        .set(doc(b, 'accountTransactions', 'tx-rt8'), line('tx-rt8', 'acc-bank2', 'in', 300, 3000, 3300, 'custody_return', 'c2', BOTH_FIN))
        .update(doc(b, 'paymentAccounts', 'acc-bank2'), { currentBalance: 3300, balance: 3300, totalIn: 300, updatedAt: 'x', lastLedgerId: 'tx-rt8' })
        .update(doc(b, 'custodies', 'c2'), { remainingAmount: 0, returnedAmount: 300, status: 'settled', returnedToAccountId: 'acc-bank2', updatedAt: 'x', lastLedgerId: 'tx-rt8' })
        .commit());
      // return smaller than the remainder (keeps 200 outside the books)
      await assertFails(writeBatch(f)
        .set(doc(f, 'accountTransactions', 'tx-rt1'), line('tx-rt1', 'acc-cash', 'in', 100, 1000, 1100, 'custody_return', 'c1'))
        .update(doc(f, 'paymentAccounts', 'acc-cash'), { currentBalance: 1100, balance: 1100, totalIn: 100, updatedAt: 'x', lastLedgerId: 'tx-rt1' })
        .update(doc(f, 'custodies', 'c1'), { remainingAmount: 0, returnedAmount: 100, status: 'settled', returnedToAccountId: 'acc-cash', updatedAt: 'x', lastLedgerId: 'tx-rt1' })
        .commit());
      // settle: 0.005 invoice; remainder not decreasing; settled + returned in one write
      const e = db(EMP);
      const stl = (id: string, amt: number) => ({ id, custodyId: 'c1', orgId: ORG, employeeId: EMP.uid, employeeName: 'e', employeeEmail: EMP.email, amount: amt, currency: 'EGP', description: 'x', status: 'approved', createdAt: 'x' });
      await assertFails(writeBatch(e).set(doc(e, 'custodySettlements', 's1'), stl('s1', 0.005))
        .update(doc(e, 'custodies', 'c1'), { remainingAmount: 299.995, settledAmount: 0.005, lastSettlementId: 's1', updatedAt: 'x' }).commit());
      await assertFails(writeBatch(e).set(doc(e, 'custodySettlements', 's2'), stl('s2', 10))
        .update(doc(e, 'custodies', 'c1'), { remainingAmount: 300, settledAmount: 10, lastSettlementId: 's2', updatedAt: 'x' }).commit());
      await assertFails(writeBatch(e).set(doc(e, 'custodySettlements', 's3'), stl('s3', 10))
        .update(doc(e, 'custodies', 'c1'), { remainingAmount: 290, settledAmount: 10, returnedAmount: 290, lastSettlementId: 's3', updatedAt: 'x' }).commit());
      // control: a real invoice
      await assertSucceeds(writeBatch(e).set(doc(e, 'custodySettlements', 's4'), stl('s4', 10))
        .update(doc(e, 'custodies', 'c1'), { remainingAmount: 290, settledAmount: 10, lastSettlementId: 's4', updatedAt: 'x' }).commit());
    });

    it('accounts: no delete with history (incl. string / tiny-noise totals that are not zero), no retype of a linked InstaPay into cash, no mirror on another company bank', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'paymentAccounts', 'z1'), account('z1', 0, { totalIn: 0.01, totalOut: 0.01 }));
        await setDoc(doc(f, 'paymentAccounts', 'z2'), account('z2', 0, { totalIn: '5' }));
        await setDoc(doc(f, 'paymentAccounts', 'z3'), account('z3', 0, { initialBalance: 0.006 }));
        await setDoc(doc(f, 'paymentAccounts', 'z4'), account('z4', 0, { totalIn: 0.1 + 0.2 - 0.3 }));
      });
      const a = db(ADMIN);
      await assertFails(deleteDoc(doc(a, 'paymentAccounts', 'z1')));
      await assertFails(deleteDoc(doc(a, 'paymentAccounts', 'z2')));
      await assertFails(deleteDoc(doc(a, 'paymentAccounts', 'z3')));
      await assertSucceeds(deleteDoc(doc(a, 'paymentAccounts', 'z4')));
      await assertFails(deleteDoc(doc(db(FIN), 'paymentAccounts', 'acc-cash')));
      await assertFails(updateDoc(doc(db(FIN), 'paymentAccounts', 'acc-insta'), { type: 'cash' }));
      await assertFails(updateDoc(doc(db(FIN), 'paymentAccounts', 'acc-insta'), { parentAccountId: 'acc-o' }));
      await assertFails(updateDoc(doc(db(FIN), 'paymentAccounts', 'acc-cash'), { type: 'wallet', parentAccountId: 'acc-bank' }));
    });
  });

  // =============================================================================
  // Heaviest legitimate flows (20-read / 1000-expression budgets)
  // =============================================================================
  describe('budgets: heaviest legitimate flows (real domain)', () => {
    const longHistory = {
      timeline: Array.from({ length: 60 }, (_, i) => ({ id: `tl-${i}`, status: 'pending', title: 'x'.repeat(40), actorName: 'a', timestamp: 'x' })),
      comments: Array.from({ length: 30 }, (_, i) => ({ id: `c-${i}`, text: 'y'.repeat(40), authorId: 'a', authorName: 'a' })),
    };

    it('[budget] pay a request on a service shared at index 5 + provider + InstaPay→bank + outbox (all notifications): owner, multi-company finance, multi-company org admin, finance', async () => {
      const payers = [[OWNER, 'super_admin'], [MULTI3, 'finance'], [MULTI_ADMIN, 'org_admin'], [FIN, 'finance'], [MULTI_FIN, 'finance']] as const;
      await seed(async f => {
        for (const [i] of payers.entries()) {
          await setDoc(doc(f, 'requests', `b${i}`), approvedRequest(`b${i}`, 100.1, { serviceCategoryId: 'srv-wide', providerId: 'prov-1', ...longHistory }));
        }
      });
      for (const [i, [who, role]] of payers.entries()) {
        const res = await disburseExpenseRequest(store(who), actor(who, role, role === 'super_admin' ? undefined : ORG), `b${i}`, { paymentMethod: 'instapay', referenceNumber: `B${i}`, accountId: 'acc-insta' }, key(), notifyAll);
        expect(res.changed).toBe(true);
      }
      expect((await read('services', 'srv-wide'))!.spentAmount).toBe(500.5);
      expect(await balance('acc-bank')).toBe(4499.5);
    });

    it('[budget] income into an InstaPay, transfer InstaPay→InstaPay, custody issue from InstaPay / replenish from InstaPay / settle / return into InstaPay (owner and finance)', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'inc0'), approvedRequest('inc0', 50, { status: 'pending', requestType: 'income', ...longHistory }));
        await setDoc(doc(f, 'requests', 'inc1'), approvedRequest('inc1', 50, { status: 'pending', requestType: 'income', ...longHistory }));
      });
      for (const [i, [who, role]] of ([[OWNER, 'super_admin'], [FIN, 'finance']] as const).entries()) {
        const s = store(who);
        const a = actor(who, role, role === 'super_admin' ? undefined : ORG);
        expect((await disburseExpenseRequest(s, a, `inc${i}`, { paymentMethod: 'instapay', referenceNumber: 'I', accountId: 'acc-insta' }, key(), notifyAll)).changed).toBe(true);
        expect((await transferBetweenAccounts(s, a, { fromAccountId: 'acc-insta', toAccountId: 'acc-insta2', amount: 10 }, key())).changed).toBe(true);
        const c = await issueCustody(s, a, { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount: 20, sourceAccountId: 'acc-insta' }, key());
        await replenishCustody(s, a, { custodyId: c.value.id, amount: 5, sourceAccountId: 'acc-insta2' }, key());
        await settleCustodyItem(s, a, { custodyId: c.value.id, amount: 3, description: 'x' }, key());
        const r = await returnCustodyRemainders(s, a, { custodyIds: [c.value.id], targetAccountId: 'acc-insta2' }, key());
        expect(r.value.totalReturned).toBe(22);
      }
      expect(await balance('acc-bank')).toBe(5000 + 100 - 20 - 40);
      expect(await balance('acc-bank2')).toBe(3000 + 20 - 10 + 44);
    });

    it('[budget] multi-company finance (member) pays from an InstaPay with service + provider while its company custody is replenished/returned through InstaPays', async () => {
      await seed(async f => {
        await setDoc(doc(f, 'requests', 'mm'), approvedRequest('mm', 77.7, { serviceCategoryId: 'srv-wide', providerId: 'prov-1', ...longHistory }));
        await setDoc(doc(f, 'custodies', 'cm'), custody('cm', { totalAmount: 100, remainingAmount: 100, sourceAccountId: 'acc-insta', lastLedgerId: 'tx-old' }));
      });
      const s = store(MULTI3);
      const a = actor(MULTI3, 'finance', ORG);
      expect((await disburseExpenseRequest(s, a, 'mm', { paymentMethod: 'instapay', referenceNumber: 'M', accountId: 'acc-insta' }, key(), notifyAll)).changed).toBe(true);
      await replenishCustody(s, a, { custodyId: 'cm', amount: 5, sourceAccountId: 'acc-insta2' }, key());
      await settleCustodyItem(s, a, { custodyId: 'cm', amount: 3, description: 'x' }, key());
      const r = await returnCustodyRemainders(s, a, { custodyIds: ['cm'], targetAccountId: 'acc-insta' }, key());
      expect(r.value.totalReturned).toBe(102);
    });
  });

  // Calibration of the padding used to measure expression margins (only with R3_RULES set).
  describe.runIf(!!process.env.R3_RULES)('pad probe', () => {
    it('[pad probe] a create whose rule is padN() alone', async () => {
      await assertSucceeds(setDoc(doc(db(FIN), 'padprobe', 'x'), { a: 1 }));
    });
  });
});

// =============================================================================
// Round r3, keys lane. Each section seeds its own data (its own accounts, users and helpers).
// =============================================================================
/**
 * Round r3, uniqueness keys and legacy restores lane (attacker + fuzzer).
 *
 * Attacker: raw Firestore Web SDK with its own credentials. Legitimate operations run the
 * REAL domain functions (src/domain/directory.ts, treasury.ts, legacyRecovery.ts) as the
 * role the UI allows.
 *
 * Fuzz: random values mixing ASCII (mixed case), Unicode letters and capitals, Arabic with
 * tatweel / harakat / Arabic-Indic digits, every JavaScript \s character, zero-width and
 * other non-whitespace format characters, '-', '_', '.' runs and leading / trailing spaces.
 * Each value goes through the real domain create (provider / department / service / member /
 * account) and its key; variants that differ only in characters normalizeKeyValue drops must
 * be refused as duplicates; the rules' keyNorm must claim / release exactly when the domain's
 * normalizeKeyValue says so.
 *
 * Tests named [K3-n] demonstrate a finding (they FAIL while the defect is present).
 * Everything else is coverage that the round-2 key / restore fixes hold.
 */
describe('round r3: keys and restore markers lane ([K3-1] stale keys, [K3-2] separators, [K3-3] Unicode variants, [K3-4] shared legacy service, [K3-5] marker reads)', () => {
  const ORG = 'org-acme';
  const OTHER_ORG = 'org-other';

  type U = { uid: string; email: string };
  const OWNER: U = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
  const ADMIN: U = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
  const FIN: U = { uid: 'uidFinance00000000000000001', email: 'fin@acme.test' };
  const EMP: U = { uid: 'uidEmployee0000000000000001', email: 'emp@acme.test' };
  const DE: U = { uid: 'uidDataEntry000000000000001', email: 'de@acme.test' };
  const CAIRO_ADMIN: U = { uid: 'uidCairoAdmin000000000001', email: 'admin@other.test' };
  const CAIRO_EMP: U = { uid: 'uidCairoEmp00000000000001', email: 'emp@other.test' };
  const CAIRO_DE: U = { uid: 'uidCairoDataEntry00000001', email: 'de@other.test' };
  const MULTI_ADMIN: U = { uid: 'uidMultiAdmin00000000001', email: 'madmin@other.test' }; // profile OTHER (employee), org admin member of ORG
  const STRANGER: U = { uid: 'uidStranger00000000000001', email: 'stranger@evil.test' };

  const db = (u: U, verified = true): Firestore =>
    env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore() as unknown as Firestore;
  const store = (u: U) => createFirestoreStore(db(u));
  const actor = (u: U, role: Actor['role'], orgId?: string): Actor => ({ id: u.uid, name: u.email, email: u.email, role, ...(orgId ? { orgId } : {}) });
  let n = 0;
  const key = () => `key-r3k${String(++n).padStart(7, '0')}`;
  const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));
  const read = async (c: string, id: string) => {
    let data: Record<string, any> | undefined;
    await env.withSecurityRulesDisabled(async ctx => {
      data = (await getDoc(doc(ctx.firestore(), c, id))).data();
    });
    return data;
  };
  const keyDoc = (scope: any, org: string, v: string, coll: string, id: string) =>
    ({ scope, orgId: org, value: normalizeKeyValue(v), entityCollection: coll, entityId: id });

  /** What a promise ended with: 'ok', 'unchanged:<reason>', a DomainError code, or the Firestore error (code + rules detail). */
  const outcome = async (p: Promise<any>): Promise<string> => {
    try {
      const r = await p;
      return r && r.changed === false ? `unchanged:${r.reason ?? ''}` : 'ok';
    } catch (e: any) {
      const code = e?.code ?? 'error';
      return code === 'permission-denied' || code === 'error' ? `${code} ${String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 400)}` : String(code);
    }
  };
  /** A value with every non-printable / non-ASCII code point spelled out (readable failure output). */
  const esc = (v: string) => Array.from(v).map(c => (/^[\x21-\x7e]$/.test(c) ? c : `<${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`)).join('');

  // ---------------------------------------------------------------------------
  // Fuzz alphabet
  // ---------------------------------------------------------------------------
  const JS_WS = ['\t', '\n', '\v', '\f', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ',
    ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿'];
  const SEPS = ['-', '_', '.'];
  // round 3: invisible format characters, tatweel and harakat are dropped too (KEY_INVISIBLE / keyBase)
  const INVISIBLE = ['​', '‌', '‍', '⁠', '᠎', '­', '͏', '؜', '‎', '‏', 'ـ', 'َ', 'ّ', 'ٰ'];
  const IGNORED = [...JS_WS, ...SEPS, ...INVISIBLE];
  /** Dropped in every scope (separators are kept in an email / @ address). */
  const IGNORED_NO_SEPS = [...JS_WS, ...INVISIBLE];
  const ZERO_WIDTH = ['\u0085'];   // not JavaScript whitespace, not in the dropped list: a kept character
  const ASCII = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const ARABIC = 'ابتثجحخدذرزسشصضطظعغفقكلمنهويءآأؤإئةى';
  const HARAKAT = ['ً', 'ٌ', 'ٍ', 'َ', 'ُ', 'ِ', 'ّ', 'ْ', 'ٰ'];
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩۰۱۲۳';
  const UNI = ['é', 'É', 'ö', 'Ö', 'ß', 'ẞ', 'ç', 'Ç', 'ñ', 'Ñ', 'ﬁ', 'K', 'İ', 'ı', 'Д', 'д', 'Ж', 'Σ', 'σ', 'ς', '中', '文', '😀', '👍🏽', 'Å', 'Å', 'ǅ', 'ﾀ', 'Ａ', '𝐀'];
  const PUNCT = ['/', '#', '&', '(', ')', '@', '+', '=', '\\', '$', '*', '[', ']', '%', '~', ',', ':', '"', "'", '`', '|', '^', '{', '}', '?', '!'];

  function rng(seed0: number) {
    let a = seed0 >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = <T,>(r: () => number, xs: readonly T[] | string): T => (xs as any)[Math.floor(r() * xs.length)];
  function token(r: () => number): string {
    const x = r();
    if (x < 0.30) return pick(r, ASCII);
    if (x < 0.50) return pick(r, ARABIC);
    if (x < 0.55) return 'ـ';
    if (x < 0.60) return pick(r, HARAKAT);
    if (x < 0.63) return pick(r, AR_DIGITS);
    if (x < 0.73) return pick(r, UNI);
    if (x < 0.83) return pick(r, IGNORED);
    if (x < 0.90) return pick(r, ZERO_WIDTH);
    return pick(r, PUNCT);
  }
  /** A random value with at least one character the key keeps. */
  function genValue(r: () => number): string {
    for (;;) {
      let v = '';
      const len = 1 + Math.floor(r() * 14);
      for (let i = 0; i < len; i++) v += token(r);
      if (r() < 0.3) v = pick(r, IGNORED) + v;
      if (r() < 0.3) v = v + pick(r, IGNORED) + (r() < 0.5 ? ' ' : '');
      if (normalizeKeyValue(v) !== '' && v.trim() !== '') return v;
    }
  }
  /** The same key for normalizeKeyValue: ASCII case toggled, dropped characters inserted between code points. */
  function sameKeyVariant(r: () => number, v: string, ignored: readonly string[] = IGNORED): string {
    const cps = Array.from(v);
    let out = r() < 0.5 ? pick(r, ignored) : '';
    for (const c of cps) {
      out += /^[A-Za-z]$/.test(c) && r() < 0.5 ? (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()) : c;
      const k = Math.floor(r() * 3);
      for (let i = 0; i < k; i++) out += pick(r, ignored);
    }
    if (out === v) out = ` ${out}​`;
    return out + (r() < 0.5 ? ' ' : '');
  }
  /** Another key: one kept character (non-ASCII capital, letter, digit, U+0085) inserted. */
  function otherKeyVariant(r: () => number, v: string): string {
    const cps = Array.from(v);
    const at = Math.floor(r() * (cps.length + 1));
    const extra = pick(r, [...ZERO_WIDTH, ...UNI, 'x', 'Q', '7', 'ع']);
    cps.splice(at, 0, extra);
    return cps.join('');
  }
  /** n values whose keys are all distinct. */
  function distinctValues(seed0: number, count: number): string[] {
    const r = rng(seed0);
    const seen = new Set<string>();
    const out: string[] = [];
    while (out.length < count) {
      const v = genValue(r);
      const k = normalizeKeyValue(v);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }


  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [ADMIN.email], createdAt: '2026-01-01' });
      await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [CAIRO_ADMIN.email], createdAt: '2026-01-01' });
      for (const [u, role, org] of [[ADMIN, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [DE, 'data_entry', ORG],
        [CAIRO_ADMIN, 'org_admin', OTHER_ORG], [CAIRO_EMP, 'employee', OTHER_ORG], [CAIRO_DE, 'data_entry', OTHER_ORG]] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true, email: u.email, memberId: `${u.uid}_${org}` });
        await setDoc(doc(f, 'members', `${u.uid}_${org}`), { orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      await setDoc(doc(f, 'users', MULTI_ADMIN.uid), { orgId: OTHER_ORG, role: 'employee', active: true, email: MULTI_ADMIN.email, memberId: `${MULTI_ADMIN.uid}_${OTHER_ORG}` });
      await setDoc(doc(f, 'members', `${MULTI_ADMIN.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: MULTI_ADMIN.uid, userEmail: MULTI_ADMIN.email, role: 'employee', active: true, userName: 'ma' });
      await setDoc(doc(f, 'members', `${MULTI_ADMIN.uid}_${ORG}`), { orgId: ORG, userId: MULTI_ADMIN.uid, userEmail: MULTI_ADMIN.email, role: 'org_admin', active: true, userName: 'ma' });

      const acc = (id: string, org: string, ident: string) => ({ orgId: org, name: id, type: 'cash', accountIdentifier: ident, currency: 'EGP', active: true,
        balance: 0, currentBalance: 0, initialBalance: 0, totalIn: 0, totalOut: 0 });
      await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), acc('acc-cash', ORG, 'EG001'));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank'), { ...acc('acc-bank', ORG, 'EG777'), type: 'bank' });
      await setDoc(doc(f, 'paymentAccounts', 'acc-ob'), { ...acc('acc-ob', OTHER_ORG, 'OB1'), type: 'bank' });
      await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0 });
      await setDoc(doc(f, 'providers', 'prov-1'), { orgId: ORG, name: 'Vodafone', totalPaid: 0, active: true });
      await setDoc(doc(f, 'providers', 'prov-o'), { orgId: OTHER_ORG, name: 'Orange', totalPaid: 0, active: true });
      await setDoc(doc(f, 'departments', 'dept-1'), { orgId: ORG, name: 'IT' });

      const k = (scope: any, org: string, v: string, coll: string, id: string) => setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId(scope, org, v)), keyDoc(scope, org, v, coll, id));
      await k('account_identifier', ORG, 'EG001', 'paymentAccounts', 'acc-cash');
      await k('account_identifier', ORG, 'EG777', 'paymentAccounts', 'acc-bank');
      await k('account_identifier', OTHER_ORG, 'OB1', 'paymentAccounts', 'acc-ob');
      await k('provider_name', ORG, 'Vodafone', 'providers', 'prov-1');
      await k('provider_name', OTHER_ORG, 'Orange', 'providers', 'prov-o');
      await k('service_code', ORG, 'CLD', 'services', 'srv-1');
      await k('department_name', ORG, 'IT', 'departments', 'dept-1');
      await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('org_code', '-', 'ACME')), { scope: 'org_code', orgId: '-', value: 'acme', entityCollection: 'organizations', entityId: ORG });
    });
  });

  const provider = (name: string, org = ORG) => (id: string) => ({ id, orgId: org, name, totalPaid: 0, active: true } as any);
  const department = (name: string, org = ORG) => (id: string) => ({ id, orgId: org, name } as any);
  const service = (code: string, org = ORG) => (id: string) => ({ id, orgId: org, name: `S ${id}`, code, spentAmount: 0, active: true } as any);
  const rename = () => ({ actionType: 'rename' as const, details: 'x' });

  // =============================================================================
  // 1. Fuzz: rules keyNorm vs domain normalizeKeyValue
  // =============================================================================
  describe('fuzz: rules keyNorm == domain normalizeKeyValue', () => {
    it('raw claim of a key for 300 random values: allowed exactly when the domain gives the value a non-empty key', async () => {
      const r = rng(20261003);
      const values: string[] = [];
      for (let i = 0; i < 300; i++) {
        // a third of them made only of characters the key drops (must be refused)
        values.push(i % 3 === 0 ? Array.from({ length: 1 + Math.floor(r() * 5) }, () => pick(r, IGNORED)).join('') : genValue(r));
      }
      const a = db(ADMIN);
      const bad: string[] = [];
      for (const v of values) {
        const id = uniqueKeyDocId('provider_name', ORG, v);
        await seed(f => setDoc(doc(f, 'providers', 'prov-fz'), { orgId: ORG, name: v, totalPaid: 0, active: true }));
        const res = await outcome(setDoc(doc(a, 'uniqueKeys', id), keyDoc('provider_name', ORG, v, 'providers', 'prov-fz')));
        const expectOk = normalizeKeyValue(v) !== '';
        if ((res === 'ok') !== expectOk) bad.push(`${esc(v)} -> ${res} (expected ${expectOk ? 'ok' : 'refused'})`);
        if (res === 'ok') await seed(f => deleteDoc(doc(f, 'uniqueKeys', id)));
      }
      expect(bad).toEqual([]);
    }, 300_000);

    it('raw release for 300 (value, new value) pairs: allowed exactly when the domain says the key changed', async () => {
      const r = rng(777);
      const fin = db(FIN);
      const bad: string[] = [];
      for (let i = 0; i < 300; i++) {
        const v = genValue(r);
        const w = i % 2 === 0 ? sameKeyVariant(r, v) : otherKeyVariant(r, v);
        const id = uniqueKeyDocId('provider_name', ORG, v);
        await seed(async f => {
          await setDoc(doc(f, 'providers', 'prov-fz'), { orgId: ORG, name: v, totalPaid: 0, active: true });
          await setDoc(doc(f, 'uniqueKeys', id), keyDoc('provider_name', ORG, v, 'providers', 'prov-fz'));
        });
        const res = await outcome(writeBatch(fin).update(doc(fin, 'providers', 'prov-fz'), { name: w }).delete(doc(fin, 'uniqueKeys', id)).commit());
        const expectOk = normalizeKeyValue(w) !== normalizeKeyValue(v);
        if ((res === 'ok') !== expectOk) bad.push(`${esc(v)} => ${esc(w)} -> ${res} (expected ${expectOk ? 'released' : 'refused'})`);
      }
      expect(bad).toEqual([]);
    }, 300_000);
  });

  // =============================================================================
  // 2. Fuzz through the real domain, as the real roles
  // =============================================================================
  describe('fuzz: real domain creates / renames, duplicates by dropped characters refused', () => {
    it('providers (data entry creates, org admin renames): 40 random names claimed; same-key variants refused as duplicates; renames keep / move the key', async () => {
      const vals = distinctValues(4242, 40);
      const r = rng(99);
      const bad: string[] = [];
      for (const v of vals) {
        const c = await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', provider(v), () => 'x', key()).catch(e => e);
        if (!c?.value?.id) { bad.push(`create ${esc(v)}: ${await outcome(Promise.reject(c))}`); continue; }
        const id = c.value.id;
        const k = await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, v));
        if (k?.entityId !== id) bad.push(`key of ${esc(v)} missing`);
        const w = sameKeyVariant(r, v);
        const dup = await outcome(createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', provider(w), () => 'x', key()));
        if (dup !== 'duplicate') bad.push(`dup ${esc(v)} vs ${esc(w)}: ${dup}`);
        const dup2 = await outcome(updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', 'prov-1', { name: w } as any, rename, key()));
        if (dup2 !== 'duplicate') bad.push(`rename-dup ${esc(v)} vs ${esc(w)}: ${dup2}`);
        // same key: renamed in place, key untouched
        const same = await outcome(updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', id, { name: w } as any, rename, key()));
        if (same !== 'ok' || (await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, v)))?.entityId !== id) bad.push(`rename-same ${esc(v)} -> ${esc(w)}: ${same}`);
        // another key: old released, new claimed
        const u = otherKeyVariant(r, w);
        const moved = await outcome(updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', id, { name: u } as any, rename, key()));
        if (moved !== 'ok' || (await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, v))) || (await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, u)))?.entityId !== id) {
          bad.push(`rename-other ${esc(w)} -> ${esc(u)}: ${moved}`);
        }
      }
      expect(bad).toEqual([]);
    }, 600_000);

    it('departments (data entry) and services (org admin, code): 25 random values each claimed; same-key variants refused; delete releases', async () => {
      const r = rng(5150);
      const bad: string[] = [];
      for (const v of distinctValues(31337, 25)) {
        const d = await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'department', department(v), () => 'x', key()).catch(e => e);
        if (!d?.value?.id) { bad.push(`dept ${esc(v)}: ${await outcome(Promise.reject(d))}`); continue; }
        const w = sameKeyVariant(r, v);
        const dup = await outcome(createEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'department', department(w), () => 'x', key()));
        if (dup !== 'duplicate') bad.push(`dept dup ${esc(v)} vs ${esc(w)}: ${dup}`);
        const del = await outcome(deleteEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'department', d.value.id, 'delete', key()));
        if (del !== 'ok' || (await read('uniqueKeys', uniqueKeyDocId('department_name', ORG, v)))) bad.push(`dept delete ${esc(v)}: ${del}`);
      }
      for (const v of distinctValues(8086, 25)) {
        const s = await outcome(createEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'service', service(v), () => 'x', key()));
        if (s !== 'ok') { bad.push(`svc ${esc(v)}: ${s}`); continue; }
        const w = sameKeyVariant(r, v);
        const dup = await outcome(createEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'service', service(w), () => 'x', key()));
        if (dup !== 'duplicate') bad.push(`svc dup ${esc(v)} vs ${esc(w)}: ${dup}`);
      }
      expect(bad).toEqual([]);
    }, 600_000);

    it('accounts (org admin opens, finance re-numbers): 25 random identifiers; same-key variants refused on create and on re-number', async () => {
      const r = rng(2468);
      const bad: string[] = [];
      for (const v of distinctValues(1357, 25)) {
        const c = await createPaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, name: 'Fz', type: 'cash', accountIdentifier: v, currency: 'EGP', active: true, initialBalance: 0 } as any, key()).catch(e => e);
        if (!c?.value?.id) { bad.push(`acc ${esc(v)}: ${await outcome(Promise.reject(c))}`); continue; }
        const w = sameKeyVariant(r, v, v.includes('@') ? IGNORED_NO_SEPS : IGNORED);
        const dup = await outcome(createPaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, name: 'Fz2', type: 'cash', accountIdentifier: w, currency: 'EGP', active: true, initialBalance: 0 } as any, key()));
        if (dup !== 'duplicate') bad.push(`acc dup ${esc(v)} vs ${esc(w)}: ${dup}`);
        const dup2 = await outcome(updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-bank', { accountIdentifier: w }, key()));
        if (dup2 !== 'duplicate') bad.push(`acc renumber dup ${esc(v)} vs ${esc(w)}: ${dup2}`);
        const u = otherKeyVariant(r, v);
        const mv = await outcome(updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), c.value.id, { accountIdentifier: u }, key()));
        if (mv !== 'ok') bad.push(`acc renumber ${esc(v)} -> ${esc(u)}: ${mv}`);
      }
      expect(bad).toEqual([]);
    }, 600_000);

    it('members (org admin): 20 random e-mails (Unicode / mixed case / spaces); case and surrounding-space variants under another login id are refused by the key', async () => {
      const r = rng(1111);
      const bad: string[] = [];
      const LOCAL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+';
      for (let i = 0; i < 20; i++) {
        let local = '';
        const len = 2 + Math.floor(r() * 8);
        for (let j = 0; j < len; j++) local += r() < 0.8 ? pick(r, LOCAL) : pick(r, ['É', 'ö', 'Ж', 'ع', 'ß', 'K', 'İ']);
        const email = `${local}${i}@Acme-${i % 3}.TEST`;
        const m = await outcome(createMember(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, userEmail: email, userName: `N${i}`, role: 'employee', jobTitle: 'j', department: 'd', active: true } as any, key()));
        if (m !== 'ok') { bad.push(`member ${esc(email)}: ${m}`); continue; }
        const k = await read('uniqueKeys', uniqueKeyDocId('member_email', ORG, normalizeEmail(email)));
        if (!k) bad.push(`member key ${esc(email)} missing`);
        const variant = `  ${Array.from(email).map(c => (/^[a-z]$/i.test(c) && r() < 0.5 ? (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()) : c)).join('')} `;
        const dup = await outcome(createMember(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, userId: `uidFuzzLogin${String(i).padStart(12, '0')}`, userEmail: variant, userName: `D${i}`, role: 'employee', jobTitle: 'j', department: 'd', active: true } as any, key()));
        if (dup !== 'duplicate') bad.push(`member dup ${esc(email)} vs ${esc(variant)}: ${dup}`);
      }
      expect(bad).toEqual([]);
    }, 600_000);

    it('multi-company add (org admin of ORG and OTHER via memberships): a random name is claimed in each company, the same-key variant skipped everywhere', async () => {
      await seed(f => setDoc(doc(f, 'members', `${ADMIN.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: ADMIN.uid, userEmail: ADMIN.email, role: 'org_admin', active: true, userName: 'a' }));
      const r = rng(6060);
      for (const v of distinctValues(7070, 5)) {
        const res = await createEntityInOrgs(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', [ORG, OTHER_ORG], (id: string, orgId: string) => ({ id, orgId, name: v, totalPaid: 0, active: true } as any), () => 'x', key());
        expect(res.value.created.length).toBe(2);
        await expect(createEntityInOrgs(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', [ORG, OTHER_ORG], (id: string, orgId: string) => ({ id, orgId, name: sameKeyVariant(r, v), totalPaid: 0, active: true } as any), () => 'x', key()))
          .rejects.toMatchObject({ code: 'duplicate' });
      }
    }, 300_000);
  });

  // =============================================================================
  // 3. Attacker: keys
  // =============================================================================
  describe('attacker: uniqueness keys after round 2', () => {
    const kEt = uniqueKeyDocId('provider_name', ORG, 'Etisalat');

    it('[K3-1] a record editor (finance) can no longer leave a key naming a record that does not hold its value: the rename back must release it', async () => {
      const f = db(FIN);
      // step 1: rename prov-1 to the victim value and claim its key (claimedByRecord: prov-1 holds it after this commit);
      // leaving "Vodafone" requires releasing its key in the same commit (without it: refused)
      await assertFails(writeBatch(f)
        .update(doc(f, 'providers', 'prov-1'), { name: 'Etisalat' })
        .set(doc(f, 'uniqueKeys', kEt), keyDoc('provider_name', ORG, 'Etisalat', 'providers', 'prov-1'))
        .commit());
      await assertSucceeds(writeBatch(f)
        .update(doc(f, 'providers', 'prov-1'), { name: 'Etisalat' })
        .set(doc(f, 'uniqueKeys', kEt), keyDoc('provider_name', ORG, 'Etisalat', 'providers', 'prov-1'))
        .delete(doc(f, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Vodafone')))
        .commit());
      // step 2: rename it back WITHOUT releasing the key: refused (keyLeftWithRecord)
      await assertFails(updateDoc(doc(f, 'providers', 'prov-1'), { name: 'Vodafone' }));
      // a case / spacing change of the same value keeps the key
      await assertSucceeds(updateDoc(doc(f, 'providers', 'prov-1'), { name: 'ETISALAT ' }));
      // the rename that releases it (the domain's updateEntity) passes; the value is free again
      await updateEntity(store(FIN), actor(FIN, 'finance', ORG), 'provider', 'prov-1', { name: 'Vodafone' } as any, rename, key());
      expect(await read('uniqueKeys', kEt)).toBeUndefined();
      expect(await outcome(createEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', provider('Etisalat'), () => 'x', key()))).toBe('ok');
    });

    it('[K3-1] (stale keys left by older app versions) the org admin takes the value over through the domain: a new record, or the record renamed back', async () => {
      // a key whose record no longer holds its value (written before the fix)
      await seed(f => setDoc(doc(f, 'uniqueKeys', kEt), keyDoc('provider_name', ORG, 'Etisalat', 'providers', 'prov-1')));
      // the stale key still cannot be deleted on its own by the org admin (nothing is released by it)
      await assertFails(deleteDoc(doc(db(ADMIN), 'uniqueKeys', kEt)));
      // prov-1 takes its own stale key back (renamed to "Etisalat" through the domain)
      expect(await outcome(updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', 'prov-1', { name: 'Etisalat' } as any, rename, key()))).toBe('ok');
      expect(await read('uniqueKeys', kEt)).toMatchObject({ entityId: 'prov-1' });
      // ... and it now holds it: a new "Etisalat" is a duplicate
      expect(await outcome(createEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', provider('Etisalat'), () => 'x', key()))).toBe('duplicate');
      // a key naming a deleted record is taken over by a new record
      await seed(f => setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Orange EG')), keyDoc('provider_name', ORG, 'Orange EG', 'providers', 'prov-gone')));
      const p = await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', provider('Orange EG'), () => 'x', key());
      expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Orange EG'))).toMatchObject({ entityId: p.value.id });
    });

    it('[K3-1] (other scopes) service codes and account numbers: the rename back is refused; stale keys are taken over by the org admin', async () => {
      const f = db(FIN);
      const kSvc = uniqueKeyDocId('service_code', ORG, 'HOST');
      await assertSucceeds(writeBatch(f).update(doc(f, 'services', 'srv-1'), { code: 'HOST' }).set(doc(f, 'uniqueKeys', kSvc), keyDoc('service_code', ORG, 'HOST', 'services', 'srv-1'))
        .delete(doc(f, 'uniqueKeys', uniqueKeyDocId('service_code', ORG, 'CLD'))).commit());
      await assertFails(updateDoc(doc(f, 'services', 'srv-1'), { code: 'CLD' }));
      const kAcc = uniqueKeyDocId('account_identifier', ORG, 'EG-555');
      await assertSucceeds(writeBatch(f).update(doc(f, 'paymentAccounts', 'acc-cash'), { accountIdentifier: 'EG-555' }).set(doc(f, 'uniqueKeys', kAcc), keyDoc('account_identifier', ORG, 'EG-555', 'paymentAccounts', 'acc-cash'))
        .delete(doc(f, 'uniqueKeys', uniqueKeyDocId('account_identifier', ORG, 'EG001'))).commit());
      await assertFails(updateDoc(doc(f, 'paymentAccounts', 'acc-cash'), { accountIdentifier: 'EG001' }));
      // departments and member e-mails (org admin) follow the same rule
      const a = db(ADMIN);
      const kDep = uniqueKeyDocId('department_name', ORG, 'Ops');
      await assertSucceeds(writeBatch(a).update(doc(a, 'departments', 'dept-1'), { name: 'Ops' }).set(doc(a, 'uniqueKeys', kDep), keyDoc('department_name', ORG, 'Ops', 'departments', 'dept-1'))
        .delete(doc(a, 'uniqueKeys', uniqueKeyDocId('department_name', ORG, 'IT'))).commit());
      await assertFails(updateDoc(doc(a, 'departments', 'dept-1'), { name: 'IT' }));
      const kMail = uniqueKeyDocId('member_email', ORG, 'new.emp@acme.test');
      await assertSucceeds(writeBatch(a).update(doc(a, 'members', `${EMP.uid}_${ORG}`), { userEmail: 'new.emp@acme.test' })
        .set(doc(a, 'uniqueKeys', kMail), { ...keyDoc('member_email', ORG, 'new.emp@acme.test', 'members', `${EMP.uid}_${ORG}`), value: normalizeKeyValue('new.emp@acme.test', 'member_email') }).commit());
      await assertFails(updateDoc(doc(a, 'members', `${EMP.uid}_${ORG}`), { userEmail: EMP.email }));
      // stale keys (older app versions): taken over through the domain
      await seed(async s2 => {
        await setDoc(doc(s2, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0 });
        await setDoc(doc(s2, 'paymentAccounts', 'acc-cash'), { orgId: ORG, name: 'acc-cash', type: 'cash', accountIdentifier: 'EG001', currency: 'EGP', active: true, balance: 0, currentBalance: 0, initialBalance: 0, totalIn: 0, totalOut: 0 });
      });
      const svc = await outcome(createEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'service', service('HOST'), () => 'x', key()));
      const acc = await outcome(createPaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, name: 'New bank', type: 'bank', accountIdentifier: 'EG555', currency: 'EGP', active: true, initialBalance: 0 } as any, key()));
      expect({ svc, acc }).toEqual({ svc: 'ok', acc: 'ok' });
    });

    it('[K3-1] (budget) worst-case values (capitals, Arabic-Indic digits, tatweel, separators) are released, taken back and taken over within the expression budget', async () => {
      const v = 'ETISALAT-MISR ١٢٣ـ Co.';
      const v2 = 'VODAFONE-EGYPT ۴۵ Co.';
      const kv = uniqueKeyDocId('provider_name', ORG, v);
      // a stale self-owned key with the worst-case value, then the record renamed back to it through the domain
      await seed(f => setDoc(doc(f, 'uniqueKeys', kv), keyDoc('provider_name', ORG, v, 'providers', 'prov-1')));
      expect(await outcome(updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', 'prov-1', { name: v } as any, rename, key()))).toBe('ok');
      // renamed away (release) to another worst-case value (claim)
      expect(await outcome(updateEntity(store(FIN), actor(FIN, 'finance', ORG), 'provider', 'prov-1', { name: v2 } as any, rename, key()))).toBe('ok');
      expect(await read('uniqueKeys', kv)).toBeUndefined();
      // a stale key naming a deleted record, taken over by a new record
      await seed(f => setDoc(doc(f, 'uniqueKeys', kv), keyDoc('provider_name', ORG, v, 'providers', 'prov-deleted')));
      expect(await outcome(createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', provider(v), () => 'x', key()))).toBe('ok');
      // a member e-mail with capitals and separators: changed and taken over
      const m = `${EMP.uid}_${ORG}`;
      expect(await outcome(updateMemberRecord(store(ADMIN), actor(ADMIN, 'org_admin', ORG), m, { userEmail: 'Ahmed.Ali-EG_2@Acme-Group.TEST' }, [EMP.uid], key()))).toBe('ok');
    });

    it('take-over is only for a key whose record does not hold it: a live key is never re-pointed (other record, other role, other company, unrelated record)', async () => {
      const kV = uniqueKeyDocId('provider_name', ORG, 'Vodafone');
      await seed(f => setDoc(doc(f, 'providers', 'prov-2'), { orgId: ORG, name: 'Vodafone', totalPaid: 0, active: true })); // a legacy duplicate holding the same value
      for (const u of [ADMIN, FIN, DE, EMP, MULTI_ADMIN, CAIRO_ADMIN, STRANGER]) {
        await assertFails(setDoc(doc(db(u), 'uniqueKeys', kV), keyDoc('provider_name', ORG, 'Vodafone', 'providers', 'prov-2')));
      }
      // a key naming a deleted record: re-pointed only to a record of the key's company that holds the value
      await seed(f => setDoc(doc(f, 'uniqueKeys', kEt), keyDoc('provider_name', ORG, 'Etisalat', 'providers', 'prov-gone')));
      await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', kEt), keyDoc('provider_name', ORG, 'Etisalat', 'providers', 'prov-2')));        // prov-2 is Vodafone
      await assertFails(setDoc(doc(db(CAIRO_ADMIN), 'uniqueKeys', kEt), keyDoc('provider_name', ORG, 'Etisalat', 'providers', 'prov-o')));  // other company
      await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', kEt), { ...keyDoc('provider_name', ORG, 'Etisalat', 'providers', 'prov-1'), orgId: OTHER_ORG }));
      await assertFails(setDoc(doc(db(STRANGER), 'uniqueKeys', kEt), keyDoc('provider_name', ORG, 'Etisalat', 'providers', 'prov-1')));
      // control: a record that holds the value takes it over (here: prov-2 renamed in the same commit)
      const f = db(FIN);
      await assertSucceeds(writeBatch(f).update(doc(f, 'providers', 'prov-2'), { name: 'Etisalat' })
        .set(doc(f, 'uniqueKeys', kEt), keyDoc('provider_name', ORG, 'Etisalat', 'providers', 'prov-2')).commit());
    });

    it('roles that cannot edit the record cannot plant a stale key (employee, data entry, other company, stranger)', async () => {
      for (const u of [EMP, DE, CAIRO_ADMIN, STRANGER]) {
        const f = db(u);
        await assertFails(writeBatch(f).update(doc(f, 'providers', 'prov-1'), { name: 'Etisalat' }).set(doc(f, 'uniqueKeys', kEt), keyDoc('provider_name', ORG, 'Etisalat', 'providers', 'prov-1')).commit());
      }
      // employee's own membership: contact edits only, never the e-mail a member_email key holds
      const e = db(EMP);
      const kM = uniqueKeyDocId('member_email', ORG, 'ceo@acme.test');
      await assertFails(writeBatch(e).update(doc(e, 'members', `${EMP.uid}_${ORG}`), { userEmail: 'ceo@acme.test' }).set(doc(e, 'uniqueKeys', kM), keyDoc('member_email', ORG, 'ceo@acme.test', 'members', `${EMP.uid}_${ORG}`)).commit());
      // data entry creates a provider WITH the name (a visible record, removable by the org admin through the domain)
      const p = await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', provider('Etisalat'), () => 'x', key());
      await deleteEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', p.value.id, 'delete', key());
      expect(await read('uniqueKeys', kEt)).toBeUndefined();
    });

    it('live keys: nobody but the owner deletes a key whose record still holds it; releases through unrelated fields / self-service edits are refused', async () => {
      const kV = uniqueKeyDocId('provider_name', ORG, 'Vodafone');
      for (const u of [ADMIN, FIN, EMP, DE, MULTI_ADMIN, CAIRO_ADMIN, STRANGER]) await assertFails(deleteDoc(doc(db(u), 'uniqueKeys', kV)));
      const f = db(FIN);
      await assertFails(writeBatch(f).update(doc(f, 'providers', 'prov-1'), { active: false }).delete(doc(f, 'uniqueKeys', kV)).commit());
      await assertFails(writeBatch(f).update(doc(f, 'providers', 'prov-1'), { name: 'VODA FONE.' }).delete(doc(f, 'uniqueKeys', kV)).commit());
      const e = db(EMP);
      const kMe = uniqueKeyDocId('member_email', ORG, EMP.email);
      await seed(s => setDoc(doc(s, 'uniqueKeys', kMe), keyDoc('member_email', ORG, EMP.email, 'members', `${EMP.uid}_${ORG}`)));
      await assertFails(writeBatch(e).update(doc(e, 'members', `${EMP.uid}_${ORG}`), { userName: 'renamed' }).delete(doc(e, 'uniqueKeys', kMe)).commit());
      expect(await read('uniqueKeys', kV)).toBeTruthy();
      expect(await read('uniqueKeys', kMe)).toBeTruthy();
    });

    it('cross-company: keys of OTHER can be neither read, claimed nor released by ORG staff; a claim in ORG for an OTHER record is refused', async () => {
      const kO = uniqueKeyDocId('provider_name', OTHER_ORG, 'Orange');
      for (const u of [ADMIN, FIN, EMP, DE, STRANGER]) await assertFails(getDoc(doc(db(u), 'uniqueKeys', kO)));
      await assertSucceeds(getDoc(doc(db(CAIRO_EMP), 'uniqueKeys', kO)));
      // ORG data entry: a provider of OTHER keyed in ORG's namespace / OTHER's namespace
      const d = db(DE);
      await assertFails(writeBatch(d).set(doc(d, 'providers', 'prov-x'), { orgId: OTHER_ORG, name: 'Zed', totalPaid: 0 })
        .set(doc(d, 'uniqueKeys', uniqueKeyDocId('provider_name', OTHER_ORG, 'Zed')), keyDoc('provider_name', OTHER_ORG, 'Zed', 'providers', 'prov-x')).commit());
      await assertFails(setDoc(doc(d, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Orange')), keyDoc('provider_name', ORG, 'Orange', 'providers', 'prov-o')));
      // OTHER's data entry cannot claim in ORG, even for a record it creates in OTHER
      const c = db(CAIRO_DE);
      await assertFails(writeBatch(c).set(doc(c, 'providers', 'prov-y'), { orgId: OTHER_ORG, name: 'Vodafone EG', totalPaid: 0 })
        .set(doc(c, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Vodafone EG')), keyDoc('provider_name', ORG, 'Vodafone EG', 'providers', 'prov-y')).commit());
      // release of OTHER's key by renaming ORG's record / OTHER's record
      const a = db(ADMIN);
      await assertFails(writeBatch(a).update(doc(a, 'providers', 'prov-1'), { name: 'X1' }).delete(doc(a, 'uniqueKeys', kO)).commit());
      const m = db(MULTI_ADMIN);
      await assertFails(writeBatch(m).update(doc(m, 'providers', 'prov-o'), { name: 'X2' }).delete(doc(m, 'uniqueKeys', kO)).commit());
      expect(await read('uniqueKeys', kO)).toBeTruthy();
    });

    it('empty-normalizing and format-character values: no empty key can be claimed; a zero-width / tatweel-only value has no key on either side', async () => {
      const a = db(ADMIN);
      for (const v of ['-', '...', '_-_', ' 　 ', '﻿', '  ', ' . ', '​', 'ــ', '­']) {
        await seed(f => setDoc(doc(f, 'providers', 'prov-e'), { orgId: ORG, name: v, totalPaid: 0 }));
        await assertFails(setDoc(doc(a, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, v)), keyDoc('provider_name', ORG, v, 'providers', 'prov-e')));
        await assertFails(setDoc(doc(a, 'uniqueKeys', `provider_name__${ORG}__`), { scope: 'provider_name', orgId: ORG, value: '', entityCollection: 'providers', entityId: 'prov-e' }));
      }
      // the domain: providers named "-" or "​" (no key) are all created, none claims a key
      for (const v of ['-', ' - ', '​', ' ​.']) expect((await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', provider(v), () => 'x', key())).changed).toBe(true);
      // a value made of a kept character (U+0085, not JavaScript whitespace) is a real key on both sides
      await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', provider(''), () => 'x', key());
      await expect(createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', provider(' .'), () => 'x', key())).rejects.toMatchObject({ code: 'duplicate' });
    });

    it('forged key shapes: a non-normalized value, a value that differs from the id, an id of another scope, a key of a company-less scope', async () => {
      const a = db(ADMIN);
      await seed(f => setDoc(doc(f, 'providers', 'prov-z'), { orgId: ORG, name: 'Zain Misr', totalPaid: 0 }));
      const good = keyDoc('provider_name', ORG, 'Zain Misr', 'providers', 'prov-z');
      await assertFails(setDoc(doc(a, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Zain Misr')), { ...good, value: 'Zain Misr' }));
      await assertFails(setDoc(doc(a, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'ZainMisr2')), good));
      await assertFails(setDoc(doc(a, 'uniqueKeys', uniqueKeyDocId('department_name', ORG, 'Zain Misr')), { ...good, scope: 'department_name' }));
      await assertFails(setDoc(doc(a, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Zain Misr')), { ...good, entityId: '' }));
      await assertFails(setDoc(doc(a, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Zain Misr')), { ...good, entityId: 7 }));
      await assertSucceeds(setDoc(doc(db(EMP), 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Zain Misr')), good));   // [known] any member re-keys a record that holds the value
      await assertFails(setDoc(doc(a, 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Zain Misr')), good));            // and nobody overwrites it
    });

    it('org codes: only the owner reads, claims or releases org_code keys (org admin, data entry, employee, other company refused)', async () => {
      const kCode = uniqueKeyDocId('org_code', '-', 'ACME');
      const kNew = uniqueKeyDocId('org_code', '-', 'NEWCO');
      for (const u of [ADMIN, DE, EMP, CAIRO_ADMIN, STRANGER]) {
        await assertFails(getDoc(doc(db(u), 'uniqueKeys', kCode)));
        await assertFails(deleteDoc(doc(db(u), 'uniqueKeys', kCode)));
        await assertFails(setDoc(doc(db(u), 'uniqueKeys', kNew), { scope: 'org_code', orgId: '-', value: 'newco', entityCollection: 'organizations', entityId: ORG }));
        await assertFails(setDoc(doc(db(u), 'uniqueKeys', uniqueKeyDocId('org_code', ORG, 'NEWCO')), { scope: 'org_code', orgId: ORG, value: 'newco', entityCollection: 'organizations', entityId: ORG }));
      }
      // releasing ACME's code by "renaming" the company is refused (code is the owner's)
      const a = db(ADMIN);
      await assertFails(writeBatch(a).update(doc(a, 'organizations', ORG), { code: 'ACME2' }).delete(doc(a, 'uniqueKeys', kCode)).commit());
      await assertSucceeds(getDoc(doc(db(OWNER), 'uniqueKeys', kCode)));
    });

    it('a key released by a legitimate rename is re-claimed through the domain by another record; the renamed record cannot take it back', async () => {
      await updateEntity(store(FIN), actor(FIN, 'finance', ORG), 'provider', 'prov-1', { name: 'Vodafone Egypt' } as any, rename, key());
      const p = await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', provider('VODA-FONE'), () => 'x', key());
      expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Vodafone'))).toMatchObject({ entityId: p.value.id });
      await expect(updateEntity(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'provider', 'prov-1', { name: 'vodafone' } as any, rename, key())).rejects.toMatchObject({ code: 'duplicate' });
    });
  });

  // =============================================================================
  // 4. Legitimacy gaps of the key normalization (domain)
  // =============================================================================
  describe('legit: what the key folds and what it should not', () => {
    it('[K3-2] org admin adds two DIFFERENT people whose e-mails differ only by a dot / dash / underscore (ahmed.ali@ vs ahmedali@): both are added', async () => {
      const a = actor(ADMIN, 'org_admin', ORG);
      const out: Record<string, string> = {};
      for (const [first, second] of [['ahmed.ali@acme.test', 'ahmedali@acme.test'], ['m-salah@acme.test', 'msalah@acme.test'], ['sara_k@acme.test', 'sarak@acme.test']]) {
        await createMember(store(ADMIN), a, { orgId: ORG, userEmail: first, userName: first, role: 'employee', jobTitle: 'j', department: 'd', active: true } as any, key());
        out[second] = await outcome(createMember(store(ADMIN), a, { orgId: ORG, userEmail: second, userName: second, role: 'employee', jobTitle: 'j', department: 'd', active: true } as any, key()));
      }
      // the multi-company add form skips the company as "already a member"
      await createMember(store(ADMIN), a, { orgId: ORG, userEmail: 'o.nabil@acme.test', userName: 'O', role: 'employee', jobTitle: 'j', department: 'd', active: true } as any, key());
      const multi = await createMemberInOrgs(store(ADMIN), a, { userId: '', userEmail: 'onabil@acme.test', userName: 'O2', role: 'employee', jobTitle: 'j', department: 'd', active: true } as any, [ORG], key()).catch(e => e);
      out['onabil@acme.test (multi-company form)'] = multi?.value ? `created ${multi.value.created.length}, skipped ${JSON.stringify(multi.value.skipped)}` : String(multi?.code);
      expect(out).toEqual({
        'ahmedali@acme.test': 'ok',
        'msalah@acme.test': 'ok',
        'sarak@acme.test': 'ok',
        'onabil@acme.test (multi-company form)': 'created 1, skipped []',
      });
    });

    it('[K3-2] (InstaPay addresses) org admin opens two InstaPay channels ali.m@instapay and alim@instapay (two different payment addresses)', async () => {
      const base = { orgId: ORG, type: 'instapay', currency: 'EGP', active: true, initialBalance: 0, parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' };
      await createPaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { ...base, name: 'IP Ali M', accountIdentifier: 'ali.m@instapay' } as any, key());
      const second = await outcome(createPaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { ...base, name: 'IP Alim', accountIdentifier: 'alim@instapay' } as any, key()));
      expect(second).toBe('ok');
    });

    it('[K3-3] visually identical Arabic / Unicode duplicates are refused: tatweel, harakat, zero-width, Arabic-Indic digits ([known] NFD accents stay distinct)', async () => {
      const pairs: Array<[string, string, 'provider' | 'department' | 'account']> = [
        ['شركة الأمل للتوريدات', 'شركة الأمـــل للتوريدات', 'provider'],          // tatweel (kashida)
        ['شركة الأمل للتوريدات', 'شَرِكَة الأمل للتوريدات', 'provider'],            // harakat
        ['مؤسسة النور', 'مؤسسة الن​ور', 'provider'],                            // zero-width space
        ['قسم المشتريات', 'قسم المشتـريات', 'department'],                           // tatweel
        ['0123456789', '٠١٢٣٤٥٦٧٨٩', 'account'],                                     // Arabic-Indic digits typed on an Arabic keyboard
      ];
      const out: string[] = [];
      for (const [first, second, kind] of pairs) {
        if (kind === 'account') {
          await createPaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, name: 'A1', type: 'bank', accountIdentifier: first, currency: 'EGP', active: true, initialBalance: 0 } as any, key());
          out.push(`${kind} ${esc(second)}: ${await outcome(createPaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, name: 'A2', type: 'bank', accountIdentifier: second, currency: 'EGP', active: true, initialBalance: 0 } as any, key()))}`);
          continue;
        }
        const build = kind === 'provider' ? provider : department;
        await createEntity(store(DE), actor(DE, 'data_entry', ORG), kind, build(first), () => 'x', key()).catch(() => undefined);
        out.push(`${kind} ${esc(second)}: ${await outcome(createEntity(store(DE), actor(DE, 'data_entry', ORG), kind, build(second), () => 'x', key()))}`);
      }
      expect(out.filter(o => !o.endsWith(': duplicate'))).toEqual([]);
      // [known] composed vs decomposed accents are two keys (the rules cannot normalize Unicode forms)
      await createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', provider('Café Nile'), () => 'x', key());
      expect(await outcome(createEntity(store(DE), actor(DE, 'data_entry', ORG), 'provider', provider('Café Nile'), () => 'x', key()))).toBe('ok');
    });

    it('keys written before the round-3 normalization: an old folded e-mail key still refuses the SAME address, frees a different one, and is released with its member', async () => {
      const a = actor(ADMIN, 'org_admin', ORG);
      const m1 = `pending-old_${ORG}`;
      const oldId = uniqueKeyDocIdV1('member_email', ORG, 'ahmed.ali@acme.test');
      await seed(async f => {
        await setDoc(doc(f, 'members', m1), { orgId: ORG, userId: 'pending-old', userEmail: 'ahmed.ali@acme.test', role: 'employee', active: true, userName: 'Ahmed Ali' });
        await setDoc(doc(f, 'uniqueKeys', oldId), { scope: 'member_email', orgId: ORG, value: normalizeKeyValueV1('ahmed.ali@acme.test'), entityCollection: 'members', entityId: m1 });
      });
      // the same address under another login id: still a duplicate
      expect(await outcome(createMember(store(ADMIN), a, { orgId: ORG, userId: 'uidOtherLogin000000000001', userEmail: 'Ahmed.Ali@acme.test', userName: 'x', role: 'employee', jobTitle: 'j', department: 'd', active: true } as any, key()))).toBe('duplicate');
      // a different address that shared the old folded key: free
      expect(await outcome(createMember(store(ADMIN), a, { orgId: ORG, userEmail: 'ahmedali@acme.test', userName: 'y', role: 'employee', jobTitle: 'j', department: 'd', active: true } as any, key()))).toBe('ok');
      // an old tab claiming a folded (V1) key is still accepted by the rules
      const kOld = uniqueKeyDocIdV1('member_email', ORG, 'old.tab@acme.test');
      const ad = db(ADMIN);
      await assertSucceeds(writeBatch(ad).set(doc(ad, 'members', `pending-tab_${ORG}`), { orgId: ORG, userId: 'pending-tab', userEmail: 'old.tab@acme.test', role: 'employee', active: true, userName: 't' })
        .set(doc(ad, 'uniqueKeys', kOld), { scope: 'member_email', orgId: ORG, value: normalizeKeyValueV1('old.tab@acme.test'), entityCollection: 'members', entityId: `pending-tab_${ORG}` }).commit());
      // removing the member releases its old key
      const { removeMember } = await import('../src/domain/directory');
      await removeMember(store(ADMIN), a, m1, [], key());
      expect(await read('uniqueKeys', oldId)).toBeUndefined();
    });
  });

  // =============================================================================
  // 5. Legacy restores (markers, other company, existing record, counters)
  // =============================================================================
  describe('legacy restores after round 2', () => {
    const rec = (c: string, id: string, data: Record<string, unknown>): LegacyRecord =>
      ({ store: LEGACY_STORES.find(s => s.collection === c)!, id, data: { id, ...data }, title: id });
    const marker = (collection: string, docId: string, orgId: string, by: string) => ({ collection, docId, orgId, restoredBy: by, restoredAt: 'x', source: 'file' });
    const adminCtx = () => ({ actor: actor(ADMIN, 'org_admin', ORG), orgId: ORG });

    it('[K3-4] legit: org admin restores a legacy service that the old app shared with another company: the domain sends it to the owner ("needs_owner")', async () => {
      const res = await restoreRecord(store(ADMIN), adminCtx(), rec('services', 'srv-old-shared', { orgId: ORG, orgIds: [ORG, OTHER_ORG], name: 'Shared hosting', code: 'SH-1', spentAmount: 0 }), 'file');
      expect(`${res.outcome}${res.error ? ` ${res.error.replace(/\s+/g, ' ').slice(0, 400)}` : ''}`).toMatch(/^(restored|needs_owner)$/);
    });

    it('[K3-4] control: the owner restores the same shared service; a legacy service shared only with its own company is restored by the org admin', async () => {
      const own = await restoreRecord(store(ADMIN), adminCtx(), rec('services', 'srv-old-own', { orgId: ORG, orgIds: [ORG], name: 'Own', code: 'OWN-1', spentAmount: 0 }), 'file');
      const owner = await restoreRecord(store(OWNER), { actor: actor(OWNER, 'super_admin'), orgId: '' }, rec('services', 'srv-old-shared', { orgId: ORG, orgIds: [ORG, OTHER_ORG], name: 'Shared hosting', code: 'SH-1', spentAmount: 0 }), 'file');
      expect([own.outcome, owner.outcome]).toEqual(['restored', 'restored']);
    });

    it('[K3-5] a restore marker of ORG is readable by its company only (not another company\'s employee, not a stranger); a missing marker reads as missing for everyone', async () => {
      await restoreRecord(store(ADMIN), adminCtx(), rec('requests', 'req-legacy-7', { orgId: ORG, status: 'pending', amount: 10, requesterId: EMP.uid, requesterEmail: EMP.email, title: 'x' }), 'file');
      await assertSucceeds(getDoc(doc(db(ADMIN), 'legacyRestores', 'requests__req-legacy-7')));
      const leaked: string[] = [];
      for (const u of [CAIRO_EMP, STRANGER]) {
        const snap = await getDoc(doc(db(u), 'legacyRestores', 'requests__req-legacy-7')).catch(() => null);
        if (snap?.exists()) leaked.push(`${u.email} read ${JSON.stringify(snap.data())}`);
      }
      expect(leaked).toEqual([]);
      await assertSucceeds(getDoc(doc(db(EMP), 'legacyRestores', 'requests__req-legacy-7')));
      await assertSucceeds(getDoc(doc(db(OWNER), 'legacyRestores', 'requests__req-legacy-7')));
      for (const u of [CAIRO_EMP, STRANGER]) await assertSucceeds(getDoc(doc(db(u), 'legacyRestores', 'requests__req-legacy-99')));
    });

    it('forged markers: wrong id, other collection, other company, existing record, non-restorable collection, empty orgId, foreign restoredBy', async () => {
      const a = db(ADMIN);
      const d = { id: 'dept-r1', orgId: ORG, name: 'Restored 1' };
      await assertFails(writeBatch(a).set(doc(a, 'departments', 'dept-r1'), d).set(doc(a, 'legacyRestores', 'departments__dept-r2'), marker('departments', 'dept-r1', ORG, ADMIN.uid)).commit());
      await assertFails(writeBatch(a).set(doc(a, 'departments', 'dept-r1'), d).set(doc(a, 'legacyRestores', 'requests__dept-r1'), marker('requests', 'dept-r1', ORG, ADMIN.uid)).commit());
      await assertFails(writeBatch(a).set(doc(a, 'departments', 'dept-r1'), d).set(doc(a, 'legacyRestores', 'departments__dept-r1'), marker('departments', 'dept-r1', '', ADMIN.uid)).commit());
      await assertFails(writeBatch(a).set(doc(a, 'departments', 'dept-r1'), d).set(doc(a, 'legacyRestores', 'departments__dept-r1'), marker('departments', 'dept-r1', ORG, EMP.uid)).commit());
      await assertFails(writeBatch(a).set(doc(a, 'members', 'x_' + ORG), { orgId: ORG, userId: 'x', role: 'employee' }).set(doc(a, 'legacyRestores', 'members__x_' + ORG), marker('members', 'x_' + ORG, ORG, ADMIN.uid)).commit());
      // existing record overwritten + marker (set on an existing department = update)
      await assertFails(writeBatch(a).set(doc(a, 'departments', 'dept-1'), { orgId: ORG, name: 'IT' }).set(doc(a, 'legacyRestores', 'departments__dept-1'), marker('departments', 'dept-1', ORG, ADMIN.uid)).commit());
      // a path-like docId
      await assertFails(setDoc(doc(a, 'legacyRestores', 'departments__a'), marker('departments', 'a/b', ORG, ADMIN.uid)));
      // the other company's staff restore into ORG (record + marker)
      const c = db(CAIRO_ADMIN);
      await assertFails(writeBatch(c).set(doc(c, 'departments', 'dept-r3'), { id: 'dept-r3', orgId: ORG, name: 'R3' }).set(doc(c, 'legacyRestores', 'departments__dept-r3'), marker('departments', 'dept-r3', ORG, CAIRO_ADMIN.uid)).commit());
      await assertFails(writeBatch(c).set(doc(c, 'departments', 'dept-r3'), { id: 'dept-r3', orgId: ORG, name: 'R3' }).set(doc(c, 'legacyRestores', 'departments__dept-r3'), marker('departments', 'dept-r3', OTHER_ORG, CAIRO_ADMIN.uid)).commit());
      // markers are permanent for org admins
      await writeBatch(a).set(doc(a, 'departments', 'dept-r4'), { id: 'dept-r4', orgId: ORG, name: 'R4' }).set(doc(a, 'legacyRestores', 'departments__dept-r4'), marker('departments', 'dept-r4', ORG, ADMIN.uid)).commit();
      await assertFails(deleteDoc(doc(a, 'legacyRestores', 'departments__dept-r4')));
      await assertFails(setDoc(doc(a, 'legacyRestores', 'departments__dept-r4'), marker('departments', 'dept-r4', ORG, ADMIN.uid)));
    });

    it('needs_owner cannot be bypassed with raw writes: counters, non-pending statuses and decision records are refused for org admin / data entry / employee', async () => {
      const a = db(ADMIN);
      const d = db(DE);
      const e = db(EMP);
      const restore = (f: Firestore, c: string, id: string, data: Record<string, unknown>, by: string) =>
        writeBatch(f).set(doc(f, c, id), { id, ...data }).set(doc(f, 'legacyRestores', `${c}__${id}`), marker(c, id, ORG, by)).commit();
      await assertFails(restore(a, 'providers', 'prov-r1', { orgId: ORG, name: 'Paid P', totalPaid: 500 }, ADMIN.uid));
      await assertFails(restore(a, 'providers', 'prov-r2', { orgId: ORG, name: 'Paid P2', totalPaid: '0' }, ADMIN.uid));
      await assertFails(restore(d, 'providers', 'prov-r3', { orgId: ORG, name: 'Paid P3', totalPaid: 0.01 }, DE.uid));
      await assertFails(restore(a, 'services', 'srv-r1', { orgId: ORG, name: 'Used', code: 'U1', spentAmount: 120 }, ADMIN.uid));
      await assertFails(restore(a, 'requests', 'req-r1', { orgId: ORG, status: 'approved', amount: 5, requesterId: EMP.uid }, ADMIN.uid));
      await assertFails(restore(a, 'requests', 'req-r2', { orgId: ORG, status: 'pending', amount: 5, requesterId: EMP.uid, approvedBy: ADMIN.uid }, ADMIN.uid));
      await assertFails(restore(a, 'requests', 'req-r3', { orgId: ORG, status: 'pending', amount: 5, requesterId: EMP.uid, disbursement: null }, ADMIN.uid));
      await assertFails(restore(e, 'requests', 'req-r4', { orgId: ORG, status: 'pending', amount: 5, requesterId: FIN.uid }, EMP.uid));
      await assertFails(restore(e, 'visaRequests', 'visa-r1', { orgId: ORG, status: 'paid', totalAmount: 5, requesterId: EMP.uid }, EMP.uid));
      await assertFails(restore(e, 'departments', 'dept-r9', { orgId: ORG, name: 'by employee' }, EMP.uid));
      // a sub-cent legacy counter rounds to 0 for the domain and the rules alike
      await assertSucceeds(restore(d, 'providers', 'prov-r4', { orgId: ORG, name: 'Noise', totalPaid: 0.004 }, DE.uid));
    });

    it('restore through the domain: the multi-company org admin restores in ORG; a duplicate name is "duplicate"; a second attempt is "handled"; another company\'s record is "other_org"', async () => {
      const mctx = { actor: actor(MULTI_ADMIN, 'org_admin', ORG), orgId: ORG };
      const r1 = await restoreRecord(store(MULTI_ADMIN), mctx, rec('providers', 'prov-old-m', { orgId: ORG, name: 'Legacy Supplier Co.' }), 'browser');
      const r2 = await restoreRecord(store(MULTI_ADMIN), mctx, rec('providers', 'prov-old-m2', { orgId: ORG, name: 'legacy-supplier co' }), 'browser');
      const r3 = await restoreRecord(store(MULTI_ADMIN), mctx, rec('providers', 'prov-old-m', { orgId: ORG, name: 'Legacy Supplier Co.' }), 'browser');
      const r4 = await restoreRecord(store(ADMIN), adminCtx(), rec('departments', 'dept-old-o', { orgId: OTHER_ORG, name: 'Other dept' }), 'file');
      const r5 = await restoreRecord(store(ADMIN), adminCtx(), rec('departments', 'dept-1', { orgId: ORG, name: 'IT again' }), 'file');
      expect([r1.outcome, r2.outcome, r3.outcome, r4.outcome, r5.outcome]).toEqual(['restored', 'duplicate', 'handled', 'other_org', 'exists']);
      expect(await read('uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Legacy Supplier Co'))).toMatchObject({ entityId: 'prov-old-m' });
    });

    it('[known] a member of the same company can occupy a legacy id with a record of its own (and its marker); another company cannot', async () => {
      const e = db(EMP);
      await assertSucceeds(writeBatch(e)
        .set(doc(e, 'requests', 'req-legacy-9'), { id: 'req-legacy-9', orgId: ORG, status: 'pending', amount: 1, requesterId: EMP.uid, title: 'mine' })
        .set(doc(e, 'legacyRestores', 'requests__req-legacy-9'), marker('requests', 'req-legacy-9', ORG, EMP.uid))
        .commit());
      const c = db(CAIRO_EMP);
      await assertFails(writeBatch(c)
        .set(doc(c, 'requests', 'req-legacy-10'), { id: 'req-legacy-10', orgId: ORG, status: 'pending', amount: 1, requesterId: CAIRO_EMP.uid, title: 'x' })
        .set(doc(c, 'legacyRestores', 'requests__req-legacy-10'), marker('requests', 'req-legacy-10', ORG, CAIRO_EMP.uid))
        .commit());
      const res = await restoreRecord(store(ADMIN), adminCtx(), rec('requests', 'req-legacy-10', { orgId: ORG, status: 'pending', amount: 10, requesterId: EMP.uid, title: 'x' }), 'file');
      expect(res.outcome).toBe('restored');
    });
  });
});

// =============================================================================
// Round r3, legit lane. Each section seeds its own data (its own accounts, users and helpers).
// =============================================================================
/**
 * Round r3, LEGITIMACY lane (not an attacker): every write operation of the app, run through the
 * REAL domain functions (src/domain/*) as each role the UI allows (src/utils/permissions.ts), on
 * realistic and legacy production data, against the hardened rules.
 *
 * A test named [LG3-n] demonstrates a finding: it runs the legitimate operation and asserts that it
 * works; it FAILS while the rules (or the domain) refuse it. Every other test is coverage.
 */
describe('round r3: legitimate operations lane ([LG3-1] invitation of a person of another company, [LG3-2] un-shared service, [LG3-3] restore of a shared service)', () => {
  const ORG = 'org-acme';
  const OTHER_ORG = 'org-other';

  type U = { uid: string; email: string };
  const OWNER: U = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
  const ADMIN: U = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
  const EMP: U = { uid: 'uidEmployee0000000000000001', email: 'emp@acme.test' };
  const FIN: U = { uid: 'uidFinance00000000000000001', email: 'fin@acme.test' };
  const DE: U = { uid: 'uidDataEntry000000000000001', email: 'de@acme.test' };
  const CAIRO_FIN: U = { uid: 'uidCairoFin00000000000001', email: 'fin@other.test' };
  const CAIRO_ADMIN: U = { uid: 'uidCairoAdmin000000000001', email: 'admin@other.test' };
  const CAIRO_EMP: U = { uid: 'uidCairoEmp00000000000001', email: 'emp@other.test' };
  const MULTI_FIN: U = { uid: 'uidMultiFin00000000000001', email: 'multi@other.test' }; // profile OTHER (employee), finance member of ORG

  const db = (u: U, verified = true): Firestore =>
    env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore() as unknown as Firestore;
  const store = (u: U, verified = true) => createFirestoreStore(db(u, verified));
  const actor = (u: U, role: Actor['role'], orgId?: string, emailVerified = true): Actor =>
    ({ id: u.uid, name: u.email, email: u.email, role, emailVerified, ...(orgId ? { orgId } : {}) });
  const notifyOff = { settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: false } };
  const notifyAll = {
    settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: true, notifyOnNewRequest: true, notifyOnApproval: true, notifyOnDisbursement: true, notifyOnClarification: true, notifyOnRejection: true },
    adminRecipients: ['mahmoud@tieapps.com', ADMIN.email],
  };
  let n = 0;
  const key = () => `key-r3l${String(++n).padStart(7, '0')}`;
  const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));
  const read = async (c: string, id: string) => {
    let data: Record<string, any> | undefined;
    await env.withSecurityRulesDisabled(async ctx => {
      data = (await getDoc(doc(ctx.firestore(), c, id))).data();
    });
    return data;
  };
  const readAll = async (c: string, field: string, value: string) => {
    const out: Array<Record<string, any>> = [];
    await env.withSecurityRulesDisabled(async ctx => {
      const snap = await getDocs(query(collection(ctx.firestore(), c), where(field, '==', value)));
      snap.docs.forEach(d => out.push({ ...d.data(), id: d.id }));
    });
    return out;
  };

  const account = (id: string, balance: number, extra: Record<string, unknown> = {}) => ({
    orgId: ORG, name: id, type: 'cash', accountIdentifier: id, currency: 'EGP', active: true,
    balance, currentBalance: balance, initialBalance: balance, totalIn: 0, totalOut: 0, ...extra,
  });
  const approvedRequest = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
    id, orgId: ORG, requestNumber: `REQ-${id}`, status: 'approved', amount, currency: 'EGP', title: 't', requestType: 'expense',
    requesterId: EMP.uid, requesterName: 'e', requesterEmail: EMP.email, timeline: [], comments: [], createdAt: '2026-10-01T00:00:00.000Z', ...extra,
  });

  async function seedBase() {
    await env.clearFirestore();
    await seed(async f => {
      await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', budget: 0, notificationRecipients: [ADMIN.email] });
      await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', budget: 0, notificationRecipients: [CAIRO_ADMIN.email] });
      for (const [u, role, org] of [
        [ADMIN, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [DE, 'data_entry', ORG],
        [CAIRO_FIN, 'finance', OTHER_ORG], [CAIRO_ADMIN, 'org_admin', OTHER_ORG], [CAIRO_EMP, 'employee', OTHER_ORG],
      ] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true, memberId: `${u.uid}_${org}`, email: u.email, name: u.email });
        await setDoc(doc(f, 'members', `${u.uid}_${org}`), { id: `${u.uid}_${org}`, orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
      }
      await setDoc(doc(f, 'users', MULTI_FIN.uid), { orgId: OTHER_ORG, role: 'employee', active: true });
      await setDoc(doc(f, 'members', `${MULTI_FIN.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: MULTI_FIN.uid, userEmail: MULTI_FIN.email, role: 'employee', active: true, userName: 'm' });
      await setDoc(doc(f, 'members', `${MULTI_FIN.uid}_${ORG}`), { orgId: ORG, userId: MULTI_FIN.uid, userEmail: MULTI_FIN.email, role: 'finance', active: true, userName: 'm' });

      // legacy cash box: unrounded balance, no totals, no initialBalance, no lastLedgerId
      await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), { orgId: ORG, name: 'Cash', type: 'cash', accountIdentifier: 'CASH-1', currency: 'EGP', active: true, currentBalance: 7500 / 3, balance: 7500 / 3 });
      // bank with drifted totals (totals do not explain the balance)
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank'), account('acc-bank', 8000.1, { type: 'bank', initialBalance: 100, totalIn: 12.345, totalOut: 9999 }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-insta'), account('acc-insta', 1200.55, { type: 'instapay', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-bank2'), account('acc-bank2', 3000, { type: 'bank' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-insta2'), account('acc-insta2', 3000, { type: 'instapay', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2' }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-wallet-old'), account('acc-wallet-old', 600, { type: 'wallet', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank', initialBalance: 1000, totalOut: 400 }));
      await setDoc(doc(f, 'paymentAccounts', 'acc-oc'), { ...account('acc-oc', 5000), orgId: OTHER_ORG });

      await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0 });
      await setDoc(doc(f, 'services', 'srv-legacy'), { orgId: ORG, name: 'Legacy' }); // no counter, no code
      await setDoc(doc(f, 'services', 'srv-shared'), { orgId: ORG, orgIds: [ORG, OTHER_ORG], name: 'WE', code: 'WE', spentAmount: 0 });
      await setDoc(doc(f, 'providers', 'prov-1'), { orgId: ORG, name: 'Vodafone', totalPaid: 500, active: true });
      await setDoc(doc(f, 'providers', 'prov-legacy'), { orgId: ORG, name: 'Old vendor' }); // no counter
      await setDoc(doc(f, 'providers', 'prov-c'), { orgId: OTHER_ORG, name: 'CP', totalPaid: 0, active: true });
    });
  }


  // Deterministic PRNG (mulberry32).
  const rng = (s: number) => () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ===========================================================================
  // 1. Random mixed movements: 30 steps, decimal amounts, 3 accounts incl. an InstaPay and its bank
  // ===========================================================================
  describe('random mixed-movement sequences (cash + InstaPay + its bank)', () => {
    beforeEach(seedBase);

    const ACCS = ['acc-cash', 'acc-insta', 'acc-bank'];
    const MONEY_ACTORS: Array<[U, Actor['role'], string | undefined]> = [[FIN, 'finance', ORG], [ADMIN, 'org_admin', ORG], [OWNER, 'super_admin', undefined], [MULTI_FIN, 'finance', ORG]];
    // the custody / transfer counters accept the profile company's role only (spec §11.4, known)
    const COUNTER_ACTORS = MONEY_ACTORS.filter(([u]) => u !== MULTI_FIN);
    const PAIRS: Array<[string, string]> = [['acc-cash', 'acc-insta'], ['acc-insta', 'acc-cash'], ['acc-cash', 'acc-bank'], ['acc-bank', 'acc-cash']];

    async function runSequence(seedNo: number, steps: number) {
      const r = rng(seedNo);
      const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
      const amt = (max = 400) => Math.round((0.01 + r() * max) * 100) / 100;
      const custodies: string[] = [];
      const log: string[] = [];
      const before: Record<string, number> = {};
      for (const a of ACCS) before[a] = toMoney((await read('paymentAccounts', a))!.currentBalance);
      let skipped = 0;
      for (let i = 0; i < steps; i++) {
        const op = pick(['adjust', 'adjust', 'transfer', 'disburse', 'income', 'custody', 'settle', 'replenish', 'return', 'visa']);
        const [u, role, org] = pick(op === 'transfer' || op === 'custody' || op === 'replenish' || op === 'visa' ? COUNTER_ACTORS : MONEY_ACTORS);
        const a = actor(u, role, org);
        const acc = pick(ACCS);
        const amount = amt();
        const desc = `#${i} ${op} by ${u.email} on ${acc} ${amount}`;
        log.push(desc);
        try {
          switch (op) {
            case 'adjust':
              await adjustAccountBalance(store(u), a, { accountId: acc, type: r() < 0.5 ? 'in' : 'out', amount, description: 'seq' }, key());
              break;
            case 'transfer': {
              const [from, to] = pick(PAIRS);
              await transferBetweenAccounts(store(u), a, { fromAccountId: from, toAccountId: to, amount, description: 'seq' }, key());
              break;
            }
            case 'disburse':
            case 'income': {
              const id = `rq-${seedNo}-${i}`;
              const service = pick(['srv-1', 'srv-legacy', 'srv-shared', '']);
              const provider = pick(['prov-1', 'prov-legacy', '']);
              await seed(f => setDoc(doc(f, 'requests', id), approvedRequest(id, op === 'income' ? amount : amount + 1 / 3 - 1 / 3,
                op === 'income' ? { status: 'pending', requestType: 'income' } : { ...(service ? { serviceCategoryId: service } : {}), ...(provider ? { providerId: provider } : {}) })));
              await disburseExpenseRequest(store(u), a, id, { paymentMethod: 'cash', referenceNumber: `R${i}`, accountId: acc }, key(), r() < 0.5 ? notifyAll : notifyOff);
              break;
            }
            case 'custody': {
              const res = await issueCustody(store(u), a, { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, amount, sourceAccountId: acc }, key());
              custodies.push(res.value.id);
              break;
            }
            case 'settle': {
              if (!custodies.length) break;
              const c = await read('custodies', pick(custodies));
              const rem = toMoney(c!.remainingAmount);
              if (rem <= 0) break;
              await settleCustodyItem(store(EMP), actor(EMP, 'employee', ORG), { custodyId: c!.id, amount: Math.min(rem, amt(rem)), description: 'inv' }, key());
              break;
            }
            case 'replenish': {
              if (!custodies.length) break;
              await replenishCustody(store(u), a, { custodyId: pick(custodies), amount, sourceAccountId: acc }, key());
              break;
            }
            case 'return': {
              if (!custodies.length) break;
              await returnCustodyRemainders(store(u), a, { custodyIds: [pick(custodies), pick(custodies)], targetAccountId: r() < 0.5 ? acc : undefined }, key());
              break;
            }
            case 'visa': {
              const v = await createVisaRequest(store(EMP), actor(EMP, 'employee', ORG), { orgId: ORG, requesterId: EMP.uid, requesterName: 'e', travelerName: 'T', passportNumber: 'P', totalAmount: amount + 10, currency: 'EGP', serviceProviderName: 'SP' } as any, key());
              await decideVisaRequest(store(u), a, v.value.id, { type: 'approve' }, key());
              await addVisaPayment(store(u), a, v.value.id, { amount, accountId: acc, method: 'cash' } as any, key());
              break;
            }
          }
        } catch (err: any) {
          if (isDomainError(err) && ['insufficient_funds', 'nothing_to_return'].includes(err.code)) {
            skipped++;
            continue;
          }
          throw new Error(`${desc} -> ${err?.code || ''} ${err?.message || err}\n${log.join('\n')}`);
        }
      }
      // books: each account moved exactly by its ledger lines
      for (const a of ACCS) {
        const lines = await readAll('accountTransactions', 'accountId', a);
        const delta = lines.reduce((s, l) => s + (l.type === 'in' ? l.amount : -l.amount), 0);
        const now = (await read('paymentAccounts', a))!;
        expect(Math.abs(toMoney(before[a] + delta) - toMoney(now.currentBalance))).toBeLessThan(0.011);
        expect(now.balance).toBe(now.currentBalance);
      }
      return { skipped, steps };
    }

    it('seed 101: 30 steps', async () => { await runSequence(101, 30); }, 240_000);
    it('seed 202: 30 steps', async () => { await runSequence(202, 30); }, 240_000);
    it('seed 303: 30 steps', async () => { await runSequence(303, 30); }, 240_000);
    it('seed 404: 30 steps', async () => { await runSequence(404, 30); }, 240_000);
  });

  // ===========================================================================
  // 2. Treasury flows on legacy data
  // ===========================================================================
  describe('treasury: transfers between parent-linked accounts, both edit forms, detach, bulk return', () => {
    beforeEach(seedBase);

    it('transfers: InstaPay→InstaPay of another bank, bank→other InstaPay, legacy wallet→InstaPay, InstaPay→legacy wallet (4 accounts each), by finance / org admin / owner', async () => {
      await transferBetweenAccounts(store(FIN), actor(FIN, 'finance', ORG), { fromAccountId: 'acc-insta', toAccountId: 'acc-insta2', amount: 100.1 }, key());
      await transferBetweenAccounts(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { fromAccountId: 'acc-bank', toAccountId: 'acc-insta2', amount: 200.02 }, key());
      await transferBetweenAccounts(store(OWNER), actor(OWNER, 'super_admin'), { fromAccountId: 'acc-wallet-old', toAccountId: 'acc-insta2', amount: 50.5 }, key());
      await transferBetweenAccounts(store(FIN), actor(FIN, 'finance', ORG), { fromAccountId: 'acc-insta2', toAccountId: 'acc-wallet-old', amount: 0.01 }, key());
      expect(toMoney((await read('paymentAccounts', 'acc-bank'))!.currentBalance)).toBe(toMoney(8000.1 - 100.1 - 200.02 - 50.5 + 0.01));
      expect(toMoney((await read('paymentAccounts', 'acc-bank2'))!.currentBalance)).toBe(toMoney(3000 + 100.1 + 200.02 + 50.5 - 0.01));
    });

    it('both account edit forms (hub + treasury) on an InstaPay, a legacy linked wallet and a legacy cash box; account number change and back', async () => {
      // hub form (OrganizationsManagement): whole payload incl. orgId
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-insta', { name: 'Insta X', type: 'instapay', accountIdentifier: 'x@instapay', bankName: '', currency: 'EGP', description: '', orgId: ORG } as any, key());
      await updatePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'acc-wallet-old', { name: 'Wallet', type: 'wallet', accountIdentifier: '010', bankName: '', currency: 'egp', description: 'd', orgId: ORG } as any, key());
      await updatePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'acc-cash', { name: 'Cash', type: 'cash', accountIdentifier: 'CASH-1', bankName: '', currency: 'EGP', description: '', orgId: ORG } as any, key());
      // treasury form: relink to bank2, unlink, relink to bank
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-insta', { name: 'Insta X', type: 'instapay', accountIdentifier: 'x@instapay', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2', currency: 'EGP' } as any, key());
      await updatePaymentAccount(store(FIN), actor(FIN, 'finance', ORG), 'acc-insta', { name: 'Insta X', type: 'instapay', accountIdentifier: 'x@instapay', parentAccountId: '', parentAccountName: '', currency: 'EGP' } as any, key());
      await updatePaymentAccount(store(ADMIN), actor(ADMIN, 'org_admin', ORG), 'acc-insta', { name: 'Insta X', type: 'instapay', accountIdentifier: 'ACC-INSTA', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank', currency: 'EGP' } as any, key());
      await adjustAccountBalance(store(FIN), actor(FIN, 'finance', ORG), { accountId: 'acc-insta', type: 'out', amount: 10.01, description: 'x' }, key());
      expect((await read('paymentAccounts', 'acc-bank'))!.lastLedgerId).toMatch(/-parent$/);
    });

    it('detach legacy wallets (with and without correction), then use the wallet standalone', async () => {
      await seed(f => setDoc(doc(f, 'paymentAccounts', 'acc-wallet-2'), account('acc-wallet-2', 80.5, { type: 'wallet', parentAccountId: 'acc-bank2', parentAccountName: 'acc-bank2', initialBalance: 0, totalIn: 100.5, totalOut: 20 })));
      await detachLegacyWallet(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { walletId: 'acc-wallet-old', bankCorrection: 400 - 0, expectedWalletTotals: { totalIn: 0, totalOut: 400 } }, key());
      await detachLegacyWallet(store(OWNER), actor(OWNER, 'super_admin'), { walletId: 'acc-wallet-2', bankCorrection: 0 }, key());
      await adjustAccountBalance(store(FIN), actor(FIN, 'finance', ORG), { accountId: 'acc-wallet-old', type: 'out', amount: 99.99, description: 'x' }, key());
      await transferBetweenAccounts(store(FIN), actor(FIN, 'finance', ORG), { fromAccountId: 'acc-wallet-2', toAccountId: 'acc-insta', amount: 80.5 }, key());
      expect((await read('paymentAccounts', 'acc-wallet-2'))!.currentBalance).toBe(0);
    });

    it('bulk custody return: legacy custodies (no currency / totals) from cash, InstaPay and legacy wallet, into their sources and into one InstaPay', async () => {
      await seed(async f => {
        const c = (id: string, src: string, rem: number, extra: Record<string, unknown> = {}) => setDoc(doc(f, 'custodies', id), {
          id, orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', employeeEmail: EMP.email, custodyNumber: `CUS-${id}`,
          totalAmount: 1000, remainingAmount: rem, status: 'active', sourceAccountId: src, sourceAccountName: src, ...extra });
        await c('k1', 'acc-cash', 10.1);
        await c('k2', 'acc-insta', 20.2, { currency: 'EGP' });
        await c('k3', 'acc-wallet-old', 1000 / 3);
        await c('k4', 'acc-cash', 0.3 + 0.6);
        await c('k5', 'acc-insta2', 5);
      });
      await returnCustodyRemainders(store(FIN), actor(FIN, 'finance', ORG), { custodyIds: ['k1', 'k2', 'k3'] }, key());
      await returnCustodyRemainders(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { custodyIds: ['k4', 'k5', 'k1'], targetAccountId: 'acc-insta' }, key());
      expect((await read('custodies', 'k5'))!.remainingAmount).toBe(0);
    });

    it('batch disbursement: 6 approved requests (legacy amounts, mixed services / providers) from the InstaPay by the multi-company finance member, notifications on', async () => {
      const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
      await seed(async f => {
        for (const [i, id] of ids.entries()) {
          const data: Record<string, unknown> = approvedRequest(id, i === 0 ? 1000 / 3 : 10.1 * (i + 1), {
            ...(i % 2 ? { serviceCategoryId: i % 3 ? 'srv-shared' : 'srv-legacy' } : {}),
            ...(i % 3 ? { providerId: i % 2 ? 'prov-legacy' : 'prov-1' } : {}),
          });
          if (i === 4) delete data.currency; // legacy request without a currency
          await setDoc(doc(f, 'requests', id), data);
        }
      });
      for (const id of ids) {
        await disburseExpenseRequest(store(MULTI_FIN), actor(MULTI_FIN, 'finance', ORG), id, { paymentMethod: 'instapay', referenceNumber: `B-${id}`, accountId: 'acc-insta', batchId: 'batch-1' }, key(), notifyAll);
      }
      for (const id of ids) expect((await read('requests', id))!.status).toBe('disbursed');
    });
  });

  // ===========================================================================
  // 3. Organizations: creation with default accounts and immediate use by the new company
  // ===========================================================================
  describe('organization creation with default accounts, then the new company works', () => {
    beforeEach(seedBase);
    const NADMIN: U = { uid: 'uidNileAdmin0000000000001', email: 'admin@nile.test' };
    const NFIN: U = { uid: 'uidNileFin000000000000001', email: 'fin@nile.test' };
    const NEMP: U = { uid: 'uidNileEmp000000000000001', email: 'emp@nile.test' };

    it('owner creates a company (and one without currency), provisions its admin / finance / employee; they use the default bank, cash, InstaPay and wallet', async () => {
      const o = actor(OWNER, 'super_admin');
      const res = await createOrganization(store(OWNER), o, { name: 'Nile Trading', code: 'NILE', currency: 'EGP', budget: 100000, description: '' } as any, key());
      const org = res.value.id;
      const delta = await createOrganization(store(OWNER), o, { name: 'Delta', code: 'DLT', budget: 0, description: '' } as any, key());
      expect((await read('paymentAccounts', `vault-cash-${delta.value.id}`))!.currency).toBe('EGP');
      await updateOrganization(store(OWNER), o, delta.value.id, { name: 'Delta 2', currency: 'USD', budget: 5 } as any, key());

      for (const [u, role] of [[NADMIN, 'org_admin'], [NFIN, 'finance'], [NEMP, 'employee']] as const) {
        await createMember(store(OWNER), o, { orgId: org, userId: u.uid, userName: u.email, userEmail: u.email, role, department: 'd', jobTitle: 'j', active: true } as any, key(), { writeUserProfile: true });
      }
      const na = actor(NADMIN, 'org_admin', org);
      const nf = actor(NFIN, 'finance', org);
      await adjustAccountBalance(store(NADMIN), na, { accountId: `vault-insta-${org}`, type: 'in', amount: 1500.75, description: 'x' }, key());
      await adjustAccountBalance(store(NFIN), nf, { accountId: `vault-cash-${org}`, type: 'in', amount: 300.3, description: 'x' }, key());
      await transferBetweenAccounts(store(NFIN), nf, { fromAccountId: `vault-bank-${org}`, toAccountId: `vault-wallet-${org}`, amount: 500.5 }, key());
      await transferBetweenAccounts(store(NFIN), nf, { fromAccountId: `vault-insta-${org}`, toAccountId: `vault-cash-${org}`, amount: 100 }, key());
      const c = await issueCustody(store(NFIN), nf, { orgId: org, employeeId: NEMP.uid, employeeName: 'e', employeeEmail: NEMP.email, amount: 99.99, sourceAccountId: `vault-wallet-${org}` }, key());
      await settleCustodyItem(store(NEMP), actor(NEMP, 'employee', org), { custodyId: c.value.id, amount: 33.33, description: 'x' }, key());
      // both edit forms on the default accounts
      await updatePaymentAccount(store(NADMIN), na, `vault-insta-${org}`, { name: 'Insta', type: 'instapay', accountIdentifier: 'nile2@instapay', bankName: '', currency: 'EGP', description: '', orgId: org } as any, key());
      await updatePaymentAccount(store(NFIN), nf, `vault-wallet-${org}`, { name: 'W', type: 'wallet', accountIdentifier: '01011111111', currency: 'EGP' } as any, key());
      await createPaymentAccount(store(NADMIN), na, { orgId: org, name: 'Insta 2', type: 'instapay', accountIdentifier: 'n2@ipa', parentAccountId: `vault-bank-${org}`, parentAccountName: 'b', initialBalance: 12.5, currentBalance: 12.5, totalIn: 0, totalOut: 0, currency: 'EGP', active: true } as any, key());
      // directory + a full request cycle in the new company
      const svc = await createEntity(store(NADMIN), na, 'service', (id: string) => ({ id, orgId: org, name: 'Rent', code: 'RNT', spentAmount: 0, orgIds: [org] } as any), () => 'x', key());
      const prov = await createEntity(store(NADMIN), na, 'provider', (id: string) => ({ id, orgId: org, name: 'Landlord', totalPaid: 0, active: true } as any), () => 'x', key());
      const req = await createExpenseRequest(store(NEMP), actor(NEMP, 'employee', org), { orgId: org, title: 'Rent', description: 'd', justification: 'j', amount: 250.25, currency: 'EGP', urgency: 'medium', requestType: 'expense', serviceCategoryId: svc.value.id, providerId: prov.value.id } as any, key(), { ...notifyAll, adminRecipients: ['mahmoud@tieapps.com', NADMIN.email] });
      await transitionExpenseRequest(store(NFIN), nf, req.value.id, { type: 'approve' }, key(), notifyAll);
      await disburseExpenseRequest(store(NFIN), nf, req.value.id, { paymentMethod: 'instapay', referenceNumber: 'N1', accountId: `vault-insta-${org}` }, key(), notifyAll);
      expect((await read('services', svc.value.id))!.spentAmount).toBe(250.25);
    });
  });

  // ===========================================================================
  // 4. Multi-company creates of 20 and 50 companies
  // ===========================================================================
  describe('multi-company creates (20 and 50 companies)', () => {
    const ORGS = Array.from({ length: 50 }, (_, i) => `org-m${String(i + 1).padStart(2, '0')}`);
    const MADM: U = { uid: 'uidMultiOrgAdmin000000001', email: 'madm@group.test' };
    const MDE: U = { uid: 'uidMultiOrgDataEnt0000001', email: 'mde@group.test' };

    beforeEach(async () => {
      await env.clearFirestore();
      await seed(async f => {
        for (const o of ORGS) {
          await setDoc(doc(f, 'organizations', o), { id: o, name: o, code: o.toUpperCase(), currency: 'EGP', budget: 0, notificationRecipients: [MADM.email] });
          await setDoc(doc(f, 'members', `${MADM.uid}_${o}`), { orgId: o, userId: MADM.uid, userEmail: MADM.email, role: 'org_admin', active: true, userName: 'madm' });
          await setDoc(doc(f, 'members', `${MDE.uid}_${o}`), { orgId: o, userId: MDE.uid, userEmail: MDE.email, role: 'data_entry', active: true, userName: 'mde' });
        }
        await setDoc(doc(f, 'users', MADM.uid), { orgId: ORGS[0], role: 'org_admin', active: true });
        await setDoc(doc(f, 'users', MDE.uid), { orgId: ORGS[0], role: 'data_entry', active: true });
      });
    });

    it('owner adds an org admin (recipient lists follow), a provider and a department to 50 companies', async () => {
      const o = actor(OWNER, 'super_admin');
      const m = await createMemberInOrgs(store(OWNER), o, { userId: '', userName: 'Boss', userEmail: 'boss@group.test', role: 'org_admin', department: 'd', jobTitle: 'j', active: true } as any, ORGS, key());
      expect(m.value.created).toHaveLength(50);
      expect((await read('organizations', ORGS[49]))!.notificationRecipients).toContain('boss@group.test');
      const p = await createEntityInOrgs(store(OWNER), o, 'provider', ORGS, (id: string, orgId: string) => ({ id, orgId, name: 'Etisalat', totalPaid: 0, active: true } as any), () => 'x', key());
      expect(p.value.created).toHaveLength(50);
      const d = await createEntityInOrgs(store(OWNER), o, 'department', ORGS, (id: string, orgId: string, nowIso: string) => ({ id, orgId, name: 'HR', createdAt: nowIso } as any), () => 'x', key());
      expect(d.value.created).toHaveLength(50);
    }, 240_000);

    it('[LG3-1] (50 companies) email invitations in every company are replaced by the proven login in one add: by the owner, and by the org admin of all 50', async () => {
      for (const [who, a, email, uid] of [
        [OWNER, actor(OWNER, 'super_admin'), 'joiner@group.test', 'uidJoinerLogin0000000001'],
        [MADM, actor(MADM, 'org_admin', ORGS[0]), 'joiner2@group.test', 'uidJoinerLogin0000000002'],
      ] as const) {
        const inv = await createMemberInOrgs(store(who), a, { userId: '', userName: 'J', userEmail: email, role: 'finance', department: 'd', jobTitle: 'j', active: true } as any, ORGS, key());
        expect(inv.value.created.every(m => m.userId.startsWith('pending-'))).toBe(true);
        const up = await createMemberInOrgs(store(who), a, { userId: uid, userName: 'J', userEmail: email, role: 'finance', department: 'd', jobTitle: 'j', active: true } as any, ORGS, key());
        expect(up.value.created.map(m => m.id)).toEqual(ORGS.map(o => `${uid}_${o}`));
        expect(await read('members', inv.value.created[49].id)).toBeUndefined();
        expect(await read('uniqueKeys', uniqueKeyDocId('member_email', ORGS[49], email))).toMatchObject({ entityId: `${uid}_${ORGS[49]}` });
      }
    }, 240_000);

    it('org admin of 50 companies adds an org admin and a finance member, a provider and a department to all of them', async () => {
      const a = actor(MADM, 'org_admin', ORGS[0]);
      const m = await createMemberInOrgs(store(MADM), a, { userId: '', userName: 'Co-admin', userEmail: 'co@group.test', role: 'org_admin', department: 'd', jobTitle: 'j', active: true } as any, ORGS, key());
      expect(m.value.created).toHaveLength(50);
      const f = await createMemberInOrgs(store(MADM), a, { userId: 'uidRealLoginOfFinance0001', userName: 'Fin', userEmail: 'fin@group.test', role: 'finance', department: 'd', jobTitle: 'j', active: true } as any, ORGS, key());
      expect(f.value.created).toHaveLength(50);
      const p = await createEntityInOrgs(store(MADM), a, 'provider', ORGS, (id: string, orgId: string) => ({ id, orgId, name: 'Orange', totalPaid: 0, active: true } as any), () => 'x', key());
      expect(p.value.created).toHaveLength(50);
      const d = await createEntityInOrgs(store(MADM), a, 'department', ORGS, (id: string, orgId: string, nowIso: string) => ({ id, orgId, name: 'IT', createdAt: nowIso } as any), () => 'x', key());
      expect(d.value.created).toHaveLength(50);
    }, 240_000);

    it('data entry of 20 companies adds a provider (with a non-ASCII name) and a department to all of them', async () => {
      const a = actor(MDE, 'data_entry', ORGS[0]);
      const twenty = ORGS.slice(0, 20);
      const p = await createEntityInOrgs(store(MDE), a, 'provider', twenty, (id: string, orgId: string) => ({ id, orgId, name: 'Société Générale', totalPaid: 0, active: true } as any), () => 'x', key());
      expect(p.value.created).toHaveLength(20);
      const d = await createEntityInOrgs(store(MDE), a, 'department', twenty, (id: string, orgId: string, nowIso: string) => ({ id, orgId, name: 'المشتريات', createdAt: nowIso } as any), () => 'x', key());
      expect(d.value.created).toHaveLength(20);
    }, 240_000);
  });

  // ===========================================================================
  // 5. Email verification: an unverified employee added to a 2nd company verifies, then gets access
  // ===========================================================================
  describe('email verification flow (second company by invitation)', () => {
    beforeEach(seedBase);
    const VER: U = { uid: 'uidVerifyEmp000000000001', email: 'ver@acme.test' };

    /** The app's addMemberToOrgs: a UID is re-used only when its profile proves the email (users/{uid}.verifiedEmail). */
    const ownerAddsByEmail = async (orgIds: string[], role: Actor['role']) => {
      const members = await readAll('members', 'userEmail', VER.email);
      const knownUid = await verifiedLoginUidOf(members as any, VER.email, async uid => {
        const snap = await getDoc(doc(db(OWNER), 'users', uid));
        return snap.exists() ? String(snap.data()?.verifiedEmail || '') : null;
      });
      return createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'), { userId: knownUid, userName: 'Ver', userEmail: VER.email, role, department: 'd', jobTitle: 'j', active: true } as any, orgIds, key());
    };

    it('control: an invited person with NO company yet verifies, self-links to the invitation and works there', async () => {
      await ownerAddsByEmail([OTHER_ORG], 'employee');
      const v = db(VER, true);
      await assertSucceeds(setDoc(doc(v, 'users', VER.uid), { verifiedEmail: VER.email }, { merge: true }));
      const mine = (await getDocs(query(collection(v, 'members'), where('userEmail', '==', VER.email)))).docs.map(d => ({ ...d.data(), id: d.id })) as any[];
      const profile = (await getDoc(doc(v, 'users', VER.uid))).data() as any;
      const state = profileMembershipState(profile, mine, { uid: VER.uid, email: VER.email, emailVerified: true });
      expect(state.relinkTo?.orgId).toBe(OTHER_ORG);
      const m = state.relinkTo!;
      await assertSucceeds(setDoc(doc(v, 'users', VER.uid), { id: VER.uid, email: VER.email, name: m.userName, role: m.role, orgId: m.orgId, memberId: m.id, active: true }, { merge: true }));
      await createExpenseRequest(store(VER), actor(VER, 'employee', OTHER_ORG), { orgId: OTHER_ORG, title: 't', description: 'd', justification: 'j', amount: 10, currency: 'EGP', urgency: 'low', requestType: 'expense' } as any, key(), notifyOff);
    });

    it('[LG3-1] an UNVERIFIED employee of ORG is added by email to OTHER as finance and verifies: the owner re-adds the now-proven login, which replaces the invitation and opens OTHER', async () => {
      // ORG's admin provisions the login (createCompanyUser → createMember with a real uid + profile); its email is unverified
      await createMember(store(ADMIN), actor(ADMIN, 'org_admin', ORG), { orgId: ORG, userId: VER.uid, userName: 'Ver', userEmail: VER.email, role: 'employee', department: 'd', jobTitle: 'j', active: true } as any, key(), { writeUserProfile: true });
      // the owner adds the same email to OTHER as finance: no proof yet → invitation pending-<email>_org-other
      const add = await ownerAddsByEmail([OTHER_ORG], 'finance');
      const invitationId = add.value.created[0].id;
      expect(add.value.created[0].userId).toMatch(/^pending-/);
      // the person verifies the address and records the proof (AppContext verifiedEmail effect)
      const v = db(VER, true);
      await assertSucceeds(setDoc(doc(v, 'users', VER.uid), { verifiedEmail: VER.email }, { merge: true }));
      // the profile stays in ORG (the company the person works in): no relink
      const mine = (await getDocs(query(collection(v, 'members'), where('userEmail', '==', VER.email)))).docs.map(d => ({ ...d.data(), id: d.id })) as any[];
      expect(mine.map(m => m.orgId).sort()).toEqual([ORG, OTHER_ORG].sort());
      const profile = (await getDoc(doc(v, 'users', VER.uid))).data() as any;
      expect(profileMembershipState(profile, mine, { uid: VER.uid, email: VER.email, emailVerified: true }).relinkTo).toBeNull();
      // the owner re-adds the now-proven login: the invitation is replaced by members/<uid>_org-other, same e-mail key
      const reAdd = await ownerAddsByEmail([OTHER_ORG], 'finance');
      expect(reAdd.value.created.map(m => m.id)).toEqual([`${VER.uid}_${OTHER_ORG}`]);
      expect(await read('members', invitationId)).toBeUndefined();
      expect(await read('uniqueKeys', uniqueKeyDocId('member_email', OTHER_ORG, VER.email))).toMatchObject({ entityId: `${VER.uid}_${OTHER_ORG}` });
      // ... and the person does its OTHER finance job
      await seed(f => setDoc(doc(f, 'requests', 'rq-o'), { ...approvedRequest('rq-o', 120.5), orgId: OTHER_ORG, requesterId: CAIRO_EMP.uid, requesterEmail: CAIRO_EMP.email }));
      await disburseExpenseRequest(store(VER), actor(VER, 'finance', OTHER_ORG), 'rq-o', { paymentMethod: 'cash', referenceNumber: 'V1', accountId: 'acc-oc' }, key(), notifyOff);
      expect((await read('requests', 'rq-o'))!.status).toBe('disbursed');
      // a further add is a plain duplicate
      await expect(ownerAddsByEmail([OTHER_ORG], 'finance')).rejects.toMatchObject({ code: 'duplicate' });
    });

    it('[LG3-1] an invitation is replaced only by its own proven login: an unproven add stays a duplicate, a raw replacement by an outsider is refused', async () => {
      await ownerAddsByEmail([OTHER_ORG], 'finance');
      const invitationId = `${(await readAll('members', 'userEmail', VER.email))[0].id}`;
      // no proof yet: the owner's re-add finds no login and the invitation holds the e-mail
      await expect(ownerAddsByEmail([OTHER_ORG], 'finance')).rejects.toMatchObject({ code: 'duplicate' });
      // the e-mail key cannot be re-pointed while its invitation still holds it, nor by another company
      const k = uniqueKeyDocId('member_email', OTHER_ORG, VER.email);
      const fake = { scope: 'member_email', orgId: OTHER_ORG, value: VER.email, entityCollection: 'members', entityId: `${EMP.uid}_${OTHER_ORG}` };
      const a = db(ADMIN);
      await expect(setDoc(doc(a, 'uniqueKeys', k), fake)).rejects.toBeTruthy();
      const c = db(CAIRO_ADMIN);
      await expect(setDoc(doc(c, 'uniqueKeys', k), fake)).rejects.toBeTruthy();
      expect(await read('members', invitationId)).toBeTruthy();
    });
  });

  // ===========================================================================
  // 6. Requests on services whose sharing changed, legacy restore of a shared service
  // ===========================================================================
  describe('shared services after a sharing change; legacy restore', () => {
    beforeEach(seedBase);

    it('[LG3-2] OTHER files a request on a service ORG shared with it; the owner later stops sharing; OTHER finance (and its org admin) still pay the approved request', async () => {
      const req = await createExpenseRequest(store(CAIRO_EMP), actor(CAIRO_EMP, 'employee', OTHER_ORG), { orgId: OTHER_ORG, title: 'Internet', description: 'd', justification: 'j', amount: 75.5, currency: 'EGP', urgency: 'low', requestType: 'expense', serviceCategoryId: 'srv-shared', serviceCategoryName: 'WE' } as any, key(), notifyOff);
      await transitionExpenseRequest(store(CAIRO_FIN), actor(CAIRO_FIN, 'finance', OTHER_ORG), req.value.id, { type: 'approve' }, key(), notifyOff);
      // the owner un-shares the service (ServicesManagement edit form, owner only)
      await updateEntity(store(OWNER), actor(OWNER, 'super_admin'), 'service', 'srv-shared', { orgIds: [ORG] } as any, () => ({ actionType: 'update', details: 'x' }), key());
      let err = '';
      try {
        await disburseExpenseRequest(store(CAIRO_FIN), actor(CAIRO_FIN, 'finance', OTHER_ORG), req.value.id, { paymentMethod: 'cash', referenceNumber: 'S2', accountId: 'acc-oc' }, key(), notifyOff);
      } catch (e: any) {
        err = `${e?.code || ''} ${e?.message || e}`;
      }
      let adminErr = '';
      try {
        await disburseExpenseRequest(store(CAIRO_ADMIN), actor(CAIRO_ADMIN, 'org_admin', OTHER_ORG), req.value.id, { paymentMethod: 'cash', referenceNumber: 'S2a', accountId: 'acc-oc' }, key(), notifyOff);
      } catch (e: any) {
        adminErr = `${e?.code || ''} ${e?.message || e}`;
      }
      expect({ finance: err, orgAdmin: adminErr }).toEqual({ finance: '', orgAdmin: '' });
      expect((await read('requests', req.value.id))!.status).toBe('disbursed');
    });

    it('[LG3-2] (owner) after the sharing ends, ORG\'s service budget is not charged for OTHER\'s request, whoever pays it', async () => {
      const req2 = await createExpenseRequest(store(CAIRO_EMP), actor(CAIRO_EMP, 'employee', OTHER_ORG), { orgId: OTHER_ORG, title: 'Internet 2', description: 'd', justification: 'j', amount: 10, currency: 'EGP', urgency: 'low', requestType: 'expense', serviceCategoryId: 'srv-shared' } as any, key(), notifyOff);
      await transitionExpenseRequest(store(CAIRO_FIN), actor(CAIRO_FIN, 'finance', OTHER_ORG), req2.value.id, { type: 'approve' }, key(), notifyOff);
      await updateEntity(store(OWNER), actor(OWNER, 'super_admin'), 'service', 'srv-shared', { orgIds: [ORG] } as any, () => ({ actionType: 'update', details: 'x' }), key());
      await disburseExpenseRequest(store(OWNER), actor(OWNER, 'super_admin'), req2.value.id, { paymentMethod: 'cash', referenceNumber: 'S2o', accountId: 'acc-oc' }, key(), notifyOff);
      expect((await read('requests', req2.value.id))!.status).toBe('disbursed');
      expect((await read('services', 'srv-shared'))!.spentAmount).toBe(0);
    });

    it('[LG3-3] org admin restores a legacy service that was shared with another company: the domain sends it to the owner ("needs_owner")', async () => {
      const def = LEGACY_STORES.find(s => s.collection === 'services')!;
      const rec: LegacyRecord = { store: def, id: 'srv-old-shared', data: { id: 'srv-old-shared', orgId: ORG, orgIds: [ORG, OTHER_ORG], name: 'Old shared', code: 'OSH', spentAmount: 0 }, title: 'Old shared' };
      const ctx = { actor: actor(ADMIN, 'org_admin', ORG), orgId: ORG };
      const res = await restoreRecord(store(ADMIN), ctx, rec, 'browser');
      expect([res.outcome, restoreBlock(ctx, rec)]).toContain('needs_owner');
    });

    it('legacy restores by the roles the domain allows: requester restores its pending request and visa, org admin a provider (no counter) and a department; owner a disbursed request', async () => {
      const st = (c: string) => LEGACY_STORES.find(s => s.collection === c)!;
      const rec = (c: string, id: string, data: Record<string, unknown>): LegacyRecord => ({ store: st(c), id, data: { id, ...data }, title: id });
      const emp = { actor: actor(EMP, 'employee', ORG), orgId: ORG };
      const adm = { actor: actor(ADMIN, 'org_admin', ORG), orgId: ORG };
      const own = { actor: actor(OWNER, 'super_admin'), orgId: ORG };
      expect((await restoreRecord(store(EMP), emp, rec('requests', 'req-old-1', { orgId: ORG, status: 'pending', amount: 10.5, requesterId: EMP.uid, requesterEmail: EMP.email, title: 'x' }), 'browser')).outcome).toBe('restored');
      expect((await restoreRecord(store(EMP), emp, rec('visaRequests', 'visa-old-1', { orgId: ORG, status: 'pending', totalAmount: 100, requesterId: EMP.uid, travelerName: 'T' }), 'file')).outcome).toBe('restored');
      expect((await restoreRecord(store(ADMIN), adm, rec('providers', 'prov-old-1', { orgId: ORG, name: 'Ancien Fournisseur' }), 'browser')).outcome).toBe('restored');
      expect((await restoreRecord(store(ADMIN), adm, rec('departments', 'dep-old-1', { orgId: ORG, name: 'Old Dept' }), 'browser')).outcome).toBe('restored');
      expect((await restoreRecord(store(OWNER), own, rec('requests', 'req-old-2', { orgId: ORG, status: 'disbursed', amount: 5, requesterId: EMP.uid, disbursement: { accountId: 'x' } }), 'browser')).outcome).toBe('restored');
    });
  });

  // ===========================================================================
  // 7. Everyday flows per role on legacy records
  // ===========================================================================
  describe('everyday flows per role (legacy records)', () => {
    beforeEach(seedBase);

    it('employee / data entry / finance / org admin file requests (one income); org admin clarifies, requester replies with the full form, finance approves and pays, org admin rejects one', async () => {
      const draft = (extra: Record<string, unknown> = {}) => ({ orgId: ORG, title: 'Laptop', description: 'd', justification: 'j', amount: 999.99, currency: 'EGP', urgency: 'high', requestType: 'expense', preferredPaymentMethod: 'instapay', paymentAccountDetails: 'x@instapay', attachments: [], serviceCategoryId: 'srv-legacy', providerId: 'prov-legacy', ...extra }) as any;
      const r1 = await createExpenseRequest(store(EMP, false), actor(EMP, 'employee', ORG, false), draft(), key(), notifyAll);
      const r2 = await createExpenseRequest(store(DE), actor(DE, 'data_entry', ORG), draft({ amount: 0.1 + 0.2 }), key(), notifyAll);
      const r3 = await createExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), draft({ requestType: 'income', amount: 500.05 }), key(), notifyAll);
      const r4 = await createExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), draft({ currency: 'egp' }), key(), notifyAll);
      await transitionExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), r1.value.id, { type: 'clarify', question: 'why?' }, key(), notifyAll);
      await updateExpenseRequest(store(EMP, false), actor(EMP, 'employee', ORG, false), r1.value.id, { ...draft({ title: 'Laptop 2' }) }, key());
      await transitionExpenseRequest(store(EMP, false), actor(EMP, 'employee', ORG, false), r1.value.id, { type: 'reply', replyText: 'because' }, key(), notifyAll);
      await transitionExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), r1.value.id, { type: 'approve', note: 'ok' }, key(), notifyAll);
      await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), r1.value.id, { paymentMethod: 'instapay', referenceNumber: 'E1', accountId: 'acc-insta' }, key(), notifyAll);
      await transitionExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), r2.value.id, { type: 'approve' }, key(), notifyAll);
      await disburseExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), r2.value.id, { paymentMethod: 'cash', referenceNumber: 'E2', accountId: 'acc-cash' }, key(), notifyAll);
      await disburseExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), r3.value.id, { paymentMethod: 'cash', referenceNumber: 'E3', accountId: 'acc-wallet-old' }, key(), notifyAll);
      await transitionExpenseRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), r4.value.id, { type: 'reject', reason: 'no' }, key(), notifyAll);
      expect((await read('services', 'srv-legacy'))!.spentAmount).toBe(toMoney(999.99 + 0.3));
    });

    it('visas: employee files (legacy-style payload), org admin approves, finance pays from the InstaPay and from the legacy wallet, edits the total', async () => {
      const v = await createVisaRequest(store(EMP), actor(EMP, 'employee', ORG), { orgId: ORG, requesterId: EMP.uid, requesterName: 'e', travelerName: 'T', passportNumber: 'P', totalAmount: 2000 / 3, currency: 'egp', serviceProviderName: 'SP' } as any, key());
      await decideVisaRequest(store(ADMIN), actor(ADMIN, 'org_admin', ORG), v.value.id, { type: 'approve' }, key());
      await addVisaPayment(store(FIN), actor(FIN, 'finance', ORG), v.value.id, { amount: 100.1, accountId: 'acc-insta', method: 'instapay' } as any, key());
      await addVisaPayment(store(FIN), actor(FIN, 'finance', ORG), v.value.id, { amount: 66.56, accountId: 'acc-wallet-old', method: 'wallet' } as any, key());
      await updateVisaRequest(store(FIN), actor(FIN, 'finance', ORG), v.value.id, { totalAmount: 700, notes: 'n' } as any);
      await seed(f => setDoc(doc(f, 'visaRequests', 'visa-legacy'), { id: 'visa-legacy', orgId: ORG, status: 'approved', totalAmount: 300, requesterId: EMP.uid, travelerName: 'L' }));
      await addVisaPayment(store(FIN), actor(FIN, 'finance', ORG), 'visa-legacy', { amount: 300, accountId: 'acc-cash', method: 'cash' } as any, key());
      expect((await read('visaRequests', 'visa-legacy'))!.status).toBe('paid');
    });

    it('members: org admin re-roles, suspends, re-activates and removes a member; owner removes one; directory edits / deactivations on legacy records', async () => {
      const adm = actor(ADMIN, 'org_admin', ORG);
      await updateMemberRecord(store(ADMIN), adm, `${EMP.uid}_${ORG}`, { role: 'finance', userName: 'Emp F', phone: '1' }, [EMP.uid], key());
      await updateMemberRecord(store(ADMIN), adm, `${EMP.uid}_${ORG}`, { active: false }, [EMP.uid], key());
      await updateMemberRecord(store(ADMIN), adm, `${EMP.uid}_${ORG}`, { active: true, role: 'employee' }, [EMP.uid], key());
      await removeMember(store(ADMIN), adm, `${DE.uid}_${ORG}`, [DE.uid], key());
      await removeMember(store(OWNER), actor(OWNER, 'super_admin'), `${CAIRO_EMP.uid}_${OTHER_ORG}`, [CAIRO_EMP.uid], key());
      await updateEntity(store(FIN), actor(FIN, 'finance', ORG), 'service', 'srv-legacy', { name: 'Legacy 2', code: 'LG2', orgIds: [ORG] } as any, () => ({ actionType: 'update', details: 'x' }), key());
      await updateEntity(store(FIN), actor(FIN, 'finance', ORG), 'provider', 'prov-legacy', { name: 'Old vendor', phone: '2' } as any, () => ({ actionType: 'update', details: 'x' }), key());
      await deleteEntity(store(ADMIN), adm, 'provider', 'prov-1', 'delete', key());
      await deleteEntity(store(ADMIN), adm, 'service', 'srv-legacy', 'delete', key());
      expect((await read('providers', 'prov-1'))!.active).toBe(false);
      expect(await read('services', 'srv-legacy')).toBeUndefined();
    });
  });

  // ===========================================================================
  // 8. Notifications (outbox dispatch, Trigger-Email docs, test email), own profile, attachments
  // ===========================================================================
  describe('outbox dispatch, own profile save, attachments', () => {
    beforeEach(seedBase);

    it('firestore_mail: the employee dispatches its own new_request event; the finance worker lists and dispatches an approval event; org admin sends a test email to itself', async () => {
      const mailSettings = { ...DEFAULT_EMAIL_SETTINGS, enabled: true, notifyOnNewRequest: true, notifyOnApproval: true, deliveryMethod: 'firestore_mail' } as any;
      await seed(f => setDoc(doc(f, 'system_settings', 'email_notifications'), { ...mailSettings, directApiKey: '' }));
      const { dispatchOutboxEvent, buildOutboxEvent } = await import('../src/domain/outbox');
      const { createNotificationTransport } = await import('../src/services/emailService');
      const r = await createExpenseRequest(store(EMP, false), actor(EMP, 'employee', ORG, false), { orgId: ORG, title: 'Chair', description: 'd', justification: 'j', amount: 45.5, currency: 'EGP', urgency: 'low', requestType: 'expense' } as any, key(), { settings: mailSettings, adminRecipients: [ADMIN.email, 'mahmoud@tieapps.com'] });
      expect(await dispatchOutboxEvent(store(EMP, false), r.outboxEventIds[0], createNotificationTransport(store(EMP, false)))).toBe('sent');
      const ap = await transitionExpenseRequest(store(FIN), actor(FIN, 'finance', ORG), r.value.id, { type: 'approve' }, key(), { settings: mailSettings });
      // the worker of another finance tab (org admin) lists due events of its company and dispatches
      const due = await getDocs(query(collection(db(ADMIN), 'outbox'), where('status', 'in', ['pending', 'failed', 'sending']), where('orgId', '==', ORG)));
      expect(due.docs.map(d => d.id)).toContain(ap.outboxEventIds[0]);
      expect(await dispatchOutboxEvent(store(ADMIN), ap.outboxEventIds[0], createNotificationTransport(store(ADMIN)))).toBe('sent');
      // test email (AppContext.sendTestEmail) by the org admin, to itself (a notification recipient)
      const ev = buildOutboxEvent({ eventId: `test_email__${key()}`, eventType: 'test_email' as any, entityType: 'system', entityId: 'test', orgId: ORG, recipients: [ADMIN.email], details: { request: approvedRequest('req-test', 2750) as any }, settings: mailSettings, actor: actor(ADMIN, 'org_admin', ORG, false), nowIso: new Date().toISOString(), force: true })!;
      await store(ADMIN, false).runTransaction(async tx => { tx.set('outbox', ev.id, ev); });
      expect(await dispatchOutboxEvent(store(ADMIN, false), ev.id, createNotificationTransport(store(ADMIN, false)))).toBe('sent');
    });

    it('own profile save (payout details) + membership name sync, by an employee with an UNVERIFIED email and by finance; the verified email proof write', async () => {
      const { syncOwnMembership } = await import('../src/domain/directory');
      await seed(f => setDoc(doc(f, 'members', `${EMP.uid}_${ORG}`), { orgId: ORG, userId: EMP.uid, userEmail: EMP.email, role: 'employee', active: true, userName: 'old', instapay: 'legacy@ipa' }));
      for (const [u, verified] of [[EMP, false], [FIN, true]] as const) {
        const d = db(u, verified);
        await assertSucceeds(setDoc(doc(d, 'users', u.uid), { uid: u.uid, instapay: 'me@instapay', iban: 'EG12', name: 'New Name', phone: '0100', updatedAt: 'x' }, { merge: true }));
        await syncOwnMembership(createFirestoreStore(d), actor(u, u === EMP ? 'employee' : 'finance', ORG, verified), `${u.uid}_${ORG}`, { userName: 'New Name', phone: '0100' });
      }
      await assertSucceeds(setDoc(doc(db(FIN, true), 'users', FIN.uid), { verifiedEmail: FIN.email }, { merge: true }));
      expect((await read('members', `${EMP.uid}_${ORG}`))!.instapay).toBeUndefined();
    });

    it('attachments: employee (unverified) uploads a 2-chunk PDF for its request, finance reads it, the uploader removes one, the org admin removes another; data entry uploads an image', async () => {
      const { writeAttachment, readAttachment, removeAttachment } = await import('../src/lib/attachmentsCore');
      const pdf = new Blob([new Uint8Array(700_000).fill(37)], { type: 'application/pdf' });
      const a1 = await writeAttachment(db(EMP, false), EMP.uid, pdf, { orgId: ORG, name: 'invoice.pdf' });
      const a2 = await writeAttachment(db(EMP, false), EMP.uid, pdf, { orgId: ORG, name: 'invoice2.pdf' });
      const img = await writeAttachment(db(DE), DE.uid, new Blob([new Uint8Array(1000).fill(1)], { type: 'image/png' }), { orgId: ORG, name: 'r.png' });
      expect((await readAttachment(db(FIN), a1.attachmentId)).bytes.length).toBe(700_000);
      await removeAttachment(db(EMP, false), EMP.uid, a1.attachmentId);
      await removeAttachment(db(ADMIN), ADMIN.uid, a2.attachmentId);
      expect(img.url).toMatch(/^fsattach:\/\//);
    });
  });
});

describe('round r4: identity lane ([R4-I1] org-admin profile writes bound to a membership, [R4-I2] self-addressed memberships, [R4-I3] corrected invitation address, [R4-I4] missing-document oracle)', () => {
  // Raw Firestore Web SDK with the attacker's own credentials; legitimate operations through the
  // real domain functions the way AppContext calls them. [R4-Ix] tests assert the fixed outcome.
  const ORG = 'org-acme';
  const OTHER_ORG = 'org-other';

  type U = { uid: string; email: string };
  const OWNER: U = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
  const ADMIN: U = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
  const ADMIN2: U = { uid: 'uidAdmin000000000000000002', email: 'admin2@acme.test' };
  const FIN: U = { uid: 'uidFinance00000000000000001', email: 'fin@acme.test' };
  const EMP: U = { uid: 'uidEmployee0000000000000001', email: 'emp@acme.test' };
  const EMP2: U = { uid: 'uidEmployee0000000000000002', email: 'emp2@acme.test' };
  const SUSP: U = { uid: 'uidSuspAdmin0000000000001', email: 'sadmin@acme.test' };
  const CAIRO_ADMIN: U = { uid: 'uidCairoAdmin000000000001', email: 'admin@other.test' };
  const CAIRO_EMP: U = { uid: 'uidCairoEmp00000000000001', email: 'emp@other.test' };
  const STRANGER: U = { uid: 'uidStranger00000000000001', email: 'stranger@evil.test' };
  const TYPO: U = { uid: 'uidTypoOwner0000000000001', email: 'mona.salem@acme-test.com' }; // owns the mistyped address
  const NEWHIRE: U = { uid: 'uidNewHire000000000000001', email: 'newhire@acme.test' };
  const MONA: U = { uid: 'uidMonaSalem0000000000001', email: 'mona.salem@acme.test' }; // the intended invitee

  const db = (u: U, verified = true, email = u.email): Firestore =>
    env.authenticatedContext(u.uid, { email, email_verified: verified }).firestore() as unknown as Firestore;
  const store = (u: U, verified = true) => createFirestoreStore(db(u, verified));
  const actor = (u: U, role: Actor['role'], orgId?: string): Actor => ({ id: u.uid, name: u.email, email: u.email, role, ...(orgId ? { orgId } : {}) });
  let n = 0;
  const key = () => `key-r4i${String(++n).padStart(7, '0')}`;
  const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));
  const read = async (c: string, id: string) => {
    let data: Record<string, any> | undefined;
    await env.withSecurityRulesDisabled(async ctx => {
      data = (await getDoc(doc(ctx.firestore(), c, id))).data();
    });
    return data;
  };
  const mid = (u: U, org = ORG) => `${u.uid}_${org}`;
  const inv = (email: string, org = ORG) => `${pendingUserIdForEmail(email)}_${org}`;
  const allows = async (p: Promise<unknown>) => p.then(() => true, () => false);

  // ---- AppContext.linkedProfileIds (verbatim shape) ----
  const linkedProfileIds = async (f: Firestore, mem: OrganizationMember | undefined): Promise<string[]> => {
    if (!mem) return [];
    const ids = new Set<string>();
    if (isRealUid(mem.userId)) {
      try {
        await getDoc(doc(f, 'users', mem.userId));
        ids.add(mem.userId);
      } catch {
        // not ours
      }
    }
    try {
      const snap = await getDocs(query(collection(f, 'users'), where('orgId', '==', mem.orgId), where('memberId', '==', mem.id)));
      snap.docs.forEach(d => ids.add(d.id));
    } catch {
      // skipped
    }
    return Array.from(ids);
  };
  const memberAs = async (f: Firestore, id: string) => ({ id, ...(await getDoc(doc(f, 'members', id))).data() } as OrganizationMember);
  // AppContext.updateMember
  const appUpdateMember = async (who: U, role: Actor['role'], memberId: string, updates: Partial<OrganizationMember>) => {
    const f = db(who);
    const mem = await memberAs(f, memberId);
    return updateMemberRecord(store(who), actor(who, role, ORG), memberId, updates, await linkedProfileIds(f, mem), key());
  };
  // AppContext.removeMember
  const appRemoveMember = async (who: U, role: Actor['role'], memberId: string) => {
    const f = db(who);
    const mem = await memberAs(f, memberId);
    const all = (await getDocs(query(collection(f, 'members'), where('orgId', '==', ORG)))).docs.map(d => ({ id: d.id, ...d.data() } as OrganizationMember));
    const email = normalizeEmail(mem.userEmail);
    const samePerson = email ? all.filter(m => m.id !== memberId && isRealUid(m.userId) && normalizeEmail(m.userEmail) === email) : [];
    const ids = new Set(await linkedProfileIds(f, mem));
    for (const other of samePerson) (await linkedProfileIds(f, other)).forEach(id => ids.add(id));
    return removeMember(store(who), actor(who, role, ORG), memberId, Array.from(ids), key());
  };
  // AppContext.linkOwnProfile (verbatim shape)
  const linkOwnProfile = (f: Firestore, user: U & { emailVerified: boolean }, m: OrganizationMember) =>
    setDoc(doc(f, 'users', user.uid), {
      id: user.uid,
      ...(user.emailVerified ? { email: normalizeEmail(user.email) } : {}),
      name: m.userName || 'موظف',
      role: m.role,
      orgId: m.orgId,
      memberId: m.id,
      department: m.department || '',
      phone: m.phone || '',
      active: true,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  // What the company's member list (the only people list the app shows) contains.
  const memberListUids = async (who: U) =>
    (await getDocs(query(collection(db(who), 'members'), where('orgId', '==', ORG)))).docs.map(d => String(d.data().userId));

  // What an account can do in ORG, observed through the rules.
  const powers = async (u: U) => ({
    readsTreasury: await allows(getDoc(doc(db(u), 'paymentAccounts', 'acc-cash'))),
    editsMembers: await allows(updateDoc(doc(db(u), 'members', mid(EMP2)), { jobTitle: `probe-${++n}` })),
  });


  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [ADMIN.email, ADMIN2.email] });
      await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [CAIRO_ADMIN.email] });
      for (const [u, role, org] of [
        [ADMIN, 'org_admin', ORG], [ADMIN2, 'org_admin', ORG], [FIN, 'finance', ORG], [EMP, 'employee', ORG], [EMP2, 'employee', ORG],
        [CAIRO_ADMIN, 'org_admin', OTHER_ORG], [CAIRO_EMP, 'employee', OTHER_ORG],
      ] as const) {
        await setDoc(doc(f, 'users', u.uid), { orgId: org, role, active: true, email: u.email, verifiedEmail: u.email, memberId: mid(u, org), name: u.email });
        await setDoc(doc(f, 'members', mid(u, org)), { orgId: org, userId: u.uid, userEmail: u.email, role, active: true, userName: u.email });
        await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('member_email', org, u.email)),
          { scope: 'member_email', orgId: org, value: normalizeKeyValue(u.email, 'member_email'), entityCollection: 'members', entityId: mid(u, org) });
      }
      await setDoc(doc(f, 'users', SUSP.uid), { orgId: ORG, role: 'org_admin', active: false, email: SUSP.email, memberId: mid(SUSP) });
      await setDoc(doc(f, 'members', mid(SUSP)), { orgId: ORG, userId: SUSP.uid, userEmail: SUSP.email, role: 'org_admin', active: false, userName: 'S' });
      await setDoc(doc(f, 'members', mid(OWNER)), { orgId: ORG, userId: OWNER.uid, userEmail: OWNER.email, role: 'org_admin', active: true, userName: 'Owner' });
      await setDoc(doc(f, 'paymentAccounts', 'acc-cash'), { orgId: ORG, name: 'cash', type: 'cash', currency: 'EGP', active: true, balance: 1000, currentBalance: 1000 });
      await setDoc(doc(f, 'paymentAccounts', 'acc-ob'), { orgId: OTHER_ORG, name: 'ob', type: 'bank', currency: 'EGP', active: true, balance: 9000, currentBalance: 9000 });
    });
  });

  // =============================================================================
  // FINDINGS
  // =============================================================================
  describe('round r4 identity: findings', () => {
    it('[R4-I1] an org admin cannot write a users/{uid} profile that no membership backs: no invisible org admin', async () => {
      const a = db(ADMIN);
      // STRANGER: any account the admin controls (fresh sign-up, no profile, no membership anywhere).
      await assertFails(setDoc(doc(a, 'users', STRANGER.uid), { orgId: ORG, role: 'org_admin', active: true, name: 'svc' }));
      await assertFails(setDoc(doc(a, 'users', STRANGER.uid), { orgId: ORG, role: 'employee', active: true }));
      // naming someone else's membership, or one of another role
      await assertFails(setDoc(doc(a, 'users', STRANGER.uid), { orgId: ORG, role: 'org_admin', memberId: mid(ADMIN), active: true }));
      await assertFails(setDoc(doc(a, 'users', STRANGER.uid), { orgId: ORG, role: 'org_admin', memberId: mid(EMP), active: true }));
      expect(await powers(STRANGER)).toEqual({ readsTreasury: false, editsMembers: false });
      // The visible way: a membership in the member list, the profile in the same transaction (createCompanyUser).
      await createMember(store(ADMIN), actor(ADMIN, 'org_admin', ORG), {
        orgId: ORG, userId: STRANGER.uid, userName: 'svc', userEmail: STRANGER.email, role: 'org_admin', department: '', jobTitle: '', active: true, phone: '',
      } as any, key(), { writeUserProfile: true });
      expect(await memberListUids(OWNER)).toContain(STRANGER.uid);
      expect(await powers(STRANGER)).toEqual({ readsTreasury: true, editsMembers: true });
      // ... whose record cannot then be deleted alone, leaving the profile (the invisible admin again)
      await assertFails(deleteDoc(doc(a, 'members', mid(STRANGER))));
      // the app's removal (record + profile detached in one transaction) passes, and takes everything
      await appRemoveMember(ADMIN, 'org_admin', mid(STRANGER));
      expect(await read('users', STRANGER.uid)).toMatchObject({ orgId: '', role: 'employee', memberId: null });
      expect(await powers(STRANGER)).toEqual({ readsTreasury: false, editsMembers: false });
    });

    it('[R4-I1] (variants) an org admin cannot promote, re-activate or re-point a profile against its membership; taking access away still works', async () => {
      const a = db(ADMIN);
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { role: 'org_admin' }));
      await assertFails(updateDoc(doc(a, 'users', SUSP.uid), { active: true }));
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { memberId: mid(EMP2) }));
      await assertFails(updateDoc(doc(a, 'users', EMP.uid), { memberId: mid(FIN), role: 'finance' }));
      await assertFails(setDoc(doc(a, 'users', EMP.uid), { orgId: ORG, role: 'org_admin', active: true, memberId: mid(EMP) }));
      expect(await powers(EMP)).toEqual({ readsTreasury: false, editsMembers: false }); // still an employee
      expect(await allows(getDoc(doc(db(SUSP), 'paymentAccounts', 'acc-cash')))).toBe(false);
      // edits that grant nothing new: name / payout details
      await assertSucceeds(updateDoc(doc(a, 'users', EMP.uid), { name: 'E', iban: 'EG1' }));
      // taking access away: a suspension, a detach (never planting another memberId)
      await assertSucceeds(updateDoc(doc(a, 'users', EMP2.uid), { active: false }));
      await assertFails(updateDoc(doc(a, 'users', FIN.uid), { orgId: '', role: 'employee', memberId: mid(ADMIN) }));
      await assertSucceeds(updateDoc(doc(a, 'users', EMP2.uid), { orgId: '', role: 'employee', memberId: null }));
      // the domain's role change and re-activation (membership + profile in one transaction) pass
      await appUpdateMember(ADMIN, 'org_admin', mid(EMP), { role: 'finance' });
      expect(await read('users', EMP.uid)).toMatchObject({ role: 'finance', memberId: mid(EMP) });
      await appUpdateMember(ADMIN, 'org_admin', mid(SUSP), { active: true });
      expect(await read('users', SUSP.uid)).toMatchObject({ active: true });
      expect(await allows(getDoc(doc(db(SUSP), 'paymentAccounts', 'acc-cash')))).toBe(true);
    });

    it('[R4-I1] (known, accepted) an invitee that self-linked keeps its profile when an admin raw-deletes the invitation (no rule can find that profile)', async () => {
      // A placeholder record names no UID, so the delete rule cannot check the profile linked to it;
      // the app's removal (AppContext.removeMember: profiles where memberId == id) detaches it.
      const pid = inv(NEWHIRE.email);
      await seed(f => setDoc(doc(f, 'members', pid), { orgId: ORG, userId: pendingUserIdForEmail(NEWHIRE.email), userEmail: NEWHIRE.email, role: 'employee', active: true, userName: 'N' }));
      await assertSucceeds(linkOwnProfile(db(NEWHIRE), { ...NEWHIRE, emailVerified: true }, await memberAs(db(NEWHIRE), pid)));
      await appRemoveMember(ADMIN, 'org_admin', pid);
      expect(await read('users', NEWHIRE.uid)).toMatchObject({ orgId: '', memberId: null });
      expect(await allows(getDoc(doc(db(NEWHIRE), 'paymentAccounts', 'acc-cash')))).toBe(false);
    });

    it('[R4-I2] an org admin cannot mint a membership addressed to itself (UID or verified email), nor re-address an invitation to itself', async () => {
      const a2 = db(ADMIN2);
      const pid = inv(ADMIN2.email);
      const self = { orgId: ORG, userId: pendingUserIdForEmail(ADMIN2.email), userEmail: ADMIN2.email, role: 'org_admin', active: true, userName: ADMIN2.email };
      await assertFails(setDoc(doc(a2, 'members', pid), self));
      await assertFails(setDoc(doc(a2, 'members', `pending-x_${ORG}`), { ...self, userId: 'pending-x', userEmail: 'Admin2@Acme.test' }));
      // nor the platform owner's address
      await assertFails(setDoc(doc(a2, 'members', `pending-o_${ORG}`), { ...self, userId: 'pending-o', userEmail: OWNER.email }));
      // re-address someone else's invitation to itself (old key released in the same commit)
      const nid = inv(NEWHIRE.email);
      await seed(async f => {
        await setDoc(doc(f, 'members', nid), { orgId: ORG, userId: pendingUserIdForEmail(NEWHIRE.email), userEmail: NEWHIRE.email, role: 'org_admin', active: true, userName: 'N' });
        await setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('member_email', ORG, NEWHIRE.email)),
          { scope: 'member_email', orgId: ORG, value: normalizeKeyValue(NEWHIRE.email, 'member_email'), entityCollection: 'members', entityId: nid });
      });
      const b = writeBatch(a2);
      b.update(doc(a2, 'members', nid), { userEmail: ADMIN2.email });
      b.delete(doc(a2, 'uniqueKeys', uniqueKeyDocId('member_email', ORG, NEWHIRE.email)));
      await assertFails(b.commit());
      // ... while the same re-address to another person passes (control)
      const c = writeBatch(a2);
      c.update(doc(a2, 'members', nid), { userEmail: 'someone@acme.test' });
      c.delete(doc(a2, 'uniqueKeys', uniqueKeyDocId('member_email', ORG, NEWHIRE.email)));
      await assertSucceeds(c.commit());
      // the platform owner may add any record
      await assertSucceeds(setDoc(doc(db(OWNER), 'members', pid), self));
    });

    it('[R4-I2] (removal / suspension) an org admin removed by the owner, or suspended by another admin, keeps nothing', async () => {
      await appUpdateMember(ADMIN, 'org_admin', mid(ADMIN2), { active: false });
      expect((await read('users', ADMIN2.uid))).toMatchObject({ active: false });
      expect(await powers(ADMIN2)).toEqual({ readsTreasury: false, editsMembers: false });
      await appUpdateMember(ADMIN, 'org_admin', mid(ADMIN2), { active: true });
      expect(await powers(ADMIN2)).toEqual({ readsTreasury: true, editsMembers: true });
      await appRemoveMember(OWNER, 'super_admin', mid(ADMIN2));
      expect((await read('users', ADMIN2.uid))).toMatchObject({ orgId: '', role: 'employee', memberId: null });
      expect(await powers(ADMIN2)).toEqual({ readsTreasury: false, editsMembers: false });
    });

    it('[R4-I3] correcting a mistyped invitation email detaches whoever linked under the wrong address; the invitation waits for the corrected one', async () => {
      // ADMIN invites the new finance manager, mistyping the address (a real address someone else owns).
      const r = await createMember(store(ADMIN), actor(ADMIN, 'org_admin', ORG), {
        orgId: ORG, userId: '', userName: 'Mona Salem', userEmail: TYPO.email, role: 'finance', department: 'F', jobTitle: 'FM', active: true, phone: '',
      } as any, key());
      const pid = r.value.id;
      expect(pid).toBe(inv(TYPO.email));
      // The owner of the mistyped address signs in (verified) and the app links it (forceRefreshUserState → linkOwnProfile).
      await assertSucceeds(linkOwnProfile(db(TYPO), { ...TYPO, emailVerified: true }, await memberAs(db(TYPO), pid)));
      expect(await allows(getDoc(doc(db(TYPO), 'paymentAccounts', 'acc-cash')))).toBe(true);
      // ADMIN notices and corrects the address through the app.
      await appUpdateMember(ADMIN, 'org_admin', pid, { userEmail: MONA.email });
      expect(await read('members', pid)).toMatchObject({ userEmail: MONA.email, userId: pendingUserIdForEmail(TYPO.email), role: 'finance', active: true });
      expect(await read('users', TYPO.uid)).toMatchObject({ orgId: '', role: 'employee', memberId: null });
      expect(await allows(getDoc(doc(db(TYPO), 'paymentAccounts', 'acc-cash')))).toBe(false);
      await assertFails(linkOwnProfile(db(TYPO), { ...TYPO, emailVerified: true }, { ...(await read('members', pid)), id: pid } as OrganizationMember));
      // the intended person links on its first (verified) sign-in
      await assertSucceeds(linkOwnProfile(db(MONA), { ...MONA, emailVerified: true }, await memberAs(db(MONA), pid)));
      expect(await allows(getDoc(doc(db(MONA), 'paymentAccounts', 'acc-cash')))).toBe(true);
    });

    it('[R4-I3] (raw) a placeholder is never re-pointed in the write that changes its address', async () => {
      const pid = inv(NEWHIRE.email);
      await seed(async f => {
        await setDoc(doc(f, 'members', pid), { orgId: ORG, userId: pendingUserIdForEmail(NEWHIRE.email), userEmail: NEWHIRE.email, role: 'finance', active: true, userName: 'N' });
        await setDoc(doc(f, 'users', NEWHIRE.uid), { orgId: ORG, role: 'finance', memberId: pid, active: true, verifiedEmail: NEWHIRE.email });
      });
      const a = db(ADMIN);
      await assertFails(updateDoc(doc(a, 'members', pid), { userId: NEWHIRE.uid, userEmail: 'other@acme.test' }));
      await assertSucceeds(updateDoc(doc(a, 'members', pid), { userId: NEWHIRE.uid }));
    });

    it('[R4-I4] members / organizations get: a missing document is refused wherever an existing one would be (no invitation / company oracle)', async () => {
      await seed(f => setDoc(doc(f, 'members', inv(NEWHIRE.email)), {
        orgId: ORG, userId: pendingUserIdForEmail(NEWHIRE.email), userEmail: NEWHIRE.email, role: 'finance', active: true, userName: 'New',
      }));
      const s = db(STRANGER, false); // an unverified sign-up, no company
      const probe = async (f: Firestore, id: string) => allows(getDoc(doc(f, 'members', id)));
      // the same answer for an existing and a missing document
      expect(await probe(s, inv(NEWHIRE.email))).toBe(false);
      expect(await probe(s, inv('nobody@acme.test'))).toBe(false);
      expect(await probe(s, inv(NEWHIRE.email, OTHER_ORG))).toBe(false);
      expect(await probe(s, mid(CAIRO_EMP, OTHER_ORG))).toBe(false);
      expect(await probe(s, mid(CAIRO_EMP, ORG))).toBe(false);
      expect(await allows(getDoc(doc(s, 'organizations', 'org-acme')))).toBe(false);
      expect(await allows(getDoc(doc(s, 'organizations', 'org-nosuch')))).toBe(false);
      // a member of another company learns nothing about ORG either
      expect(await probe(db(CAIRO_ADMIN), inv('nobody@acme.test'))).toBe(false);
      expect(await allows(getDoc(doc(db(CAIRO_ADMIN), 'organizations', 'org-nosuch')))).toBe(false);
      // legitimate reads of a missing document: one's own UID id, a member of the id's company, the owner
      expect(await probe(s, mid(STRANGER, ORG))).toBe(true);
      expect(await probe(db(ADMIN), inv('nobody@acme.test'))).toBe(true);
      expect(await probe(db(EMP), mid(STRANGER, ORG))).toBe(true);
      expect(await probe(db(OWNER), inv('nobody@other.test', OTHER_ORG))).toBe(true);
      expect(await allows(getDoc(doc(db(OWNER), 'organizations', 'org-nosuch')))).toBe(true);
      // the domain's idempotent creates (tx.get of the missing id) keep working
      const r = await createMember(store(ADMIN), actor(ADMIN, 'org_admin', ORG), {
        orgId: ORG, userId: '', userName: 'Nobody', userEmail: 'nobody@acme.test', role: 'employee', department: '', jobTitle: '', active: true, phone: '',
      } as any, key());
      expect(r.value.id).toBe(inv('nobody@acme.test'));
    });
  });

  // =============================================================================
  // COVERAGE: attacks that are refused
  // =============================================================================
  describe('round r4 identity: refused', () => {
    it('memberId freeze: change, clear (merge / deleteField / null) while keeping the company, on update and create', async () => {
      const e = db(EMP);
      await assertFails(setDoc(doc(e, 'users', EMP.uid), { memberId: mid(EMP2) }, { merge: true }));
      await assertFails(setDoc(doc(e, 'users', EMP.uid), { memberId: deleteField() }, { merge: true }));
      await assertFails(updateDoc(doc(e, 'users', EMP.uid), { memberId: null }));
      await assertFails(updateDoc(doc(e, 'users', EMP.uid), { memberId: 'x' }));
      // full overwrite without memberId (keeps company / role)
      await assertFails(setDoc(doc(e, 'users', EMP.uid), { orgId: ORG, role: 'employee', active: true, email: EMP.email }));
      // create with someone else's membership
      await assertFails(setDoc(doc(db(STRANGER), 'users', STRANGER.uid), { orgId: ORG, role: 'org_admin', memberId: mid(ADMIN), active: true }));
      await assertFails(setDoc(doc(db(STRANGER), 'users', STRANGER.uid), { orgId: ORG, role: 'employee', memberId: mid(EMP), active: true }));
      // profile without company may not carry a memberId of someone else
      await assertFails(setDoc(doc(db(STRANGER), 'users', STRANGER.uid), { orgId: '', role: 'employee', memberId: mid(ADMIN) }));
      await assertSucceeds(setDoc(doc(db(STRANGER), 'users', STRANGER.uid), { orgId: '', role: 'employee', name: 's' }));
    });

    it('clear then re-set: detaching works, re-linking only to a membership addressed to the caller', async () => {
      const e = db(EMP);
      await assertSucceeds(setDoc(doc(e, 'users', EMP.uid), { orgId: '', role: 'employee', memberId: null }, { merge: true }));
      await assertFails(setDoc(doc(e, 'users', EMP.uid), { orgId: ORG, role: 'org_admin', memberId: mid(ADMIN) }, { merge: true }));
      await assertFails(setDoc(doc(e, 'users', EMP.uid), { orgId: ORG, role: 'finance', memberId: mid(FIN) }, { merge: true }));
      await assertFails(setDoc(doc(e, 'users', EMP.uid), { orgId: ORG, role: 'org_admin', memberId: mid(EMP) }, { merge: true }));
      await assertSucceeds(setDoc(doc(e, 'users', EMP.uid), { orgId: ORG, role: 'employee', memberId: mid(EMP) }, { merge: true }));
      // detach keeping a stale memberId of someone else: memberId must be kept or cleared, never changed
      await assertFails(setDoc(doc(e, 'users', EMP.uid), { orgId: '', role: 'employee', memberId: mid(ADMIN) }, { merge: true }));
    });

    it('grantsMembership: unverified token, case variants, placeholder ids, suspended / other-company records', async () => {
      const pid = inv(NEWHIRE.email);
      await seed(f => setDoc(doc(f, 'members', pid), { orgId: ORG, userId: pendingUserIdForEmail(NEWHIRE.email), userEmail: NEWHIRE.email, role: 'org_admin', active: true, userName: 'N' }));
      const link = (f: Firestore, uid: string, memberId: string, role = 'org_admin', orgId = ORG) =>
        setDoc(doc(f, 'users', uid), { orgId, role, memberId, active: true }, { merge: true });
      // unverified sign-up of the invited address
      await assertFails(link(db(STRANGER, false, NEWHIRE.email), STRANGER.uid, pid));
      // verified, but another address that differs only by case / dots
      await assertFails(link(db(STRANGER, true, 'NewHire@acme.test.'), STRANGER.uid, pid));
      await assertFails(link(db(STRANGER, true, 'new.hire@acme.test'), STRANGER.uid, pid));
      // placeholder / odd ids
      for (const id of ['', '..', '.', `${pid}/x`, 'pending-', `usr-x_${ORG}`]) await assertFails(link(db(NEWHIRE), NEWHIRE.uid, id));
      // wrong role / company for the right record
      await assertFails(link(db(NEWHIRE), NEWHIRE.uid, pid, 'finance'));
      await assertFails(link(db(NEWHIRE), NEWHIRE.uid, pid, 'org_admin', OTHER_ORG));
      // the invitee itself (verified, upper-case token): ok
      await assertSucceeds(link(db(NEWHIRE, true, 'NEWHIRE@ACME.TEST'), NEWHIRE.uid, pid));
      // suspended record
      await seed(async f => {
        await updateDoc(doc(f, 'members', pid), { active: false });
        await setDoc(doc(f, 'users', NEWHIRE.uid), { orgId: '', role: 'employee', memberId: null, active: true });
      });
      await assertFails(link(db(NEWHIRE), NEWHIRE.uid, pid));
    });

    it('removal / suspension: a removed or suspended member cannot regain access with any self-write', async () => {
      await appRemoveMember(ADMIN, 'org_admin', mid(FIN));
      const f = db(FIN);
      expect((await read('users', FIN.uid))).toMatchObject({ orgId: '', role: 'employee' });
      for (const w of [
        { orgId: ORG, role: 'finance', memberId: mid(FIN), active: true },
        { orgId: ORG, role: 'finance' },
        { orgId: ORG, role: 'employee', memberId: mid(EMP) },
        { orgId: ORG, role: 'finance', memberId: mid(FIN, OTHER_ORG) },
      ]) await assertFails(setDoc(doc(f, 'users', FIN.uid), w, { merge: true }));
      expect(await powers(FIN)).toEqual({ readsTreasury: false, editsMembers: false });
      // suspended admin (record and profile active:false)
      const s = db(SUSP);
      await assertFails(updateDoc(doc(s, 'users', SUSP.uid), { active: true }));
      await assertFails(setDoc(doc(s, 'users', SUSP.uid), { orgId: ORG, role: 'org_admin', memberId: mid(SUSP), active: true }, { merge: true }));
      await assertFails(updateDoc(doc(s, 'members', mid(SUSP)), { active: true }));
      await assertFails(setDoc(doc(s, 'members', `${pendingUserIdForEmail(SUSP.email)}_${ORG}`), { orgId: ORG, userId: pendingUserIdForEmail(SUSP.email), userEmail: SUSP.email, role: 'org_admin', active: true }));
      // detach + re-attach with active:true and no company grants nothing
      await assertSucceeds(setDoc(doc(s, 'users', SUSP.uid), { orgId: '', role: 'employee', memberId: null, active: true }, { merge: true }));
      expect(await allows(getDoc(doc(s, 'paymentAccounts', 'acc-cash')))).toBe(false);
      // self-service edit of own suspended membership can't touch grant fields
      await assertFails(updateDoc(doc(s, 'members', mid(SUSP)), { role: 'org_admin', active: true }));
    });

    it('org admin\'s own profile: no role / company / status / memberId changes; name and payout are fine', async () => {
      const a = db(ADMIN);
      await assertSucceeds(updateDoc(doc(a, 'users', ADMIN.uid), { name: 'A', iban: 'EG00' }));
      await assertFails(updateDoc(doc(a, 'users', ADMIN.uid), { memberId: mid(EMP2) }));
      await assertFails(updateDoc(doc(a, 'users', ADMIN.uid), { role: 'finance' }));
      await assertFails(updateDoc(doc(a, 'users', ADMIN.uid), { verifiedEmail: 'x@acme.test' }));
      await assertFails(updateDoc(doc(a, 'users', ADMIN.uid), { email: 'x@acme.test' }));
      // own membership's grant fields
      await assertFails(updateDoc(doc(a, 'members', mid(ADMIN)), { role: 'finance' }));
      await assertFails(deleteDoc(doc(a, 'members', mid(ADMIN))));
    });

    it('another company\'s org admin: members create / update / delete, profiles, keys in ORG are refused', async () => {
      const c = db(CAIRO_ADMIN);
      await assertFails(setDoc(doc(c, 'members', `${CAIRO_ADMIN.uid}_${ORG}`), { orgId: ORG, userId: CAIRO_ADMIN.uid, userEmail: CAIRO_ADMIN.email, role: 'org_admin', active: true }));
      await assertFails(setDoc(doc(c, 'members', `${CAIRO_ADMIN.uid}_${ORG}`), { orgId: OTHER_ORG, userId: CAIRO_ADMIN.uid, userEmail: CAIRO_ADMIN.email, role: 'org_admin', active: true }));
      await assertFails(updateDoc(doc(c, 'members', mid(EMP)), { role: 'org_admin' }));
      await assertFails(updateDoc(doc(c, 'members', mid(EMP)), { orgId: OTHER_ORG }));
      await assertFails(deleteDoc(doc(c, 'members', mid(EMP))));
      await assertFails(updateDoc(doc(c, 'users', EMP.uid), { role: 'org_admin' }));
      await assertFails(updateDoc(doc(c, 'users', EMP.uid), { orgId: OTHER_ORG }));
      await assertFails(updateDoc(doc(c, 'users', EMP.uid), { orgId: '', role: 'employee' }));
      await assertFails(setDoc(doc(c, 'users', NEWHIRE.uid), { orgId: ORG, role: 'org_admin', active: true }));
      // profile in OTHER (no membership behind it: refused since R4-I1; planted), then moved
      await assertFails(setDoc(doc(c, 'users', NEWHIRE.uid), { orgId: OTHER_ORG, role: 'employee', active: true }));
      await seed(f => setDoc(doc(f, 'users', NEWHIRE.uid), { orgId: OTHER_ORG, role: 'employee', active: true }));
      await assertFails(updateDoc(doc(c, 'users', NEWHIRE.uid), { orgId: ORG }));
      await assertFails(updateDoc(doc(c, 'users', NEWHIRE.uid), { verifiedEmail: NEWHIRE.email }));
      // key of ORG re-pointed to an OTHER record holding the same value
      await seed(f => setDoc(doc(f, 'members', `${pendingUserIdForEmail(EMP.email)}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: pendingUserIdForEmail(EMP.email), userEmail: EMP.email, role: 'employee', active: true }));
      await assertFails(setDoc(doc(c, 'uniqueKeys', uniqueKeyDocId('member_email', ORG, EMP.email)),
        { scope: 'member_email', orgId: ORG, value: normalizeKeyValue(EMP.email, 'member_email'), entityCollection: 'members', entityId: `${pendingUserIdForEmail(EMP.email)}_${OTHER_ORG}` }));
      await assertFails(setDoc(doc(c, 'uniqueKeys', uniqueKeyDocId('member_email', ORG, EMP.email)),
        { scope: 'member_email', orgId: OTHER_ORG, value: normalizeKeyValue(EMP.email, 'member_email'), entityCollection: 'members', entityId: `${pendingUserIdForEmail(EMP.email)}_${OTHER_ORG}` }));
    });

    it('invitation takeover: an employee, or another company, cannot replace an invitation or re-point its key; a live key is never moved', async () => {
      const pid = inv(NEWHIRE.email);
      const kid = uniqueKeyDocId('member_email', ORG, NEWHIRE.email);
      await seed(async f => {
        await setDoc(doc(f, 'members', pid), { orgId: ORG, userId: pendingUserIdForEmail(NEWHIRE.email), userEmail: NEWHIRE.email, role: 'finance', active: true, userName: 'N' });
        await setDoc(doc(f, 'uniqueKeys', kid), { scope: 'member_email', orgId: ORG, value: normalizeKeyValue(NEWHIRE.email, 'member_email'), entityCollection: 'members', entityId: pid });
      });
      const keyFor = (entityId: string) => ({ scope: 'member_email', orgId: ORG, value: normalizeKeyValue(NEWHIRE.email, 'member_email'), entityCollection: 'members', entityId });
      // employee: own record does not hold the value
      await assertFails(setDoc(doc(db(EMP), 'uniqueKeys', kid), keyFor(mid(EMP))));
      // employee: creates the replacing membership itself
      const ed = db(EMP);
      const e = writeBatch(ed);
      e.set(doc(ed, 'members', mid(EMP)), { orgId: ORG, userId: EMP.uid, userEmail: NEWHIRE.email, role: 'finance', active: true }, { merge: true });
      e.set(doc(ed, 'uniqueKeys', kid), keyFor(mid(EMP)));
      await assertFails(e.commit());
      // a second live record holding the value (admin-written duplicate): the key stays on the live one
      await seed(f => setDoc(doc(f, 'members', `${STRANGER.uid}_${ORG}`), { orgId: ORG, userId: STRANGER.uid, userEmail: NEWHIRE.email, role: 'finance', active: true }));
      await assertFails(setDoc(doc(db(EMP), 'uniqueKeys', kid), keyFor(`${STRANGER.uid}_${ORG}`)));
      await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', kid), keyFor(`${STRANGER.uid}_${ORG}`)));
      // the invitee cannot delete its invitation / re-point itself
      await assertFails(deleteDoc(doc(db(NEWHIRE), 'members', pid)));
      await assertFails(updateDoc(doc(db(NEWHIRE), 'members', pid), { userId: NEWHIRE.uid }));
      // an outsider cannot replace in a transaction either
      const cd = db(CAIRO_ADMIN);
      await assertFails(runTransaction(cd, async tx => {
        tx.delete(doc(cd, 'members', pid));
        tx.set(doc(cd, 'uniqueKeys', kid), keyFor(mid(CAIRO_ADMIN, OTHER_ORG)));
      }));
    });

    it('keyLeftWithRecord: a raw email change must release the old key; the domain change passes', async () => {
      await assertFails(updateDoc(doc(db(ADMIN), 'members', mid(EMP)), { userEmail: 'emp.new@acme.test' }));
      await appUpdateMember(ADMIN, 'org_admin', mid(EMP), { userEmail: 'emp.new@acme.test' });
      expect((await read('members', mid(EMP)))?.userEmail).toBe('emp.new@acme.test');
      expect(await read('uniqueKeys', uniqueKeyDocId('member_email', ORG, EMP.email))).toBeUndefined();
      expect((await read('uniqueKeys', uniqueKeyDocId('member_email', ORG, 'emp.new@acme.test')))?.entityId).toBe(mid(EMP));
    });

    it('super_admins: no write by org admins, unverified owner address, or self records', async () => {
      await assertFails(setDoc(doc(db(ADMIN), 'super_admins', ADMIN.uid), { email: ADMIN.email }));
      await assertFails(setDoc(doc(db(ADMIN), 'super_admins', ADMIN.email), { email: ADMIN.email }));
      await assertFails(setDoc(doc(db(STRANGER, false, OWNER.email), 'super_admins', STRANGER.uid), { email: OWNER.email }));
      await assertFails(setDoc(doc(db(STRANGER, true, 'MAHMOUD@TIEAPPS.COM '), 'super_admins', STRANGER.uid), { email: OWNER.email }));
      await assertFails(getDocs(collection(db(ADMIN), 'super_admins')));
      await assertSucceeds(setDoc(doc(db(OWNER), 'super_admins', 'x@acme.test'), { email: 'x@acme.test' }));
      await assertFails(deleteDoc(doc(db(ADMIN), 'super_admins', 'x@acme.test')));
    });

    it('members create / update by an org admin: no super_admin role, id must be <userId>_<orgId>, owner\'s record protected', async () => {
      const a = db(ADMIN);
      await assertFails(setDoc(doc(a, 'members', `${STRANGER.uid}_${ORG}`), { orgId: ORG, userId: STRANGER.uid, role: 'super_admin', active: true }));
      await assertFails(setDoc(doc(a, 'members', `${STRANGER.uid}_${OTHER_ORG}`), { orgId: ORG, userId: STRANGER.uid, role: 'org_admin', active: true }));
      await assertFails(setDoc(doc(a, 'members', `x_${ORG}`), { orgId: ORG, userId: STRANGER.uid, role: 'org_admin', active: true }));
      await assertFails(updateDoc(doc(a, 'members', mid(OWNER)), { role: 'employee' }));
      await assertFails(updateDoc(doc(a, 'members', mid(OWNER)), { active: false }));
      await assertFails(deleteDoc(doc(a, 'members', mid(OWNER))));
      await assertFails(updateDoc(doc(a, 'members', mid(EMP)), { userId: STRANGER.uid }));   // real login never re-pointed
      await assertFails(updateDoc(doc(a, 'members', mid(EMP)), { role: 'super_admin' }));
    });
  });
});

describe('round r4: login lane ([LOGIN-1..6] nobody real is locked out: legacy placeholders, unverified invitees, multi-company members, company moves)', () => {
  // Every flow runs through the REAL domain code and the AppContext self-write effects, copied in the
  // exact shape the app sends them (appMemberships / appSignIn / knownUidForEmail / appAddMemberToOrgs).
  // [LOGIN-n] tests assert the correct outcome (they failed before the round-4 fix).
  const ORG = 'org-acme';
  const OTHER = 'org-other';
  const THIRD = 'org-third';

  type U = { uid: string; email: string };
  const OWNER: U = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
  const ADMIN: U = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
  const OADMIN: U = { uid: 'uidCairoAdmin000000000001', email: 'admin@other.test' };
  const TADMIN: U = { uid: 'uidThirdAdmin000000000001', email: 'admin@third.test' };
  const u = (tag: string): U => ({ uid: `uidR4${tag}`.padEnd(28, '0'), email: `${tag.toLowerCase()}@people.test` });

  const db = (x: U, verified = true): Firestore =>
    env.authenticatedContext(x.uid, { email: x.email, email_verified: verified }).firestore() as unknown as Firestore;
  const store = (x: U, verified = true) => createFirestoreStore(db(x, verified));
  const actor = (x: U, role: Actor['role'], orgId?: string): Actor => ({ id: x.uid, name: x.email, email: x.email, role, ...(orgId ? { orgId } : {}) });
  let n = 0;
  const key = () => `key-r4l${String(++n).padStart(7, '0')}`;
  const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));
  const read = async (c: string, id: string) => {
    let data: Record<string, any> | undefined;
    await env.withSecurityRulesDisabled(async ctx => {
      data = (await getDoc(doc(ctx.firestore(), c, id))).data();
    });
    return data;
  };
  const mid = (x: U, org = ORG) => `${x.uid}_${org}`;
  const allows = async (p: Promise<unknown>) => p.then(() => true, () => false);
  const canOpen = (x: U, org: string, verified = true) => allows(getDoc(doc(db(x, verified), 'organizations', org)));
  const denial = (p: Promise<unknown>) => p.then(() => 'allowed', (e: any) => `${e?.code || ''} ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 260)}`);
  const errText = (e: any) => `${e?.code || ''} ${String(e?.message || e).slice(0, 220)}`;

  // ---- AppContext.buildMembershipQueries (+ the fallback when the OR query is rejected) and, for an
  // unverified account, profileCompanyQuery (the records of its email in its profile's company) ----
  const appMemberships = async (x: U, verified: boolean, profile: Record<string, any> | null = null): Promise<OrganizationMember[]> => {
    const f = db(x, verified);
    const members = collection(f, 'members');
    const email = verified ? x.email : '';
    const toMembers = (docs: Array<{ id: string; data: () => any }>) => docs.map(d => ({ ...d.data(), id: d.id } as OrganizationMember));
    const unique = (all: OrganizationMember[]) => Array.from(new Map(all.map(m => [m.id, m])).values());
    let found: OrganizationMember[];
    try {
      const combined = email ? query(members, or(where('userId', '==', x.uid), where('userEmail', '==', email))) : query(members, where('userId', '==', x.uid));
      found = toMembers((await getDocs(combined)).docs);
    } catch {
      const qs = [query(members, where('userId', '==', x.uid)), ...(email ? [query(members, where('userEmail', '==', email))] : [])];
      const res = await Promise.allSettled(qs.map(q => getDocs(q)));
      found = unique(res.flatMap(r => (r.status === 'fulfilled' ? toMembers(r.value.docs) : [])));
    }
    const orgId = typeof profile?.orgId === 'string' ? profile.orgId.trim() : '';
    if (!verified && orgId) {
      try {
        found = unique([...found, ...toMembers((await getDocs(query(members, where('orgId', '==', orgId), where('userEmail', '==', normalizeEmail(x.email))))).docs)]);
      } catch { /* not readable (e.g. a suspended profile) */ }
    }
    return found;
  };

  // ---- AppContext.linkOwnProfile (verbatim shape) ----
  const linkOwnProfile = (f: Firestore, x: U, verified: boolean, m: OrganizationMember) =>
    setDoc(doc(f, 'users', x.uid), JSON.parse(JSON.stringify({
      id: x.uid,
      ...(verified ? { email: normalizeEmail(x.email) } : {}),
      name: m.userName || 'موظف',
      role: m.role,
      orgId: m.orgId,
      memberId: m.id,
      department: m.department || '',
      phone: m.phone || '',
      active: true,
      updatedAt: new Date().toISOString(),
    })), { merge: true });

  const ROLE_PRIORITY: Record<string, number> = { super_admin: 5, org_admin: 4, finance: 3, data_entry: 2, employee: 1 };

  /**
   * One sign-in as the app runs it (AppContext identity effects), repeated until stable:
   * read users/{uid}, load memberships, profileMembershipState, relink (linkOwnProfile) when asked,
   * verifiedEmail merge when the token is verified. Returns what the UI then resolves.
   */
  const appSignIn = async (x: U, verified: boolean) => {
    const f = db(x, verified);
    const refused: string[] = [];
    const tried = new Set<string>();
    let profile: any = null;
    let memberships: OrganizationMember[] = [];
    let state = profileMembershipState(null, [], { uid: x.uid, email: x.email, emailVerified: verified });
    for (let i = 0; i < 4; i++) {
      const snap = await getDoc(doc(f, 'users', x.uid));
      profile = snap.exists() ? snap.data() : null;
      memberships = await appMemberships(x, verified, profile);
      state = profileMembershipState(profile, memberships, { uid: x.uid, email: x.email, emailVerified: verified });
      let wrote = false;
      const target = state.relinkTo;
      if (target) {
        const attempt = [target.id, target.orgId, target.role, target.userName].join('|');
        if (!tried.has(attempt)) {
          tried.add(attempt);
          try { await linkOwnProfile(f, x, verified, target); wrote = true; } catch (e) { refused.push(`relink ${target.id}: ${errText(e)}`); }
        }
      }
      if (verified && profile && normalizeEmail(profile.verifiedEmail) !== normalizeEmail(x.email) && !tried.has('verifiedEmail')) {
        tried.add('verifiedEmail');
        try { await setDoc(doc(f, 'users', x.uid), { verifiedEmail: normalizeEmail(x.email) }, { merge: true }); wrote = true; } catch (e) { refused.push(`verifiedEmail: ${errText(e)}`); }
      }
      if (!wrote) break;
    }
    // AppContext RBAC resolution
    const trusted = state.current ? profile : null;
    const matching = memberships.filter(m => m.userId === x.uid || normalizeEmail(m.userEmail) === normalizeEmail(x.email));
    const withOrg = matching.filter(m => Boolean(m.orgId && m.orgId.trim()));
    const pool = withOrg.length > 0 ? withOrg : matching;
    const userMemberRecord = [...pool].sort((a, b) => (ROLE_PRIORITY[b.role] || 0) - (ROLE_PRIORITY[a.role] || 0))[0];
    const role: Role = trusted?.role && trusted.role !== 'super_admin' ? trusted.role : userMemberRecord && userMemberRecord.role !== 'super_admin' ? userMemberRecord.role : 'employee';
    const orgId: string = trusted?.orgId || userMemberRecord?.orgId || '';
    const suspended = trusted?.orgId ? trusted.active === false : memberships.length > 0 && memberships.every(m => m.active === false);
    return { state, profile, memberships, refused, orgId, role, suspended, verifyPrompt: state.awaitingVerification };
  };

  // ---- AppContext.linkedProfileIds / updateMember / removeMember (verbatim logic) ----
  const linkedProfileIds = async (f: Firestore, mem: OrganizationMember | undefined): Promise<string[]> => {
    if (!mem) return [];
    const ids = new Set<string>();
    if (isRealUid(mem.userId)) {
      try { await getDoc(doc(f, 'users', mem.userId)); ids.add(mem.userId); } catch { /* not ours */ }
    }
    try {
      const snap = await getDocs(query(collection(f, 'users'), where('orgId', '==', mem.orgId), where('memberId', '==', mem.id)));
      snap.docs.forEach(d => ids.add(d.id));
    } catch { /* skipped */ }
    return Array.from(ids);
  };
  const memberAs = async (f: Firestore, id: string) => ({ id, ...(await getDoc(doc(f, 'members', id))).data() } as OrganizationMember);
  const appUpdateMember = async (who: U, role: Actor['role'], orgId: string | undefined, memberId: string, updates: Partial<OrganizationMember>, verified = true) => {
    const f = db(who, verified);
    const mem = await memberAs(f, memberId);
    return updateMemberRecord(store(who, verified), actor(who, role, orgId), memberId, updates, await linkedProfileIds(f, mem), key());
  };
  const orgMembers = async (f: Firestore, orgId?: string) =>
    (await getDocs(orgId ? query(collection(f, 'members'), where('orgId', '==', orgId)) : collection(f, 'members'))).docs.map(d => ({ id: d.id, ...d.data() } as OrganizationMember & { operationKey?: string }));
  const appRemoveMember = async (who: U, role: Actor['role'], orgId: string | undefined, memberId: string) => {
    const f = db(who);
    const mem = await memberAs(f, memberId);
    const all = await orgMembers(f, role === 'super_admin' ? undefined : orgId);
    const email = normalizeEmail(mem.userEmail);
    const samePerson = email ? all.filter(m => m.id !== memberId && isRealUid(m.userId) && normalizeEmail(m.userEmail) === email) : [];
    const ids = new Set(await linkedProfileIds(f, mem));
    for (const other of samePerson) (await linkedProfileIds(f, other)).forEach(id => ids.add(id));
    return removeMember(store(who), actor(who, role, orgId), memberId, Array.from(ids), key());
  };
  // AppContext.knownUidForEmail: rawMembers = what the caller's member listener shows (owner: all; org admin: its company);
  // the platform owner also finds a login by its proof (users where verifiedEmail == email)
  const knownUidForEmail = async (who: U, role: Actor['role'], orgId: string | undefined, email: string) => {
    const f = db(who);
    const raw = await orgMembers(f, role === 'super_admin' ? undefined : orgId);
    const findProvenLogins = role === 'super_admin'
      ? async (target: string) => {
          const snap = await getDocs(query(collection(f, 'users'), where('verifiedEmail', '==', target), limit(2)));
          return snap.docs.length === 1 ? [snap.docs[0].id] : [];
        }
      : undefined;
    return verifiedLoginUidOf(raw, email, async uid => {
      const s = await getDoc(doc(f, 'users', uid));
      return s.exists() ? String(s.data()?.verifiedEmail || '') : null;
    }, findProvenLogins);
  };
  // AppContext.addMemberToOrgs (pre-skip of companies already holding the email, then createMemberInOrgs)
  const appAddMemberToOrgs = async (who: U, role: Actor['role'], orgId: string | undefined, x: U, memberRole: Role, targets: string[], name = 'Person') => {
    const f = db(who);
    const raw = await orgMembers(f, role === 'super_admin' ? undefined : orgId);
    const email = normalizeEmail(x.email);
    const knownUid = await knownUidForEmail(who, role, orgId, email);
    const replaceable = (m: OrganizationMember) => Boolean(knownUid) && m.id === `${pendingUserIdForEmail(email)}_${m.orgId}` && (!isRealUid(m.userId) || m.userId === knownUid);
    const free = targets.filter(t => {
      const holder = raw.find(m => m.orgId === t && normalizeEmail(m.userEmail) === email);
      return !holder || replaceable(holder);
    });
    if (free.length === 0) return { knownUid, added: [] as string[], error: 'duplicate (pre-skip: already registered)' };
    try {
      const res = await createMemberInOrgs(store(who), actor(who, role, orgId),
        { userId: knownUid || '', userName: name, userEmail: email, role: memberRole, department: 'D', jobTitle: 'J', phone: '', active: true } as any, free, key());
      return { knownUid, added: res.value.created.map(m => m.orgId), skipped: res.value.skipped.map(s => s.orgId), error: '' };
    } catch (e: any) {
      return { knownUid, added: [] as string[], error: isDomainError(e) ? `${e.code}` : errText(e) };
    }
  };
  // AppContext.createCompanyUser (the login exists already for `x`): createMember(..., { writeUserProfile: true })
  const provision = (who: U, role: Actor['role'], orgId: string, x: U, memberRole: Role, name = 'Person') =>
    createMember(store(who), actor(who, role, role === 'super_admin' ? undefined : orgId), {
      orgId, userId: x.uid, userName: name, userEmail: x.email, role: memberRole, department: 'D', jobTitle: 'J', phone: '', active: true,
    } as any, key(), { writeUserProfile: true });
  // AppContext.addMember (by email, no login proven -> pending invitation)
  const inviteByEmail = async (who: U, role: Actor['role'], orgId: string, x: U, memberRole: Role, name = 'Invitee') => {
    const knownUid = await knownUidForEmail(who, role, orgId, x.email);
    return createMember(store(who), actor(who, role, role === 'super_admin' ? undefined : orgId), {
      orgId, userId: knownUid || '', userName: name, userEmail: x.email, role: memberRole, department: 'D', jobTitle: 'J', phone: '', active: true,
    } as any, key());
  };

  const putMember = (f: Firestore, id: string, data: Record<string, unknown>) => setDoc(doc(f, 'members', id), { userName: 'x', active: true, ...data });
  const putKey = (f: Firestore, org: string, email: string, memberId: string) =>
    setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('member_email', org, email)), { scope: 'member_email', orgId: org, value: normalizeKeyValue(email, 'member_email'), entityCollection: 'members', entityId: memberId });


  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      for (const [org, name, admin] of [[ORG, 'Acme', ADMIN], [OTHER, 'Other', OADMIN], [THIRD, 'Third', TADMIN]] as const) {
        await setDoc(doc(f, 'organizations', org), { id: org, name, code: name.toUpperCase(), currency: 'EGP', notificationRecipients: [admin.email] });
        await setDoc(doc(f, 'users', admin.uid), { orgId: org, role: 'org_admin', active: true, email: admin.email, memberId: mid(admin, org), name: admin.email });
        await putMember(f, mid(admin, org), { orgId: org, userId: admin.uid, userEmail: admin.email, role: 'org_admin', userName: `Admin ${name}` });
        await putKey(f, org, admin.email, mid(admin, org));
        await setDoc(doc(f, 'paymentAccounts', `acc-${org}`), { orgId: org, name: 'cash', type: 'cash', currency: 'EGP', active: true, balance: 100, currentBalance: 100 });
      }
    });
  });

  // =============================================================================
  describe('first sign-in, provisioning, invitations', () => {
    it('admin-provisioned password account (unverified) with a uid membership: first sign-in, profile save, later verification', async () => {
      const P = u('Prov1');
      await provision(ADMIN, 'org_admin', ORG, P, 'finance', 'Prov One');
      const s = await appSignIn(P, false);
      expect({ refused: s.refused, orgId: s.orgId, role: s.role, current: s.state.current }).toEqual({ refused: [], orgId: ORG, role: 'finance', current: true });
      expect(await canOpen(P, ORG, false)).toBe(true);
      expect(await allows(getDoc(doc(db(P, false), 'paymentAccounts', `acc-${ORG}`)))).toBe(true);
      // profile tab save (handleUpdateUserProfileInfo) + membership copy (syncOwnMembership)
      await assertSucceeds(setDoc(doc(db(P, false), 'users', P.uid), { uid: P.uid, name: 'Prov 1', phone: '0100', instapay: 'p@ip', updatedAt: 'x' }, { merge: true }));
      await syncOwnMembership(store(P, false), actor(P, 'finance', ORG), mid(P), { userName: 'Prov 1', phone: '0100' });
      // the next sign-in re-syncs nothing it should not; verification later records the proof
      const s2 = await appSignIn(P, true);
      expect(s2.refused).toEqual([]);
      expect((await read('users', P.uid))?.verifiedEmail).toBe(P.email);
    });

    it('owner provisioning (first company with profile + more companies under the same UID): unverified first sign-in opens all of them', async () => {
      const P = u('Prov2');
      await provision(OWNER, 'super_admin', ORG, P, 'employee');
      const more = await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: P.uid, userName: 'P2', userEmail: P.email, role: 'finance', department: 'D', jobTitle: 'J', active: true } as any, [OTHER, THIRD], key());
      expect(more.value.created.map(m => m.id)).toEqual([mid(P, OTHER), mid(P, THIRD)]);
      const s = await appSignIn(P, false);
      expect({ refused: s.refused, orgId: s.orgId }).toEqual({ refused: [], orgId: ORG });
      expect([await canOpen(P, ORG, false), await canOpen(P, OTHER, false), await canOpen(P, THIRD, false)]).toEqual([true, true, true]);
    });

    it('Google sign-in (verified) invited by email: self-link on first sign-in, proof recorded, admin edit re-points the placeholder, name resync accepted', async () => {
      const G = u('Goog1');
      const inv = await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'finance', 'Goog');
      expect(inv.value.userId).toBe(pendingUserIdForEmail(G.email));
      const s = await appSignIn(G, true);
      expect({ refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ refused: [], orgId: ORG, role: 'finance' });
      expect(await read('users', G.uid)).toMatchObject({ memberId: inv.value.id, verifiedEmail: G.email });
      await appUpdateMember(ADMIN, 'org_admin', ORG, inv.value.id, { userName: 'Goog Renamed' });
      expect((await read('members', inv.value.id))?.userId).toBe(G.uid);
      const s2 = await appSignIn(G, true);
      expect({ refused: s2.refused, orgId: s2.orgId, name: (await read('users', G.uid))?.name }).toEqual({ refused: [], orgId: ORG, name: 'Goog Renamed' });
    });

    it('[LOGIN-1] Google user invited by email to TWO companies before the first sign-in gets only one; neither the second company\'s admin nor the platform owner can open the other', async () => {
      const G = u('Goog2');
      await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'employee', 'G2');
      await inviteByEmail(OADMIN, 'org_admin', OTHER, G, 'finance', 'G2');
      const s = await appSignIn(G, true);
      const linkedTo = s.orgId;
      const otherOrg = linkedTo === ORG ? OTHER : ORG;
      const otherAdmin = otherOrg === ORG ? ADMIN : OADMIN;
      // the real remedies the app offers: the second company's admin, then the platform owner, add the person again
      const byAdmin = await appAddMemberToOrgs(otherAdmin, 'org_admin', otherOrg, G, 'finance', [otherOrg]);
      const byOwner = await appAddMemberToOrgs(OWNER, 'super_admin', undefined, G, 'finance', [otherOrg]);
      const observed = {
        refused: s.refused,
        linkedTo,
        opensOtherCompany: await canOpen(G, otherOrg),
        ownerFindsLogin: byOwner.knownUid === G.uid,
        ownerReAdd: byOwner.error || 'added',
        adminReAdd: byAdmin.error || 'added',
        opensOtherCompanyAfterOwnerReAdd: await canOpen(G, otherOrg),
        denial: await denial(getDoc(doc(db(G), 'organizations', otherOrg))),
      };
      console.log('[LOGIN-1] observed', JSON.stringify(observed));
      expect(observed).toMatchObject({ refused: [], opensOtherCompanyAfterOwnerReAdd: true });
      expect(observed.opensOtherCompany || observed.ownerFindsLogin).toBe(true);
    });

    it('[LOGIN-1 workaround] only after an unrelated admin edit of the FIRST invitation (re-points its userId) can the owner open the second company', async () => {
      const G = u('Goog3');
      const a = await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'finance', 'G3');
      await inviteByEmail(OADMIN, 'org_admin', OTHER, G, 'employee', 'G3');
      const s = await appSignIn(G, true);
      expect(s.orgId).toBe(ORG);
      await appUpdateMember(ADMIN, 'org_admin', ORG, a.value.id, { jobTitle: 'any edit' });
      expect((await read('members', a.value.id))?.userId).toBe(G.uid);
      const byOwner = await appAddMemberToOrgs(OWNER, 'super_admin', undefined, G, 'employee', [OTHER]);
      expect(byOwner).toMatchObject({ knownUid: G.uid, added: [OTHER] });
      expect(await canOpen(G, OTHER)).toBe(true);
    });

    it('a person who already works in a company and is invited by email to another: owner re-add replaces the invitation (round-3 path)', async () => {
      const P = u('Prov3');
      await provision(ADMIN, 'org_admin', ORG, P, 'employee');
      await inviteByEmail(OADMIN, 'org_admin', OTHER, P, 'finance');
      await appSignIn(P, true); // records verifiedEmail
      // (the company document itself is readable to its invitee since round 5 (invitedTo): its data is not)
      const readsOtherMembers = () => allows(getDocs(query(collection(db(P), 'members'), where('orgId', '==', OTHER))));
      expect(await readsOtherMembers()).toBe(false);
      const byOwner = await appAddMemberToOrgs(OWNER, 'super_admin', undefined, P, 'finance', [OTHER]);
      expect(byOwner).toMatchObject({ knownUid: P.uid, added: [OTHER] });
      expect(await canOpen(P, OTHER)).toBe(true);
      expect(await readsOtherMembers()).toBe(true);
      expect(await appSignIn(P, true)).toMatchObject({ refused: [], orgId: ORG });
    });
  });

  // =============================================================================
  describe('email invitation of an UNVERIFIED account (admin-provisioned password / self-registered)', () => {
    it('[LOGIN-2] an unverified sign-up for an invited address is never told to verify: the app cannot see the invitation, profileMembershipState never sets awaitingVerification', async () => {
      const V = u('Unver1');
      await inviteByEmail(ADMIN, 'org_admin', ORG, V, 'employee', 'Unver');
      const before = await appSignIn(V, false);
      // what the app CAN see: the email query is refused for an unverified token (rules: isInviteeOf)
      const emailQueryAllowed = await allows(getDocs(query(collection(db(V, false), 'members'), where('userEmail', '==', V.email))));
      // after verifying, the link works (the only way in)
      const after = await appSignIn(V, true);
      const observed = {
        emailQueryAllowed,
        membershipsSeen: before.memberships.length,
        verifyPrompt: before.verifyPrompt,
        orgIdBefore: before.orgId,
        orgIdAfterVerification: after.orgId,
        refusedAfter: after.refused,
      };
      console.log('[LOGIN-2] observed', JSON.stringify(observed));
      expect(observed.orgIdAfterVerification).toBe(ORG);
      expect(observed.refusedAfter).toEqual([]);
      // the UI must tell this person to verify (App.tsx membershipNeedsVerification), not "ask your admin to add you"
      expect(observed.verifyPrompt).toBe(true);
    });

    it('[LOGIN-2] (Marwa: deleted and re-added) an admin-provisioned password account removed and added again by its admin is locked out with no verification prompt', async () => {
      const M = u('Marwa1');
      await provision(ADMIN, 'org_admin', ORG, M, 'finance', 'Marwa');
      expect((await appSignIn(M, false)).orgId).toBe(ORG);
      await appRemoveMember(ADMIN, 'org_admin', ORG, mid(M));
      expect(await read('users', M.uid)).toMatchObject({ orgId: '', role: 'employee', memberId: null });
      // re-add: OrganizationsManagement "new user" -> createCompanyUser fails with email_in_use -> addMemberToOrgs by email;
      // UsersManagement provision -> addMemberToOrgs. knownUidForEmail finds no login: the removed record is gone.
      const readd = await appAddMemberToOrgs(ADMIN, 'org_admin', ORG, M, 'finance', [ORG], 'Marwa');
      const ownerKnows = await knownUidForEmail(OWNER, 'super_admin', undefined, M.email);
      const s = await appSignIn(M, false);
      const observed = { readd, ownerKnows, orgId: s.orgId, verifyPrompt: s.verifyPrompt, opens: await canOpen(M, ORG, false),
        denial: await denial(getDoc(doc(db(M, false), 'members', `${pendingUserIdForEmail(M.email)}_${ORG}`))) };
      console.log('[LOGIN-2 Marwa] observed', JSON.stringify(observed));
      expect(readd.added).toEqual([ORG]);
      // either the re-add brings the same login back, or the app at least asks her to verify
      expect(observed.opens || observed.verifyPrompt).toBe(true);
    });

    it('a verified (Google) user removed and re-invited by its admin gets back in on the next sign-in', async () => {
      const G = u('Goog4');
      await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'finance');
      expect((await appSignIn(G, true)).orgId).toBe(ORG);
      const id = `${pendingUserIdForEmail(G.email)}_${ORG}`;
      await appRemoveMember(ADMIN, 'org_admin', ORG, id);
      expect(await canOpen(G, ORG)).toBe(false);
      await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'employee');
      const s = await appSignIn(G, true);
      expect({ refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ refused: [], orgId: ORG, role: 'employee' });
      expect(await canOpen(G, ORG)).toBe(true);
    });
  });

  // =============================================================================
  describe('stale profiles, multi-company members, legacy data', () => {
    it('Marwa: profile still in company A (membership deleted by an older app) while her memberships are in B and C: relinks to the best one, opens B and C', async () => {
      const M = u('Marwa2');
      await seed(async f => {
        await setDoc(doc(f, 'users', M.uid), { orgId: ORG, role: 'org_admin', active: true, email: M.email, memberId: mid(M, ORG), name: 'Old Marwa' });
        await putMember(f, mid(M, OTHER), { orgId: OTHER, userId: M.uid, userEmail: M.email, role: 'employee', userName: 'Marwa B' });
        await putMember(f, mid(M, THIRD), { orgId: THIRD, userId: M.uid, userEmail: M.email, role: 'finance', userName: 'Marwa C' });
      });
      for (const verified of [false, true]) {
        const s = await appSignIn(M, verified);
        expect({ refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ refused: [], orgId: THIRD, role: 'finance' });
      }
      expect(await read('users', M.uid)).toMatchObject({ orgId: THIRD, role: 'finance', memberId: mid(M, THIRD), name: 'Marwa C' });
      expect([await canOpen(M, ORG), await canOpen(M, OTHER), await canOpen(M, THIRD)]).toEqual([false, true, true]);
    });

    it('removed from the profile company while still a member elsewhere: detached, then relinked to the remaining company', async () => {
      const P = u('Multi1');
      await provision(ADMIN, 'org_admin', ORG, P, 'finance');
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: P.uid, userName: 'P', userEmail: P.email, role: 'employee', department: 'D', jobTitle: 'J', active: true } as any, [OTHER], key());
      await appRemoveMember(ADMIN, 'org_admin', ORG, mid(P));
      const s = await appSignIn(P, false);
      expect({ refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ refused: [], orgId: OTHER, role: 'employee' });
      expect([await canOpen(P, ORG, false), await canOpen(P, OTHER, false)]).toEqual([false, true]);
    });

    it('multi-company member switching company: the rules accept the self-link to each of its own memberships (and back)', async () => {
      const P = u('Multi2');
      await provision(ADMIN, 'org_admin', ORG, P, 'finance');
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: P.uid, userName: 'P', userEmail: P.email, role: 'employee', department: 'D', jobTitle: 'J', active: true } as any, [OTHER], key());
      const f = db(P, false);
      await assertSucceeds(linkOwnProfile(f, P, false, await memberAs(f, mid(P, OTHER))));
      expect([await canOpen(P, ORG, false), await canOpen(P, OTHER, false)]).toEqual([true, true]);
      await assertSucceeds(linkOwnProfile(f, P, false, await memberAs(f, mid(P, ORG))));
      expect(await read('users', P.uid)).toMatchObject({ orgId: ORG, role: 'finance' });
    });

    it('[LOGIN-3] a two-company finance briefly suspended in its main company is moved by the app to its other company and stays pinned there (lower role) after re-activation: nobody can move it back', async () => {
      const P = u('Susp1');
      await provision(ADMIN, 'org_admin', ORG, P, 'finance', 'Susp');
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: P.uid, userName: 'Susp', userEmail: P.email, role: 'employee', department: 'D', jobTitle: 'J', active: true } as any, [OTHER], key());
      expect((await appSignIn(P, false)).orgId).toBe(ORG);
      await appUpdateMember(ADMIN, 'org_admin', ORG, mid(P), { active: false });
      const during = await appSignIn(P, false); // the relink effect moves the profile to OTHER
      await appUpdateMember(ADMIN, 'org_admin', ORG, mid(P), { active: true });
      const after = await appSignIn(P, false);
      // AppContext.companyChoices (switchableMemberships) -> Header switcher -> switchOwnCompany (linkOwnProfile)
      const choices = switchableMemberships(after.memberships, { uid: P.uid, email: P.email, emailVerified: false });
      const observed = {
        during: { orgId: during.orgId, role: during.role },
        after: { orgId: after.orgId, role: after.role },
        choices: choices.map(m => [m.orgId, m.role]),
        rulesStillGrantOrgFinance: await allows(getDoc(doc(db(P, false), 'paymentAccounts', `acc-${ORG}`))),
        ownerOnlySwitcher: can('finance', 'manageCompanies'),
      };
      console.log('[LOGIN-3] observed', JSON.stringify(observed));
      expect(observed.rulesStillGrantOrgFinance).toBe(true);
      // the member's own switcher offers both companies; switching back is accepted and stays
      expect(observed.choices).toEqual([[ORG, 'finance'], [OTHER, 'employee']]);
      await assertSucceeds(linkOwnProfile(db(P, false), P, false, choices[0]));
      const back = await appSignIn(P, false);
      expect({ refused: back.refused, orgId: back.orgId, role: back.role, current: back.state.current }).toEqual({ refused: [], orgId: ORG, role: 'finance', current: true });
      // a member of one company gets no switcher (a single choice)
      expect(switchableMemberships((await appSignIn(ADMIN, true)).memberships, { uid: ADMIN.uid, email: ADMIN.email, emailVerified: true })).toHaveLength(1);
    });

    it('suspended then re-activated (single company): suspended screen, then access and a clean relink', async () => {
      const P = u('Susp2');
      await provision(ADMIN, 'org_admin', ORG, P, 'data_entry');
      await appSignIn(P, false);
      await appUpdateMember(ADMIN, 'org_admin', ORG, mid(P), { active: false });
      const s = await appSignIn(P, false);
      expect({ refused: s.refused, suspended: s.suspended, opens: await canOpen(P, ORG, false) }).toEqual({ refused: [], suspended: true, opens: false });
      await appUpdateMember(ADMIN, 'org_admin', ORG, mid(P), { active: true, userName: 'Back' });
      const s2 = await appSignIn(P, false);
      expect({ refused: s2.refused, suspended: s2.suspended, orgId: s2.orgId, opens: await canOpen(P, ORG, false) }).toEqual({ refused: [], suspended: false, orgId: ORG, opens: true });
    });

    it('legacy profile WITHOUT memberId (uid membership): stays current, the relink adds memberId and is accepted (verified and unverified)', async () => {
      for (const [tag, verified] of [['LegA', false], ['LegB', true]] as const) {
        const L = u(tag);
        await seed(async f => {
          await setDoc(doc(f, 'users', L.uid), { orgId: ORG, role: 'finance', active: true });
          await putMember(f, mid(L), { orgId: ORG, userId: L.uid, userEmail: L.email, role: 'finance', userName: tag });
        });
        const s = await appSignIn(L, verified);
        expect({ refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ refused: [], orgId: ORG, role: 'finance' });
        expect((await read('users', L.uid))?.memberId).toBe(mid(L));
      }
    });

    it('[LOGIN-4] legacy member id (temp_ / usr- / pending-) linked by an older app to an UNVERIFIED password account: the rules still grant the company, but the app shows "awaiting assignment"', async () => {
      const results: Record<string, unknown> = {};
      for (const [tag, legacyUid, withMemberId] of [
        ['LegT', 'temp_1690000000000', true],
        ['LegU', 'usr-8d3f2a9c', false],
        ['LegP', 'pending-legacy', true],
      ] as const) {
        const L = u(tag);
        const id = `${legacyUid}_${ORG}`;
        await seed(async f => {
          await setDoc(doc(f, 'users', L.uid), { orgId: ORG, role: 'finance', active: true, email: L.email, name: tag, ...(withMemberId ? { memberId: id } : {}) });
          await putMember(f, id, { orgId: ORG, userId: legacyUid, userEmail: L.email, role: 'finance', userName: tag });
        });
        const s = await appSignIn(L, false);
        const v = await appSignIn(L, true);
        results[tag] = {
          rulesGrant: await allows(getDoc(doc(db(L, false), 'paymentAccounts', `acc-${ORG}`))),
          unverified: { orgId: s.orgId, role: s.role, current: s.state.current, verifyPrompt: s.verifyPrompt },
          verified: { orgId: v.orgId, refused: v.refused },
        };
      }
      console.log('[LOGIN-4] observed', JSON.stringify(results));
      for (const r of Object.values(results) as any[]) {
        expect(r.rulesGrant).toBe(true);
        expect(r.verified.orgId).toBe(ORG);
        // the app must resolve the company the rules grant (or at least ask for verification)
        expect(r.unverified.orgId === ORG || r.unverified.verifyPrompt).toBe(true);
      }
    });

    it('[LOGIN-5] a legacy profile linked to a placeholder membership (no email on the profile) is suspended with it, and stays suspended after the admin re-activates the membership', async () => {
      const L = u('LegS');
      const id = `temp_1690000000001_${ORG}`;
      await seed(async f => {
        await setDoc(doc(f, 'users', L.uid), { orgId: ORG, role: 'employee', active: true, memberId: id, name: 'Leg S' });
        await putMember(f, id, { orgId: ORG, userId: 'temp_1690000000001', userEmail: L.email, role: 'employee', userName: 'Leg S' });
      });
      expect(await canOpen(L, ORG, false)).toBe(true);
      await appUpdateMember(ADMIN, 'org_admin', ORG, id, { active: false });
      const suspendedProfile = await read('users', L.uid);
      await appUpdateMember(ADMIN, 'org_admin', ORG, id, { active: true });
      const s = await appSignIn(L, true); // even after verifying and signing in
      const observed = {
        suspendedProfileActive: suspendedProfile?.active,
        membershipActive: (await read('members', id))?.active,
        profileActiveAfterReactivation: (await read('users', L.uid))?.active,
        appSuspendedScreen: s.suspended,
        opens: await canOpen(L, ORG),
        denial: await denial(getDoc(doc(db(L), 'organizations', ORG))),
      };
      console.log('[LOGIN-5] observed', JSON.stringify(observed));
      expect(observed.suspendedProfileActive).toBe(false);
      expect(observed.membershipActive).toBe(true);
      expect(observed.opens).toBe(true);
    });
  });

  // =============================================================================
  describe('admin edits (own record, other members, company moves)', () => {
    it('org admin edits its own name / phone / job title (profile with memberId, legacy profile without memberId, multi-company admin)', async () => {
      await appUpdateMember(ADMIN, 'org_admin', ORG, mid(ADMIN), { userName: 'Boss', phone: '0123', jobTitle: 'CEO' });
      expect(await read('users', ADMIN.uid)).toMatchObject({ name: 'Boss', phone: '0123', role: 'org_admin', orgId: ORG, active: true });
      expect((await appSignIn(ADMIN, true)).refused).toEqual([]);
      // legacy admin profile without memberId (unverified password account)
      const LA = u('LegAdm');
      await seed(async f => {
        await setDoc(doc(f, 'users', LA.uid), { orgId: ORG, role: 'org_admin', active: true, email: LA.email });
        await putMember(f, mid(LA), { orgId: ORG, userId: LA.uid, userEmail: LA.email, role: 'org_admin', userName: 'LA' });
      });
      await appUpdateMember(LA, 'org_admin', ORG, mid(LA), { userName: 'LA2', phone: '1', jobTitle: 'Mgr' }, false);
      expect(await read('users', LA.uid)).toMatchObject({ name: 'LA2', memberId: mid(LA), role: 'org_admin' });
      // multi-company admin: profile elsewhere (employee), org admin member of ORG
      const MA = u('MultAdm');
      await seed(async f => {
        await setDoc(doc(f, 'users', MA.uid), { orgId: OTHER, role: 'employee', active: true, email: MA.email, memberId: mid(MA, OTHER) });
        await putMember(f, mid(MA, OTHER), { orgId: OTHER, userId: MA.uid, userEmail: MA.email, role: 'employee', userName: 'MA' });
        await putMember(f, mid(MA, ORG), { orgId: ORG, userId: MA.uid, userEmail: MA.email, role: 'org_admin', userName: 'MA' });
      });
      await appUpdateMember(MA, 'org_admin', ORG, mid(MA, ORG), { userName: 'MA2', jobTitle: 'X' }, false);
      expect(await read('users', MA.uid)).toMatchObject({ orgId: OTHER, role: 'employee' });
      expect((await read('members', mid(MA, ORG)))?.userName).toBe('MA2');
      // own profile tab save + membership copy
      await assertSucceeds(setDoc(doc(db(ADMIN), 'users', ADMIN.uid), { uid: ADMIN.uid, name: 'Boss 2', phone: '9', iban: 'EG00', updatedAt: 'x' }, { merge: true }));
      await syncOwnMembership(store(ADMIN), actor(ADMIN, 'org_admin', ORG), mid(ADMIN), { userName: 'Boss 2', phone: '9' });
    });

    it('org admin edits its own record when it is a legacy placeholder membership (usr-) linked to its profile (verified and unverified admin)', async () => {
      for (const [tag, verified] of [['PhA', false], ['PhB', true]] as const) {
        const A = u(tag);
        const legacyUid = `usr-${tag.toLowerCase()}000`;
        const id = `${legacyUid}_${ORG}`;
        await seed(async f => {
          await setDoc(doc(f, 'users', A.uid), { orgId: ORG, role: 'org_admin', active: true, email: A.email, memberId: id });
          await putMember(f, id, { orgId: ORG, userId: legacyUid, userEmail: A.email, role: 'org_admin', userName: tag });
        });
        let err = '';
        try { await appUpdateMember(A, 'org_admin', ORG, id, { userName: `${tag} renamed`, phone: '5' }, verified); } catch (e) { err = errText(e); }
        expect({ tag, err }).toEqual({ tag, err: '' });
      }
    });

    it('org admin changes another member\'s role and status; owner changes role of an org admin', async () => {
      const P = u('Role1');
      await provision(ADMIN, 'org_admin', ORG, P, 'employee');
      await appUpdateMember(ADMIN, 'org_admin', ORG, mid(P), { role: 'finance' });
      expect(await read('users', P.uid)).toMatchObject({ role: 'finance' });
      expect((await appSignIn(P, false)).role).toBe('finance');
      await appUpdateMember(ADMIN, 'org_admin', ORG, mid(P), { role: 'org_admin', active: false });
      expect(await canOpen(P, ORG, false)).toBe(false);
      await appUpdateMember(ADMIN, 'org_admin', ORG, mid(P), { active: true });
      const s = await appSignIn(P, false);
      expect({ refused: s.refused, role: s.role, opens: await canOpen(P, ORG, false) }).toEqual({ refused: [], role: 'org_admin', opens: true });
      await appUpdateMember(OWNER, 'super_admin', undefined, mid(P), { role: 'employee' });
      expect((await appSignIn(P, false)).role).toBe('employee');
    });

    it('membership with a real UID but no profile yet (multi-company add / profile never written): first unverified sign-in creates the profile by self-link', async () => {
      const P = u('NoProf');
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: P.uid, userName: 'NP', userEmail: P.email, role: 'data_entry', department: 'D', jobTitle: 'J', active: true } as any, [ORG, OTHER], key());
      const s = await appSignIn(P, false);
      expect({ refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ refused: [], orgId: ORG, role: 'data_entry' });
      expect([await canOpen(P, ORG, false), await canOpen(P, OTHER, false)]).toEqual([true, true]);
    });

    it('org admin edits its own legacy placeholder record whose stored email has capitals (verified admin)', async () => {
      const A = u('PhC');
      const id = `usr-phc000_${ORG}`;
      await seed(async f => {
        await setDoc(doc(f, 'users', A.uid), { orgId: ORG, role: 'org_admin', active: true, email: A.email, memberId: id });
        await putMember(f, id, { orgId: ORG, userId: 'usr-phc000', userEmail: 'PhC@People.test', role: 'org_admin', userName: 'PhC' });
      });
      await appUpdateMember(A, 'org_admin', ORG, id, { userName: 'PhC 2', jobTitle: 'Mgr' });
      expect((await appSignIn(A, true)).refused).toEqual([]);
      expect(await canOpen(A, ORG)).toBe(true);
    });

    it('owner moves a single-company member to another company: the profile follows, the person works there', async () => {
      const P = u('Move1');
      await provision(ADMIN, 'org_admin', ORG, P, 'finance');
      await appUpdateMember(OWNER, 'super_admin', undefined, mid(P), { orgId: THIRD });
      const s = await appSignIn(P, false);
      expect({ refused: s.refused, orgId: s.orgId, opens: await canOpen(P, THIRD, false) }).toEqual({ refused: [], orgId: THIRD, opens: true });
    });

    it('[LOGIN-6] owner moves the SECOND membership of a two-company member to a third company (edit form "company"): the person gets nothing there, and can no longer be added back to the old company', async () => {
      const P = u('Move2');
      await provision(ADMIN, 'org_admin', ORG, P, 'employee');
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: P.uid, userName: 'Move2', userEmail: P.email, role: 'finance', department: 'D', jobTitle: 'J', active: true } as any, [OTHER], key());
      await appSignIn(P, true); // a verified login (records verifiedEmail): the owner's later re-add re-uses its UID
      await appUpdateMember(OWNER, 'super_admin', undefined, mid(P, OTHER), { orgId: THIRD });
      const moved = await read('members', mid(P, OTHER));
      const s = await appSignIn(P, false);
      const backToOther = await appAddMemberToOrgs(OWNER, 'super_admin', undefined, P, 'finance', [OTHER]);
      const observed = {
        movedDoc: { id: mid(P, OTHER), orgId: moved?.orgId, role: moved?.role },
        opensThird: await canOpen(P, THIRD, false),
        readsThirdTreasury: await allows(getDoc(doc(db(P, false), 'paymentAccounts', `acc-${THIRD}`))),
        app: { orgId: s.orgId, refused: s.refused },
        reAddToOther: backToOther,
        denial: await denial(getDoc(doc(db(P, false), 'paymentAccounts', `acc-${THIRD}`))),
      };
      console.log('[LOGIN-6] observed', JSON.stringify(observed));
      expect(observed.opensThird).toBe(true);
      expect(observed.readsThirdTreasury).toBe(true);
      expect(backToOther.added).toEqual([OTHER]);
    });
  });
});

describe('round r5: login lane ([R5-L-1..6] legacy original-app profiles, internal login addresses, company moves, re-adds, the company switcher)', () => {
  // Every flow runs through the REAL domain code and the AppContext identity effects as the round-5
  // fix ships them (linkedProfileIds also finds a placeholder's profiles by address in its company,
  // addMemberToOrgs leaves an invitation already re-pointed to the login to the platform owner,
  // companySwitchChoices, the owner's orphan clean-up). [R5-L-n] tests assert the correct outcome.
  const ORG = 'org-acme';
  const OTHER = 'org-other';
  const THIRD = 'org-third';

  type U = { uid: string; email: string };
  const OWNER: U = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
  const ADMIN: U = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
  const OADMIN: U = { uid: 'uidCairoAdmin000000000001', email: 'admin@other.test' };
  const TADMIN: U = { uid: 'uidThirdAdmin000000000001', email: 'admin@third.test' };
  const u = (tag: string): U => ({ uid: `uidR4${tag}`.padEnd(28, '0'), email: `${tag.toLowerCase()}@people.test` });

  const db = (x: U, verified = true): Firestore =>
    env.authenticatedContext(x.uid, { email: x.email, email_verified: verified }).firestore() as unknown as Firestore;
  const store = (x: U, verified = true) => createFirestoreStore(db(x, verified));
  const actor = (x: U, role: Actor['role'], orgId?: string): Actor => ({ id: x.uid, name: x.email, email: x.email, role, ...(orgId ? { orgId } : {}) });
  let n = 0;
  const key = () => `key-r5l${String(++n).padStart(7, '0')}`;
  const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));
  const read = async (c: string, id: string) => {
    let data: Record<string, any> | undefined;
    await env.withSecurityRulesDisabled(async ctx => {
      data = (await getDoc(doc(ctx.firestore(), c, id))).data();
    });
    return data;
  };
  const mid = (x: U, org = ORG) => `${x.uid}_${org}`;
  const allows = async (p: Promise<unknown>) => p.then(() => true, () => false);
  const canOpen = (x: U, org: string, verified = true) => allows(getDoc(doc(db(x, verified), 'organizations', org)));
  const denial = (p: Promise<unknown>) => p.then(() => 'allowed', (e: any) => `${e?.code || ''} ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 260)}`);
  const errText = (e: any) => `${e?.code || ''} ${String(e?.message || e).slice(0, 220)}`;

  // ---- AppContext.buildMembershipQueries (+ the fallback when the OR query is rejected) and, for an
  // unverified account, profileCompanyQuery (the records of its email in its profile's company) ----
  const appMemberships = async (x: U, verified: boolean, profile: Record<string, any> | null = null): Promise<OrganizationMember[]> => {
    const f = db(x, verified);
    const members = collection(f, 'members');
    const email = verified ? x.email : '';
    const toMembers = (docs: Array<{ id: string; data: () => any }>) => docs.map(d => ({ ...d.data(), id: d.id } as OrganizationMember));
    const unique = (all: OrganizationMember[]) => Array.from(new Map(all.map(m => [m.id, m])).values());
    let found: OrganizationMember[];
    try {
      const combined = email ? query(members, or(where('userId', '==', x.uid), where('userEmail', '==', email))) : query(members, where('userId', '==', x.uid));
      found = toMembers((await getDocs(combined)).docs);
    } catch {
      const qs = [query(members, where('userId', '==', x.uid)), ...(email ? [query(members, where('userEmail', '==', email))] : [])];
      const res = await Promise.allSettled(qs.map(q => getDocs(q)));
      found = unique(res.flatMap(r => (r.status === 'fulfilled' ? toMembers(r.value.docs) : [])));
    }
    const orgId = typeof profile?.orgId === 'string' ? profile.orgId.trim() : '';
    if (!verified && orgId) {
      try {
        found = unique([...found, ...toMembers((await getDocs(query(members, where('orgId', '==', orgId), where('userEmail', '==', normalizeEmail(x.email))))).docs)]);
      } catch { /* not readable (e.g. a suspended profile) */ }
    }
    return found;
  };

  // ---- AppContext.linkOwnProfile (verbatim shape) ----
  const linkOwnProfile = (f: Firestore, x: U, verified: boolean, m: OrganizationMember) =>
    setDoc(doc(f, 'users', x.uid), JSON.parse(JSON.stringify({
      id: x.uid,
      ...(verified ? { email: normalizeEmail(x.email) } : {}),
      name: m.userName || 'موظف',
      role: m.role,
      orgId: m.orgId,
      memberId: m.id,
      department: m.department || '',
      phone: m.phone || '',
      active: true,
      updatedAt: new Date().toISOString(),
    })), { merge: true });

  const ROLE_PRIORITY: Record<string, number> = { super_admin: 5, org_admin: 4, finance: 3, data_entry: 2, employee: 1 };

  /**
   * One sign-in as the app runs it (AppContext identity effects), repeated until stable:
   * read users/{uid}, load memberships, profileMembershipState, relink (linkOwnProfile) when asked,
   * verifiedEmail merge when the token is verified. Returns what the UI then resolves.
   */
  const appSignIn = async (x: U, verified: boolean) => {
    const f = db(x, verified);
    const refused: string[] = [];
    const tried = new Set<string>();
    let profile: any = null;
    let memberships: OrganizationMember[] = [];
    let state = profileMembershipState(null, [], { uid: x.uid, email: x.email, emailVerified: verified });
    for (let i = 0; i < 4; i++) {
      const snap = await getDoc(doc(f, 'users', x.uid));
      profile = snap.exists() ? snap.data() : null;
      memberships = await appMemberships(x, verified, profile);
      state = profileMembershipState(profile, memberships, { uid: x.uid, email: x.email, emailVerified: verified });
      let wrote = false;
      const target = state.relinkTo;
      if (target) {
        const attempt = [target.id, target.orgId, target.role, target.userName].join('|');
        if (!tried.has(attempt)) {
          tried.add(attempt);
          try { await linkOwnProfile(f, x, verified, target); wrote = true; } catch (e) { refused.push(`relink ${target.id}: ${errText(e)}`); }
        }
      }
      if (verified && profile && normalizeEmail(profile.verifiedEmail) !== normalizeEmail(x.email) && !tried.has('verifiedEmail')) {
        tried.add('verifiedEmail');
        try { await setDoc(doc(f, 'users', x.uid), { verifiedEmail: normalizeEmail(x.email) }, { merge: true }); wrote = true; } catch (e) { refused.push(`verifiedEmail: ${errText(e)}`); }
      }
      if (!wrote) break;
    }
    // AppContext RBAC resolution
    const trusted = state.current ? profile : null;
    const matching = memberships.filter(m => m.userId === x.uid || normalizeEmail(m.userEmail) === normalizeEmail(x.email));
    const withOrg = matching.filter(m => Boolean(m.orgId && m.orgId.trim()));
    const pool = withOrg.length > 0 ? withOrg : matching;
    const userMemberRecord = [...pool].sort((a, b) => (ROLE_PRIORITY[b.role] || 0) - (ROLE_PRIORITY[a.role] || 0))[0];
    const role: Role = trusted?.role && trusted.role !== 'super_admin' ? trusted.role : userMemberRecord && userMemberRecord.role !== 'super_admin' ? userMemberRecord.role : 'employee';
    const orgId: string = trusted?.orgId || userMemberRecord?.orgId || '';
    const suspended = trusted?.orgId ? trusted.active === false : memberships.length > 0 && memberships.every(m => m.active === false);
    return { state, profile, memberships, refused, orgId, role, suspended, verifyPrompt: state.awaitingVerification };
  };

  // ---- AppContext.linkedProfileIds / updateMember / removeMember (verbatim logic) ----
  const linkedProfileIds = async (f: Firestore, mem: OrganizationMember | undefined): Promise<string[]> => {
    if (!mem) return [];
    const ids = new Set<string>();
    if (isRealUid(mem.userId)) {
      try { await getDoc(doc(f, 'users', mem.userId)); ids.add(mem.userId); } catch { /* not ours */ }
    }
    try {
      const snap = await getDocs(query(collection(f, 'users'), where('orgId', '==', mem.orgId), where('memberId', '==', mem.id)));
      snap.docs.forEach(d => ids.add(d.id));
    } catch { /* skipped */ }
    const email = normalizeEmail(mem.userEmail);
    if (!isRealUid(mem.userId) && email) {
      try {
        const snap = await getDocs(query(collection(f, 'users'), where('orgId', '==', mem.orgId), where('email', '==', email)));
        snap.docs.forEach(d => ids.add(d.id));
      } catch { /* skipped */ }
    }
    return Array.from(ids);
  };
  const memberAs = async (f: Firestore, id: string) => ({ id, ...(await getDoc(doc(f, 'members', id))).data() } as OrganizationMember);
  const appUpdateMember = async (who: U, role: Actor['role'], orgId: string | undefined, memberId: string, updates: Partial<OrganizationMember>, verified = true) => {
    const f = db(who, verified);
    const mem = await memberAs(f, memberId);
    return updateMemberRecord(store(who, verified), actor(who, role, orgId), memberId, updates, await linkedProfileIds(f, mem), key());
  };
  const orgMembers = async (f: Firestore, orgId?: string) =>
    (await getDocs(orgId ? query(collection(f, 'members'), where('orgId', '==', orgId)) : collection(f, 'members'))).docs.map(d => ({ id: d.id, ...d.data() } as OrganizationMember & { operationKey?: string }));
  const appRemoveMember = async (who: U, role: Actor['role'], orgId: string | undefined, memberId: string) => {
    const f = db(who);
    const mem = await memberAs(f, memberId);
    const all = await orgMembers(f, role === 'super_admin' ? undefined : orgId);
    const email = normalizeEmail(mem.userEmail);
    const samePerson = email ? all.filter(m => m.id !== memberId && isRealUid(m.userId) && normalizeEmail(m.userEmail) === email) : [];
    const ids = new Set(await linkedProfileIds(f, mem));
    for (const other of samePerson) (await linkedProfileIds(f, other)).forEach(id => ids.add(id));
    return removeMember(store(who), actor(who, role, orgId), memberId, Array.from(ids), key());
  };
  // AppContext.knownUidForEmail: rawMembers = what the caller's member listener shows (owner: all; org admin: its company);
  // the platform owner also finds a login by its proof (users where verifiedEmail == email)
  const knownUidForEmail = async (who: U, role: Actor['role'], orgId: string | undefined, email: string) => {
    const f = db(who);
    const raw = await orgMembers(f, role === 'super_admin' ? undefined : orgId);
    const findProvenLogins = role === 'super_admin'
      ? async (target: string) => {
          const snap = await getDocs(query(collection(f, 'users'), where('verifiedEmail', '==', target), limit(2)));
          return snap.docs.length === 1 ? [snap.docs[0].id] : [];
        }
      : undefined;
    return verifiedLoginUidOf(raw, email, async uid => {
      const s = await getDoc(doc(f, 'users', uid));
      return s.exists() ? String(s.data()?.verifiedEmail || '') : null;
    }, findProvenLogins);
  };
  // AppContext.addMemberToOrgs (pre-skip of companies already holding the email, then createMemberInOrgs)
  const appAddMemberToOrgs = async (who: U, role: Actor['role'], orgId: string | undefined, x: U, memberRole: Role, targets: string[], name = 'Person') => {
    const f = db(who);
    const raw = await orgMembers(f, role === 'super_admin' ? undefined : orgId);
    const email = normalizeEmail(x.email);
    const knownUid = await knownUidForEmail(who, role, orgId, email);
    const replaceable = (m: OrganizationMember) =>
      Boolean(knownUid) && m.id === `${pendingUserIdForEmail(email)}_${m.orgId}` && (!isRealUid(m.userId) || (role === 'super_admin' && m.userId === knownUid));
    const free = targets.filter(t => {
      const holder = raw.find(m => m.orgId === t && normalizeEmail(m.userEmail) === email);
      return !holder || replaceable(holder);
    });
    if (free.length === 0) return { knownUid, added: [] as string[], skipped: [] as string[], error: 'duplicate (pre-skip: already registered)' };
    try {
      const res = await createMemberInOrgs(store(who), actor(who, role, orgId),
        { userId: knownUid || '', userName: name, userEmail: email, role: memberRole, department: 'D', jobTitle: 'J', phone: '', active: true } as any, free, key());
      return { knownUid, added: res.value.created.map(m => m.orgId), skipped: res.value.skipped.map(s => s.orgId), error: '' };
    } catch (e: any) {
      return { knownUid, added: [] as string[], skipped: [] as string[], error: isDomainError(e) ? `${e.code}` : errText(e) };
    }
  };
  // AppContext.createCompanyUser (the login exists already for `x`): createMember(..., { writeUserProfile: true })
  const provision = (who: U, role: Actor['role'], orgId: string, x: U, memberRole: Role, name = 'Person') =>
    createMember(store(who), actor(who, role, role === 'super_admin' ? undefined : orgId), {
      orgId, userId: x.uid, userName: name, userEmail: x.email, role: memberRole, department: 'D', jobTitle: 'J', phone: '', active: true,
    } as any, key(), { writeUserProfile: true });
  // AppContext.addMember (by email, no login proven -> pending invitation)
  const inviteByEmail = async (who: U, role: Actor['role'], orgId: string, x: U, memberRole: Role, name = 'Invitee') => {
    const knownUid = await knownUidForEmail(who, role, orgId, x.email);
    return createMember(store(who), actor(who, role, role === 'super_admin' ? undefined : orgId), {
      orgId, userId: knownUid || '', userName: name, userEmail: x.email, role: memberRole, department: 'D', jobTitle: 'J', phone: '', active: true,
    } as any, key());
  };

  const putMember = (f: Firestore, id: string, data: Record<string, unknown>) => setDoc(doc(f, 'members', id), { userName: 'x', active: true, ...data });
  const putKey = (f: Firestore, org: string, email: string, memberId: string) =>
    setDoc(doc(f, 'uniqueKeys', uniqueKeyDocId('member_email', org, email)), { scope: 'member_email', orgId: org, value: normalizeKeyValue(email, 'member_email'), entityCollection: 'members', entityId: memberId });


  beforeEach(async () => {
    await env.clearFirestore();
    await seed(async f => {
      for (const [org, name, admin] of [[ORG, 'Acme', ADMIN], [OTHER, 'Other', OADMIN], [THIRD, 'Third', TADMIN]] as const) {
        await setDoc(doc(f, 'organizations', org), { id: org, name, code: name.toUpperCase(), currency: 'EGP', notificationRecipients: [admin.email] });
        await setDoc(doc(f, 'users', admin.uid), { orgId: org, role: 'org_admin', active: true, email: admin.email, memberId: mid(admin, org), name: admin.email });
        await putMember(f, mid(admin, org), { orgId: org, userId: admin.uid, userEmail: admin.email, role: 'org_admin', userName: `Admin ${name}` });
        await putKey(f, org, admin.email, mid(admin, org));
        await setDoc(doc(f, 'paymentAccounts', `acc-${org}`), { orgId: org, name: 'cash', type: 'cash', currency: 'EGP', active: true, balance: 100, currentBalance: 100 });
      }
    });
  });

  // =============================================================================
  // r5 helpers
  // =============================================================================
  type Access = { org: boolean; members: boolean; treasury: boolean; audit: boolean };
  /** What the rules let x read in `org` (the collections the app subscribes to for each role). */
  const access = async (x: U, org: string, verified = true): Promise<Access> => {
    const f = db(x, verified);
    return {
      org: await allows(getDoc(doc(f, 'organizations', org))),
      members: await allows(getDocs(query(collection(f, 'members'), where('orgId', '==', org)))),
      treasury: await allows(getDocs(query(collection(f, 'paymentAccounts'), where('orgId', '==', org)))),
      audit: await allows(getDocs(query(collection(f, 'auditLogs'), where('orgId', '==', org)))),
    };
  };
  const roleAccess = (role: Role | 'none'): Access => role === 'none'
    ? { org: false, members: false, treasury: false, audit: false }
    : { org: true, members: true, treasury: role === 'finance' || role === 'org_admin', audit: role === 'org_admin' };

  /** AppContext.handleUpdateUserProfileInfo: own profile save + membership copy (syncOwnMembership). */
  const appProfileSave = async (x: U, verified: boolean, s: Awaited<ReturnType<typeof appSignIn>>, name: string) => {
    const refused: string[] = [];
    const f = db(x, verified);
    try {
      await setDoc(doc(f, 'users', x.uid), { uid: x.uid, name, phone: '0100', instapay: `${x.uid}@ip`, updatedAt: new Date().toISOString() }, { merge: true });
    } catch (e) { refused.push(`profile: ${errText(e)}`); }
    const matching = s.memberships.filter(m => m.userId === x.uid || normalizeEmail(m.userEmail) === normalizeEmail(x.email));
    const withOrg = matching.filter(m => Boolean(m.orgId && m.orgId.trim()));
    const pool = withOrg.length > 0 ? withOrg : matching;
    const userMemberRecord = [...pool].sort((a, b) => (ROLE_PRIORITY[b.role] || 0) - (ROLE_PRIORITY[a.role] || 0))[0];
    for (const m of s.memberships.filter(mm => mm.userId === x.uid)) {
      if (m.id !== userMemberRecord?.id) continue;
      try { await syncOwnMembership(store(x, verified), actor(x, s.role, s.orgId), m.id, { userName: name, phone: '0100' }); } catch (e) { refused.push(`membership ${m.id}: ${errText(e)}`); }
    }
    return refused;
  };

  /** AppContext.companyChoices (companySwitchChoices, shown when > 1) + switchOwnCompany (linkOwnProfile, relinkable ones). */
  const appChoices = (x: U, verified: boolean, s: Awaited<ReturnType<typeof appSignIn>>) => {
    const c = companySwitchChoices(s.memberships, { uid: x.uid, email: x.email, emailVerified: verified }, s.profile);
    return c.length > 1 ? c : [];
  };
  const appSwitch = async (x: U, verified: boolean, orgId: string) => {
    const s = await appSignIn(x, verified);
    const target = appChoices(x, verified, s).find(m => m.orgId === orgId && m.relinkable);
    if (!target) return { ok: false, why: `not offered (choices: ${appChoices(x, verified, s).map(m => m.orgId).join(',') || 'none'})` };
    try { await linkOwnProfile(db(x, verified), x, verified, target); } catch (e) { return { ok: false, why: `refused: ${errText(e)}` }; }
    const after = await appSignIn(x, verified);
    return { ok: after.orgId === orgId && after.refused.length === 0, why: '', orgId: after.orgId, role: after.role, refused: after.refused };
  };

  // =============================================================================
  describe('every role, provisioned (createCompanyUser shape) by its org admin and by the owner', () => {
    for (const by of ['org_admin', 'super_admin'] as const) {
      for (const role of ['org_admin', 'finance', 'data_entry', 'employee'] as const) {
        it(`${role} provisioned by ${by}: unverified then verified sign-in, access by role, own profile save accepted`, async () => {
          const P = u(`Rl${role.slice(0, 3)}${by.slice(0, 2)}`);
          await provision(by === 'org_admin' ? ADMIN : OWNER, by, ORG, P, role, `P ${role}`);
          for (const verified of [false, true]) {
            const s = await appSignIn(P, verified);
            expect({ verified, refused: s.refused, orgId: s.orgId, role: s.role, current: s.state.current, suspended: s.suspended })
              .toEqual({ verified, refused: [], orgId: ORG, role, current: true, suspended: false });
            expect(await access(P, ORG, verified)).toEqual(roleAccess(role));
            expect(await access(P, OTHER, verified)).toEqual(roleAccess('none'));
            expect(await appProfileSave(P, verified, s, `P ${role} ${verified}`)).toEqual([]);
            const again = await appSignIn(P, verified);
            expect({ refused: again.refused, orgId: again.orgId, role: again.role }).toEqual({ refused: [], orgId: ORG, role });
          }
          expect((await read('users', P.uid))?.verifiedEmail).toBe(P.email);
        });
      }
    }

    it('the platform owner (verified) reads every company; an org admin provisioned by the owner works as admin right away (unverified)', async () => {
      for (const org of [ORG, OTHER, THIRD]) expect(await access(OWNER, org, true)).toEqual(roleAccess('org_admin'));
      const A = u('NewAdm');
      await provision(OWNER, 'super_admin', OTHER, A, 'org_admin');
      expect((await appSignIn(A, false)).orgId).toBe(OTHER);
      const P = u('NewAdmP');
      await assertSucceeds(provision(A, 'org_admin', OTHER, P, 'finance'));
      await appUpdateMember(A, 'org_admin', OTHER, mid(P, OTHER), { role: 'data_entry' }, false);
      expect((await appSignIn(P, false)).role).toBe('data_entry');
    });
  });

  // =============================================================================
  describe('admin-provisioned accounts with a company.local placeholder email (never verifiable)', () => {
    it('[R5-L-1] a company.local account removed by its admin: re-adding the address by email (admin, owner, single add) is refused with "create a new login" instead of a dead invitation; the new login works', async () => {
      const M: U = { uid: 'uidR5CompanyLocal000000001', email: 'emp_1a2b3c4d@company.local' };
      await provision(ADMIN, 'org_admin', ORG, M, 'finance', 'Marwa Local');
      const first = await appSignIn(M, false);
      expect({ orgId: first.orgId, role: first.role }).toEqual({ orgId: ORG, role: 'finance' });
      await appRemoveMember(ADMIN, 'org_admin', ORG, mid(M));
      const byAdmin = await appAddMemberToOrgs(ADMIN, 'org_admin', ORG, M, 'finance', [ORG], 'Marwa Local');
      const byOwner = await appAddMemberToOrgs(OWNER, 'super_admin', undefined, M, 'finance', [ORG], 'Marwa Local');
      let single = 'added';
      try { await inviteByEmail(ADMIN, 'org_admin', ORG, M, 'finance', 'Marwa Local'); } catch (e: any) { single = isDomainError(e) ? e.code : errText(e); }
      const observed = {
        byAdmin: byAdmin.error, byOwner: byOwner.error, single,
        invitation: (await read('members', `${pendingUserIdForEmail(M.email)}_${ORG}`)) ? 'pending-<b64>_org-acme' : 'none',
      };
      console.log('[R5-L-1] observed', JSON.stringify(observed));
      expect(observed).toEqual({ byAdmin: 'internal_email', byOwner: 'internal_email', single: 'internal_email', invitation: 'none' });
      // the remedy the message names: a new login (createCompanyUser without an email)
      const M2: U = { uid: 'uidR5CompanyLocal000000003', email: 'emp_5e6f7a8b@company.local' };
      await provision(ADMIN, 'org_admin', ORG, M2, 'finance', 'Marwa Local');
      expect(await appSignIn(M2, false)).toMatchObject({ refused: [], orgId: ORG, role: 'finance', verifyPrompt: false });
      expect(await access(M2, ORG, false)).toEqual(roleAccess('finance'));
      // an ordinary address is still invited by email
      expect((await inviteByEmail(ADMIN, 'org_admin', ORG, u('NotLocal'), 'employee')).value.userId).toMatch(/^pending-/);
    });

    it('a company.local account added to a second company by the owner with its UID (OrganizationsManagement new-user form: createCompanyUser + addMemberToOrgs with res.uid) opens both', async () => {
      const M: U = { uid: 'uidR5CompanyLocal000000002', email: 'emp_9f8e7d6c@company.local' };
      await provision(OWNER, 'super_admin', ORG, M, 'employee');
      const more = await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: M.uid, userName: 'M', userEmail: M.email, role: 'finance', department: 'D', jobTitle: 'J', active: true } as any, [OTHER], key());
      expect(more.value.created.map(m => m.id)).toEqual([mid(M, OTHER)]);
      const s = await appSignIn(M, false);
      expect({ refused: s.refused, orgId: s.orgId }).toEqual({ refused: [], orgId: ORG });
      expect(await access(M, OTHER, false)).toEqual(roleAccess('finance'));
      expect(await appSwitch(M, false, OTHER)).toMatchObject({ ok: true, role: 'finance' });
      expect(await appSwitch(M, false, ORG)).toMatchObject({ ok: true, role: 'employee' });
    });
  });

  // =============================================================================
  describe('Google (verified) invited by email to 1 and to 3 companies; the new company switcher', () => {
    it('invited by three admins before the first sign-in: linked to the highest role, the switcher offers all three, every switch is accepted and gives exactly that company and role', async () => {
      const G = u('G3co');
      await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'employee', 'G');
      await inviteByEmail(OADMIN, 'org_admin', OTHER, G, 'finance', 'G');
      await inviteByEmail(TADMIN, 'org_admin', THIRD, G, 'data_entry', 'G');
      const s = await appSignIn(G, true);
      expect({ refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ refused: [], orgId: OTHER, role: 'finance' });
      expect(appChoices(G, true, s).map(m => [m.orgId, m.role, m.relinkable])).toEqual([[OTHER, 'finance', true], [THIRD, 'data_entry', true], [ORG, 'employee', true]]);
      for (const [org, role] of [[ORG, 'employee'], [THIRD, 'data_entry'], [OTHER, 'finance'], [ORG, 'employee']] as const) {
        const r = await appSwitch(G, true, org);
        expect({ org, ...r }).toMatchObject({ org, ok: true, role });
        expect(await access(G, org, true)).toEqual(roleAccess(role));
        expect(await appProfileSave(G, true, await appSignIn(G, true), 'G saved')).toEqual([]);
      }
    });

    it('[R5-L-2] (switcher company names) the switcher reads the names of the companies a Google invitee was invited to by email before switching there (organizations get: invitedTo)', async () => {
      const G = u('GName');
      await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'finance', 'G');
      await inviteByEmail(OADMIN, 'org_admin', OTHER, G, 'employee', 'G');
      const s = await appSignIn(G, true);
      const names: Record<string, string> = {};
      // AppContext: getDoc(organizations/<id>) for every choice, falls back to the raw id on error
      for (const m of appChoices(G, true, s)) {
        names[m.orgId] = await getDoc(doc(db(G), 'organizations', m.orgId)).then(snap => String(snap.data()?.name || m.orgId), () => m.orgId);
      }
      console.log('[R5-L-2] observed', JSON.stringify({ linkedTo: s.orgId, names, denial: await denial(getDoc(doc(db(G), 'organizations', OTHER))) }));
      expect(names).toEqual({ [ORG]: 'Acme', [OTHER]: 'Other' });
    });

    it('[R5-L-2] (refused) a company stays unreadable without an active invitation addressed to the caller: a stranger, a suspended invitation, an unverified token on an invitation not yet re-pointed, a missing company', async () => {
      const G = u('GNameNo');
      const inv = await inviteByEmail(OADMIN, 'org_admin', OTHER, G, 'employee', 'G');
      expect(await canOpen(G, OTHER)).toBe(true);
      expect(await canOpen(G, OTHER, false)).toBe(false);
      expect(await canOpen(u('GStranger'), OTHER)).toBe(false);
      expect(await canOpen(G, 'org-missing')).toBe(false);
      expect(await canOpen(G, THIRD)).toBe(false);
      await appUpdateMember(OADMIN, 'org_admin', OTHER, inv.value.id, { active: false });
      expect(await canOpen(G, OTHER)).toBe(false);
    });

    it('admins edit the invitee (rename -> re-point) while its profile is in another company; the invitee keeps switching', async () => {
      const G = u('GEdit');
      const a = await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'finance', 'G');
      const b = await inviteByEmail(OADMIN, 'org_admin', OTHER, G, 'employee', 'G');
      await appSignIn(G, true); // ORG (finance)
      await appUpdateMember(ADMIN, 'org_admin', ORG, a.value.id, { userName: 'G renamed' });
      expect((await read('members', a.value.id))?.userId).toBe(G.uid);
      await appUpdateMember(OADMIN, 'org_admin', OTHER, b.value.id, { userName: 'G other', role: 'data_entry' });
      expect((await read('members', b.value.id))?.userId).toBe(pendingUserIdForEmail(G.email)); // not linked there yet
      expect(await appSwitch(G, true, OTHER)).toMatchObject({ ok: true, role: 'data_entry' });
      await appUpdateMember(OADMIN, 'org_admin', OTHER, b.value.id, { jobTitle: 'x' });
      expect((await read('members', b.value.id))?.userId).toBe(G.uid);
      expect(await appSwitch(G, true, ORG)).toMatchObject({ ok: true, role: 'finance' });
      expect(await access(G, ORG, true)).toEqual(roleAccess('finance'));
    });
  });

  // =============================================================================
  describe('multi-company members switching companies back and forth', () => {
    it('org admin in ORG, employee in OTHER, finance in THIRD (unverified, same UID): every switch accepted; suspension / removal take the company out of the switcher', async () => {
      const P = u('Sw1');
      await provision(ADMIN, 'org_admin', ORG, P, 'org_admin', 'Sw');
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: P.uid, userName: 'Sw', userEmail: P.email, role: 'employee', department: 'D', jobTitle: 'J', active: true } as any, [OTHER], key());
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: P.uid, userName: 'Sw', userEmail: P.email, role: 'finance', department: 'D', jobTitle: 'J', active: true } as any, [THIRD], key());
      const s = await appSignIn(P, false);
      expect({ orgId: s.orgId, role: s.role }).toEqual({ orgId: ORG, role: 'org_admin' });
      expect(appChoices(P, false, s).map(m => [m.orgId, m.role])).toEqual([[ORG, 'org_admin'], [THIRD, 'finance'], [OTHER, 'employee']]);
      for (const [org, role] of [[OTHER, 'employee'], [THIRD, 'finance'], [ORG, 'org_admin'], [OTHER, 'employee']] as const) {
        expect({ org, ...(await appSwitch(P, false, org)) }).toMatchObject({ org, ok: true, role });
        // the rules keep every membership's own role (members/<uid>_<org>) whatever the profile says
        expect(await access(P, ORG, false)).toEqual(roleAccess('org_admin'));
        expect(await access(P, THIRD, false)).toEqual(roleAccess('finance'));
        expect(await access(P, OTHER, false)).toEqual(roleAccess('employee'));
      }
      // profile in OTHER: its admin suspends P -> next sign-in relinks to the best remaining company
      await appUpdateMember(OADMIN, 'org_admin', OTHER, mid(P, OTHER), { active: false });
      const after = await appSignIn(P, false);
      expect({ refused: after.refused, orgId: after.orgId, role: after.role, suspended: after.suspended }).toEqual({ refused: [], orgId: ORG, role: 'org_admin', suspended: false });
      expect(appChoices(P, false, after).map(m => m.orgId)).toEqual([ORG, THIRD]);
      // THIRD's admin removes P (profile elsewhere)
      await appRemoveMember(TADMIN, 'org_admin', THIRD, mid(P, THIRD));
      const after2 = await appSignIn(P, false);
      expect(appChoices(P, false, after2)).toEqual([]);
      expect({ refused: after2.refused, orgId: after2.orgId }).toEqual({ refused: [], orgId: ORG });
      // OTHER re-activates: back in the switcher, switch accepted
      await appUpdateMember(OADMIN, 'org_admin', OTHER, mid(P, OTHER), { active: true });
      expect(await appSwitch(P, false, OTHER)).toMatchObject({ ok: true, role: 'employee' });
      expect(await appSwitch(P, false, ORG)).toMatchObject({ ok: true, role: 'org_admin' });
    });

    it('org admin of A who is an employee of B (profile in B): stays in B, switches to A and works there as admin (provision, edit, suspend, re-activate, remove), then back to B', async () => {
      const MA = u('AdmEmp');
      await provision(OADMIN, 'org_admin', OTHER, MA, 'employee', 'MA');
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: MA.uid, userName: 'MA', userEmail: MA.email, role: 'org_admin', department: 'D', jobTitle: 'J', active: true } as any, [ORG], key());
      for (const verified of [false, true]) {
        const s = await appSignIn(MA, verified);
        expect({ verified, refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ verified, refused: [], orgId: OTHER, role: 'employee' });
        expect(appChoices(MA, verified, s).map(m => [m.orgId, m.role])).toEqual([[ORG, 'org_admin'], [OTHER, 'employee']]);
        expect(await appSwitch(MA, verified, ORG)).toMatchObject({ ok: true, role: 'org_admin' });
        const P = u(`AdmEmpP${verified ? 'v' : 'u'}`);
        await provision(MA, 'org_admin', ORG, P, 'employee');
        await appUpdateMember(MA, 'org_admin', ORG, mid(P), { role: 'finance', userName: 'P2' }, verified);
        await appUpdateMember(MA, 'org_admin', ORG, mid(P), { active: false }, verified);
        expect(await canOpen(P, ORG, false)).toBe(false);
        await appUpdateMember(MA, 'org_admin', ORG, mid(P), { active: true }, verified);
        expect((await appSignIn(P, false))).toMatchObject({ refused: [], orgId: ORG, role: 'finance' });
        await appRemoveMember(MA, 'org_admin', ORG, mid(P));
        expect(await canOpen(P, ORG, false)).toBe(false);
        expect(await appSwitch(MA, verified, OTHER)).toMatchObject({ ok: true, role: 'employee' });
      }
    });

    it('[R5-L-3] an UNVERIFIED account whose (legacy) profile is linked to a placeholder record in A and that also has a UID membership in B gets a switcher (A current and not re-linkable, B): B (its other role) is reachable, A again once verified', async () => {
      const L = u('LegSw');
      const id = `usr_1690000000123_${ORG}`;
      await seed(async f => {
        await setDoc(doc(f, 'users', L.uid), { orgId: ORG, role: 'employee', active: true, email: L.email, name: 'Leg', memberId: id });
        await putMember(f, id, { orgId: ORG, userId: 'usr_1690000000123', userEmail: L.email, role: 'employee', userName: 'Leg' });
      });
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: L.uid, userName: 'Leg', userEmail: L.email, role: 'finance', department: 'D', jobTitle: 'J', active: true } as any, [OTHER], key());
      const s = await appSignIn(L, false);
      const observed = {
        app: { orgId: s.orgId, role: s.role, current: s.state.current, relinkTo: s.state.relinkTo?.id || null },
        switcher: appChoices(L, false, s).map(m => [m.orgId, m.role, m.relinkable]),
        switchable: switchableMemberships(s.memberships, { uid: L.uid, email: L.email, emailVerified: false }).map(m => [m.orgId, m.role]),
        rulesGrantOtherFinance: (await access(L, OTHER, false)).treasury,
        rulesGrantOrg: (await access(L, ORG, false)).org,
      };
      console.log('[R5-L-3] observed', JSON.stringify(observed));
      expect(observed.app.orgId).toBe(ORG);
      expect(observed.rulesGrantOtherFinance).toBe(true);
      // the member of two companies reaches both: the switcher lists ORG (current, not re-linkable) and OTHER
      expect(observed.switcher).toEqual([[ORG, 'employee', false], [OTHER, 'finance', true]]);
      expect(await appSwitch(L, false, OTHER)).toMatchObject({ ok: true, orgId: OTHER, role: 'finance' });
      expect(await access(L, OTHER, false)).toEqual(roleAccess('finance'));
      // back to ORG only once the address is verified (the warning the switcher shows)
      expect(appChoices(L, false, await appSignIn(L, false))).toEqual([]);
      expect(await appSwitch(L, true, ORG)).toMatchObject({ ok: true, orgId: ORG, role: 'employee' });
    });
  });

  // =============================================================================
  describe('legacy data shapes (old app versions)', () => {
    it('legacy placeholder ids user-<ts> / usr_<ts> (an underscore in the userId) linked to an unverified password account: company kept, admin rename re-points, removal detaches', async () => {
      for (const [tag, legacyUid] of [['LgUser', 'user-1690000000777'], ['LgUsrU', 'usr_1690000000778']] as const) {
        const L = u(tag);
        const id = `${legacyUid}_${ORG}`;
        await seed(async f => {
          await setDoc(doc(f, 'users', L.uid), { orgId: ORG, role: 'finance', active: true, email: L.email, name: tag, memberId: id });
          await putMember(f, id, { orgId: ORG, userId: legacyUid, userEmail: L.email, role: 'finance', userName: tag });
        });
        const s = await appSignIn(L, false);
        expect({ tag, refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ tag, refused: [], orgId: ORG, role: 'finance' });
        expect(await access(L, ORG, false)).toEqual(roleAccess('finance'));
        await appUpdateMember(ADMIN, 'org_admin', ORG, id, { userName: `${tag} renamed`, role: 'data_entry' });
        expect(await read('members', id)).toMatchObject({ userId: L.uid, role: 'data_entry' });
        const s2 = await appSignIn(L, false);
        expect({ tag, refused: s2.refused, orgId: s2.orgId, role: s2.role }).toEqual({ tag, refused: [], orgId: ORG, role: 'data_entry' });
        await appRemoveMember(ADMIN, 'org_admin', ORG, id);
        expect(await canOpen(L, ORG, false)).toBe(false);
      }
    });

    it('[R5-L-6] original-app shape (profile WITHOUT memberId, linked by email to a usr_<ts> placeholder, unverified password account): the admin\'s suspension, demotion and removal reach the profile (found by address in the record\'s company); another company\'s profile with that address is untouched', async () => {
      const L = u('OrigLeg');
      const DECOY = u('OrigDecoy');
      const legacyUid = 'usr_1690000001000';
      const id = `${legacyUid}_${ORG}`;
      await seed(async f => {
        // forceRefreshUserState of the original app: users/{uid} {id, email, name, role, orgId, active} (no memberId)
        await setDoc(doc(f, 'users', L.uid), { id: L.uid, email: L.email, name: 'Orig', role: 'finance', orgId: ORG, department: '', phone: '', active: true });
        await putMember(f, id, { orgId: ORG, userId: legacyUid, userEmail: L.email, role: 'finance', userName: 'Orig' });
        await putKey(f, ORG, L.email, id);
        // another company's profile carrying the same address (written by its admin): never touched
        await setDoc(doc(f, 'users', DECOY.uid), { id: DECOY.uid, email: L.email, name: 'Decoy', role: 'employee', orgId: OTHER, active: true, memberId: mid(DECOY, OTHER) });
        await putMember(f, mid(DECOY, OTHER), { orgId: OTHER, userId: DECOY.uid, userEmail: DECOY.email, role: 'employee', userName: 'Decoy' });
      });
      const s = await appSignIn(L, false);
      expect({ refused: s.refused, orgId: s.orgId, role: s.role, current: s.state.current }).toEqual({ refused: [], orgId: ORG, role: 'finance', current: true });
      expect((await read('users', L.uid))?.memberId).toBeUndefined(); // an unverified account cannot self-link a placeholder
      await appUpdateMember(ADMIN, 'org_admin', ORG, id, { active: false });
      const whileSuspended = { app: (await appSignIn(L, false)).suspended, rules: await access(L, ORG, false) };
      await appUpdateMember(ADMIN, 'org_admin', ORG, id, { active: true, role: 'employee' });
      const afterDemotion = { app: (await appSignIn(L, false)).role, rules: await access(L, ORG, false) };
      await appRemoveMember(ADMIN, 'org_admin', ORG, id);
      const afterRemoval = { app: (await appSignIn(L, false)).orgId, rules: await access(L, ORG, false), profile: await read('users', L.uid) };
      const observed = { whileSuspended, afterDemotion, afterRemoval };
      console.log('[R5-L-6] observed', JSON.stringify(observed));
      expect(observed.whileSuspended).toEqual({ app: true, rules: roleAccess('none') });
      expect(observed.afterDemotion).toEqual({ app: 'employee', rules: roleAccess('employee') });
      expect({ app: observed.afterRemoval.app, rules: observed.afterRemoval.rules, orgId: observed.afterRemoval.profile?.orgId })
        .toEqual({ app: '', rules: roleAccess('none'), orgId: '' });
      expect(await read('users', DECOY.uid)).toMatchObject({ orgId: OTHER, role: 'employee', active: true, memberId: mid(DECOY, OTHER) });
    });

    it('[R5-L-6] (verified control) the same original-app shape signed in with a VERIFIED token self-links (memberId written), after which suspension and removal do reach it', async () => {
      const L = u('OrigLegV');
      const id = `usr_1690000001001_${ORG}`;
      await seed(async f => {
        await setDoc(doc(f, 'users', L.uid), { id: L.uid, email: L.email, name: 'Orig', role: 'finance', orgId: ORG, active: true });
        await putMember(f, id, { orgId: ORG, userId: 'usr_1690000001001', userEmail: L.email, role: 'finance', userName: 'Orig' });
        await putKey(f, ORG, L.email, id);
      });
      expect(await appSignIn(L, true)).toMatchObject({ refused: [], orgId: ORG, role: 'finance' });
      expect((await read('users', L.uid))?.memberId).toBe(id);
      await appUpdateMember(ADMIN, 'org_admin', ORG, id, { active: false });
      expect(await access(L, ORG, true)).toEqual(roleAccess('none'));
      await appUpdateMember(ADMIN, 'org_admin', ORG, id, { active: true });
      await appRemoveMember(ADMIN, 'org_admin', ORG, id);
      expect(await access(L, ORG, true)).toEqual(roleAccess('none'));
    });

    it('[R5-L-6] (orphan) an original-app profile whose placeholder record an older app deleted (no member list shows it) is detached by the owner\'s one-time clean-up; profiles backed by a record (UID, memberId, address) and the owner\'s own keep their company', async () => {
      const L = u('OrigOrph');
      const K = u('OrigKeep');
      const P = u('UidKeep');
      const S = u('SuspKeep');
      const keepId = `usr_1690000002000_${ORG}`;
      await seed(async f => {
        await setDoc(doc(f, 'users', L.uid), { id: L.uid, email: L.email, name: 'Orphan', role: 'finance', orgId: ORG, active: true });
        await setDoc(doc(f, 'users', K.uid), { id: K.uid, email: K.email, name: 'Keep', role: 'finance', orgId: ORG, active: true });
        await putMember(f, keepId, { orgId: ORG, userId: 'usr_1690000002000', userEmail: K.email, role: 'finance', userName: 'Keep' });
        await setDoc(doc(f, 'users', OWNER.uid), { id: OWNER.uid, email: OWNER.email, name: 'Owner', role: 'super_admin', orgId: ORG, active: true });
      });
      await provision(ADMIN, 'org_admin', ORG, P, 'employee');
      await provision(ADMIN, 'org_admin', ORG, S, 'finance');
      await appUpdateMember(ADMIN, 'org_admin', ORG, mid(S), { active: false });
      const s = await appSignIn(L, false);
      const listed = (await orgMembers(db(ADMIN), ORG)).some(m => normalizeEmail(m.userEmail) === L.email);
      expect({ app: { orgId: s.orgId, verifyPrompt: s.verifyPrompt }, listedToAdmin: listed, rules: await access(L, ORG, false) })
        .toEqual({ app: { orgId: '', verifyPrompt: true }, listedToAdmin: false, rules: roleAccess('finance') });
      // AppContext.migrateUniqueKeys (Settings, platform owner): every profile, every record -> orphanProfiles -> detachOrphanProfiles
      const appCleanUp = async () => {
        const f = db(OWNER);
        const profiles = (await getDocs(collection(f, 'users'))).docs.map(d => ({ ...d.data(), id: d.id }) as { id: string; orgId?: string });
        const orphans = orphanProfiles(profiles, await orgMembers(f));
        return { orphans: orphans.map(o => o.id), detached: orphans.length ? await detachOrphanProfiles(store(OWNER), actor(OWNER, 'super_admin'), orphans) : 0 };
      };
      const run = await appCleanUp();
      console.log('[R5-L-6 orphan] observed', JSON.stringify({ run, after: await access(L, ORG, false) }));
      expect(run).toEqual({ orphans: [L.uid], detached: 1 });
      expect(await access(L, ORG, false)).toEqual(roleAccess('none'));
      expect(await read('users', L.uid)).toMatchObject({ orgId: '', role: 'employee', memberId: null });
      // the rest keep exactly what they had
      expect(await access(K, ORG, false)).toEqual(roleAccess('finance'));
      expect(await appSignIn(P, false)).toMatchObject({ refused: [], orgId: ORG, role: 'employee' });
      expect(await access(S, ORG, false)).toEqual(roleAccess('none'));
      expect(await read('users', S.uid)).toMatchObject({ orgId: ORG, active: false });
      expect(await read('users', OWNER.uid)).toMatchObject({ orgId: ORG });
      for (const a of [ADMIN, OADMIN, TADMIN]) expect((await read('users', a.uid))?.orgId).not.toBe('');
      // idempotent; and nobody but the owner may run it
      expect(await appCleanUp()).toEqual({ orphans: [], detached: 0 });
      await expect(detachOrphanProfiles(store(ADMIN), actor(ADMIN, 'org_admin', ORG), [{ id: K.uid, orgId: ORG }])).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('stale memberId (record deleted and re-created under another id by an older app): relinked to the live record, its role, verified and unverified', async () => {
      for (const [tag, verified] of [['StU', false], ['StV', true]] as const) {
        const L = u(tag);
        await seed(async f => {
          await setDoc(doc(f, 'users', L.uid), { orgId: ORG, role: 'finance', active: true, email: L.email, name: 'old', memberId: `temp_1690000000999_${ORG}` });
          await putMember(f, mid(L), { orgId: ORG, userId: L.uid, userEmail: L.email, role: 'employee', userName: tag });
        });
        const s = await appSignIn(L, verified);
        expect({ tag, refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ tag, refused: [], orgId: ORG, role: 'employee' });
        expect(await read('users', L.uid)).toMatchObject({ role: 'employee', memberId: mid(L) });
        expect(await access(L, ORG, verified)).toEqual(roleAccess('employee'));
      }
    });
  });

  // =============================================================================
  describe('admin edits: email correction, suspension of an invitation holder, remove / re-add', () => {
    it('org admin corrects the email of a UID member (unverified password account): its profile is synced and it keeps its company', async () => {
      const P = u('EmFix');
      await provision(ADMIN, 'org_admin', ORG, P, 'finance');
      await appSignIn(P, false);
      await appUpdateMember(ADMIN, 'org_admin', ORG, mid(P), { userEmail: 'emfix.new@people.test', userName: 'Fixed' });
      expect(await read('members', mid(P))).toMatchObject({ userEmail: 'emfix.new@people.test', userId: P.uid });
      const s = await appSignIn(P, false);
      expect({ refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ refused: [], orgId: ORG, role: 'finance' });
    });

    it('org admin corrects a never-used invitation address; the right person (Google) then links to it', async () => {
      const R = u('EmRight');
      const inv = await inviteByEmail(ADMIN, 'org_admin', ORG, { uid: 'x', email: 'emright@people-typo.test' }, 'finance');
      await appUpdateMember(ADMIN, 'org_admin', ORG, inv.value.id, { userEmail: R.email });
      const s = await appSignIn(R, true);
      expect({ refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ refused: [], orgId: ORG, role: 'finance' });
      expect(await access(R, ORG, true)).toEqual(roleAccess('finance'));
    });

    it('Google invitee (placeholder record) suspended then re-activated: suspended screen, then its company and role back', async () => {
      const G = u('GSusp');
      const inv = await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'finance');
      expect((await appSignIn(G, true)).orgId).toBe(ORG);
      await appUpdateMember(ADMIN, 'org_admin', ORG, inv.value.id, { active: false });
      const s = await appSignIn(G, true);
      expect({ refused: s.refused, suspended: s.suspended, opens: await canOpen(G, ORG) }).toEqual({ refused: [], suspended: true, opens: false });
      await appUpdateMember(ADMIN, 'org_admin', ORG, inv.value.id, { active: true });
      const s2 = await appSignIn(G, true);
      expect({ refused: s2.refused, suspended: s2.suspended, orgId: s2.orgId, role: s2.role }).toEqual({ refused: [], suspended: false, orgId: ORG, role: 'finance' });
      expect(await access(G, ORG, true)).toEqual(roleAccess('finance'));
    });

    it('verified password account removed and re-added by its admin (Marwa, verified): back on the next sign-in', async () => {
      const M = u('MarwaV');
      await provision(ADMIN, 'org_admin', ORG, M, 'finance', 'Marwa');
      await appSignIn(M, true);
      await appRemoveMember(ADMIN, 'org_admin', ORG, mid(M));
      expect(await canOpen(M, ORG)).toBe(false);
      const readd = await appAddMemberToOrgs(ADMIN, 'org_admin', ORG, M, 'employee', [ORG], 'Marwa');
      expect(readd.added).toEqual([ORG]);
      const s = await appSignIn(M, true);
      expect({ refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ refused: [], orgId: ORG, role: 'employee' });
    });

    it('Google org admin linked by email invitation (role through its profile only) provisions, edits and removes people', async () => {
      const GA = u('GAdm');
      await inviteByEmail(OWNER, 'super_admin', ORG, GA, 'org_admin', 'GA');
      expect((await appSignIn(GA, true))).toMatchObject({ refused: [], orgId: ORG, role: 'org_admin' });
      const P = u('GAdmP');
      await provision(GA, 'org_admin', ORG, P, 'employee');
      await appUpdateMember(GA, 'org_admin', ORG, mid(P), { role: 'finance' });
      expect((await appSignIn(P, false)).role).toBe('finance');
      await appRemoveMember(GA, 'org_admin', ORG, mid(P));
      expect(await canOpen(P, ORG, false)).toBe(false);
      // another admin renames GA (re-points its invitation): GA keeps its role
      await appUpdateMember(ADMIN, 'org_admin', ORG, `${pendingUserIdForEmail(GA.email)}_${ORG}`, { userName: 'GA renamed' });
      expect((await appSignIn(GA, true))).toMatchObject({ refused: [], orgId: ORG, role: 'org_admin' });
      expect(await access(GA, ORG, true)).toEqual(roleAccess('org_admin'));
    });
  });

  // =============================================================================
  describe('company moves by the owner (LOGIN-6 fix): records whose id is not <userId>_<org>', () => {
    it('[R5-L-4] owner moves a re-pointed email invitation (id pending-<b64>_org-acme, userId = the login) to THIRD: re-keyed to <uid>_org-third, so ORG\'s admin can invite the person again', async () => {
      const G = u('GMove');
      const inv = await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'finance', 'G');
      await appSignIn(G, true);
      await appUpdateMember(ADMIN, 'org_admin', ORG, inv.value.id, { userName: 'G edited' }); // re-points userId to G
      expect((await read('members', inv.value.id))?.userId).toBe(G.uid);
      await appUpdateMember(OWNER, 'super_admin', undefined, inv.value.id, { orgId: THIRD });
      const s = await appSignIn(G, true);
      let reinvite = 'added';
      try { await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'employee', 'G again'); } catch (e: any) { reinvite = isDomainError(e) ? `domain ${e.code}` : errText(e); }
      const moved = await read('members', inv.value.id);
      const observed = {
        movedRecord: { id: inv.value.id, orgId: moved?.orgId, userId: moved?.userId },
        recordUnderThirdId: Boolean((await read('members', `${G.uid}_${THIRD}`)) || (await read('members', `${pendingUserIdForEmail(G.email)}_${THIRD}`))),
        app: { orgId: s.orgId, role: s.role, refused: s.refused },
        reinviteToOrgByItsAdmin: reinvite,
      };
      console.log('[R5-L-4] observed', JSON.stringify(observed));
      expect(observed.app.orgId).toBe(THIRD);
      expect(observed.recordUnderThirdId).toBe(true);
      expect(observed.reinviteToOrgByItsAdmin).toBe('added');
    });

    it('[R5-L-4] (legacy move) a record the original app moved (members/<uid>_org-acme holding orgId org-third): the add names it (moved_record) instead of "duplicate", one save by the owner re-keys it to <uid>_org-third, then the add works and both companies open', async () => {
      const P = u('LgMove');
      await seed(async f => {
        await setDoc(doc(f, 'users', P.uid), { orgId: OTHER, role: 'employee', active: true, email: P.email, name: 'P', memberId: mid(P, OTHER), verifiedEmail: P.email });
        await putMember(f, mid(P, OTHER), { orgId: OTHER, userId: P.uid, userEmail: P.email, role: 'employee', userName: 'P' });
        await putMember(f, mid(P, ORG), { orgId: THIRD, userId: P.uid, userEmail: P.email, role: 'finance', userName: 'P' }); // moved by the original app
        await putKey(f, THIRD, P.email, mid(P, ORG));
      });
      const first = await appAddMemberToOrgs(OWNER, 'super_admin', undefined, P, 'data_entry', [ORG]);
      expect(await access(P, THIRD)).toEqual(roleAccess('none')); // the moved record grants nothing
      await appUpdateMember(OWNER, 'super_admin', undefined, mid(P, ORG), { jobTitle: 'repaired' });
      const now = await read('members', mid(P, THIRD));
      const repaired = { old: Boolean(await read('members', mid(P, ORG))), orgId: now?.orgId, key: (await read('uniqueKeys', uniqueKeyDocId('member_email', THIRD, P.email)))?.entityId };
      const byOwner = await appAddMemberToOrgs(OWNER, 'super_admin', undefined, P, 'data_entry', [ORG]);
      const observed = { first: first.error, repaired, byOwner, opensOrg: await canOpen(P, ORG) };
      console.log('[R5-L-4 legacy] observed', JSON.stringify(observed));
      expect(observed.first).toBe('moved_record');
      expect(observed.repaired).toEqual({ old: false, orgId: THIRD, key: mid(P, THIRD) });
      expect(observed.byOwner.added).toEqual([ORG]);
      expect(observed.opensOrg).toBe(true);
      expect(await access(P, ORG)).toEqual(roleAccess('data_entry'));
      expect(await access(P, THIRD)).toEqual(roleAccess('finance'));
      expect(await appSignIn(P, true)).toMatchObject({ refused: [], orgId: OTHER, role: 'employee' });
    });

    it('[R5-L-4] (legacy move, invitation) an email invitation the original app moved (pending-<b64>_org-acme holding orgId org-third): ORG\'s admin is told moved_record (not permission-denied), the owner\'s save re-keys it, the admin\'s invitation then works', async () => {
      const G = u('LgMoveInv');
      const invId = `${pendingUserIdForEmail(G.email)}_${ORG}`;
      await seed(async f => {
        await putMember(f, invId, { orgId: THIRD, userId: pendingUserIdForEmail(G.email), userEmail: G.email, role: 'finance', userName: 'G' });
        await putKey(f, THIRD, G.email, invId);
      });
      let before = 'added';
      try { await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'employee'); } catch (e: any) { before = isDomainError(e) ? e.code : errText(e); }
      await appUpdateMember(OWNER, 'super_admin', undefined, invId, { jobTitle: 'repaired' });
      expect(await read('members', invId)).toBeUndefined();
      expect(await read('members', `${pendingUserIdForEmail(G.email)}_${THIRD}`)).toMatchObject({ orgId: THIRD, role: 'finance' });
      const after = await inviteByEmail(ADMIN, 'org_admin', ORG, G, 'employee');
      expect({ before, after: after.value.id }).toEqual({ before: 'moved_record', after: invId });
      // G (Google) links one, then switches to the other
      const s = await appSignIn(G, true);
      expect({ refused: s.refused, orgId: s.orgId, role: s.role }).toEqual({ refused: [], orgId: THIRD, role: 'finance' });
      expect(await appSwitch(G, true, ORG)).toMatchObject({ ok: true, role: 'employee' });
    });

    it('[R5-L-4] (coverage) owner moves of a UID record and of a never-linked invitation land on <userId>_<new company>; an org admin\'s save of a legacy-moved record is not re-keyed (only the owner repairs)', async () => {
      const P = u('MvUid');
      await provision(ADMIN, 'org_admin', ORG, P, 'finance');
      await appSignIn(P, false);
      await appUpdateMember(OWNER, 'super_admin', undefined, mid(P), { orgId: OTHER });
      expect({ old: await read('members', mid(P)), now: (await read('members', mid(P, OTHER)))?.orgId }).toEqual({ old: undefined, now: OTHER });
      expect(await appSignIn(P, false)).toMatchObject({ refused: [], orgId: OTHER, role: 'finance' });
      const I = u('MvInv');
      const inv = await inviteByEmail(ADMIN, 'org_admin', ORG, I, 'employee');
      await appUpdateMember(OWNER, 'super_admin', undefined, inv.value.id, { orgId: THIRD });
      expect((await read('members', `${pendingUserIdForEmail(I.email)}_${THIRD}`))?.orgId).toBe(THIRD);
      expect(await appSignIn(I, true)).toMatchObject({ refused: [], orgId: THIRD, role: 'employee' });
      // a legacy-moved record saved by its company's admin: name saved, record left where it is
      const Q = u('MvAdm');
      await seed(async f => {
        await putMember(f, mid(Q, ORG), { orgId: THIRD, userId: Q.uid, userEmail: Q.email, role: 'employee', userName: 'Q' });
      });
      await appUpdateMember(TADMIN, 'org_admin', THIRD, mid(Q, ORG), { userName: 'Q renamed' });
      expect(await read('members', mid(Q, ORG))).toMatchObject({ orgId: THIRD, userName: 'Q renamed' });
    });
  });

  // =============================================================================
  describe('re-adding a person whose re-pointed invitation already holds the company', () => {
    it('[R5-L-5] an org admin of two companies adds an invitee (already linked in ORG through a re-pointed invitation) to [ORG, OTHER]: ORG is reported as already registered, OTHER is added (no half-way permission-denied)', async () => {
      const MA = u('TwoAdm');
      await provision(OWNER, 'super_admin', ORG, MA, 'org_admin', 'MA');
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: MA.uid, userName: 'MA', userEmail: MA.email, role: 'org_admin', department: 'D', jobTitle: 'J', active: true } as any, [OTHER], key());
      const G = u('TwoAdmG');
      const inv = await inviteByEmail(MA, 'org_admin', ORG, G, 'finance', 'G');
      await appSignIn(G, true);
      await appUpdateMember(MA, 'org_admin', ORG, inv.value.id, { jobTitle: 'edit' }); // re-point
      const res = await appAddMemberToOrgs(MA, 'org_admin', ORG, G, 'finance', [ORG, OTHER], 'G');
      const observed = { res, otherCreated: Boolean(await read('members', mid(G, OTHER))), invitationKept: Boolean(await read('members', inv.value.id)) };
      console.log('[R5-L-5] observed', JSON.stringify(observed));
      // not half-way: ORG is already the login's membership (pre-skipped), OTHER is added
      expect(observed).toMatchObject({ res: { error: '', added: [OTHER] }, otherCreated: true, invitationKept: true });
      // a client that does not pre-skip (stale list): the domain skips it too, no permission-denied
      await expect(createMemberInOrgs(store(MA), actor(MA, 'org_admin', ORG),
        { userId: G.uid, userName: 'G', userEmail: G.email, role: 'finance', department: 'D', jobTitle: 'J', active: true } as any, [ORG], key()))
        .rejects.toMatchObject({ code: 'duplicate' });
      expect(await access(G, ORG)).toEqual(roleAccess('finance'));
      expect(await appSwitch(G, true, OTHER)).toMatchObject({ ok: true, role: 'finance' });
      expect(await appSwitch(G, true, ORG)).toMatchObject({ ok: true, role: 'finance' });
    });
  });
  describe('re-adding a linked invitee to its own company (invitation upgrade to <uid>_<org>)', () => {
    const setupG = async (who: U, tag: string) => {
      const G = u(tag);
      const inv = await inviteByEmail(who, 'org_admin', ORG, G, 'finance', 'G');
      await appSignIn(G, true);
      await appUpdateMember(who, 'org_admin', ORG, inv.value.id, { jobTitle: 'edit' }); // re-points userId to G
      expect((await read('members', inv.value.id))?.userId).toBe(G.uid);
      return { G, inv };
    };
    it('[R5-L-5] (single-company admin) re-adding the linked invitee is reported as already registered (no permission-denied), the invitee keeps its company', async () => {
      const { G, inv } = await setupG(ADMIN, 'DgTwo');
      const res = await appAddMemberToOrgs(ADMIN, 'org_admin', ORG, G, 'finance', [ORG], 'G');
      const observed = { res, invitationKept: Boolean(await read('members', inv.value.id)), uidRecord: Boolean(await read('members', mid(G))) };
      console.log('[R5-L-5 single] observed', JSON.stringify(observed));
      expect(observed).toMatchObject({ res: { error: 'duplicate (pre-skip: already registered)' }, invitationKept: true, uidRecord: false });
      expect(await appSignIn(G, true)).toMatchObject({ refused: [], orgId: ORG, role: 'finance' });
    });
    it('owner re-adds the linked invitee: invitation replaced by <uid>_org-acme, the stale profile relinks on the next sign-in', async () => {
      const { G, inv } = await setupG(ADMIN, 'DgThr');
      const res = await appAddMemberToOrgs(OWNER, 'super_admin', undefined, G, 'finance', [ORG], 'G');
      expect(res).toMatchObject({ added: [ORG], error: '' });
      expect(await read('members', inv.value.id)).toBeUndefined();
      const s = await appSignIn(G, true);
      expect({ orgId: s.orgId, role: s.role, refused: s.refused }).toEqual({ orgId: ORG, role: 'finance', refused: [] });
      expect(await read('users', G.uid)).toMatchObject({ memberId: mid(G) });
    });
    it('a single-company admin cannot see the invitee once its profile switched to another company: the re-add is pre-skipped as "already registered" (no error, no change)', async () => {
      const { G } = await setupG(ADMIN, 'DgOne');
      await createMemberInOrgs(store(OWNER), actor(OWNER, 'super_admin'),
        { userId: G.uid, userName: 'G', userEmail: G.email, role: 'employee', department: 'D', jobTitle: 'J', active: true } as any, [THIRD], key());
      expect(await appSwitch(G, true, THIRD)).toMatchObject({ ok: true });
      const res = await appAddMemberToOrgs(ADMIN, 'org_admin', ORG, G, 'finance', [ORG], 'G');
      expect(res.error).toBe('duplicate (pre-skip: already registered)');
      expect(await appSwitch(G, true, ORG)).toMatchObject({ ok: true, role: 'finance' });
    });
  });
});
