/**
 * One add operation for several companies (company multi-select): memberships,
 * providers and departments become one document per company, all in ONE transaction,
 * idempotent under retries, and a company where the email / name is taken is skipped.
 */
import { describe, expect, it } from 'vitest';
import { DomainError, uniqueKeyDocId, type Actor } from '../src/domain/common';
import {
  MAX_ORGS_PER_OPERATION,
  ORGS_PER_TRANSACTION,
  PLATFORM_OWNER_EMAILS,
  createEntityInOrgs,
  createMemberInOrgs,
  entityIdInOrg,
  isPlatformOwnerEmail,
  knownLoginUidOf,
  pendingUserIdForEmail,
  reusableProvisionedAccount,
  verifiedLoginUidOf,
} from '../src/domain/directory';
import type { MemoryStore } from '../src/domain/store';
import type { Department, OrganizationMember, ServiceProvider } from '../src/types';
import { ORG, admin, burst, employee, finance, freshStore, key } from './helpers';

const ORG_B = 'org-beta';
const ORG_C = 'org-gamma';
const now = new Date('2026-09-29T10:00:00.000Z');
const owner: Actor = { id: 'uidOwner000000000000000001', name: 'Owner', email: 'mahmoud@tieapps.com', role: 'super_admin' };
const dataEntry: Actor = { id: 'uidDataEntry00000000000001', name: 'مدخل', email: 'de@acme.test', role: 'data_entry' };

function multiOrgStore(): MemoryStore {
  const store = freshStore();
  store.seed('organizations', ORG, { ...store.read('organizations', ORG)!, notificationRecipients: [] });
  store.seed('organizations', ORG_B, { id: ORG_B, name: 'Beta', code: 'BETA', currency: 'EGP', budget: 1, description: '', notificationRecipients: ['boss@beta.test'] });
  store.seed('organizations', ORG_C, { id: ORG_C, name: 'Gamma', code: 'GAM', currency: 'EGP', budget: 1, description: '', notificationRecipients: [] });
  return store;
}

const person = (overrides: Partial<Omit<OrganizationMember, 'orgId'>> = {}): Omit<OrganizationMember, 'id' | 'joinedAt' | 'orgId'> => ({
  userId: '',
  userName: 'Mahmoud',
  userEmail: 'Multi@Tie.test',
  role: 'org_admin',
  department: 'الإدارة العامة',
  jobTitle: 'مدير',
  active: true,
  ...overrides,
});

const EMAIL = 'multi@tie.test';
const PENDING = pendingUserIdForEmail(EMAIL);
const audits = (store: MemoryStore) => store.dump('auditLogs');

/** Seeds an existing membership (document + email unique key) the way createMember writes it. */
function seedMember(store: MemoryStore, orgId: string, id: string, userName: string, email = EMAIL) {
  store.seed('members', id, { id, orgId, userId: id.split('_')[0], userName, userEmail: email, role: 'employee', department: '', jobTitle: '', joinedAt: '2026-01-01', active: true });
  store.seed('uniqueKeys', uniqueKeyDocId('member_email', orgId, email), { scope: 'member_email', orgId, value: email, entityCollection: 'members', entityId: id });
}

const provider = (name = 'Vodafone') => (id: string, orgId: string): ServiceProvider => ({
  id, orgId, name, serviceCategoryIds: [], serviceCategoryNames: [], contactPerson: '', phone: '010', email: '', taxNumber: '', crNumber: '',
  bankName: '', iban: '', address: '', rating: 5, totalPaid: 0, active: true,
});
const department = (name = 'المالية') => (id: string, orgId: string, nowIso: string): Department => ({ id, orgId, name, createdAt: nowIso });
const describeProvider = (p: ServiceProvider) => `مورد جديد: "${p.name}"`;
const describeDept = (d: Department) => `قسم جديد: "${d.name}"`;

describe('createMemberInOrgs — one person, several companies', () => {
  it('adds the member to 3 companies in ONE transaction: 3 memberships, 3 audits, recipients of each company', async () => {
    const store = multiOrgStore();
    const commits = store.commits;
    const k = key();
    const res = await createMemberInOrgs(store, owner, person(), [ORG, ORG_B, ORG_C], k, now);

    expect(res.changed).toBe(true);
    expect(store.commits).toBe(commits + 1);
    expect(res.value.created.map(m => m.orgId)).toEqual([ORG, ORG_B, ORG_C]);
    expect(res.value.skipped).toEqual([]);
    for (const orgId of [ORG, ORG_B, ORG_C]) {
      expect(store.read('members', `${PENDING}_${orgId}`)).toMatchObject({ orgId, userId: PENDING, userEmail: EMAIL, role: 'org_admin', operationKey: k });
      expect(store.read('uniqueKeys', uniqueKeyDocId('member_email', orgId, EMAIL))).toMatchObject({ entityId: `${PENDING}_${orgId}` });
      expect(store.read('auditLogs', `audit-${k}-${orgId}`)).toMatchObject({ entityType: 'member', actionType: 'create', orgId, actorId: owner.id });
    }
    expect(audits(store)).toHaveLength(3);
    expect(store.read('organizations', ORG)!.notificationRecipients).toEqual([EMAIL]);
    expect(store.read('organizations', ORG_B)!.notificationRecipients).toEqual(['boss@beta.test', EMAIL]);
    expect(store.read('organizations', ORG_C)!.notificationRecipients).toEqual([EMAIL]);
  });

  it('an employee role is added everywhere without becoming a notification recipient', async () => {
    const store = multiOrgStore();
    await createMemberInOrgs(store, owner, person({ role: 'employee' }), [ORG, ORG_C], key(), now);
    expect(store.read('organizations', ORG)!.notificationRecipients).toEqual([]);
    expect(store.read('organizations', ORG_C)!.notificationRecipients).toEqual([]);
  });

  it('skips a company where the person already belongs (with their name) and adds the others', async () => {
    const store = multiOrgStore();
    seedMember(store, ORG_B, `${PENDING}_${ORG_B}`, 'Mahmoud (Beta)');
    // Same email under another user id (e.g. an account that already signed in): found through the email key.
    seedMember(store, ORG_C, `uidRealAccount00000000000001_${ORG_C}`, 'Mahmoud (Gamma)');
    const k = key();
    const res = await createMemberInOrgs(store, owner, person(), [ORG, ORG_B, ORG_C], k, now);

    expect(res.changed).toBe(true);
    expect(res.value.created.map(m => m.orgId)).toEqual([ORG]);
    expect(res.value.skipped).toEqual([
      { orgId: ORG_B, reason: 'already_member', existingName: 'Mahmoud (Beta)' },
      { orgId: ORG_C, reason: 'already_member', existingName: 'Mahmoud (Gamma)' },
    ]);
    expect(store.read('members', `${PENDING}_${ORG_B}`)!.userName).toBe('Mahmoud (Beta)'); // untouched
    expect(store.read('members', `${PENDING}_${ORG_C}`)).toBeNull();
    expect(audits(store).map(a => a.id)).toEqual([`audit-${k}-${ORG}`]);
  });

  it('refuses with a clear message when the person already belongs to EVERY selected company, writing nothing', async () => {
    const store = multiOrgStore();
    seedMember(store, ORG, `${PENDING}_${ORG}`, 'A');
    seedMember(store, ORG_B, `${PENDING}_${ORG_B}`, 'B');
    const commits = store.commits;
    const err = await createMemberInOrgs(store, owner, person(), [ORG, ORG_B], key(), now).catch(e => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('duplicate');
    expect(err.message).toContain('كل الشركات المختارة');
    expect(store.commits).toBe(commits);
    expect(audits(store)).toHaveLength(0);

    const single = await createMemberInOrgs(store, owner, person(), [ORG], key(), now).catch(e => e);
    expect(single.message).toContain('باسم "A"');
  });

  it('a burst with the same key (double click, two tabs) creates each membership once; the retries report duplicate_operation', async () => {
    const store = multiOrgStore();
    const k = key();
    const results = await burst(5, () => createMemberInOrgs(store, owner, person(), [ORG, ORG_B, ORG_C], k, now));
    const values = results.map(r => (r.status === 'fulfilled' ? r.value : null));
    expect(values.every(Boolean)).toBe(true);
    expect(values.filter(v => v!.changed)).toHaveLength(1);
    for (const v of values.filter(v => !v!.changed)) {
      expect(v!.reason).toBe('duplicate_operation');
      expect(v!.value.created.map(m => m.orgId)).toEqual([ORG, ORG_B, ORG_C]);
    }
    expect(store.dump('members')).toHaveLength(3);
    expect(audits(store)).toHaveLength(3);
    expect(store.read('organizations', ORG_B)!.notificationRecipients).toEqual(['boss@beta.test', EMAIL]);
  });

  it('a retry after a partial skip resolves to the same outcome instead of failing as a duplicate', async () => {
    const store = multiOrgStore();
    seedMember(store, ORG_B, `${PENDING}_${ORG_B}`, 'B');
    const k = key();
    await createMemberInOrgs(store, owner, person(), [ORG, ORG_B], k, now);
    const again = await createMemberInOrgs(store, owner, person(), [ORG, ORG_B], k, now);
    expect(again).toMatchObject({ changed: false, reason: 'duplicate_operation' });
    expect(again.value.created.map(m => m.orgId)).toEqual([ORG]);
    expect(again.value.skipped).toEqual([{ orgId: ORG_B, reason: 'already_member', existingName: 'B' }]);
  });

  it('never grants super admin — not even when the platform owner asks', async () => {
    const store = multiOrgStore();
    for (const actor of [owner, admin]) {
      await expect(createMemberInOrgs(store, actor, person({ role: 'super_admin' }), [ORG], key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(store.dump('members')).toHaveLength(0);
  });

  it('needs 1..50 distinct companies (trimmed and de-duplicated)', async () => {
    const store = multiOrgStore();
    await expect(createMemberInOrgs(store, owner, person(), [], key(), now)).rejects.toMatchObject({ code: 'missing_org' });
    await expect(createMemberInOrgs(store, owner, person(), ['  ', 'all'], key(), now)).rejects.toMatchObject({ code: 'missing_org' });
    const tooMany = Array.from({ length: MAX_ORGS_PER_OPERATION + 1 }, (_, i) => `org-${i}`);
    await expect(createMemberInOrgs(store, owner, person(), tooMany, key(), now)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(store.commits).toBe(0);

    const res = await createMemberInOrgs(store, owner, person(), [ORG, ` ${ORG} `, ORG], key(), now);
    expect(res.value.created).toHaveLength(1);
  });

  it('refuses employees and finance; an org admin may add (the rules then limit them to their own company)', async () => {
    const store = multiOrgStore();
    for (const actor of [employee, finance, dataEntry]) {
      await expect(createMemberInOrgs(store, actor, person(), [ORG], key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(store.dump('members')).toHaveLength(0);
    const res = await createMemberInOrgs(store, admin, person({ role: 'finance' }), [ORG], key(), now);
    expect(res.value.created[0]).toMatchObject({ orgId: ORG, role: 'finance' });
  });

  it('an unknown or archived company fails the whole operation (nothing is written anywhere)', async () => {
    const store = multiOrgStore();
    await expect(createMemberInOrgs(store, owner, person(), [ORG, 'org-missing'], key(), now)).rejects.toMatchObject({ code: 'not_found' });
    store.seed('organizations', ORG_C, { ...store.read('organizations', ORG_C)!, archived: true, status: 'archived' });
    await expect(createMemberInOrgs(store, owner, person(), [ORG, ORG_C], key(), now)).rejects.toMatchObject({ code: 'archived_org' });
    expect(store.dump('members')).toHaveLength(0);
    expect(audits(store)).toHaveLength(0);
  });

  it('more companies than ORGS_PER_TRANSACTION: one commit per chunk (rules read budget), same result, a retry writes nothing', async () => {
    const store = multiOrgStore();
    const many = Array.from({ length: 2 * ORGS_PER_TRANSACTION + 3 }, (_, i) => `org-m${i}`);
    for (const o of many) store.seed('organizations', o, { id: o, name: o, code: o, currency: 'EGP', budget: 1, description: '', notificationRecipients: [] });
    const k = key();
    const res = await createMemberInOrgs(store, owner, person({ role: 'org_admin' }), many, k, now);
    expect(res.value.created.map(m => m.orgId)).toEqual(many);
    expect(store.commits).toBe(3);
    expect(audits(store)).toHaveLength(many.length);
    const again = await createMemberInOrgs(store, owner, person({ role: 'org_admin' }), many, k, now);
    expect(again.changed).toBe(false);
    expect(again.value.created).toHaveLength(many.length);
    expect(store.commits).toBe(3);
    // an archived company anywhere in the list fails the operation before any chunk is written
    store.seed('organizations', many[40 % many.length], { ...store.read('organizations', many[40 % many.length])!, archived: true, status: 'archived' });
    await expect(createEntityInOrgs(store, owner, 'department', many, (id, orgId, nowIso) => ({ id, orgId, name: 'Ops', createdAt: nowIso } as Department), () => 'x', key(), now))
      .rejects.toMatchObject({ code: 'archived_org' });
    expect(store.dump('departments')).toHaveLength(0);
  });

  it('re-uses a known real UID for every company', async () => {
    const store = multiOrgStore();
    const uid = 'uidKnownAccount000000000001';
    await createMemberInOrgs(store, owner, person({ userId: uid }), [ORG, ORG_B], key(), now);
    expect(store.read('members', `${uid}_${ORG}`)).toMatchObject({ userId: uid });
    expect(store.read('members', `${uid}_${ORG_B}`)).toMatchObject({ userId: uid });
  });
});

describe('createEntityInOrgs — providers and departments in several companies', () => {
  it('a provider for 2 companies is 2 documents with their own orgId, totals and name keys; the one holding the name is skipped', async () => {
    const store = multiOrgStore();
    // Beta already has "Vodafone" (document + name key).
    store.seed('providers', 'prov-beta-voda', { ...provider('Vodafone ')('prov-beta-voda', ORG_B), totalPaid: 900 });
    store.seed('uniqueKeys', uniqueKeyDocId('provider_name', ORG_B, 'Vodafone'), { scope: 'provider_name', orgId: ORG_B, value: 'vodafone', entityCollection: 'providers', entityId: 'prov-beta-voda' });
    const commits = store.commits;
    const k = key();
    const res = await createEntityInOrgs(store, admin, 'provider', [ORG, ORG_B, ORG_C], provider(), describeProvider, k, now);

    expect(store.commits).toBe(commits + 1);
    expect(res.value.created.map(p => [p.id, p.orgId])).toEqual([
      [entityIdInOrg('provider', k, ORG), ORG],
      [entityIdInOrg('provider', k, ORG_C), ORG_C],
    ]);
    expect(res.value.skipped).toEqual([{ orgId: ORG_B, reason: 'duplicate', existingName: 'Vodafone ' }]);
    for (const orgId of [ORG, ORG_C]) {
      const id = `prov-${k}-${orgId}`;
      expect(store.read('providers', id)).toMatchObject({ orgId, name: 'Vodafone', totalPaid: 0, active: true });
      expect(store.read('uniqueKeys', uniqueKeyDocId('provider_name', orgId, 'Vodafone'))).toMatchObject({ entityId: id, orgId });
      expect(store.read('auditLogs', `audit-${k}-${orgId}`)).toMatchObject({ entityType: 'provider', entityId: id, orgId });
    }
    expect(store.read('providers', 'prov-beta-voda')!.totalPaid).toBe(900);
  });

  it('the id and orgId always come from the operation, whatever the builder returns', async () => {
    const store = multiOrgStore();
    const k = key();
    const res = await createEntityInOrgs(store, admin, 'provider', [ORG, ORG_B], (id, orgId) => ({ ...provider()(id, orgId), id: 'forged', orgId: ORG }), describeProvider, k, now);
    expect(res.value.created.map(p => p.orgId)).toEqual([ORG, ORG_B]);
    expect(store.read('providers', 'forged')).toBeNull();
  });

  it('replaying the same key is a no-op (changed:false) and never duplicates a document', async () => {
    const store = multiOrgStore();
    const k = key();
    const results = await burst(4, () => createEntityInOrgs(store, admin, 'provider', [ORG, ORG_B], provider(), describeProvider, k, now));
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    const values = results.map(r => (r as PromiseFulfilledResult<any>).value);
    expect(values.filter(v => v.changed)).toHaveLength(1);
    expect(values.filter(v => !v.changed).every(v => v.reason === 'duplicate_operation' && v.value.created.length === 2)).toBe(true);
    expect(store.dump('providers').filter(p => p.name === 'Vodafone')).toHaveLength(2);
    expect(audits(store)).toHaveLength(2);
  });

  it('refuses when the name exists in every selected company, writing nothing', async () => {
    const store = multiOrgStore();
    const first = await createEntityInOrgs(store, admin, 'department', [ORG, ORG_B], department(), describeDept, key(), now);
    expect(first.value.created).toHaveLength(2);
    const commits = store.commits;
    const err = await createEntityInOrgs(store, admin, 'department', [ORG, ORG_B], department(' المالية '), describeDept, key(), now).catch(e => e);
    expect(err).toMatchObject({ code: 'duplicate' });
    expect(err.message).toContain('كل الشركات المختارة');
    expect(store.commits).toBe(commits);
    const single = await createEntityInOrgs(store, admin, 'department', [ORG], department(), describeDept, key(), now).catch(e => e);
    expect(single.message).toBe('يوجد قسم بنفس الاسم (المالية) في هذه الشركة.');
  });

  it('a department for 3 companies: one document each, a company holding the name is skipped, a replay is a no-op', async () => {
    const store = multiOrgStore();
    await createEntityInOrgs(store, admin, 'department', [ORG_C], department('IT'), describeDept, key(), now);
    const k = key();
    const res = await createEntityInOrgs(store, admin, 'department', [ORG, ORG_B, ORG_C], department('it'), describeDept, k, now);
    expect(res.value.created.map(d => d.orgId)).toEqual([ORG, ORG_B]);
    expect(res.value.skipped).toEqual([{ orgId: ORG_C, reason: 'duplicate', existingName: 'IT' }]);
    expect(store.read('departments', `dept-${k}-${ORG}`)).toMatchObject({ orgId: ORG, name: 'it', createdAt: now.toISOString() });

    const again = await createEntityInOrgs(store, admin, 'department', [ORG, ORG_B, ORG_C], department('it'), describeDept, k, now);
    expect(again).toMatchObject({ changed: false, reason: 'duplicate_operation' });
    expect(store.dump('departments')).toHaveLength(3);
  });

  it('employees and finance cannot add; data entry can', async () => {
    const store = multiOrgStore();
    for (const actor of [employee, finance]) {
      await expect(createEntityInOrgs(store, actor, 'provider', [ORG], provider(), describeProvider, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    }
    await expect(createEntityInOrgs(store, dataEntry, 'department', [ORG], department(), describeDept, key(), now)).resolves.toMatchObject({ changed: true });
  });

  it('needs 1..50 companies', async () => {
    const store = multiOrgStore();
    await expect(createEntityInOrgs(store, admin, 'provider', [], provider(), describeProvider, key(), now)).rejects.toMatchObject({ code: 'missing_org' });
    const tooMany = Array.from({ length: 51 }, (_, i) => `org-${i}`);
    await expect(createEntityInOrgs(store, admin, 'provider', tooMany, provider(), describeProvider, key(), now)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(store.dump('providers')).toHaveLength(1); // only the seeded one
  });
});

describe('platform owner = the only super admin', () => {
  it('only the owner email (any case / spacing) is the platform owner', () => {
    expect(PLATFORM_OWNER_EMAILS).toEqual(['mahmoud@tieapps.com']);
    expect(isPlatformOwnerEmail(' Mahmoud@TieApps.com ')).toBe(true);
    expect(isPlatformOwnerEmail('admin@tieapps.com')).toBe(false);
    expect(isPlatformOwnerEmail('')).toBe(false);
    expect(isPlatformOwnerEmail(undefined)).toBe(false);
  });
});

describe('provisioning a login for a company member', () => {
  it('an email with only email-invited (pending) memberships has no known login: a login must be created for it', async () => {
    const store = multiOrgStore();
    await createMemberInOrgs(store, owner, person(), [ORG], key(), now);
    const pendingOnly = store.dump('members') as OrganizationMember[];
    expect(pendingOnly[0].userId).toBe(pendingUserIdForEmail('multi@tie.test'));
    expect(knownLoginUidOf(pendingOnly)).toBe('');

    const uid = 'uidKnownAccount000000000001';
    await createMemberInOrgs(store, owner, person({ userId: uid }), [ORG_B], key(), now);
    expect(knownLoginUidOf(store.dump('members') as OrganizationMember[])).toBe(uid);
    expect(knownLoginUidOf([])).toBe('');
  });

  it('a login created by an unfinished attempt is re-used only for the same email, never under another email', () => {
    const account = { uid: 'uidProvisioned0000000000001', email: 'x@acme.test', password: 'secret1' };
    expect(reusableProvisionedAccount(undefined, 'x@acme.test')).toBeUndefined();
    expect(reusableProvisionedAccount(account, ' X@Acme.test ')).toBe(account);
    expect(() => reusableProvisionedAccount(account, 'y@acme.test')).toThrow(DomainError);
    expect(() => reusableProvisionedAccount(account, 'y@acme.test')).toThrow(expect.objectContaining({ code: 'identity_changed' }));
  });
});

describe('re-using a login for an email (verifiedLoginUidOf)', () => {
  const uid = 'uidKnownAccount000000000001';
  const other = 'uidAttacker0000000000000001';
  const memberships = [
    { userId: other, userEmail: 'cfo@other.test' },          // an org admin paired its own account with the email
    { userId: uid, userEmail: ' CFO@Other.test ' },
    { userId: pendingUserIdForEmail('cfo@other.test'), userEmail: 'cfo@other.test' },
  ];
  it('a membership pairing a UID with the email is a claim, not proof: only the account that recorded the address itself is re-used', async () => {
    const profiles: Record<string, string> = { [uid]: 'cfo@other.test', [other]: 'attacker@evil.test' };
    expect(knownLoginUidOf(memberships)).toBe(other);
    expect(await verifiedLoginUidOf(memberships, 'cfo@other.test', async id => profiles[id] ?? null)).toBe(uid);
  });

  it('no proof, an unreadable profile or an empty email: no login (the person is added by email)', async () => {
    expect(await verifiedLoginUidOf(memberships, 'cfo@other.test', async () => null)).toBe('');
    expect(await verifiedLoginUidOf(memberships, 'cfo@other.test', async () => { throw new Error('permission-denied'); })).toBe('');
    expect(await verifiedLoginUidOf(memberships, '', async () => 'cfo@other.test')).toBe('');
  });
});
