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
import { collection, doc, getDocs, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { createFirestoreStore } from '../src/domain/firestoreStore';
import { createExpenseRequest, transitionExpenseRequest } from '../src/domain/requests';
import { createPaymentAccount, settleCustodyItem } from '../src/domain/treasury';
import { restoreRecord, readLegacySnapshot } from '../src/domain/legacyRecovery';
import { DEFAULT_EMAIL_SETTINGS } from '../src/services/emailTemplates';
import type { Actor } from '../src/domain/common';

const ORG = 'org-acme';
const OTHER_ORG = 'org-other';
let env: RulesTestEnvironment;

const OWNER = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
const REMOVED = { uid: 'uidRemoved0000000000000001', email: 'awadhsaudi2030@gmail.com' };
const ADMIN = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
const EMP = { uid: 'uidEmployee0000000000000001', email: 'emp@acme.test' };

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
