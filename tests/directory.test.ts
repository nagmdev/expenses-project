/**
 * Membership security: first-sign-in profile linking, access revocation and the
 * notification recipient lists firestore.rules checks outbox events against.
 *
 * First-sign-in profile linking. firestore.rules only accepts a self-written role/orgId
 * that matches an admin-created membership (grantsMembership); the client must pick
 * exactly such a membership, or the link write is rejected.
 */
import { describe, expect, it } from 'vitest';
import type { Actor } from '../src/domain/common';
import { createMember, createOrganization, ensureOrgNotificationRecipients, pickMembershipToLink, profileMembershipState, removeMember, updateMemberRecord } from '../src/domain/directory';
import type { OrganizationMember } from '../src/types';
import { ORG, admin, freshStore, key } from './helpers';

const UID = 'uidNewUser00000000000000001';

const member = (overrides: Partial<OrganizationMember>): OrganizationMember => ({
  id: 'm',
  orgId: ORG,
  userId: 'pending-bmV3QGFjbWUudGVzdA',
  userName: 'New',
  userEmail: 'new@acme.test',
  role: 'employee',
  department: '',
  jobTitle: '',
  joinedAt: '2026-01-01',
  active: true,
  ...overrides,
});

const verified = { uid: UID, email: 'New@Acme.test', emailVerified: true };
const unverified = { ...verified, emailVerified: false };

describe('pickMembershipToLink', () => {
  it('links a membership invited by email when the email is verified', () => {
    const m = member({ id: `pending-x_${ORG}` });
    expect(pickMembershipToLink([m], verified)).toBe(m);
  });

  it('never links by an unverified email (anyone can register an unverified address)', () => {
    expect(pickMembershipToLink([member({})], unverified)).toBeNull();
  });

  it('links by UID regardless of email verification', () => {
    const m = member({ id: `${UID}_${ORG}`, userId: UID, userEmail: 'other@acme.test' });
    expect(pickMembershipToLink([m], unverified)).toBe(m);
  });

  it('skips suspended, org-less, super-admin and someone else’s memberships', () => {
    const candidates = [
      member({ id: 'suspended', active: false }),
      member({ id: 'no-org', orgId: '  ' }),
      member({ id: 'super', role: 'super_admin' }),
      member({ id: 'other-user', userId: 'uidOther000000000000000001', userEmail: 'other@acme.test' }),
    ];
    expect(pickMembershipToLink(candidates, verified)).toBeNull();
  });

  it('prefers the highest role, and role/orgId/id all come from that one membership', () => {
    const employeeElsewhere = member({ id: 'e', orgId: 'org-other', role: 'employee' });
    const finance = member({ id: 'f', orgId: ORG, role: 'finance' });
    const picked = pickMembershipToLink([employeeElsewhere, finance], verified)!;
    expect([picked.id, picked.orgId, picked.role]).toEqual(['f', ORG, 'finance']);
  });
});

describe('profileMembershipState — a profile never outlives the membership it came from', () => {
  const profileOf = (m: OrganizationMember, extra: Record<string, unknown> = {}) => ({ orgId: m.orgId, role: m.role, memberId: m.id, name: m.userName, ...extra });

  it('a profile that names a live membership with the same role is current (no write needed)', () => {
    const m = member({ id: `${UID}_${ORG}`, userId: UID, role: 'finance', userName: 'مروة' });
    expect(profileMembershipState(profileOf(m), [m], unverified)).toEqual({ current: true, relinkTo: null, awaitingVerification: false });
  });

  it('deleted and added again (Marwa): the old name/role are dropped and the profile re-links to the new record', () => {
    // Profile still carries the deleted record (old English name, old role).
    const stale = { orgId: ORG, role: 'org_admin' as const, memberId: 'mem-legacy-deleted', name: 'Marwa Hassan' };
    const fresh = member({ id: `${UID}_${ORG}`, userId: UID, role: 'employee', userName: 'مروة نجيب' });
    const state = profileMembershipState(stale, [fresh], unverified);
    expect(state.current).toBe(false);
    expect(state.relinkTo).toBe(fresh);
  });

  it('a detached profile (company cleared on delete) re-links to the new membership', () => {
    const fresh = member({ id: `${UID}_${ORG}`, userId: UID, role: 'data_entry', userName: 'New name' });
    const state = profileMembershipState({ orgId: '', role: 'employee', memberId: null, name: 'Old name' }, [fresh], unverified);
    expect(state).toMatchObject({ current: false, relinkTo: fresh, awaitingVerification: false });
  });

  it('a role changed by the admin (profile not synced) is not trusted and gets re-linked', () => {
    const m = member({ id: `${UID}_${ORG}`, userId: UID, role: 'employee' });
    const state = profileMembershipState(profileOf(m, { role: 'org_admin' }), [m], unverified);
    expect(state).toMatchObject({ current: false, relinkTo: m });
  });

  it('re-added by email only: verified email re-links; unverified asks for verification instead of keeping the old identity', () => {
    const stale = { orgId: ORG, role: 'org_admin' as const, memberId: 'gone', name: 'Old' };
    const byEmail = member({ id: `pending-x_${ORG}`, userName: 'Fresh', role: 'finance' });
    expect(profileMembershipState(stale, [byEmail], verified)).toMatchObject({ current: false, relinkTo: byEmail, awaitingVerification: false });
    expect(profileMembershipState(stale, [byEmail], unverified)).toEqual({ current: false, relinkTo: null, awaitingVerification: true });
  });

  it('a suspended or missing membership never keeps the profile current', () => {
    const m = member({ id: `${UID}_${ORG}`, userId: UID, active: false });
    expect(profileMembershipState(profileOf(m), [m], unverified).current).toBe(false);
    expect(profileMembershipState(profileOf(m), [], unverified)).toEqual({ current: false, relinkTo: null, awaitingVerification: false });
  });

  it('a legacy profile without memberId stays current while the user still belongs to that company, and gains the link', () => {
    const m = member({ id: `${UID}_${ORG}`, userId: UID, role: 'finance' });
    expect(profileMembershipState({ orgId: ORG, role: 'finance', name: m.userName }, [m], unverified)).toEqual({ current: true, relinkTo: m, awaitingVerification: false });
  });
});

// ---------------------------------------------------------------------------
// Access revocation and notification recipients
// ---------------------------------------------------------------------------
const now = new Date('2026-09-28T10:00:00.000Z');
const superAdmin: Actor = { id: 'uidSuper00000000000000000001', name: 'SA', email: 'sa@platform.test', role: 'super_admin' };
const INVITEE_UID = 'uidInvitee000000000000000001';
const PENDING_ID = `pending-aW52aXRlZQ_${ORG}`;

function storeWithInvitee(role: OrganizationMember['role'] = 'org_admin') {
  const store = freshStore();
  store.seed('organizations', ORG, { ...store.read('organizations', ORG)!, notificationRecipients: ['boss@acme.test', 'invitee@acme.test'] });
  // Invited by email, then self-linked on first sign-in (profile carries memberId).
  store.seed('members', PENDING_ID, member({ id: PENDING_ID, userId: 'pending-aW52aXRlZQ', userEmail: 'invitee@acme.test', role }));
  store.seed('users', INVITEE_UID, { uid: INVITEE_UID, email: 'invitee@acme.test', role, orgId: ORG, memberId: PENDING_ID, active: true });
  return store;
}

describe('removing a member revokes the access it carried', () => {
  it('detaches the self-linked profile and drops the admin from the recipients', async () => {
    const store = storeWithInvitee();
    await removeMember(store, admin, PENDING_ID, [INVITEE_UID], key(), now);
    expect(store.read('members', PENDING_ID)).toBeNull();
    expect(store.read('users', INVITEE_UID)).toMatchObject({ orgId: '', role: 'employee', memberId: null });
    expect(store.read('organizations', ORG)!.notificationRecipients).toEqual(['boss@acme.test']);
  });

  it('leaves profiles that belong to another org or another membership alone', async () => {
    const store = storeWithInvitee();
    store.seed('users', 'uidOtherOrg00000000000000001', { orgId: 'org-other', role: 'org_admin' });
    store.seed('users', 'uidOtherMember0000000000001', { orgId: ORG, role: 'finance', memberId: 'someone-else' });
    await removeMember(store, admin, PENDING_ID, ['uidOtherOrg00000000000000001', 'uidOtherMember0000000000001'], key(), now);
    expect(store.read('users', 'uidOtherOrg00000000000000001')).toMatchObject({ orgId: 'org-other', role: 'org_admin' });
    expect(store.read('users', 'uidOtherMember0000000000001')).toMatchObject({ orgId: ORG, role: 'finance' });
  });

  it('duplicate records of the same person (English + Arabic): deleting both always detaches the profile', async () => {
    const store = freshStore();
    const REAL = 'uidMarwa00000000000000000001';
    const english = `${REAL}_${ORG}`;
    const arabic = 'mem-1789642366744'; // legacy duplicate, same email, other role
    store.seed('members', english, member({ id: english, userId: REAL, userEmail: 'marwa@acme.test', userName: 'Marwa Hassan', role: 'org_admin' }));
    store.seed('members', arabic, member({ id: arabic, userId: 'usr-legacy', userEmail: 'marwa@acme.test', userName: 'مروة', role: 'finance' }));
    // The profile happens to be linked to the Arabic duplicate.
    store.seed('users', REAL, { uid: REAL, email: 'marwa@acme.test', role: 'finance', orgId: ORG, memberId: arabic, name: 'مروة', active: true });

    // Delete the Arabic one first (the app offers the same person's account as well) …
    await removeMember(store, admin, arabic, [REAL], key(), now);
    expect(store.read('users', REAL)).toMatchObject({ orgId: '', role: 'employee', memberId: null });
    // … and re-link attempts never resurrect it: the English record is still there and gets deleted next.
    await removeMember(store, admin, english, [REAL], key(), now);
    expect(store.read('users', REAL)).toMatchObject({ orgId: '', role: 'employee', memberId: null });
  });

  it("a profile still pointing at a deleted duplicate is detached when the person's last record goes", async () => {
    const store = freshStore();
    const REAL = 'uidMarwa00000000000000000002';
    const english = `${REAL}_${ORG}`;
    store.seed('members', english, member({ id: english, userId: REAL, userEmail: 'marwa2@acme.test', userName: 'Marwa', role: 'org_admin' }));
    // Linked to a duplicate that was already deleted (old versions did not detach it).
    store.seed('users', REAL, { uid: REAL, email: 'marwa2@acme.test', role: 'org_admin', orgId: ORG, memberId: 'mem-already-deleted', name: 'Marwa', active: true });
    await removeMember(store, admin, english, [REAL], key(), now);
    expect(store.read('users', REAL)).toMatchObject({ orgId: '', role: 'employee', memberId: null });
  });
});

describe('role and status changes reach self-linked profiles', () => {
  it('demotion updates the profile, re-points the placeholder member and the recipients', async () => {
    const store = storeWithInvitee();
    await updateMemberRecord(store, admin, PENDING_ID, { role: 'employee' }, [INVITEE_UID], key(), now);
    expect(store.read('users', INVITEE_UID)).toMatchObject({ role: 'employee', orgId: ORG, memberId: PENDING_ID });
    expect(store.read('members', PENDING_ID)).toMatchObject({ role: 'employee', userId: INVITEE_UID });
    expect(store.read('organizations', ORG)!.notificationRecipients).toEqual(['boss@acme.test']);
  });

  it('suspension marks the profile inactive and stops notifications to that admin', async () => {
    const store = storeWithInvitee();
    await updateMemberRecord(store, admin, PENDING_ID, { active: false }, [INVITEE_UID], key(), now);
    expect(store.read('users', INVITEE_UID)).toMatchObject({ active: false });
    expect(store.read('organizations', ORG)!.notificationRecipients).toEqual(['boss@acme.test']);
  });

  it('never rewrites a profile whose primary org is another one', async () => {
    const store = storeWithInvitee();
    store.seed('users', INVITEE_UID, { orgId: 'org-other', role: 'org_admin', memberId: 'x' });
    await updateMemberRecord(store, admin, PENDING_ID, { role: 'employee' }, [INVITEE_UID], key(), now);
    expect(store.read('users', INVITEE_UID)).toMatchObject({ orgId: 'org-other', role: 'org_admin' });
    expect(store.read('members', PENDING_ID)!.userId).toBe('pending-aW52aXRlZQ');
  });
});

describe('notification recipients list', () => {
  it('new orgs start with an initialized (empty) list', async () => {
    const store = freshStore();
    const res = await createOrganization(store, superAdmin, { name: 'Beta', code: 'BETA', currency: 'EGP', budget: 1, description: '' }, key(), now);
    expect(res.value.notificationRecipients).toEqual([]);
  });

  it('adding an org admin adds their email; adding an employee does not', async () => {
    const store = freshStore();
    store.seed('organizations', ORG, { ...store.read('organizations', ORG)!, notificationRecipients: [] });
    await createMember(store, admin, { ...member({}), userId: '', userEmail: 'Boss@Acme.test', role: 'org_admin' }, key(), {}, now);
    await createMember(store, admin, { ...member({}), userId: '', userEmail: 'emp@acme.test', role: 'employee' }, key(), {}, now);
    expect(store.read('organizations', ORG)!.notificationRecipients).toEqual(['boss@acme.test']);
  });

  it('an uninitialized list is left for the backfill, which fills it once from the members', async () => {
    const store = freshStore(); // org seeded without notificationRecipients
    await createMember(store, admin, { ...member({}), userId: '', userEmail: 'boss@acme.test', role: 'org_admin' }, key(), {}, now);
    expect(store.read('organizations', ORG)!.notificationRecipients).toBeUndefined();

    const members = [member({ userEmail: 'boss@acme.test', role: 'org_admin' }), member({ userEmail: 'off@acme.test', role: 'org_admin', active: false }), member({ userEmail: 'e@acme.test' })];
    expect((await ensureOrgNotificationRecipients(store, admin, ORG, members, now)).value).toEqual(['boss@acme.test']);
    expect((await ensureOrgNotificationRecipients(store, admin, ORG, [], now)).changed).toBe(false); // never overwritten
    expect(store.read('organizations', ORG)!.notificationRecipients).toEqual(['boss@acme.test']);
  });
});
