import type { AuditActionType, Department, Organization, OrganizationMember, PaymentAccount, ServiceCategory, ServiceProvider } from '../types';
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
    { ...base, id: `vault-wallet-${org.id}`, name: `محفظة إلكترونية (${org.name})`, type: 'wallet', accountIdentifier: '01000000000', parentAccountId: bankId, parentAccountName: bankName, description: `محفظة كاش إلكترونية (فودافون/أورانج/اتصالات/وي) لـ ${org.name} (مربوطة بالبنك)` },
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

    const org: Organization & { operationKey: string } = { ...input, id, name, code, createdAt: nowIso, operationKey };
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
    tx.set(COL.members, id, member);
    if (key) claimUniqueKey(tx, key, { collection: COL.members, id }, nowIso);
    if (options.writeUserProfile) {
      tx.set(COL.users, userId, {
        uid: userId,
        email,
        name: member.userName,
        role: member.role,
        orgId: member.orgId,
        department: member.department || '',
        active: true,
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

/**
 * Updates a membership and the matching users/{uid} security profile(s) in ONE
 * transaction, so a role change can never be half-applied.
 * `linkedUserIds` are real UIDs found by email for members provisioned before sign-in.
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

    const realUids = Array.from(new Set([...(isRealUid(mem.userId) ? [mem.userId] : []), ...linkedUserIds.filter(isRealUid)]));
    if (!isRealUid(mem.userId) && realUids[0]) clean.userId = realUids[0];

    tx.update(COL.members, memberId, { ...clean, updatedAt: nowIso });
    if (oldKey) releaseUniqueKey(tx, oldKey, memberId);
    if (newKey) claimUniqueKey(tx, newKey, { collection: COL.members, id: memberId }, nowIso);
    for (const uid of realUids) {
      tx.set(
        COL.users,
        uid,
        {
          orgId: after.orgId,
          role: after.role,
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

export async function removeMember(store: DataStore, actor: Actor, memberId: string, operationKey: string, now: Date = new Date()) {
  assertRole(actor, ['super_admin', 'org_admin'], 'حذف الموظفين متاح لمدير الشركة فقط.');
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const mem = await tx.get<OrganizationMember>(COL.members, memberId);
    if (!mem) return { value: null, changed: false };
    const key = mem.userEmail ? await readUniqueKey(tx, 'member_email', mem.orgId, mem.userEmail) : null;
    tx.delete(COL.members, memberId);
    if (key) releaseUniqueKey(tx, key, memberId);
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
