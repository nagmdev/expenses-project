import type { AuditActionType, Department, Organization, OrganizationMember, PaymentAccount, Role, ServiceCategory, ServiceProvider } from '../types';
import { encodeKeyPart, idFromKey } from '../utils/ids';
import {
  COL,
  DomainError,
  assertRole,
  auditIdFor,
  claimUniqueKey,
  isKeyTakenByOther,
  normalizeEmail,
  readUniqueKey,
  releaseUniqueKey,
  writeAudit,
  type Actor,
  type UniqueKeyRead,
  type UniqueScope,
} from './common';
import type { DataStore, TxContext } from './store';
import { buildAccountDoc, writeNewAccount, type MutationOutcome } from './treasury';

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------
export function defaultAccountsFor(org: Organization): Array<Omit<PaymentAccount, 'createdAt'>> {
  const code = org.code || 'ORG';
  const bankId = `vault-bank-${org.id}`;
  const bankName = `حساب بنكي رئيسي (${org.name})`;
  const base = { orgId: org.id, balance: 0, initialBalance: 0, currentBalance: 0, totalIn: 0, totalOut: 0, currency: org.currency || 'EGP', active: true };
  return [
    { ...base, id: bankId, name: bankName, type: 'bank', accountIdentifier: `EG00${code}00000000000000`, bankName: 'البنك التجاري الدولي CIB / البنك الأهلي', description: `الحساب المصرفي البنكي الرئيسي لـ ${org.name}` },
    { ...base, id: `vault-cash-${org.id}`, name: `خزينة نقدية (${org.name})`, type: 'cash', accountIdentifier: `CASH-${code}`, description: `الخزينة النقدية الرئيسية لمقر ${org.name}` },
    { ...base, id: `vault-insta-${org.id}`, name: `إنستاباي (${org.name})`, type: 'instapay', accountIdentifier: `${code.toLowerCase()}@instapay`, parentAccountId: bankId, parentAccountName: bankName, description: `حساب استقبال وتحويلات إنستاباي لـ ${org.name} (مربوط بالبنك)` },
    // An e-wallet is a standalone treasury (never linked to the bank; see linkedParentIdOf in ./treasury).
    { ...base, id: `vault-wallet-${org.id}`, name: `محفظة إلكترونية (${org.name})`, type: 'wallet', accountIdentifier: '01000000000', description: `محفظة كاش إلكترونية (فودافون/أورانج/اتصالات/وي) لـ ${org.name} (خزينة مستقلة)` },
  ];
}

export async function createOrganization(
  store: DataStore,
  actor: Actor,
  input: Omit<Organization, 'id' | 'createdAt'>,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<Organization>> {
  assertRole(actor, ['super_admin'], 'إنشاء الشركات متاح للمشرف العام فقط.');
  const name = input.name.trim();
  const code = (input.code?.trim() || name.slice(0, 3)).toUpperCase();
  if (!name) throw new DomainError('invalid_input', 'يرجى إدخال اسم الشركة.');
  const slug = code.toLowerCase().replace(/[^a-z0-9]/g, '');
  const id = slug ? `org-${slug}` : idFromKey('org', operationKey);
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    const existing = await tx.get<Organization & { operationKey?: string }>(COL.organizations, id);
    if (existing) {
      if (existing.operationKey === operationKey) return { value: existing, changed: false, reason: 'duplicate_operation' };
      throw new DomainError('duplicate', `توجد مؤسسة مسجلة بالفعل بنفس الكود (${code}). تم منع التكرار.`);
    }
    const codeKey = await readUniqueKey(tx, 'org_code', '-', code);
    if (isKeyTakenByOther(codeKey, id)) throw new DomainError('duplicate', `كود الشركة (${code}) مستخدم لشركة أخرى.`);

    const org: Organization & { operationKey: string } = { ...input, id, name, code, notificationRecipients: [], createdAt: nowIso, operationKey };
    const accounts = defaultAccountsFor(org);
    const accountKeys: UniqueKeyRead[] = [];
    for (const acc of accounts) accountKeys.push(await readUniqueKey(tx, 'account_identifier', org.id, acc.accountIdentifier));

    tx.set(COL.organizations, id, org);
    claimUniqueKey(tx, codeKey, { collection: COL.organizations, id }, nowIso);
    // The org's standard treasury cards are created in the SAME transaction as the
    // org itself — never later by a background effect that could re-create cards the
    // user deleted or overwrite balances with zero.
    accounts.forEach((acc, i) => {
      const { id: accId, ...rest } = acc;
      const doc = buildAccountDoc(accId!, rest as any, nowIso);
      writeNewAccount(tx, actor, doc, isKeyTakenByOther(accountKeys[i], accId!) ? null : accountKeys[i], nowIso);
    });
    writeAudit(
      tx,
      actor,
      {
        actionType: 'create',
        entityType: 'organization',
        entityId: id,
        entityName: name,
        orgId: id,
        orgName: name,
        details: `تم إنشاء شركة ومؤسسة جديدة: "${name}" بكود (${code}) وميزانية معتمدة ${Number(input.budget || 0).toLocaleString()} ${input.currency}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: org, changed: true };
  });
}

export async function updateOrganization(store: DataStore, actor: Actor, orgId: string, updates: Partial<Organization>, operationKey: string, now: Date = new Date()) {
  assertRole(actor, ['super_admin', 'org_admin'], 'تعديل بيانات الشركة متاح للإدارة فقط.');
  const clean: Record<string, any> = { ...updates };
  delete clean.id;
  delete clean.createdAt;
  delete clean.code; // the code is the org's identity key
  delete clean.notificationRecipients; // maintained with memberships only
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const org = await tx.get<Organization>(COL.organizations, orgId);
    if (!org) throw new DomainError('not_found', 'الشركة غير موجودة.');
    const patch = { ...clean, updatedAt: nowIso };
    tx.update(COL.organizations, orgId, patch);
    const updated = { ...org, ...patch } as Organization;
    const nameChanged = Boolean(clean.name && String(clean.name).trim() !== org.name.trim());
    const budgetChanged = clean.budget !== undefined && clean.budget !== org.budget;
    let details = `تم تعديل بيانات الشركة: "${updated.name}"`;
    if (nameChanged) details += ` (إعادة التسمية من "${org.name}" إلى "${updated.name}")`;
    if (budgetChanged) details += ` (تعديل الميزانية من ${Number(org.budget).toLocaleString()} إلى ${Number(updated.budget).toLocaleString()} ${updated.currency})`;
    writeAudit(
      tx,
      actor,
      {
        actionType: (nameChanged ? 'rename' : budgetChanged ? 'budget_change' : 'update') as AuditActionType,
        entityType: 'organization',
        entityId: orgId,
        entityName: updated.name,
        orgId,
        orgName: updated.name,
        details,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: updated, changed: true };
  });
}

export async function removeOrganization(
  store: DataStore,
  actor: Actor,
  orgId: string,
  mode: 'archive' | 'delete',
  operationKey: string,
  now: Date = new Date(),
) {
  assertRole(actor, ['super_admin'], 'حذف الشركات متاح للمشرف العام فقط.');
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const org = await tx.get<Organization>(COL.organizations, orgId);
    if (!org) return { value: null, changed: false };
    const codeKey = await readUniqueKey(tx, 'org_code', '-', org.code || '');
    if (mode === 'archive') {
      tx.update(COL.organizations, orgId, { archived: true, status: 'archived', archivedAt: nowIso });
    } else {
      tx.delete(COL.organizations, orgId);
      releaseUniqueKey(tx, codeKey, orgId);
    }
    writeAudit(
      tx,
      actor,
      {
        actionType: 'delete',
        entityType: 'organization',
        entityId: orgId,
        entityName: org.name,
        orgId,
        orgName: org.name,
        details:
          mode === 'archive'
            ? `تمت أرشفة وتعطيل الشركة "${org.name}" (${org.code}) مع الحفاظ على سجلاتها المالية.`
            : `تم حذف الشركة "${org.name}" (${org.code}) من النظام`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: org, changed: true };
  });
}

// ---------------------------------------------------------------------------
// Generic org-scoped entity with a uniqueness key (services, providers, departments)
// ---------------------------------------------------------------------------
interface EntitySpec<T> {
  collection: string;
  idPrefix: string;
  scope: UniqueScope;
  keyOf: (e: Partial<T>) => string;
  label: string;
  auditType: 'service' | 'provider' | 'department';
  duplicateMessage: (value: string) => string;
}

const SPECS = {
  service: {
    collection: COL.services,
    idPrefix: 'srv',
    scope: 'service_code',
    keyOf: (s: Partial<ServiceCategory>) => (s.code || '').trim(),
    label: 'بند الصرف',
    auditType: 'service',
    duplicateMessage: (v: string) => `يوجد بند صرف بنفس الكود (${v}) في هذه الشركة.`,
  } as EntitySpec<ServiceCategory>,
  provider: {
    collection: COL.providers,
    idPrefix: 'prov',
    scope: 'provider_name',
    keyOf: (p: Partial<ServiceProvider>) => (p.name || '').trim(),
    label: 'المورد',
    auditType: 'provider',
    duplicateMessage: (v: string) => `يوجد مورد مسجل بنفس الاسم (${v}) في هذه الشركة.`,
  } as EntitySpec<ServiceProvider>,
  department: {
    collection: COL.departments,
    idPrefix: 'dept',
    scope: 'department_name',
    keyOf: (d: Partial<Department>) => (d.name || '').trim(),
    label: 'القسم',
    auditType: 'department',
    duplicateMessage: (v: string) => `يوجد قسم بنفس الاسم (${v}) في هذه الشركة.`,
  } as EntitySpec<Department>,
};
export type EntityKind = keyof typeof SPECS;

async function readKeyIfAny(tx: TxContext, scope: UniqueScope, orgId: string, value: string) {
  return value ? readUniqueKey(tx, scope, orgId, value) : null;
}

export async function createEntity<T extends { id: string; orgId: string }>(
  store: DataStore,
  actor: Actor,
  kind: EntityKind,
  build: (id: string, nowIso: string) => T,
  audit: (entity: T) => string,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<T>> {
  assertRole(actor, ['super_admin', 'org_admin', 'data_entry'], 'ليس لديك صلاحية الإضافة.');
  const spec = SPECS[kind] as unknown as EntitySpec<T>;
  const id = idFromKey(spec.idPrefix, operationKey);
  const nowIso = now.toISOString();
  const entity = build(id, nowIso);
  if (!entity.orgId) throw new DomainError('missing_org', 'يرجى تحديد الشركة.');

  return store.runTransaction(async tx => {
    const existing = await tx.get<T>(spec.collection, id);
    if (existing) return { value: existing as T, changed: false, reason: 'duplicate_operation' };
    const key = await readKeyIfAny(tx, spec.scope, entity.orgId, spec.keyOf(entity));
    if (key && isKeyTakenByOther(key, id)) throw new DomainError('duplicate', spec.duplicateMessage(spec.keyOf(entity)));
    tx.set(spec.collection, id, entity);
    if (key) claimUniqueKey(tx, key, { collection: spec.collection, id }, nowIso);
    writeAudit(
      tx,
      actor,
      { actionType: 'create', entityType: spec.auditType, entityId: id, entityName: (entity as any).name || id, orgId: entity.orgId, details: audit(entity) },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: entity, changed: true };
  });
}

export async function updateEntity<T extends { id: string; orgId: string; name?: string }>(
  store: DataStore,
  actor: Actor,
  kind: EntityKind,
  id: string,
  updates: Partial<T>,
  describe: (before: T, after: T) => { actionType: AuditActionType; details: string },
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<T>> {
  assertRole(actor, ['super_admin', 'org_admin', 'finance', 'data_entry'], 'ليس لديك صلاحية التعديل.');
  const spec = SPECS[kind] as unknown as EntitySpec<T>;
  const clean: Record<string, any> = { ...updates };
  delete clean.id;
  delete clean.orgId;
  // Counters maintained by financial transactions are never overwritten from a form.
  delete clean.spentAmount;
  delete clean.totalPaid;
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    const current = await tx.get<T>(spec.collection, id);
    if (!current) throw new DomainError('not_found', `${spec.label} غير موجود.`);
    const after = { ...current, ...clean } as T;
    const oldValue = spec.keyOf(current);
    const newValue = spec.keyOf(after);
    const changedKey = newValue.toLowerCase() !== oldValue.toLowerCase();
    const oldKey = changedKey ? await readKeyIfAny(tx, spec.scope, current.orgId, oldValue) : null;
    const newKey = changedKey ? await readKeyIfAny(tx, spec.scope, current.orgId, newValue) : null;
    if (newKey && isKeyTakenByOther(newKey, id)) throw new DomainError('duplicate', spec.duplicateMessage(newValue));

    tx.update(spec.collection, id, { ...clean, updatedAt: nowIso });
    if (oldKey) releaseUniqueKey(tx, oldKey, id);
    if (newKey) claimUniqueKey(tx, newKey, { collection: spec.collection, id }, nowIso);
    const { actionType, details } = describe(current, after);
    writeAudit(
      tx,
      actor,
      { actionType, entityType: spec.auditType, entityId: id, entityName: (after as any).name || id, orgId: current.orgId, details },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: after, changed: true };
  });
}

export async function deleteEntity(
  store: DataStore,
  actor: Actor,
  kind: EntityKind,
  id: string,
  mode: 'deactivate' | 'delete',
  operationKey: string,
  now: Date = new Date(),
) {
  assertRole(actor, ['super_admin', 'org_admin'], 'الحذف متاح لمدير الشركة فقط.');
  const spec = SPECS[kind] as unknown as EntitySpec<any>;
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const current = await tx.get<any>(spec.collection, id);
    if (!current) return { value: null, changed: false };
    const key = await readKeyIfAny(tx, spec.scope, current.orgId, spec.keyOf(current));
    if (mode === 'deactivate') {
      tx.update(spec.collection, id, { active: false, updatedAt: nowIso });
    } else {
      tx.delete(spec.collection, id);
      if (key) releaseUniqueKey(tx, key, id);
    }
    writeAudit(
      tx,
      actor,
      {
        actionType: mode === 'delete' ? 'delete' : 'update',
        entityType: spec.auditType,
        entityId: id,
        entityName: current.name || id,
        orgId: current.orgId,
        details:
          mode === 'delete'
            ? `تم حذف ${spec.label} "${current.name}" من النظام`
            : `تم تعطيل ${spec.label} "${current.name}" لوجود طلبات صرف سابقة مرتبطة به.`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: current, changed: true };
  });
}

// ---------------------------------------------------------------------------
// Members (canonical identity = Firebase UID; email is a secondary unique key)
// ---------------------------------------------------------------------------
/** Deterministic user id for a member provisioned by email before first sign-in. */
export const pendingUserIdForEmail = (email: string) => `pending-${encodeKeyPart(normalizeEmail(email))}`;

export interface MemberInput extends Omit<OrganizationMember, 'id' | 'joinedAt'> {}

// ---------------------------------------------------------------------------
// Notification recipients. organizations/{orgId}.notificationRecipients lists the
// emails admin-facing notifications of that org may go to; firestore.rules only lets
// an outbox event address those (plus the platform super admins). It is kept up to
// date by every membership change below. A missing field means "not initialized
// yet": ensureOrgNotificationRecipients fills it from the org's members.
// ---------------------------------------------------------------------------
type RecipientFields = Pick<OrganizationMember, 'role' | 'active' | 'userEmail'>;

/** Active org admins receive the org's admin-facing notifications. */
export const isNotificationRecipient = (m: RecipientFields) =>
  m.role === 'org_admin' && m.active !== false && normalizeEmail(m.userEmail).includes('@');

export function orgNotificationRecipients(members: OrganizationMember[], orgId: string): string[] {
  const emails = members.filter(m => m.orgId === orgId && isNotificationRecipient(m)).map(m => normalizeEmail(m.userEmail));
  return Array.from(new Set(emails)).sort();
}

type RecipientEdits = Map<string, { remove: string[]; add: string[] }>;

function editRecipients(edits: RecipientEdits, orgId: string, before: RecipientFields | null, after: RecipientFields | null) {
  if (!orgId) return;
  const entry = edits.get(orgId) || { remove: [], add: [] };
  if (before && isNotificationRecipient(before)) entry.remove.push(normalizeEmail(before.userEmail));
  if (after && isNotificationRecipient(after)) entry.add.push(normalizeEmail(after.userEmail));
  edits.set(orgId, entry);
}

/** Reads the affected orgs (read phase); returns the writes to apply in the write phase. */
async function readRecipientUpdates(tx: TxContext, edits: RecipientEdits) {
  const updates: Array<{ orgId: string; notificationRecipients: string[] }> = [];
  for (const [orgId, { remove, add }] of edits) {
    const org = await tx.get<Organization>(COL.organizations, orgId);
    if (!org || !Array.isArray(org.notificationRecipients)) continue; // not initialized: the backfill computes it
    const next = new Set(org.notificationRecipients.filter(e => !remove.includes(e)));
    add.forEach(e => next.add(e));
    const list = Array.from(next).sort();
    if (list.join('\n') !== [...org.notificationRecipients].sort().join('\n')) updates.push({ orgId, notificationRecipients: list });
  }
  return updates;
}

function writeRecipientUpdates(tx: TxContext, updates: Array<{ orgId: string; notificationRecipients: string[] }>, nowIso: string) {
  for (const u of updates) tx.update(COL.organizations, u.orgId, { notificationRecipients: u.notificationRecipients, updatedAt: nowIso });
}

/** One-time initialization of an org's recipient list from its current members. */
export async function ensureOrgNotificationRecipients(
  store: DataStore,
  actor: Actor,
  orgId: string,
  members: OrganizationMember[],
  now: Date = new Date(),
): Promise<MutationOutcome<string[] | null>> {
  assertRole(actor, ['super_admin', 'org_admin'], 'تهيئة مستلمي الإشعارات متاحة للإدارة فقط.');
  return store.runTransaction(async tx => {
    const org = await tx.get<Organization>(COL.organizations, orgId);
    if (!org || Array.isArray(org.notificationRecipients)) return { value: org?.notificationRecipients ?? null, changed: false };
    const list = orgNotificationRecipients(members, orgId);
    tx.update(COL.organizations, orgId, { notificationRecipients: list, updatedAt: now.toISOString() });
    return { value: list, changed: true };
  });
}

/**
 * users/{uid} profiles that carry this membership's access: in the membership's org
 * and linked to it (memberId) or to no membership in particular (admin-provisioned).
 * A profile whose primary org is elsewhere is left alone.
 */
const profileCarriesMembership = (profile: Record<string, any> | null, mem: Pick<OrganizationMember, 'id' | 'orgId'>) =>
  Boolean(profile && profile.orgId === mem.orgId && (!profile.memberId || profile.memberId === mem.id));

export async function createMember(
  store: DataStore,
  actor: Actor,
  input: MemberInput,
  operationKey: string,
  options: { writeUserProfile?: boolean } = {},
  now: Date = new Date(),
): Promise<MutationOutcome<OrganizationMember>> {
  assertRole(actor, ['super_admin', 'org_admin'], 'إضافة الموظفين متاحة لمدير الشركة فقط.');
  if (input.role === 'super_admin' && actor.role !== 'super_admin') {
    throw new DomainError('forbidden', 'لا يمكن منح صلاحية المشرف العام.');
  }
  const email = normalizeEmail(input.userEmail);
  const userId = input.userId && !input.userId.startsWith('temp_') ? input.userId : email ? pendingUserIdForEmail(email) : idFromKey('usr', operationKey);
  const id = `${userId}_${input.orgId}`;
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    const existing = await tx.get<OrganizationMember & { operationKey?: string }>(COL.members, id);
    if (existing) {
      if (existing.operationKey === operationKey) return { value: existing, changed: false, reason: 'duplicate_operation' };
      throw new DomainError('duplicate', `البريد الإلكتروني (${email || input.userName}) مسجل بالفعل في هذه المؤسسة باسم "${existing.userName}"`);
    }
    const key = email ? await readUniqueKey(tx, 'member_email', input.orgId, email) : null;
    if (key && isKeyTakenByOther(key, id)) {
      throw new DomainError('duplicate', `البريد الإلكتروني (${email}) مسجل بالفعل في هذه المؤسسة.`);
    }
    const member: OrganizationMember & { operationKey: string } = {
      ...input,
      id,
      userId,
      userEmail: email,
      joinedAt: nowIso.split('T')[0],
      active: input.active !== false,
      operationKey,
    };
    const recipientEdits: RecipientEdits = new Map();
    editRecipients(recipientEdits, member.orgId, null, member);
    const recipientUpdates = await readRecipientUpdates(tx, recipientEdits);

    tx.set(COL.members, id, member);
    if (key) claimUniqueKey(tx, key, { collection: COL.members, id }, nowIso);
    writeRecipientUpdates(tx, recipientUpdates, nowIso);
    if (options.writeUserProfile) {
      tx.set(COL.users, userId, {
        uid: userId,
        email,
        name: member.userName,
        role: member.role,
        orgId: member.orgId,
        memberId: id,
        department: member.department || '',
        active: member.active,
        updatedAt: nowIso,
      });
    }
    writeAudit(
      tx,
      actor,
      {
        actionType: 'create',
        entityType: 'member',
        entityId: id,
        entityName: member.userName,
        orgId: member.orgId,
        details: `تم إضافة وتعيين موظف جديد: "${member.userName}" (${member.userEmail || '-'} | ${member.jobTitle} - ${member.department}) برتبة ${member.role}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: member, changed: true };
  });
}

/** A Firebase Auth UID (as opposed to a placeholder id for a member who never signed in). */
export const isRealUid = (id?: string) => Boolean(id && /^[A-Za-z0-9]{20,40}$/.test(id));

const LINKABLE_ROLE_PRIORITY: Partial<Record<Role, number>> = { org_admin: 4, finance: 3, data_entry: 2, employee: 1 };

/**
 * The membership a user's own users/{uid} profile may be linked to (role, orgId and
 * memberId copied from it). Mirrors `grantsMembership` in firestore.rules: an active
 * membership with an org and a non-super-admin role, addressed to the user's UID or to
 * their verified email. Highest role first, like the membership the UI resolves.
 */
export function pickMembershipToLink(
  memberships: OrganizationMember[],
  identity: { uid: string; email?: string | null; emailVerified: boolean },
): OrganizationMember | null {
  const email = normalizeEmail(identity.email);
  const eligible = memberships.filter(m =>
    Boolean(m.orgId?.trim()) &&
    m.active !== false &&
    LINKABLE_ROLE_PRIORITY[m.role] !== undefined &&
    (m.userId === identity.uid || (identity.emailVerified && Boolean(email) && normalizeEmail(m.userEmail) === email)),
  );
  eligible.sort((a, b) => (LINKABLE_ROLE_PRIORITY[b.role] ?? 0) - (LINKABLE_ROLE_PRIORITY[a.role] ?? 0));
  return eligible[0] ?? null;
}

/**
 * Updates a membership and the matching users/{uid} security profile(s) in ONE
 * transaction, so a role change can never be half-applied.
 * `linkedUserIds` are the profiles the caller may read that could carry this membership
 * (see linkedProfileIds in AppContext): the member's own UID, and profiles self-linked
 * to it via memberId. Only those that actually carry it (profileCarriesMembership), or
 * the member's own UID without a profile yet, are synced.
 */
export async function updateMemberRecord(
  store: DataStore,
  actor: Actor,
  memberId: string,
  updates: Partial<OrganizationMember>,
  linkedUserIds: string[],
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<OrganizationMember>> {
  const clean: Record<string, any> = { ...updates };
  delete clean.id;
  delete clean.joinedAt;
  if (clean.userEmail !== undefined) clean.userEmail = normalizeEmail(clean.userEmail);
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    const mem = await tx.get<OrganizationMember>(COL.members, memberId);
    if (!mem) throw new DomainError('not_found', 'سجل الموظف غير موجود.');
    const isSelf = mem.userId === actor.id;
    const isAdmin = actor.role === 'super_admin' || actor.role === 'org_admin';
    if (!isAdmin && !isSelf) throw new DomainError('forbidden', 'ليس لديك صلاحية تعديل بيانات هذا الموظف.');
    if (!isAdmin && (clean.role !== undefined || clean.orgId !== undefined || clean.active !== undefined)) {
      throw new DomainError('forbidden', 'لا يمكنك تعديل الرتبة أو الشركة أو حالة الحساب.');
    }
    if (clean.role === 'super_admin' && actor.role !== 'super_admin') {
      throw new DomainError('forbidden', 'لا يمكن منح صلاحية المشرف العام.');
    }

    const after = { ...mem, ...clean } as OrganizationMember;
    const emailChanged = clean.userEmail !== undefined && clean.userEmail !== normalizeEmail(mem.userEmail);
    const orgChanged = clean.orgId !== undefined && clean.orgId !== mem.orgId;
    const oldKey = (emailChanged || orgChanged) && mem.userEmail ? await readUniqueKey(tx, 'member_email', mem.orgId, mem.userEmail) : null;
    const newKey = (emailChanged || orgChanged) && after.userEmail ? await readUniqueKey(tx, 'member_email', after.orgId, after.userEmail) : null;
    if (newKey && isKeyTakenByOther(newKey, memberId)) {
      throw new DomainError('duplicate', `البريد الإلكتروني (${after.userEmail}) مسجل لموظف آخر في هذه المؤسسة.`);
    }

    const realUids = Array.from(new Set(linkedUserIds.filter(isRealUid)));
    const syncUids: string[] = [];
    for (const uid of realUids) {
      const profile = await tx.get(COL.users, uid);
      if (profile ? profileCarriesMembership(profile, mem) : uid === mem.userId) syncUids.push(uid);
    }
    // A placeholder member (invited by email) is re-pointed at the real account.
    if (!isRealUid(mem.userId) && syncUids[0]) clean.userId = syncUids[0];

    const recipientEdits: RecipientEdits = new Map();
    editRecipients(recipientEdits, mem.orgId, mem, null);
    editRecipients(recipientEdits, after.orgId, null, after);
    const recipientUpdates = await readRecipientUpdates(tx, recipientEdits);

    tx.update(COL.members, memberId, { ...clean, updatedAt: nowIso });
    if (oldKey) releaseUniqueKey(tx, oldKey, memberId);
    if (newKey) claimUniqueKey(tx, newKey, { collection: COL.members, id: memberId }, nowIso);
    writeRecipientUpdates(tx, recipientUpdates, nowIso);
    for (const uid of syncUids) {
      tx.set(
        COL.users,
        uid,
        {
          orgId: after.orgId,
          role: after.role,
          memberId,
          name: after.userName,
          userName: after.userName,
          phone: after.phone || '',
          instapay: after.instapay || '',
          wallet: after.wallet || '',
          walletProvider: after.walletProvider || '',
          bankName: after.bankName || '',
          iban: after.iban || '',
          preferredPaymentMethod: after.preferredPaymentMethod || 'instapay',
          active: after.active !== false,
          updatedAt: nowIso,
        },
        { merge: true },
      );
    }

    const roleChanged = clean.role !== undefined && clean.role !== mem.role;
    const statusChanged = clean.active !== undefined && clean.active !== mem.active;
    const nameChanged =
      (clean.userName !== undefined && String(clean.userName).trim() !== mem.userName.trim()) ||
      (clean.jobTitle !== undefined && String(clean.jobTitle).trim() !== (mem.jobTitle || '').trim());
    let details = `تم تعديل بيانات الموظف: "${after.userName}"`;
    if (statusChanged) details = `تم ${after.active ? 'تنشيط وتفعيل' : 'تعليق وإيقاف'} حساب الموظف "${after.userName}"`;
    if (nameChanged) details += ` (تعديل الاسم أو المسمى إلى "${after.userName} - ${after.jobTitle}")`;
    if (roleChanged) details += ` (ترقية أو تعديل الرتبة إلى ${after.role})`;
    writeAudit(
      tx,
      actor,
      {
        actionType: statusChanged ? 'status_toggle' : roleChanged ? 'role_change' : nameChanged ? 'rename' : 'update',
        entityType: 'member',
        entityId: memberId,
        entityName: after.userName,
        orgId: after.orgId,
        details,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: { ...after, ...clean } as OrganizationMember, changed: true };
  });
}

/**
 * Deletes a membership and revokes the access it carried: every profile in
 * `linkedUserIds` that carries it (profileCarriesMembership) is detached from the org
 * in the same transaction. Without this a removed user whose users/{uid} still named
 * the org kept full access.
 */
export async function removeMember(
  store: DataStore,
  actor: Actor,
  memberId: string,
  linkedUserIds: string[],
  operationKey: string,
  now: Date = new Date(),
) {
  assertRole(actor, ['super_admin', 'org_admin'], 'حذف الموظفين متاح لمدير الشركة فقط.');
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const mem = await tx.get<OrganizationMember>(COL.members, memberId);
    if (!mem) return { value: null, changed: false };
    const key = mem.userEmail ? await readUniqueKey(tx, 'member_email', mem.orgId, mem.userEmail) : null;
    const detachUids: string[] = [];
    for (const uid of new Set(linkedUserIds.filter(isRealUid))) {
      if (profileCarriesMembership(await tx.get(COL.users, uid), mem)) detachUids.push(uid);
    }
    const recipientEdits: RecipientEdits = new Map();
    editRecipients(recipientEdits, mem.orgId, mem, null);
    const recipientUpdates = await readRecipientUpdates(tx, recipientEdits);

    tx.delete(COL.members, memberId);
    if (key) releaseUniqueKey(tx, key, memberId);
    writeRecipientUpdates(tx, recipientUpdates, nowIso);
    for (const uid of detachUids) {
      tx.update(COL.users, uid, { orgId: '', role: 'employee', memberId: null, updatedAt: nowIso });
    }
    writeAudit(
      tx,
      actor,
      {
        actionType: 'delete',
        entityType: 'member',
        entityId: memberId,
        entityName: mem.userName,
        orgId: mem.orgId,
        details: `تم حذف حساب وسجل الموظف "${mem.userName}" (${mem.userEmail}) من النظام`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: mem, changed: true };
  });
}
