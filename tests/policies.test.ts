/**
 * Business policies agreed after the 2026-09-30 end-to-end run:
 *  1. no money operation takes an account (or the bank behind an InstaPay) below zero;
 *  2. a treasury account with a balance or history is deactivated, never deleted;
 *  3. services / providers in use are deactivated, never hard-deleted;
 *  4. an org admin never deletes, suspends or re-roles the platform owner's membership, nor their own;
 *  5. visa decisions record the ACTING user;
 *  8. payout details live in users/{uid}, never in members/*;
 * plus the role checks aligned with firestore.rules (the domain refuses at once).
 */
import { describe, expect, it } from 'vitest';
import type { Actor } from '../src/domain/common';
import {
  createEntity,
  createEntityInOrgs,
  createMember,
  deleteEntity,
  movePayoutToProfile,
  removeMember,
  syncOwnMembership,
  updateEntity,
  updateMemberRecord,
} from '../src/domain/directory';
import { createExpenseRequest, disburseExpenseRequest, transitionExpenseRequest } from '../src/domain/requests';
import type { MemoryStore } from '../src/domain/store';
import {
  adjustAccountBalance,
  createPaymentAccount,
  deletePaymentAccount,
  detachLegacyWallet,
  issueCustody,
  replenishCustody,
  transferBetweenAccounts,
  updatePaymentAccount,
} from '../src/domain/treasury';
import { addVisaPayment, createVisaRequest, decideVisaRequest, deleteVisaRequest, updateVisaRequest } from '../src/domain/visa';
import type { Department, OrganizationMember, Role, ServiceCategory, ServiceProvider } from '../src/types';
import { can, type Permission } from '../src/utils/permissions';
import { ORG, admin, draft, employee, finance, freshStore, key, notify, seedAccount } from './helpers';

const now = new Date('2026-09-30T10:00:00.000Z');
const ORG_B = 'org-beta';
const owner: Actor = { id: 'uidOwner000000000000000001', name: 'محمود', email: 'mahmoud@tieapps.com', role: 'super_admin' };
const dataEntry: Actor = { id: 'uidDataEntry00000000000001', name: 'مدخل', email: 'de@acme.test', role: 'data_entry', orgId: ORG };
const adminOfB: Actor = { id: 'uidAdminB0000000000000001', name: 'مدير القاهرة', email: 'admin@beta.test', role: 'org_admin', orgId: ORG_B };
const financeOfB: Actor = { id: 'uidFinanceB00000000000001', name: 'مالية القاهرة', email: 'fin@beta.test', role: 'finance', orgId: ORG_B };
const inOrg = (a: Actor): Actor => ({ ...a, orgId: ORG });

const ledger = (store: MemoryStore) => store.dump('accountTransactions');
const balance = (store: MemoryStore, id: string) => store.read('paymentAccounts', id)!.currentBalance;

// ---------------------------------------------------------------------------
// 1. No overdraft
// ---------------------------------------------------------------------------
describe('policy 1 — no money operation takes an account below zero', () => {
  it('a manual withdrawal above the balance is refused with a deposit-first message; nothing is written', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 28_750);
    const err = await adjustAccountBalance(store, finance, { accountId: 'cash', type: 'out', amount: 50_000, description: 'x' }, key(), now).catch(e => e);
    expect(err).toMatchObject({ code: 'insufficient_funds' });
    expect(err.message).toContain('يرجى إيداع المبلغ في الحساب أولاً');
    expect(err.message).toContain('28,750');
    expect(balance(store, 'cash')).toBe(28_750);
    expect(ledger(store)).toHaveLength(0);
    expect(store.dump('auditLogs')).toHaveLength(0);
    // exactly the balance is fine, and a deposit always is
    await adjustAccountBalance(store, finance, { accountId: 'cash', type: 'out', amount: 28_750, description: 'all' }, key(), now);
    await adjustAccountBalance(store, finance, { accountId: 'cash', type: 'in', amount: 100, description: 'dep' }, key(), now);
    expect(balance(store, 'cash')).toBe(100);
  });

  it('an InstaPay withdrawal also needs its linked bank to cover it', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 100, { type: 'bank' });
    seedAccount(store, 'insta', 5000, { type: 'instapay', parentAccountId: 'bank' });
    await expect(adjustAccountBalance(store, finance, { accountId: 'insta', type: 'out', amount: 500, description: 'x' }, key(), now))
      .rejects.toMatchObject({ code: 'insufficient_funds', message: expect.stringContaining('Account bank') });
    expect(balance(store, 'insta')).toBe(5000);
    expect(balance(store, 'bank')).toBe(100);
  });

  it('custody issue and replenishment are refused above the source balance (no custody, no number burnt)', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 1000);
    const issue = (amount: number) =>
      issueCustody(store, finance, { orgId: ORG, employeeId: employee.id, employeeName: employee.name, amount, sourceAccountId: 'cash' }, key(), now);
    await expect(issue(99_999)).rejects.toMatchObject({ code: 'insufficient_funds' });
    expect(store.dump('custodies')).toHaveLength(0);
    expect(store.read('counters', `custodies-${now.getFullYear()}`)).toBeNull();

    const c = await issue(600);
    await expect(replenishCustody(store, finance, { custodyId: c.value.id, amount: 500, sourceAccountId: 'cash' }, key(), now))
      .rejects.toMatchObject({ code: 'insufficient_funds' });
    expect(store.read('custodies', c.value.id)!.totalAmount).toBe(600);
    expect(balance(store, 'cash')).toBe(400);
  });

  it('custody money never comes from a deactivated account', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 1000, { active: false });
    await expect(issueCustody(store, finance, { orgId: ORG, employeeId: employee.id, employeeName: employee.name, amount: 10, sourceAccountId: 'cash' }, key(), now))
      .rejects.toMatchObject({ code: 'inactive_account' });
  });

  it('a transfer above the balance is refused with the same deposit-first message', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 100);
    seedAccount(store, 'bank', 0, { type: 'bank' });
    await expect(transferBetweenAccounts(store, finance, { fromAccountId: 'cash', toAccountId: 'bank', amount: 500 }, key(), now))
      .rejects.toMatchObject({ code: 'insufficient_funds', message: expect.stringContaining('يرجى إيداع المبلغ') });
  });

  it('the owner-confirmed bank correction of a legacy wallet may still take the bank below zero', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 100, { type: 'bank' });
    seedAccount(store, 'wallet', 0, { type: 'wallet', parentAccountId: 'bank', totalOut: 400 });
    await detachLegacyWallet(store, admin, { walletId: 'wallet', bankCorrection: -400 }, key(), now);
    expect(balance(store, 'bank')).toBe(-300);
  });
});

// ---------------------------------------------------------------------------
// Visas: acting approver, roles, payment checks (policies 1 and 5)
// ---------------------------------------------------------------------------
describe('visa requests', () => {
  const newVisa = (store: MemoryStore, who: Actor = employee, total = 1000, extra: Record<string, unknown> = {}) =>
    createVisaRequest(store, who, {
      orgId: ORG, requestDate: '2026-09-30', travelerName: 'T', passportNumber: 'P', destinationCountry: 'SA',
      hasTraveledBefore: false, expectedTravelDate: '2026-12-01', visaType: 'tourist', serviceProviderId: 'prov-1',
      serviceProviderName: 'AWS', assignedApprover: 'محمود', totalAmount: total, currency: 'EGP', paymentMode: 'installments',
      requesterId: who.id, requesterName: who.name, ...extra,
    }, key(), now);

  it('approval and rejection record the ACTING user, whatever name the caller passes', async () => {
    const store = freshStore();
    const a = await newVisa(store);
    await decideVisaRequest(store, admin, a.value.id, { type: 'approve', approverName: 'محمود' }, key(), now);
    expect(store.read('visaRequests', a.value.id)).toMatchObject({ approvedBy: admin.id, approvedByName: admin.name, status: 'approved' });
    expect(store.dump('auditLogs').some(l => l.details.includes(`قام "${admin.name}" باعتماد`))).toBe(true);

    const b = await newVisa(store);
    await decideVisaRequest(store, finance, b.value.id, { type: 'reject', reason: 'ناقص', approverName: 'محمود' }, key(), now);
    expect(store.read('visaRequests', b.value.id)).toMatchObject({ approvedBy: finance.id, approvedByName: finance.name, status: 'rejected' });
    expect(JSON.stringify(store.dump('auditLogs'))).not.toContain('بواسطة محمود');
  });

  it('only a company admin deletes a visa request (not its requester, not finance); edits are for staff', async () => {
    const store = freshStore();
    const v = await newVisa(store);
    await expect(deleteVisaRequest(store, employee, v.value.id, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(deleteVisaRequest(store, finance, v.value.id, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(updateVisaRequest(store, employee, v.value.id, { travelerName: 'X' }, now)).rejects.toMatchObject({ code: 'forbidden' });
    await updateVisaRequest(store, finance, v.value.id, { travelerName: 'Y', approvedByName: 'forged' } as any, now);
    expect(store.read('visaRequests', v.value.id)).toMatchObject({ travelerName: 'Y' });
    expect(store.read('visaRequests', v.value.id)!.approvedByName).toBeUndefined();
    await deleteVisaRequest(store, admin, v.value.id, key(), now);
    expect(store.read('visaRequests', v.value.id)).toBeNull();
  });

  it('an employee files a visa request in their own name only', async () => {
    const store = freshStore();
    await expect(newVisa(store, employee, 1000, { requesterId: admin.id, requesterName: admin.name })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a payment never overdraws, never comes from an inactive account or another currency', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 300);
    seedAccount(store, 'off', 10_000, { active: false });
    seedAccount(store, 'usd', 10_000, { currency: 'USD' });
    const v = await newVisa(store);
    await decideVisaRequest(store, admin, v.value.id, { type: 'approve' }, key(), now);
    const pay = (accountId: string, amount = 500) =>
      addVisaPayment(store, finance, v.value.id, { amount, currency: 'EGP', date: '2026-09-30', paymentMethod: 'cash', accountId }, key(), now);
    await expect(pay('cash')).rejects.toMatchObject({ code: 'insufficient_funds' });
    await expect(pay('off')).rejects.toMatchObject({ code: 'inactive_account' });
    await expect(pay('usd')).rejects.toMatchObject({ code: 'currency_mismatch' });
    expect(store.read('visaRequests', v.value.id)!.paidAmount).toBe(0);
    await pay('cash', 300);
    expect(balance(store, 'cash')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Treasury accounts with history are never deleted
// ---------------------------------------------------------------------------
describe('policy 2 — an account with a balance or history is deactivated, never deleted', () => {
  it('refuses a non-zero balance, a negative one and one whose money moved in and out; deletes an unused one', async () => {
    const store = freshStore();
    seedAccount(store, 'with-balance', 500);
    seedAccount(store, 'negative', -2500, { initialBalance: 0, totalOut: 2500 });
    seedAccount(store, 'moved', 0, { initialBalance: 0, totalIn: 300, totalOut: 300 });
    seedAccount(store, 'unused', 0, { initialBalance: 0 });
    for (const id of ['with-balance', 'negative', 'moved']) {
      const err = await deletePaymentAccount(store, admin, id, key(), now).catch(e => e);
      expect(err).toMatchObject({ code: 'account_has_history' });
      expect(err.message).toContain('يمكنك تعطيله بدلاً من الحذف');
      expect(store.read('paymentAccounts', id)).not.toBeNull();
    }
    await deletePaymentAccount(store, admin, 'unused', key(), now);
    expect(store.read('paymentAccounts', 'unused')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. + role alignment: services / providers / departments
// ---------------------------------------------------------------------------
const serviceOf = (orgId = ORG, extra: Partial<ServiceCategory> = {}) => (id: string): ServiceCategory => ({
  id, orgId, name: 'Catering', code: `CAT-${id.slice(-4)}`, description: '', budgetLimit: 0, spentAmount: 0, color: '#000', iconName: 'x', ...extra,
});
const providerOf = (name = 'Fawry') => (id: string, orgId: string): ServiceProvider => ({
  id, orgId, name, serviceCategoryIds: [], serviceCategoryNames: [], contactPerson: '', phone: '', email: '', taxNumber: '', crNumber: '',
  bankName: '', iban: '', address: '', rating: 5, totalPaid: 0, active: true,
});
const deptOf = (name = 'IT') => (id: string, orgId: string, nowIso: string): Department => ({ id, orgId, name, createdAt: nowIso });
const describe_ = () => 'x';
const noChange = () => ({ actionType: 'update' as const, details: 'x' });

describe('directory roles match firestore.rules (refused at once, nothing written)', () => {
  it('data entry adds providers and departments, never services; and edits none of them', async () => {
    const store = freshStore();
    await expect(createEntity(store, dataEntry, 'service', serviceOf(), describe_, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    expect(store.dump('services')).toHaveLength(1); // only the seeded one
    const prov = await createEntityInOrgs(store, dataEntry, 'provider', [ORG], providerOf(), describe_, key(), now);
    const dept = await createEntityInOrgs(store, dataEntry, 'department', [ORG], deptOf(), describe_, key(), now);
    const provId = prov.value.created[0].id;
    const deptId = dept.value.created[0].id;
    await expect(updateEntity(store, dataEntry, 'provider', provId, { contactPerson: 'x' }, noChange, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(updateEntity(store, dataEntry, 'department', deptId, { name: 'IT 2' }, noChange, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(updateEntity(store, dataEntry, 'service', 'srv-1', { name: 'x' }, noChange, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(deleteEntity(store, dataEntry, 'provider', provId, 'delete', key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    expect(store.read('providers', provId)!.contactPerson).toBe('');
  });

  it('finance edits services and providers but not departments; employees add nothing', async () => {
    const store = freshStore();
    store.seed('departments', 'd1', { id: 'd1', orgId: ORG, name: 'IT' });
    await updateEntity(store, finance, 'service', 'srv-1', { budgetLimit: 10 }, noChange, key(), now);
    await updateEntity(store, finance, 'provider', 'prov-1', { phone: '010' }, noChange, key(), now);
    await expect(updateEntity(store, finance, 'department', 'd1', { name: 'X' }, noChange, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createEntityInOrgs(store, employee, 'provider', [ORG], providerOf('E'), describe_, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createEntity(store, finance, 'service', serviceOf(), describe_, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it("a service another company shares with this one is usable here but edited / deleted only by its own company", async () => {
    const store = freshStore();
    store.seed('services', 'srv-shared', { id: 'srv-shared', orgId: ORG, orgIds: [ORG, ORG_B], name: 'WE Internet', code: 'WE', spentAmount: 0 });
    await expect(updateEntity(store, adminOfB, 'service', 'srv-shared', { name: 'x' }, noChange, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(updateEntity(store, financeOfB, 'service', 'srv-shared', { budgetLimit: 1 }, noChange, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(deleteEntity(store, adminOfB, 'service', 'srv-shared', 'delete', key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await updateEntity(store, inOrg(admin), 'service', 'srv-shared', { name: 'WE Internet 2' }, noChange, key(), now);
    expect(store.read('services', 'srv-shared')!.name).toBe('WE Internet 2');
  });

  it('only the platform owner shares a service with other companies', async () => {
    const store = freshStore();
    await expect(createEntity(store, inOrg(admin), 'service', serviceOf(ORG, { orgIds: [ORG, ORG_B] }), describe_, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await createEntity(store, inOrg(admin), 'service', serviceOf(ORG, { orgIds: [ORG] }), describe_, key(), now);
    await expect(updateEntity(store, inOrg(admin), 'service', 'srv-1', { orgIds: [ORG, ORG_B] }, noChange, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await updateEntity(store, owner, 'service', 'srv-1', { orgIds: [ORG, ORG_B] }, noChange, key(), now);
    // an admin of the owning company may keep the list as it is (saving the form unchanged) or narrow it to their own
    await updateEntity(store, inOrg(admin), 'service', 'srv-1', { name: 'Cloud 2', orgIds: [ORG, ORG_B] }, noChange, key(), now);
    await updateEntity(store, inOrg(admin), 'service', 'srv-1', { orgIds: [ORG] }, noChange, key(), now);
    expect(store.read('services', 'srv-1')!.orgIds).toEqual([ORG]);
  });
});

describe('policy 3 — a record money went through is deactivated, never hard-deleted', () => {
  it('a service with spending and a paid provider are deactivated even when a delete is asked', async () => {
    const store = freshStore();
    store.seed('services', 'srv-spent', { id: 'srv-spent', orgId: ORG, name: 'Spent', code: 'SP', spentAmount: 250 });
    store.seed('providers', 'prov-paid', { id: 'prov-paid', orgId: ORG, name: 'Paid', totalPaid: 900, active: true });
    const s = await deleteEntity(store, admin, 'service', 'srv-spent', 'delete', key(), now);
    const p = await deleteEntity(store, admin, 'provider', 'prov-paid', 'delete', key(), now);
    expect([s.removal, p.removal]).toEqual(['deactivated', 'deactivated']);
    expect(store.read('services', 'srv-spent')).toMatchObject({ active: false });
    expect(store.read('providers', 'prov-paid')).toMatchObject({ active: false });
    // again: already inactive, nothing written
    const again = await deleteEntity(store, admin, 'provider', 'prov-paid', 'deactivate', key(), now);
    expect(again).toMatchObject({ changed: false, removal: 'deactivated' });
  });

  it('an unused provider is deleted (and says so); an in-use one is deactivated when the caller asks', async () => {
    const store = freshStore();
    const res = await createEntityInOrgs(store, admin, 'provider', [ORG], providerOf('Unused'), describe_, key(), now);
    const id = res.value.created[0].id;
    expect((await deleteEntity(store, admin, 'provider', id, 'delete', key(), now)).removal).toBe('deleted');
    expect(store.read('providers', id)).toBeNull();
    expect((await deleteEntity(store, admin, 'provider', 'prov-1', 'deactivate', key(), now)).removal).toBe('deactivated');
    expect(store.read('providers', 'prov-1')).toMatchObject({ active: false });
  });
});

// ---------------------------------------------------------------------------
// 4. Protected memberships + self edits
// ---------------------------------------------------------------------------
const OWNER_MEM = `${owner.id}_${ORG}`;
const ADMIN_MEM = `${admin.id}_${ORG}`;
const DE_MEM = `${dataEntry.id}_${ORG}`;
const memberDoc = (id: string, userId: string, userEmail: string, role: OrganizationMember['role'], extra: Record<string, unknown> = {}) => ({
  id, orgId: ORG, userId, userName: userEmail.split('@')[0], userEmail, role, department: '', jobTitle: '', joinedAt: '2026-01-01', active: true, ...extra,
});
function membersStore() {
  const store = freshStore();
  store.seed('members', OWNER_MEM, memberDoc(OWNER_MEM, owner.id, owner.email, 'org_admin'));
  store.seed('members', ADMIN_MEM, memberDoc(ADMIN_MEM, admin.id, admin.email, 'org_admin'));
  store.seed('members', DE_MEM, memberDoc(DE_MEM, dataEntry.id, dataEntry.email, 'data_entry'));
  return store;
}

describe("policy 4 — an org admin never removes, suspends or re-roles the owner's membership or their own", () => {
  it('delete of the owner / own membership is refused; another member can be deleted', async () => {
    const store = membersStore();
    await expect(removeMember(store, admin, OWNER_MEM, [], key(), now)).rejects.toMatchObject({ code: 'protected_member' });
    await expect(removeMember(store, admin, ADMIN_MEM, [], key(), now)).rejects.toMatchObject({ code: 'protected_member' });
    expect(store.read('members', OWNER_MEM)).not.toBeNull();
    expect(store.read('members', ADMIN_MEM)).not.toBeNull();
    await removeMember(store, admin, DE_MEM, [], key(), now);
    expect(store.read('members', DE_MEM)).toBeNull();
  });

  it('suspending or re-roling the owner / oneself is refused; a name edit (whole form sent back) is fine', async () => {
    const store = membersStore();
    for (const id of [OWNER_MEM, ADMIN_MEM]) {
      await expect(updateMemberRecord(store, admin, id, { active: false }, [], key(), now)).rejects.toMatchObject({ code: 'protected_member' });
      await expect(updateMemberRecord(store, admin, id, { role: 'employee' }, [], key(), now)).rejects.toMatchObject({ code: 'protected_member' });
    }
    await updateMemberRecord(store, admin, ADMIN_MEM, { userName: 'مدير طنطا', role: 'org_admin', orgId: ORG, active: true, userEmail: 'ADMIN@acme.test' }, [], key(), now);
    expect(store.read('members', ADMIN_MEM)).toMatchObject({ userName: 'مدير طنطا', role: 'org_admin', active: true });
  });

  it('the platform owner (super admin) can do all of it', async () => {
    const store = membersStore();
    await updateMemberRecord(store, owner, ADMIN_MEM, { active: false }, [], key(), now);
    await removeMember(store, owner, OWNER_MEM, [], key(), now);
    expect(store.read('members', ADMIN_MEM)!.active).toBe(false);
    expect(store.read('members', OWNER_MEM)).toBeNull();
  });

  it('a non-admin saves their own record with the unchanged role/company/status the form sends; changing them is refused', async () => {
    const store = membersStore();
    await updateMemberRecord(store, dataEntry, DE_MEM, { userName: 'مدخل بيانات', phone: '0100', role: 'data_entry', orgId: ORG, active: true }, [], key(), now);
    expect(store.read('members', DE_MEM)).toMatchObject({ userName: 'مدخل بيانات', phone: '0100', role: 'data_entry' });
    await expect(updateMemberRecord(store, dataEntry, DE_MEM, { role: 'org_admin' }, [], key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(updateMemberRecord(store, dataEntry, ADMIN_MEM, { userName: 'x' }, [], key(), now)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('an org admin never moves a membership to another company (the platform owner can)', async () => {
    const store = membersStore();
    await expect(updateMemberRecord(store, admin, DE_MEM, { orgId: ORG_B }, [], key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    expect(store.read('members', DE_MEM)!.orgId).toBe(ORG);
    await updateMemberRecord(store, owner, DE_MEM, { orgId: ORG_B }, [], key(), now);
    // moved to the id the rules look it up by (<userId>_<orgId>)
    expect(store.read('members', DE_MEM)).toBeNull();
    expect(store.read('members', `${dataEntry.id}_${ORG_B}`)).toMatchObject({ orgId: ORG_B, userId: dataEntry.id, role: 'data_entry' });
  });

  it('an empty name is refused on edit and on create', async () => {
    const store = membersStore();
    await expect(updateMemberRecord(store, admin, DE_MEM, { userName: '   ' }, [], key(), now)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(createMember(store, admin, { orgId: ORG, userId: '', userName: ' ', userEmail: 'x@acme.test', role: 'employee', department: '', jobTitle: '', active: true }, key())).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

// ---------------------------------------------------------------------------
// 8. Payout details: users/{uid} only
// ---------------------------------------------------------------------------
const EMP_MEM = `${employee.id}_${ORG}`;
const payout = { instapay: 'sara@instapay', wallet: '01012345678', walletProvider: 'فودافون كاش', bankName: 'بنك', iban: 'EG000000000000000000000E2E01', preferredPaymentMethod: 'bank_transfer' };

describe('policy 8 — payout details are never kept in a membership', () => {
  it('createMember drops payout fields; an admin edit writes given payout to the profile, never the membership, and never wipes the profile', async () => {
    const store = freshStore();
    await createMember(store, admin, { orgId: ORG, userId: employee.id, userName: 'سارة', userEmail: employee.email, role: 'employee', department: '', jobTitle: '', active: true, ...payout } as any, key());
    const mem = store.read('members', EMP_MEM)!;
    for (const f of Object.keys(payout)) expect(f in mem).toBe(false);

    store.seed('users', employee.id, { uid: employee.id, orgId: ORG, role: 'employee', memberId: EMP_MEM, ...payout });
    await updateMemberRecord(store, admin, EMP_MEM, { userName: 'سارة أحمد' }, [employee.id], key(), now);
    expect(store.read('users', employee.id)).toMatchObject({ name: 'سارة أحمد', ...payout }); // not wiped

    await updateMemberRecord(store, admin, EMP_MEM, { iban: 'EG11' } as any, [employee.id], key(), now);
    expect(store.read('users', employee.id)!.iban).toBe('EG11');
    expect('iban' in store.read('members', EMP_MEM)!).toBe(false);
  });

  it("the user's own save removes the payout an older version copied into their membership, and updates name / phone", async () => {
    const store = freshStore();
    store.seed('members', EMP_MEM, memberDoc(EMP_MEM, employee.id, employee.email, 'employee', payout));
    const res = await syncOwnMembership(store, employee, EMP_MEM, { userName: 'سارة', phone: '0111' }, now);
    expect(res.changed).toBe(true);
    const mem = store.read('members', EMP_MEM)!;
    expect(mem).toMatchObject({ userName: 'سارة', phone: '0111', role: 'employee', orgId: ORG, userId: employee.id, active: true });
    for (const f of Object.keys(payout)) expect(f in mem).toBe(false);
    // nothing left to do → no write; someone else's membership → refused
    expect((await syncOwnMembership(store, employee, EMP_MEM, { userName: 'سارة', phone: '0111' }, now)).changed).toBe(false);
    expect((await syncOwnMembership(store, employee, ADMIN_MEM, {}, now)).value).toBeNull(); // no such membership
    store.seed('members', ADMIN_MEM, memberDoc(ADMIN_MEM, admin.id, admin.email, 'org_admin'));
    await expect(syncOwnMembership(store, employee, ADMIN_MEM, {}, now)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('the admin clean-up moves values the profile lacks, keeps the ones it has, and empties the membership', async () => {
    const store = freshStore();
    store.seed('members', EMP_MEM, memberDoc(EMP_MEM, employee.id, employee.email, 'employee', payout));
    store.seed('users', employee.id, { uid: employee.id, orgId: ORG, role: 'employee', iban: 'EG-PROFILE' });
    const res = await movePayoutToProfile(store, admin, EMP_MEM, now);
    expect(res).toMatchObject({ value: 'moved', changed: true });
    expect(store.read('users', employee.id)).toMatchObject({ ...payout, iban: 'EG-PROFILE' });
    const mem = store.read('members', EMP_MEM)!;
    for (const f of Object.keys(payout)) expect(f in mem).toBe(false);
    expect(mem).toMatchObject({ role: 'employee', orgId: ORG, userId: employee.id });
    expect((await movePayoutToProfile(store, admin, EMP_MEM, now)).value).toBe('nothing_to_move');
  });

  it('a membership whose person never signed in keeps its values (nothing is lost); empty leftovers are just removed', async () => {
    const store = freshStore();
    store.seed('members', 'pending-x_org', memberDoc('pending-x_org', 'pending-x', 'x@acme.test', 'employee', { iban: 'EG99' }));
    expect((await movePayoutToProfile(store, admin, 'pending-x_org', now)).value).toBe('no_profile');
    expect(store.read('members', 'pending-x_org')!.iban).toBe('EG99');
    store.seed('members', 'pending-y_org', memberDoc('pending-y_org', 'pending-y', 'y@acme.test', 'employee', { iban: '', instapay: '' }));
    expect((await movePayoutToProfile(store, admin, 'pending-y_org', now)).value).toBe('moved');
    expect('iban' in store.read('members', 'pending-y_org')!).toBe(false);
    await expect(movePayoutToProfile(store, employee, 'pending-x_org', now)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

// ---------------------------------------------------------------------------
// src/utils/permissions.ts (what the screens show) == what the domain allows
// ---------------------------------------------------------------------------
describe('permissions.ts shows an action to exactly the roles the domain allows', () => {
  const ROLES: Role[] = ['super_admin', 'org_admin', 'finance', 'data_entry', 'employee'];
  /** true when the domain lets the role through its role check (other failures do not count). */
  const allowed = (p: Promise<unknown>) => p.then(() => true, e => e?.code !== 'forbidden');
  const visaStore = async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 10_000);
    const v = await createVisaRequest(store, employee, {
      orgId: ORG, requestDate: '2026-09-30', travelerName: 'T', passportNumber: 'P', destinationCountry: 'SA', hasTraveledBefore: false,
      expectedTravelDate: '2026-12-01', visaType: 'tourist', serviceProviderId: 'prov-1', serviceProviderName: 'AWS', assignedApprover: '',
      totalAmount: 100, currency: 'EGP', paymentMode: 'full', requesterId: employee.id, requesterName: employee.name,
    }, key(), now);
    return { store, id: v.value.id };
  };
  /** A request by the employee, pending or already approved, and a funded cash box. */
  const requestStore = async (approve = false) => {
    const store = freshStore();
    seedAccount(store, 'cash', 10_000);
    const res = await createExpenseRequest(store, employee, draft({ amount: 100 }), key(), notify, now);
    if (approve) await transitionExpenseRequest(store, admin, res.value.id, { type: 'approve' }, key(), notify, now);
    return { store, id: res.value.id };
  };
  const checks: Array<[Permission, (who: Actor) => Promise<unknown>]> = [
    ['approveRequests', async who => { const { store, id } = await requestStore(); return transitionExpenseRequest(store, who, id, { type: 'approve' }, key(), notify, now); }],
    ['rejectRequests', async who => { const { store, id } = await requestStore(); return transitionExpenseRequest(store, who, id, { type: 'reject', reason: 'r' }, key(), notify, now); }],
    ['clarifyRequests', async who => { const { store, id } = await requestStore(); return transitionExpenseRequest(store, who, id, { type: 'clarify', question: 'q' }, key(), notify, now); }],
    ['disburseRequests', async who => {
      const { store, id } = await requestStore(true);
      return disburseExpenseRequest(store, who, id, { paymentMethod: 'cash', referenceNumber: 'R-1', accountId: 'cash' }, key(), notify, now);
    }],
    ['createAccounts', who => createPaymentAccount(freshStore(), who, { orgId: ORG, name: 'N', type: 'cash', accountIdentifier: 'NEW-1', currency: 'EGP', active: true, initialBalance: 0 } as never, key(), now)],
    ['editAccounts', who => { const s = freshStore(); seedAccount(s, 'cash', 0); return updatePaymentAccount(s, who, 'cash', { name: 'Renamed' }, key(), now); }],
    ['detachWallets', who => {
      const s = freshStore();
      seedAccount(s, 'bank', 1000, { type: 'bank' });
      seedAccount(s, 'wallet', 0, { type: 'wallet', parentAccountId: 'bank' });
      return detachLegacyWallet(s, who, { walletId: 'wallet', bankCorrection: 0 }, key(), now);
    }],
    ['payVisas', async who => {
      const { store, id } = await visaStore();
      await decideVisaRequest(store, admin, id, { type: 'approve' }, key(), now);
      return addVisaPayment(store, who, id, { amount: 10, currency: 'EGP', date: '2026-09-30', paymentMethod: 'cash', accountId: 'cash' }, key(), now);
    }],
    ['createServices', who => createEntity(freshStore(), who, 'service', serviceOf(), describe_, key(), now)],
    ['editServices', who => updateEntity(freshStore(), who, 'service', 'srv-1', { budgetLimit: 1 }, noChange, key(), now)],
    ['deleteServices', who => deleteEntity(freshStore(), who, 'service', 'srv-1', 'delete', key(), now)],
    ['createProviders', who => createEntityInOrgs(freshStore(), who, 'provider', [ORG], providerOf(), describe_, key(), now)],
    ['editProviders', who => updateEntity(freshStore(), who, 'provider', 'prov-1', { phone: '1' }, noChange, key(), now)],
    ['deleteProviders', who => deleteEntity(freshStore(), who, 'provider', 'prov-1', 'delete', key(), now)],
    ['createDepartments', who => createEntityInOrgs(freshStore(), who, 'department', [ORG], deptOf(), describe_, key(), now)],
    ['editDepartments', who => { const s = freshStore(); s.seed('departments', 'd', { id: 'd', orgId: ORG, name: 'D' }); return updateEntity(s, who, 'department', 'd', { name: 'E' }, noChange, key(), now); }],
    ['deleteDepartments', who => { const s = freshStore(); s.seed('departments', 'd', { id: 'd', orgId: ORG, name: 'D' }); return deleteEntity(s, who, 'department', 'd', 'delete', key(), now); }],
    ['moveMoney', who => { const s = freshStore(); seedAccount(s, 'cash', 100); return adjustAccountBalance(s, who, { accountId: 'cash', type: 'in', amount: 1, description: '' }, key(), now); }],
    ['issueCustody', who => { const s = freshStore(); seedAccount(s, 'cash', 100); return issueCustody(s, who, { orgId: ORG, employeeId: employee.id, employeeName: 'e', amount: 1, sourceAccountId: 'cash' }, key(), now); }],
    ['deleteAccounts', who => { const s = freshStore(); seedAccount(s, 'cash', 0, { initialBalance: 0 }); return deletePaymentAccount(s, who, 'cash', key(), now); }],
    ['manageUsers', who => createMember(freshStore(), who, { orgId: ORG, userId: '', userName: 'N', userEmail: 'n@acme.test', role: 'employee', department: '', jobTitle: '', active: true }, key())],
    ['decideVisas', async who => { const { store, id } = await visaStore(); return decideVisaRequest(store, who, id, { type: 'approve' }, key(), now); }],
    ['editVisas', async who => { const { store, id } = await visaStore(); return updateVisaRequest(store, who, id, { notes: 'n' }, now); }],
    ['deleteVisas', async who => { const { store, id } = await visaStore(); return deleteVisaRequest(store, who, id, key(), now); }],
  ];

  for (const [permission, run] of checks) {
    it(permission, async () => {
      for (const role of ROLES) {
        const who: Actor = { id: `uid${role.replace('_', '')}000000000000001`, name: role, email: `${role}@acme.test`, role };
        expect({ role, allowed: await allowed(run(who)) }).toEqual({ role, allowed: can(role, permission) });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Stored texts: Arabic labels, never raw codes
// ---------------------------------------------------------------------------
describe('stored texts use Arabic labels', () => {
  it('the request timeline names the payment method in Arabic', async () => {
    const store = freshStore();
    const res = await createExpenseRequest(store, employee, draft({ preferredPaymentMethod: 'instapay', paymentAccountDetails: '01000000000' }), key(), notify, now);
    expect(res.value.timeline[0].description).toBe('طريقة التحويل: انستاباي (InstaPay) (01000000000)');
    const bank = await createExpenseRequest(store, employee, draft({ preferredPaymentMethod: 'bank_transfer', paymentAccountDetails: 'EG12' }), key(), notify, now);
    expect(bank.value.timeline[0].description).toBe('طريقة التحويل: تحويل بنكي (EG12)');
  });

  it('member audit entries name the role in Arabic', async () => {
    const store = freshStore();
    await createMember(store, admin, { orgId: ORG, userId: '', userName: 'مدير', userEmail: 'boss@acme.test', role: 'org_admin', department: '', jobTitle: '', active: true }, key());
    const details = store.dump('auditLogs').map(l => l.details).join('\n');
    expect(details).toContain('برتبة مدير الشركة');
    expect(details).not.toContain('org_admin');
  });
});
