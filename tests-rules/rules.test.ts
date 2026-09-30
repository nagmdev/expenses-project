/**
 * firestore.rules against the Firestore emulator, driving the REAL domain operations
 * (src/domain/*) through the Firestore adapter, as different signed-in users.
 *
 *   npm run test:rules      (starts the emulator; requires Java 11+)
 */
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, type Firestore } from 'firebase/firestore';
import { createFirestoreStore } from '../src/domain/firestoreStore';
import { createExpenseRequest, disburseExpenseRequest, transitionExpenseRequest } from '../src/domain/requests';
import {
  adjustAccountBalance,
  createPaymentAccount,
  deletePaymentAccount,
  detachLegacyWallet,
  returnCustodyRemainders,
  settleCustodyItem,
  transferBetweenAccounts,
} from '../src/domain/treasury';
import { restoreRecord, readLegacySnapshot } from '../src/domain/legacyRecovery';
import {
  createEntity,
  createEntityInOrgs,
  createMemberInOrgs,
  deleteEntity,
  movePayoutToProfile,
  pendingUserIdForEmail,
  removeMember,
  syncOwnMembership,
  updateEntity,
  updateMemberRecord,
} from '../src/domain/directory';
import { createVisaRequest, deleteVisaRequest } from '../src/domain/visa';
import { legacyUniqueKeyDocId, uniqueKeyDocId } from '../src/domain/common';
import { migrateLegacyUniqueKeys } from '../src/domain/directory';
import type { ServiceProvider } from '../src/types';
import { DEFAULT_EMAIL_SETTINGS } from '../src/services/emailTemplates';
import type { Actor } from '../src/domain/common';

const ORG = 'org-acme';
const OTHER_ORG = 'org-other';
let env: RulesTestEnvironment;

const OWNER = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
const REMOVED = { uid: 'uidRemoved0000000000000001', email: 'awadhsaudi2030@gmail.com' };
const ADMIN = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
const EMP = { uid: 'uidEmployee0000000000000001', email: 'emp@acme.test' };
const FIN = { uid: 'uidFinance00000000000000001', email: 'fin@acme.test' };

const db = (u: { uid: string; email: string }, verified = true): Firestore =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore() as unknown as Firestore;
const actor = (u: { uid: string; email: string }, role: Actor['role']): Actor => ({ id: u.uid, name: u.email, email: u.email, role });
const notify = { settings: { ...DEFAULT_EMAIL_SETTINGS, enabled: false } };

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-expenses-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
  });
});
afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [] });
    await setDoc(doc(f, 'organizations', OTHER_ORG), { id: OTHER_ORG, name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [] });
    await setDoc(doc(f, 'users', ADMIN.uid), { orgId: ORG, role: 'org_admin', active: true });
    await setDoc(doc(f, 'members', `${ADMIN.uid}_${ORG}`), { orgId: ORG, userId: ADMIN.uid, userEmail: ADMIN.email, role: 'org_admin', active: true });
    await setDoc(doc(f, 'users', FIN.uid), { orgId: ORG, role: 'finance', active: true });
    await setDoc(doc(f, 'members', `${FIN.uid}_${ORG}`), { orgId: ORG, userId: FIN.uid, userEmail: FIN.email, role: 'finance', active: true });
    await setDoc(doc(f, 'users', EMP.uid), { orgId: ORG, role: 'employee', active: true });
    await setDoc(doc(f, 'members', `${EMP.uid}_${ORG}`), { orgId: ORG, userId: EMP.uid, userEmail: EMP.email, role: 'employee', active: true });
    await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0 });
    await setDoc(doc(f, 'custodies', 'cus-1'), { orgId: ORG, employeeId: EMP.uid, employeeName: 'emp', custodyNumber: 'CUS-1', totalAmount: 1000, remainingAmount: 1000, settledAmount: 0, status: 'active', currency: 'EGP' });
    await setDoc(doc(f, 'custodies', 'cus-other'), { orgId: ORG, employeeId: 'someoneElse', employeeName: 'x', custodyNumber: 'CUS-2', totalAmount: 500, remainingAmount: 500, settledAmount: 0, status: 'active', currency: 'EGP' });
  });
});

describe('platform owner is the only built-in super admin', () => {
  it('owner with a verified email can list every company', async () => {
    await assertSucceeds(getDocs(collection(db(OWNER), 'organizations')));
  });

  it('owner with an UNVERIFIED email is not a super admin (this is why the lists were empty)', async () => {
    await assertFails(getDocs(collection(db(OWNER, false), 'organizations')));
  });

  it('owner with a super_admins/{uid} record works even without a verified email', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'super_admins', OWNER.uid), { email: OWNER.email }));
    await assertSucceeds(getDocs(collection(db(OWNER, false), 'organizations')));
  });

  it('a removed former built-in admin (verified) has no platform access any more', async () => {
    await assertFails(getDocs(collection(db(REMOVED), 'organizations')));
    await assertFails(getDocs(collection(db(REMOVED), 'super_admins')));
  });

  it('an email-keyed super_admins record still grants (so leftover records must be deleted)', async () => {
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'super_admins', REMOVED.email), { email: REMOVED.email }));
    await assertSucceeds(getDocs(collection(db(REMOVED), 'organizations')));
    await assertFails(getDocs(collection(db(REMOVED, false), 'organizations'))); // but never when unverified
  });

  it('the *@tieapps-verify.com wildcard no longer grants anything', async () => {
    await assertFails(getDocs(collection(db({ uid: 'uidWildcard000000000000001', email: 'x@tieapps-verify.com' }), 'organizations')));
  });
});

describe('real domain operations pass the rules', () => {
  it('employee creates a request (idempotent create reads a missing doc, counter +1)', async () => {
    const store = createFirestoreStore(db(EMP));
    const res = await createExpenseRequest(store, actor(EMP, 'employee'), {
      orgId: ORG, requesterDepartment: 'IT', serviceCategoryId: 'srv-1', serviceCategoryName: 'Cloud', providerId: 'p', providerName: 'P',
      title: 't', description: 'd', justification: 'j', amount: 100, currency: 'EGP', urgency: 'medium', requestType: 'expense', attachments: [],
    } as any, 'key-00000001', notify);
    expect(res.changed).toBe(true);
    // org admin approves it
    const approved = await transitionExpenseRequest(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), res.value.id, { type: 'approve' }, 'key-00000002', notify);
    expect(approved.value.status).toBe('approved');
  });

  it('org admin creates a payment account with an opening balance (account + ledger + unique key + audit atomically)', async () => {
    const res = await createPaymentAccount(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'),
      { orgId: ORG, name: 'CIB', type: 'bank', accountIdentifier: 'EG001', currency: 'EGP', active: true, initialBalance: 500 } as any, 'key-00000003');
    expect(res.changed).toBe(true);
  });

  it('employee settles an invoice against THEIR OWN custody only', async () => {
    const store = createFirestoreStore(db(EMP));
    await expect(settleCustodyItem(store, actor(EMP, 'employee'), { custodyId: 'cus-1', amount: 100, description: 'x' }, 'key-00000004')).resolves.toBeTruthy();
    // a forged settlement for someone else's custody / another company is refused
    await assertFails(setDoc(doc(db(EMP), 'custodySettlements', 'stl-forged'), { custodyId: 'cus-other', orgId: ORG, employeeId: EMP.uid, amount: 1 }));
    await assertFails(setDoc(doc(db(EMP), 'custodySettlements', 'stl-forged2'), { custodyId: 'cus-1', orgId: OTHER_ORG, employeeId: EMP.uid, amount: 1 }));
  });

  // Treasury accounts + the custodies' source account (seeded without rules).
  const seedTreasury = () =>
    env.withSecurityRulesDisabled(async ctx => {
      const f = ctx.firestore();
      const account = (id: string, balance: number, extra: Record<string, unknown> = {}) =>
        setDoc(doc(f, 'paymentAccounts', id), {
          orgId: ORG, name: id, type: 'cash', accountIdentifier: id, currency: 'EGP', active: true,
          balance, currentBalance: balance, initialBalance: balance, totalIn: 0, totalOut: 0, ...extra,
        });
      await account('acc-cash', 1000);
      await account('acc-bank', 5000, { type: 'bank' });
      await account('acc-insta', 5000, { type: 'instapay', parentAccountId: 'acc-bank' });
      await account('acc-wallet', 0, { type: 'wallet' }); // standalone
      // pre-standalone wallet: still linked (mirrors) until detached; spent 400 net through it
      await account('acc-wallet-old', 600, { type: 'wallet', parentAccountId: 'acc-bank', parentAccountName: 'acc-bank', initialBalance: 1000, totalOut: 400 });
      await setDoc(doc(f, 'custodies', 'cus-1'), { sourceAccountId: 'acc-cash', sourceAccountName: 'acc-cash' }, { merge: true });
      await setDoc(doc(f, 'custodies', 'cus-other'), { sourceAccountId: 'acc-cash', sourceAccountName: 'acc-cash' }, { merge: true });
    });
  const read = async (collectionName: string, id: string) => {
    let data: Record<string, any> | undefined;
    await env.withSecurityRulesDisabled(async ctx => {
      data = (await getDoc(doc(ctx.firestore(), collectionName, id))).data();
    });
    return data!;
  };

  it('finance returns several custody remainders to their source account in one transaction (and a retry is a no-op)', async () => {
    await seedTreasury();
    const store = createFirestoreStore(db(FIN));
    const res = await returnCustodyRemainders(store, actor(FIN, 'finance'), { custodyIds: ['cus-1', 'cus-other'] }, 'key-00000010');
    expect(res.changed).toBe(true);
    expect(res.value.totalReturned).toBe(1500);
    expect((await read('paymentAccounts', 'acc-cash')).currentBalance).toBe(2500);
    expect(await read('custodies', 'cus-1')).toMatchObject({ remainingAmount: 0, returnedAmount: 1000, status: 'settled', returnedToAccountId: 'acc-cash' });
    const again = await returnCustodyRemainders(store, actor(FIN, 'finance'), { custodyIds: ['cus-1', 'cus-other'] }, 'key-00000010');
    expect(again.changed).toBe(false);
    expect((await read('paymentAccounts', 'acc-cash')).currentBalance).toBe(2500);
  });

  it('finance returns custodies into a chosen InstaPay account (the linked bank is mirrored)', async () => {
    await seedTreasury();
    const res = await returnCustodyRemainders(createFirestoreStore(db(FIN)), actor(FIN, 'finance'),
      { custodyIds: ['cus-1', 'cus-other'], targetAccountId: 'acc-insta', notes: 'استرداد العهد' }, 'key-00000011');
    expect(res.value.returned.map(r => r.accountId)).toEqual(['acc-insta', 'acc-insta']);
    expect((await read('paymentAccounts', 'acc-insta')).currentBalance).toBe(6500);
    expect((await read('paymentAccounts', 'acc-bank')).currentBalance).toBe(6500);
    expect((await read('paymentAccounts', 'acc-cash')).currentBalance).toBe(1000);
  });

  it('finance transfers between accounts (TRF counter created then advanced; InstaPay mirrors; the wallet stands alone)', async () => {
    await seedTreasury();
    const store = createFirestoreStore(db(FIN));
    const first = await transferBetweenAccounts(store, actor(FIN, 'finance'), { fromAccountId: 'acc-bank', toAccountId: 'acc-cash', amount: 1000 }, 'key-00000012');
    expect(first.value.transferNumber).toMatch(/^TRF-\d{4}-000001$/);
    const second = await transferBetweenAccounts(store, actor(FIN, 'finance'), { fromAccountId: 'acc-insta', toAccountId: 'acc-wallet', amount: 300, description: 'شحن المحفظة' }, 'key-00000013');
    expect(second.value.transferNumber).toMatch(/^TRF-\d{4}-000002$/);
    const retry = await transferBetweenAccounts(store, actor(FIN, 'finance'), { fromAccountId: 'acc-insta', toAccountId: 'acc-wallet', amount: 300 }, 'key-00000013');
    expect(retry.changed).toBe(false);
    expect((await read('paymentAccounts', 'acc-bank')).currentBalance).toBe(5000 - 1000 - 300);
    expect((await read('paymentAccounts', 'acc-cash')).currentBalance).toBe(2000);
    expect((await read('paymentAccounts', 'acc-insta')).currentBalance).toBe(4700);
    expect((await read('paymentAccounts', 'acc-wallet')).currentBalance).toBe(300);
  });

  it('org admin detaches a legacy wallet from its bank (bank correction + link removed + audit pass the rules); finance may not', async () => {
    await seedTreasury();
    const input = { walletId: 'acc-wallet-old', bankCorrection: 400, expectedWalletTotals: { totalIn: 0, totalOut: 400 } };
    await expect(detachLegacyWallet(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), input, 'key-00000018')).rejects.toMatchObject({ code: 'forbidden' });
    await assertFails(detachLegacyWallet(createFirestoreStore(db(EMP)), actor(EMP, 'org_admin'), input, 'key-00000019'));

    const res = await detachLegacyWallet(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), input, 'key-00000020');
    expect(res.changed).toBe(true);
    expect((await read('paymentAccounts', 'acc-bank')).currentBalance).toBe(5400);
    expect(await read('paymentAccounts', 'acc-wallet-old')).toMatchObject({ parentAccountId: '', currentBalance: 600 });
    expect(await read('accountTransactions', 'tx-key-00000020')).toMatchObject({ accountId: 'acc-bank', type: 'in', amount: 400, referenceId: 'acc-wallet-old' });

    // from now on the wallet is its own fund: it can send to the bank it was linked to
    await transferBetweenAccounts(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), { fromAccountId: 'acc-wallet-old', toAccountId: 'acc-bank', amount: 100 }, 'key-00000021');
    expect((await read('paymentAccounts', 'acc-bank')).currentBalance).toBe(5500);
    expect((await read('paymentAccounts', 'acc-wallet-old')).currentBalance).toBe(500);
  });

  it('an employee can neither return custody money nor transfer: the domain refuses, and a forged role is stopped by the rules', async () => {
    await seedTreasury();
    const store = createFirestoreStore(db(EMP));
    await expect(returnCustodyRemainders(store, actor(EMP, 'employee'), { custodyIds: ['cus-1'] }, 'key-00000014')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(transferBetweenAccounts(store, actor(EMP, 'employee'), { fromAccountId: 'acc-bank', toAccountId: 'acc-cash', amount: 1 }, 'key-00000015'))
      .rejects.toMatchObject({ code: 'forbidden' });
    // a modified client that claims the finance role
    await assertFails(returnCustodyRemainders(store, actor(EMP, 'finance'), { custodyIds: ['cus-1'] }, 'key-00000016'));
    await assertFails(transferBetweenAccounts(store, actor(EMP, 'finance'), { fromAccountId: 'acc-bank', toAccountId: 'acc-cash', amount: 1 }, 'key-00000017'));
    await assertFails(updateDoc(doc(db(EMP), 'paymentAccounts', 'acc-cash'), { currentBalance: 999_999 }));
    await assertFails(setDoc(doc(db(EMP), 'accountTransactions', 'tx-forged'), { orgId: ORG, accountId: 'acc-cash', type: 'in', amount: 1 }));
    expect((await read('paymentAccounts', 'acc-cash')).currentBalance).toBe(1000);
    expect((await read('custodies', 'cus-1')).remainingAmount).toBe(1000);
  });

  // Company multi-select: one operation, one document per company, ONE transaction.
  const newPerson = (email: string, role: Actor['role'] = 'org_admin') => ({
    userId: '', userName: email.split('@')[0], userEmail: email, role, department: 'الإدارة العامة', jobTitle: 'مدير', active: true,
  });
  const vendor = (name: string) => (id: string, orgId: string): ServiceProvider => ({
    id, orgId, name, serviceCategoryIds: [], serviceCategoryNames: [], contactPerson: '', phone: '010', email: '', taxNumber: '', crNumber: '',
    bankName: '', iban: '', address: '', rating: 5, totalPaid: 0, active: true,
  });
  const describeVendor = (p: ServiceProvider) => `تم إضافة مورد جديد: "${p.name}"`;

  it('the owner adds one person and one provider to two companies in one operation each (and a retry is a no-op)', async () => {
    const store = createFirestoreStore(db(OWNER));
    const owner = actor(OWNER, 'super_admin');
    const email = 'multi@tie.test';
    const pending = pendingUserIdForEmail(email);

    const res = await createMemberInOrgs(store, owner, newPerson(email), [ORG, OTHER_ORG], 'key-00000030');
    expect(res.changed).toBe(true);
    expect(res.value.created.map(m => m.orgId)).toEqual([ORG, OTHER_ORG]);
    for (const orgId of [ORG, OTHER_ORG]) {
      expect(await read('members', `${pending}_${orgId}`)).toMatchObject({ orgId, userEmail: email, role: 'org_admin' });
      expect(await read('auditLogs', `audit-key-00000030-${orgId}`)).toMatchObject({ orgId, entityType: 'member', actorId: OWNER.uid });
      expect((await read('organizations', orgId)).notificationRecipients).toEqual([email]);
    }
    const again = await createMemberInOrgs(store, owner, newPerson(email), [ORG, OTHER_ORG], 'key-00000030');
    expect(again).toMatchObject({ changed: false, reason: 'duplicate_operation' });

    // already a member of ORG (the admin): only OTHER_ORG gets a new membership
    const admin = await createMemberInOrgs(store, owner, { ...newPerson(ADMIN.email), userId: ADMIN.uid }, [ORG, OTHER_ORG], 'key-00000031');
    expect(admin.value.created.map(m => m.orgId)).toEqual([OTHER_ORG]);
    expect(admin.value.skipped).toEqual([{ orgId: ORG, reason: 'already_member', existingName: undefined }]);

    const prov = await createEntityInOrgs(store, owner, 'provider', [ORG, OTHER_ORG], vendor('Vodafone'), describeVendor, 'key-00000032');
    expect(prov.value.created.map(p => [p.id, p.orgId])).toEqual([[`prov-key-00000032-${ORG}`, ORG], [`prov-key-00000032-${OTHER_ORG}`, OTHER_ORG]]);
    expect(await read('providers', `prov-key-00000032-${OTHER_ORG}`)).toMatchObject({ orgId: OTHER_ORG, name: 'Vodafone', totalPaid: 0 });
    expect((await createEntityInOrgs(store, owner, 'provider', [ORG, OTHER_ORG], vendor('Vodafone'), describeVendor, 'key-00000032')).changed).toBe(false);
  });

  it('an org admin adds to their own company; an operation that also targets another company is refused by the rules and writes NOTHING', async () => {
    const store = createFirestoreStore(db(ADMIN));
    const orgAdmin = actor(ADMIN, 'org_admin');

    const own = await createMemberInOrgs(store, orgAdmin, newPerson('own@acme.test'), [ORG], 'key-00000040');
    expect(own.value.created.map(m => m.orgId)).toEqual([ORG]);
    expect((await read('organizations', ORG)).notificationRecipients).toEqual(['own@acme.test']);
    const ownVendor = await createEntityInOrgs(store, orgAdmin, 'provider', [ORG], vendor('Orange'), describeVendor, 'key-00000041');
    expect(ownVendor.changed).toBe(true);

    await assertFails(createMemberInOrgs(store, orgAdmin, newPerson('both@acme.test'), [ORG, OTHER_ORG], 'key-00000042'));
    await assertFails(createEntityInOrgs(store, orgAdmin, 'provider', [ORG, OTHER_ORG], vendor('Etisalat'), describeVendor, 'key-00000043'));

    // atomic: not even the company the admin manages got anything
    const pending = pendingUserIdForEmail('both@acme.test');
    expect(await read('members', `${pending}_${ORG}`)).toBeUndefined();
    expect(await read('members', `${pending}_${OTHER_ORG}`)).toBeUndefined();
    expect(await read('auditLogs', `audit-key-00000042-${ORG}`)).toBeUndefined();
    expect(await read('providers', `prov-key-00000043-${ORG}`)).toBeUndefined();
    expect(await read('auditLogs', `audit-key-00000043-${ORG}`)).toBeUndefined();
    expect((await read('organizations', ORG)).notificationRecipients).toEqual(['own@acme.test']);
  });

  it('org admin adds a department to their company through the multi-company operation', async () => {
    const res = await createEntityInOrgs(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'department', [ORG],
      (id, orgId, nowIso) => ({ id, orgId, name: 'المالية', createdAt: nowIso }), d => `قسم جديد: "${d.name}"`, 'key-00000050');
    expect(res.changed).toBe(true);
    expect(await read('departments', `dept-key-00000050-${ORG}`)).toMatchObject({ orgId: ORG, name: 'المالية' });
    expect(await read('auditLogs', `audit-key-00000050-${ORG}`)).toMatchObject({ orgId: ORG, entityType: 'department', actorId: ADMIN.uid });
  });

  it('data entry adds providers and departments to its own company only (never with a payment total, never elsewhere)', async () => {
    const DE = { uid: 'uidDataEntry000000000000001', email: 'de@acme.test' };
    await env.withSecurityRulesDisabled(async ctx => {
      const f = ctx.firestore();
      await setDoc(doc(f, 'users', DE.uid), { orgId: ORG, role: 'data_entry', active: true });
      await setDoc(doc(f, 'members', `${DE.uid}_${ORG}`), { orgId: ORG, userId: DE.uid, userEmail: DE.email, role: 'data_entry', active: true });
    });
    const store = createFirestoreStore(db(DE));
    const dataEntry = actor(DE, 'data_entry');

    const prov = await createEntityInOrgs(store, dataEntry, 'provider', [ORG], vendor('Fawry'), describeVendor, 'key-00000060');
    expect(prov.changed).toBe(true);
    expect(await read('providers', `prov-key-00000060-${ORG}`)).toMatchObject({ orgId: ORG, name: 'Fawry', totalPaid: 0 });
    const dept = await createEntityInOrgs(store, dataEntry, 'department', [ORG],
      (id, orgId, nowIso) => ({ id, orgId, name: 'المشتريات', createdAt: nowIso }), d => `قسم جديد: "${d.name}"`, 'key-00000061');
    expect(dept.changed).toBe(true);
    expect(await read('departments', `dept-key-00000061-${ORG}`)).toMatchObject({ orgId: ORG, name: 'المشتريات' });

    // another company: refused, and atomic (nothing written in its own company either)
    await assertFails(createEntityInOrgs(store, dataEntry, 'provider', [ORG, OTHER_ORG], vendor('Aman'), describeVendor, 'key-00000062'));
    expect(await read('providers', `prov-key-00000062-${ORG}`)).toBeUndefined();
    await assertFails(setDoc(doc(db(DE), 'departments', 'dept-forged'), { orgId: OTHER_ORG, name: 'x' }));
    // a provider cannot start with money already "paid" to it; editing stays with admin / finance
    await assertFails(setDoc(doc(db(DE), 'providers', 'prov-forged'), { orgId: ORG, name: 'Forged', totalPaid: 5000 }));
    await assertFails(updateDoc(doc(db(DE), 'providers', `prov-key-00000060-${ORG}`), { name: 'Renamed' }));
    // an employee still cannot add either
    await assertFails(setDoc(doc(db(EMP), 'providers', 'prov-emp'), { orgId: ORG, name: 'Emp', totalPaid: 0 }));
    await assertFails(setDoc(doc(db(EMP), 'departments', 'dept-emp'), { orgId: ORG, name: 'Emp' }));
  });
});

describe('tenant isolation hardening', () => {
  it("a visa request cannot be created in someone else's name by a regular member", async () => {
    await assertSucceeds(setDoc(doc(db(EMP), 'visaRequests', 'v-own'), { orgId: ORG, status: 'pending', requesterId: EMP.uid }));
    await assertFails(setDoc(doc(db(EMP), 'visaRequests', 'v-forged'), { orgId: ORG, status: 'pending', requesterId: ADMIN.uid }));
  });

  it('a membership id must be <userId>_<orgId>', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'members', `newUser_${ORG}`), { orgId: ORG, userId: 'newUser', role: 'employee', userEmail: 'n@acme.test' }));
    await assertFails(setDoc(doc(db(ADMIN), 'members', `${EMP.uid}_${OTHER_ORG}`), { orgId: ORG, userId: 'someone', role: 'employee' }));
  });

  it('company staff cannot move a document into another company', async () => {
    await assertSucceeds(updateDoc(doc(db(ADMIN), 'services', 'srv-1'), { name: 'Renamed' }));
    await assertFails(updateDoc(doc(db(ADMIN), 'services', 'srv-1'), { orgId: OTHER_ORG }));
  });

  it('audit entries cannot be injected into another company', async () => {
    await assertSucceeds(setDoc(doc(db(EMP), 'auditLogs', 'a1'), { actorId: EMP.uid, orgId: ORG, details: 'x' }));
    await assertFails(setDoc(doc(db(EMP), 'auditLogs', 'a2'), { actorId: EMP.uid, orgId: OTHER_ORG, details: 'x' }));
    await assertFails(setDoc(doc(db(EMP), 'auditLogs', 'a3'), { actorId: 'someoneElse', orgId: ORG, details: 'x' }));
  });
});

describe('legacy local-data recovery', () => {
  const legacy = readLegacySnapshot(k => ({
    expenses_visa_requests_v3: JSON.stringify([
      { id: 'visa_paid', orgId: ORG, requestNumber: 'VISA-1', travelerName: 'A', status: 'paid', totalAmount: 900, paidAmount: 900, requesterId: EMP.uid },
      { id: 'visa_pending', orgId: ORG, requestNumber: 'VISA-2', travelerName: 'B', status: 'pending', totalAmount: 100, paidAmount: 0, requesterId: EMP.uid },
    ]),
    expenses_requests_v3: JSON.stringify([
      { id: 'req-legacy-disbursed', orgId: ORG, requestNumber: 'REQ-1', status: 'disbursed', amount: 10, requesterId: EMP.uid },
    ]),
    expenses_services_v3: JSON.stringify([{ id: 'srv-1', orgId: ORG, name: 'STALE LOCAL COPY' }]),
  } as Record<string, string>)[k] ?? null);
  const rec = (id: string) => legacy.flatMap(s => s.records).find(r => r.id === id)!;

  const asOwner = () => ({ actor: actor(OWNER, 'super_admin'), orgId: ORG });

  it('the owner restores non-pending visas/requests as they were (record + marker + audit pass the rules)', async () => {
    const store = createFirestoreStore(db(OWNER));
    expect((await restoreRecord(store, asOwner(), rec('visa_paid'), 'browser')).outcome).toBe('restored');
    expect((await restoreRecord(store, asOwner(), rec('req-legacy-disbursed'), 'browser')).outcome).toBe('restored');
    // markers are permanent: nobody can delete or change them
    await assertFails(updateDoc(doc(db(OWNER), 'legacyRestores', 'visaRequests__visa_paid'), { restoredBy: 'x' }));
  });

  it('an org member may restore a pending visa but never create a non-pending one directly', async () => {
    expect((await restoreRecord(createFirestoreStore(db(EMP)), { actor: actor(EMP, 'employee'), orgId: ORG }, rec('visa_pending'), 'browser')).outcome).toBe('restored');
    await assertFails(setDoc(doc(db(ADMIN), 'visaRequests', 'forged'), { orgId: ORG, status: 'paid', requesterId: ADMIN.uid }));
    await assertFails(setDoc(doc(db(ADMIN), 'requests', 'forged'), { orgId: ORG, status: 'approved', requesterId: ADMIN.uid }));
  });

  it('restoring never overwrites an existing document', async () => {
    const res = await restoreRecord(createFirestoreStore(db(OWNER)), asOwner(), rec('srv-1'), 'browser');
    expect(res.outcome).toBe('exists');
  });
});

// ===========================================================================
// Policies of the 2026-09-30 end-to-end fixes
// ===========================================================================
const CAIRO_EMP = { uid: 'uidCairoEmp00000000000001', email: 'emp@other.test' };
const CAIRO_FIN = { uid: 'uidCairoFin00000000000001', email: 'fin@other.test' };
const STRANGER = { uid: 'uidStranger00000000000001', email: 'nobody@nowhere.test' };
const DE = { uid: 'uidDataEntry000000000000001', email: 'de@acme.test' };
const opKey = (n: number) => `key-9${String(n).padStart(7, '0')}`;
const readDoc = async (collectionName: string, id: string) => {
  let data: Record<string, any> | undefined;
  await env.withSecurityRulesDisabled(async ctx => {
    data = (await getDoc(doc(ctx.firestore(), collectionName, id))).data();
  });
  return data;
};
const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));

describe('services shared with several companies (orgIds)', () => {
  beforeEach(() =>
    seed(async f => {
      await setDoc(doc(f, 'users', CAIRO_EMP.uid), { orgId: OTHER_ORG, role: 'employee', active: true });
      await setDoc(doc(f, 'members', `${CAIRO_EMP.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: CAIRO_EMP.uid, userEmail: CAIRO_EMP.email, role: 'employee', active: true });
      await setDoc(doc(f, 'users', CAIRO_FIN.uid), { orgId: OTHER_ORG, role: 'finance', active: true });
      await setDoc(doc(f, 'members', `${CAIRO_FIN.uid}_${OTHER_ORG}`), { orgId: OTHER_ORG, userId: CAIRO_FIN.uid, userEmail: CAIRO_FIN.email, role: 'finance', active: true });
      await setDoc(doc(f, 'services', 'srv-shared'), { orgId: ORG, orgIds: [ORG, OTHER_ORG], name: 'WE Internet', code: 'WE', spentAmount: 0 });
      await setDoc(doc(f, 'services', 'srv-cairo'), { orgId: OTHER_ORG, name: 'Cairo only', code: 'CAI', spentAmount: 0 });
    }),
  );
  const shared = (who: { uid: string; email: string }, orgId: string) => query(collection(db(who), 'services'), where('orgIds', 'array-contains', orgId));

  it("a secondary company's members list and read the services shared with it (the app's second query)", async () => {
    const snap = await assertSucceeds(getDocs(shared(CAIRO_EMP, OTHER_ORG)));
    expect(snap.docs.map(d => d.id)).toEqual(['srv-shared']);
    await assertSucceeds(getDocs(query(collection(db(CAIRO_EMP), 'services'), where('orgId', '==', OTHER_ORG))));
    await assertSucceeds(getDoc(doc(db(CAIRO_EMP), 'services', 'srv-shared')));
    // the owning company still sees it through its own query
    await assertSucceeds(getDocs(query(collection(db(EMP), 'services'), where('orgId', '==', ORG))));
  });

  it('tenant isolation holds: not shared → not readable; another company’s list, strangers and suspended users get nothing', async () => {
    await assertFails(getDoc(doc(db(CAIRO_EMP), 'services', 'srv-1')));
    await assertFails(getDocs(shared(CAIRO_EMP, ORG)));
    await assertFails(getDocs(query(collection(db(CAIRO_EMP), 'services'), where('orgId', '==', ORG))));
    await assertFails(getDocs(collection(db(CAIRO_EMP), 'services')));
    await assertFails(getDocs(shared(STRANGER, OTHER_ORG)));
    await assertFails(getDoc(doc(db(STRANGER), 'services', 'srv-shared')));
    await assertFails(getDoc(doc(db(EMP), 'services', 'srv-cairo')));
    await seed(f => updateDoc(doc(f, 'users', CAIRO_EMP.uid), { active: false }));
    await assertFails(getDocs(shared(CAIRO_EMP, OTHER_ORG)));
  });

  it("the secondary company's finance pays a request on a shared service (its spending grows) but cannot edit the service", async () => {
    await seed(async f => {
      await setDoc(doc(f, 'paymentAccounts', 'acc-cairo'), { orgId: OTHER_ORG, name: 'Cairo cash', type: 'cash', accountIdentifier: 'CASH-C', currency: 'EGP', active: true, balance: 5000, currentBalance: 5000, initialBalance: 5000, totalIn: 0, totalOut: 0 });
      await setDoc(doc(f, 'requests', 'req-cairo'), {
        orgId: OTHER_ORG, requestNumber: 'REQ-C', status: 'approved', amount: 1800, currency: 'EGP', title: 't', requestType: 'expense',
        serviceCategoryId: 'srv-shared', providerId: '', requesterId: CAIRO_EMP.uid, requesterName: 'e', requesterEmail: CAIRO_EMP.email, timeline: [],
      });
    });
    const res = await disburseExpenseRequest(createFirestoreStore(db(CAIRO_FIN)), actor(CAIRO_FIN, 'finance'), 'req-cairo',
      { paymentMethod: 'cash', referenceNumber: 'TXN-1', accountId: 'acc-cairo' }, opKey(1), notify);
    expect(res.changed).toBe(true);
    expect((await readDoc('services', 'srv-shared'))!.spentAmount).toBe(1800);
    expect((await readDoc('paymentAccounts', 'acc-cairo'))!.currentBalance).toBe(3200);

    await assertFails(updateDoc(doc(db(CAIRO_FIN), 'services', 'srv-shared'), { name: 'Renamed' }));
    await assertFails(updateDoc(doc(db(CAIRO_FIN), 'services', 'srv-shared'), { spentAmount: 0 }));
    await assertFails(updateDoc(doc(db(CAIRO_EMP), 'services', 'srv-shared'), { spentAmount: 99_999 }));
    // the domain refuses the edit at once (the actor works in the other company)
    await expect(updateEntity(createFirestoreStore(db(CAIRO_FIN)), { ...actor(CAIRO_FIN, 'finance'), orgId: OTHER_ORG }, 'service', 'srv-shared', { name: 'x' },
      () => ({ actionType: 'update', details: 'x' }), opKey(2))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('only the platform owner shares a service with other companies', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'services', 'srv-1'), { orgIds: [ORG, OTHER_ORG] }));
    await assertFails(setDoc(doc(db(ADMIN), 'services', 'srv-new'), { orgId: ORG, orgIds: [ORG, OTHER_ORG], name: 'n', code: 'N' }));
    await assertSucceeds(setDoc(doc(db(ADMIN), 'services', 'srv-own'), { orgId: ORG, orgIds: [ORG], name: 'n', code: 'N' }));
    await assertSucceeds(updateDoc(doc(db(ADMIN), 'services', 'srv-shared'), { name: 'WE 2', orgIds: [ORG, OTHER_ORG] })); // unchanged list
    await assertSucceeds(updateDoc(doc(db(OWNER), 'services', 'srv-1'), { orgIds: [ORG, OTHER_ORG] }));
  });

  it('services are added by admins only (data entry refused by the domain at once, and by the rules)', async () => {
    await seed(async f => {
      await setDoc(doc(f, 'users', DE.uid), { orgId: ORG, role: 'data_entry', active: true });
      await setDoc(doc(f, 'members', `${DE.uid}_${ORG}`), { orgId: ORG, userId: DE.uid, userEmail: DE.email, role: 'data_entry', active: true });
    });
    const build = (id: string) => ({ id, orgId: ORG, name: 'DE service', code: 'DES', description: '', budgetLimit: 0, spentAmount: 0, color: '#000', iconName: 'x' });
    await expect(createEntity(createFirestoreStore(db(DE)), actor(DE, 'data_entry'), 'service', build, () => 'x', opKey(3))).rejects.toMatchObject({ code: 'forbidden' });
    await assertFails(createEntity(createFirestoreStore(db(DE)), actor(DE, 'org_admin'), 'service', build, () => 'x', opKey(4))); // forged role
    await expect(updateEntity(createFirestoreStore(db(DE)), actor(DE, 'data_entry'), 'provider', 'any', { name: 'x' },
      () => ({ actionType: 'update', details: 'x' }), opKey(5))).rejects.toMatchObject({ code: 'forbidden' });
    const ok = await createEntity(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'service', build, () => 'x', opKey(6));
    expect(ok.changed).toBe(true);
    // an unused service is deleted, a used one deactivated (both pass the rules)
    const removal = await deleteEntity(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'service', ok.value.id, 'delete', opKey(7));
    expect(removal.removal).toBe('deleted');
    await seed(f => updateDoc(doc(f, 'services', 'srv-1'), { spentAmount: 10 }));
    expect((await deleteEntity(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'service', 'srv-1', 'delete', opKey(8))).removal).toBe('deactivated');
    expect((await readDoc('services', 'srv-1'))!.active).toBe(false);
  });
});

describe('uniqueness keys are readable in their own company only', () => {
  const tantaKey = uniqueKeyDocId('member_email', ORG, EMP.email);
  const cairoKey = uniqueKeyDocId('member_email', OTHER_ORG, CAIRO_EMP.email);
  beforeEach(() =>
    seed(async f => {
      await setDoc(doc(f, 'users', CAIRO_EMP.uid), { orgId: OTHER_ORG, role: 'employee', active: true });
      await setDoc(doc(f, 'uniqueKeys', tantaKey), { scope: 'member_email', orgId: ORG, value: EMP.email, entityCollection: 'members', entityId: `${EMP.uid}_${ORG}` });
      await setDoc(doc(f, 'uniqueKeys', cairoKey), { scope: 'member_email', orgId: OTHER_ORG, value: CAIRO_EMP.email, entityCollection: 'members', entityId: `${CAIRO_EMP.uid}_${OTHER_ORG}` });
    }),
  );

  it("another company's key (email, member id) is not disclosed; own company, missing keys and the owner are fine", async () => {
    await assertFails(getDoc(doc(db(CAIRO_EMP), 'uniqueKeys', tantaKey)));
    await assertFails(getDoc(doc(db(STRANGER), 'uniqueKeys', tantaKey)));
    await assertSucceeds(getDoc(doc(db(CAIRO_EMP), 'uniqueKeys', cairoKey)));
    await assertSucceeds(getDoc(doc(db(EMP), 'uniqueKeys', tantaKey)));
    await assertSucceeds(getDoc(doc(db(EMP), 'uniqueKeys', uniqueKeyDocId('member_email', ORG, 'nobody@acme.test'))));
    // An empty value (an old account without a number) ends the id with "__": still its company's.
    await assertSucceeds(getDoc(doc(db(FIN), 'uniqueKeys', uniqueKeyDocId('account_identifier', ORG, ''))));
    await assertSucceeds(getDoc(doc(db(OWNER), 'uniqueKeys', cairoKey)));
  });

  it("whether a key exists in another company cannot be probed: a missing one is refused just like an existing one", async () => {
    const missing = uniqueKeyDocId('member_email', ORG, 'nobody@acme.test');
    await assertFails(getDoc(doc(db(CAIRO_EMP), 'uniqueKeys', missing)));
    await assertFails(getDoc(doc(db(STRANGER), 'uniqueKeys', missing)));
    await assertFails(getDoc(doc(db(STRANGER), 'uniqueKeys', uniqueKeyDocId('org_code', '-', 'ACME'))));
    // Old-format ids (company encoded): the platform owner only, present or missing.
    await assertFails(getDoc(doc(db(EMP), 'uniqueKeys', legacyUniqueKeyDocId('member_email', ORG, 'nobody@acme.test'))));
    await assertSucceeds(getDoc(doc(db(OWNER), 'uniqueKeys', legacyUniqueKeyDocId('member_email', ORG, 'nobody@acme.test'))));
  });

  it("a key can only be created under its own company's id", async () => {
    const data = { scope: 'provider_name', orgId: ORG, value: 'vodafone', entityCollection: 'providers', entityId: 'prov-x' };
    await assertSucceeds(setDoc(doc(db(ADMIN), 'uniqueKeys', uniqueKeyDocId('provider_name', ORG, 'Vodafone')), data));
    // Squatting another company's value (claimed as this company's) is refused.
    await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', uniqueKeyDocId('provider_name', OTHER_ORG, 'Vodafone')), data));
    await assertFails(setDoc(doc(db(ADMIN), 'uniqueKeys', uniqueKeyDocId('provider_name', OTHER_ORG, 'Vodafone')), { ...data, orgId: OTHER_ORG }));
  });

  it('the platform owner moves old-format keys to the current id (and nobody else can)', async () => {
    const legacyId = legacyUniqueKeyDocId('member_email', ORG, EMP.email);
    await seed(async f => {
      await deleteDoc(doc(f, 'uniqueKeys', tantaKey));
      await setDoc(doc(f, 'uniqueKeys', legacyId), { scope: 'member_email', orgId: ORG, value: EMP.email, entityCollection: 'members', entityId: `${EMP.uid}_${ORG}` });
    });
    const owners = [{ scope: 'member_email' as const, orgId: ORG, value: EMP.email, collection: 'members', id: `${EMP.uid}_${ORG}` }];
    await expect(migrateLegacyUniqueKeys(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), owners)).rejects.toThrow();
    const res = await migrateLegacyUniqueKeys(createFirestoreStore(db(OWNER)), actor(OWNER, 'super_admin'), owners);
    expect(res).toEqual({ moved: 1, replaced: 0, skipped: 0 });
    expect(await readDoc('uniqueKeys', legacyId)).toBeUndefined();
    expect(await readDoc('uniqueKeys', tantaKey)).toMatchObject({ orgId: ORG, entityId: `${EMP.uid}_${ORG}` });
  });
});

describe('treasury: no overdraft, and accounts with history are never deleted', () => {
  beforeEach(() =>
    seed(async f => {
      const account = (id: string, fields: Record<string, unknown>) =>
        setDoc(doc(f, 'paymentAccounts', id), { orgId: ORG, name: id, type: 'cash', accountIdentifier: id, currency: 'EGP', active: true, balance: 0, currentBalance: 0, initialBalance: 0, totalIn: 0, totalOut: 0, ...fields });
      await account('acc-used', { balance: 500, currentBalance: 500, initialBalance: 500 });
      await account('acc-moved', { totalIn: 300, totalOut: 300 });
      await account('acc-empty', {});
    }),
  );

  it('the rules refuse deleting an account with a balance or history; the domain refuses it at once', async () => {
    await assertFails(deleteDoc(doc(db(ADMIN), 'paymentAccounts', 'acc-used')));
    await assertFails(deleteDoc(doc(db(ADMIN), 'paymentAccounts', 'acc-moved')));
    await assertFails(deleteDoc(doc(db(OWNER), 'paymentAccounts', 'acc-moved')));
    await expect(deletePaymentAccount(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'acc-used', opKey(10))).rejects.toMatchObject({ code: 'account_has_history' });
    await deletePaymentAccount(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), 'acc-empty', opKey(11));
    expect(await readDoc('paymentAccounts', 'acc-empty')).toBeUndefined();
  });

  it('a withdrawal above the balance is refused before anything is written', async () => {
    await expect(adjustAccountBalance(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), { accountId: 'acc-used', type: 'out', amount: 50_000, description: 'x' }, opKey(12)))
      .rejects.toMatchObject({ code: 'insufficient_funds' });
    expect((await readDoc('paymentAccounts', 'acc-used'))!.currentBalance).toBe(500);
    await adjustAccountBalance(createFirestoreStore(db(FIN)), actor(FIN, 'finance'), { accountId: 'acc-used', type: 'out', amount: 500, description: 'x' }, opKey(13));
    expect((await readDoc('paymentAccounts', 'acc-used'))!.currentBalance).toBe(0);
  });
});

describe("memberships: the owner's and one's own are protected; payout details stay out", () => {
  const OWNER_MEM = `${OWNER.uid}_${ORG}`;
  const ADMIN_MEM = `${ADMIN.uid}_${ORG}`;
  const EMP_MEM = `${EMP.uid}_${ORG}`;
  const payout = { instapay: 'sara@instapay', wallet: '01012345678', bankName: 'بنك', iban: 'EG000000000000000000000E2E01', walletProvider: 'فودافون كاش' };
  beforeEach(() =>
    seed(f => setDoc(doc(f, 'members', OWNER_MEM), { orgId: ORG, userId: OWNER.uid, userEmail: OWNER.email, userName: 'محمود', role: 'org_admin', active: true })),
  );

  it("an org admin can neither delete, suspend nor re-role the platform owner's membership or their own; a name edit is fine", async () => {
    for (const id of [OWNER_MEM, ADMIN_MEM]) {
      await assertFails(deleteDoc(doc(db(ADMIN), 'members', id)));
      await assertFails(updateDoc(doc(db(ADMIN), 'members', id), { active: false }));
      await assertFails(updateDoc(doc(db(ADMIN), 'members', id), { role: 'employee' }));
      await assertFails(updateDoc(doc(db(ADMIN), 'members', id), { userEmail: 'other@acme.test' }));
      await assertSucceeds(updateDoc(doc(db(ADMIN), 'members', id), { userName: 'اسم جديد' }));
    }
    // the domain refuses at once; a modified client claiming super admin is stopped by the rules
    await expect(removeMember(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), OWNER_MEM, [], opKey(20))).rejects.toMatchObject({ code: 'protected_member' });
    await expect(updateMemberRecord(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), ADMIN_MEM, { role: 'finance' }, [], opKey(21))).rejects.toMatchObject({ code: 'protected_member' });
    await assertFails(removeMember(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'super_admin'), OWNER_MEM, [], opKey(22)));
    // other members stay manageable, and the owner can do everything
    await removeMember(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), EMP_MEM, [EMP.uid], opKey(23));
    expect(await readDoc('members', EMP_MEM)).toBeUndefined();
    await updateMemberRecord(createFirestoreStore(db(OWNER)), actor(OWNER, 'super_admin'), ADMIN_MEM, { active: false }, [], opKey(24));
    await removeMember(createFirestoreStore(db(OWNER)), actor(OWNER, 'super_admin'), OWNER_MEM, [], opKey(25));
    expect(await readDoc('members', OWNER_MEM)).toBeUndefined();
  });

  it('payout details can be neither written into a membership by its owner nor by an admin (create or update)', async () => {
    await assertFails(updateDoc(doc(db(EMP), 'members', EMP_MEM), { iban: 'EG1' }));
    await assertSucceeds(updateDoc(doc(db(EMP), 'members', EMP_MEM), { userName: 'سارة', phone: '0100' }));
    await assertFails(updateDoc(doc(db(ADMIN), 'members', EMP_MEM), { instapay: 'x@instapay' }));
    await assertFails(setDoc(doc(db(ADMIN), 'members', `newUser_${ORG}`), { orgId: ORG, userId: 'newUser', role: 'employee', userEmail: 'n@acme.test', iban: 'EG1' }));
    // the profile is where they belong
    await assertSucceeds(setDoc(doc(db(EMP), 'users', EMP.uid), payout, { merge: true }));
  });

  it("a user's profile save removes payout details an older version copied into their membership", async () => {
    await seed(f => updateDoc(doc(f, 'members', EMP_MEM), payout));
    const res = await syncOwnMembership(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), EMP_MEM, { userName: 'سارة', phone: '0111' });
    expect(res.changed).toBe(true);
    const mem = (await readDoc('members', EMP_MEM))!;
    expect(mem).toMatchObject({ userName: 'سارة', phone: '0111', role: 'employee', orgId: ORG, userId: EMP.uid });
    for (const f of Object.keys(payout)) expect(f in mem).toBe(false);
  });

  it("an admin's clean-up moves them into the person's profile and out of the membership (both pass the rules)", async () => {
    await seed(async f => {
      await updateDoc(doc(f, 'members', EMP_MEM), payout);
      await updateDoc(doc(f, 'users', EMP.uid), { iban: 'EG-PROFILE' });
    });
    const res = await movePayoutToProfile(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), EMP_MEM);
    expect(res.value).toBe('moved');
    expect(await readDoc('users', EMP.uid)).toMatchObject({ ...payout, iban: 'EG-PROFILE' });
    const mem = (await readDoc('members', EMP_MEM))!;
    for (const f of Object.keys(payout)) expect(f in mem).toBe(false);
    // an employee cannot run it (refused by the domain), nor clean up someone else's membership
    await expect(movePayoutToProfile(createFirestoreStore(db(EMP)), actor(EMP, 'employee'), ADMIN_MEM)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('visa requests: only company admins delete', () => {
  it("the requester's own pending visa: refused by the domain at once, and by the rules for a forged role", async () => {
    const store = createFirestoreStore(db(EMP));
    const visa = await createVisaRequest(store, actor(EMP, 'employee'), {
      orgId: ORG, requestDate: '2026-09-30', travelerName: 'T', passportNumber: 'P', destinationCountry: 'SA', hasTraveledBefore: false,
      expectedTravelDate: '2026-12-01', visaType: 'tourist', serviceProviderId: 'p', serviceProviderName: 'P', assignedApprover: '',
      totalAmount: 100, currency: 'EGP', paymentMode: 'full', requesterId: EMP.uid, requesterName: 'e',
    }, opKey(30));
    await expect(deleteVisaRequest(store, actor(EMP, 'employee'), visa.value.id, opKey(31))).rejects.toMatchObject({ code: 'forbidden' });
    await assertFails(deleteVisaRequest(store, actor(EMP, 'org_admin'), visa.value.id, opKey(32)));
    await deleteVisaRequest(createFirestoreStore(db(ADMIN)), actor(ADMIN, 'org_admin'), visa.value.id, opKey(33));
    expect(await readDoc('visaRequests', visa.value.id)).toBeUndefined();
  });
});
