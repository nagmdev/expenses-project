import type { AuditActionType, Department, Organization, OrganizationMember, PaymentAccount, Role, ServiceCategory, ServiceProvider } from '../types';
import { encodeKeyPart, idFromKey } from '../utils/ids';
import {
  COL,
  DomainError,
  PAYOUT_FIELDS,
  assertActorCompany,
  assertOrgWritable,
  assertRole,
  auditIdFor,
  claimUniqueKey,
  isKeyTakenByOther,
  legacyUniqueKeyDocId,
  uniqueKeyDocIdV1,
  normalizeEmail,
  normalizeKeyValue,
  readUniqueKey,
  releaseUniqueKey,
  roleLabel,
  splitPayout,
  toMoney,
  uniqueKeyDocId,
  writeAudit,
  type Actor,
  type UniqueKeyRead,
  type UniqueScope,
  formatAmount,
  localDate,
} from './common';
import type { DataStore, TxContext } from './store';
import { buildAccountDoc, paymentAccountHasHistory, writeNewAccount, type MutationOutcome } from './treasury';

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
        details: `تم إنشاء شركة ومؤسسة جديدة: "${name}" بكود (${code}) وميزانية معتمدة ${formatAmount(Number(input.budget || 0))} ${input.currency}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: org, changed: true };
  });
}

/**
 * `accountIds`: every treasury account of the company the caller knows (the default ones are
 * always checked too). The base currency can only change while none of them has a balance or
 * any history (paymentAccountHasHistory) — the rules cannot check this for the platform owner.
 */
export async function updateOrganization(
  store: DataStore,
  actor: Actor,
  orgId: string,
  updates: Partial<Organization>,
  operationKey: string,
  now: Date = new Date(),
  accountIds: readonly string[] = [],
) {
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
    // A company without a currency field (legacy) is an EGP company everywhere else: the
    // form re-sending its currency ('EGP') is no change, and is not written.
    const currencyOf = (c?: string | null) => ((c || '').trim() || 'EGP').toUpperCase();
    if (clean.currency !== undefined && currencyOf(clean.currency) === currencyOf(org.currency)) {
      delete clean.currency;
    }
    if (clean.currency !== undefined && clean.currency !== org.currency) {
      if (actor.role !== 'super_admin') {
        throw new DomainError('currency_immutable', 'لا يمكن لمدير الشركة تغيير العملة الأساسية للمؤسسة بعد إنشائها؛ يرجى فتح خزائن أو حسابات بالعملة الجديدة.');
      }
      const candidateIds = Array.from(new Set([...defaultAccountsFor(org).map(a => a.id!), ...accountIds].filter(Boolean)));
      const accounts = await Promise.all(candidateIds.map(id => tx.get<PaymentAccount>(COL.paymentAccounts, id)));
      if (accounts.some(a => Boolean(a && a.orgId === orgId && paymentAccountHasHistory(a)))) {
        throw new DomainError('currency_immutable', 'لا يمكن تغيير العملة الأساسية للمؤسسة بعد وجود حركات أو أرصدة مالية؛ يرجى فتح خزائن وحسابات بالعملة الجديدة.');
      }
    }
    const patch = { ...clean, updatedAt: nowIso };
    tx.update(COL.organizations, orgId, patch);
    const updated = { ...org, ...patch } as Organization;
    const nameChanged = Boolean(clean.name && String(clean.name).trim() !== org.name.trim());
    const budgetChanged = clean.budget !== undefined && clean.budget !== org.budget;
    let details = `تم تعديل بيانات الشركة: "${updated.name}"`;
    if (nameChanged) details += ` (إعادة التسمية من "${org.name}" إلى "${updated.name}")`;
    if (budgetChanged) details += ` (تعديل الميزانية من ${formatAmount(Number(org.budget))} إلى ${formatAmount(Number(updated.budget))} ${updated.currency})`;
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

/**
 * Archives a company (its records stay), or deletes one that has none. A deleted company takes
 * its treasury accounts with it (the default ones createOrganization always adds, plus
 * `accountIds`) and releases their identifier keys, so nothing is left orphaned. If one of
 * those accounts has a balance or history by the time this runs, the company is archived
 * instead; `mode` in the result says which happened.
 */
export async function removeOrganization(
  store: DataStore,
  actor: Actor,
  orgId: string,
  mode: 'archive' | 'delete',
  operationKey: string,
  now: Date = new Date(),
  accountIds: readonly string[] = [],
): Promise<{ value: Organization | null; changed: boolean; mode: 'archive' | 'delete' }> {
  assertRole(actor, ['super_admin'], 'حذف الشركات متاح للمشرف العام فقط.');
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const org = await tx.get<Organization>(COL.organizations, orgId);
    if (!org) return { value: null, changed: false, mode };
    const codeKey = await readUniqueKey(tx, 'org_code', '-', org.code || '');
    const ids = mode === 'delete' ? Array.from(new Set([...defaultAccountsFor(org).map(a => a.id!), ...accountIds])) : [];
    const accounts = (await Promise.all(ids.map(id => tx.get<PaymentAccount>(COL.paymentAccounts, id)))).filter(
      (a): a is PaymentAccount & { id: string } => Boolean(a && a.orgId === orgId),
    );
    const effectiveMode = mode === 'delete' && !accounts.some(paymentAccountHasHistory) ? 'delete' : 'archive';
    const accountKeys =
      effectiveMode === 'delete'
        ? await Promise.all(accounts.map(a => readUniqueKey(tx, 'account_identifier', orgId, a.accountIdentifier || '')))
        : [];
    if (effectiveMode === 'archive') {
      tx.update(COL.organizations, orgId, { archived: true, status: 'archived', archivedAt: nowIso });
    } else {
      tx.delete(COL.organizations, orgId);
      releaseUniqueKey(tx, codeKey, orgId);
      accounts.forEach((a, i) => {
        tx.delete(COL.paymentAccounts, a.id);
        releaseUniqueKey(tx, accountKeys[i], a.id);
      });
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
          effectiveMode === 'archive'
            ? `تمت أرشفة وتعطيل الشركة "${org.name}" (${org.code}) مع الحفاظ على سجلاتها المالية.`
            : `تم حذف الشركة "${org.name}" (${org.code}) من النظام${accounts.length ? ` مع حساباتها الخالية من أي رصيد أو حركة (${accounts.length})` : ''}`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: org, changed: true, mode: effectiveMode };
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
  /** The value is taken in EVERY company of a multi-company operation. */
  duplicateInAllMessage: (value: string) => string;
  /**
   * Who may create / edit / delete, exactly as firestore.rules allow it (and
   * src/utils/permissions.ts shows it): the domain refuses at once instead of the
   * database refusing after a long wait.
   */
  roles: { create: readonly Role[]; update: readonly Role[]; delete: readonly Role[] };
  forbidden: { create: string; update: string; delete: string };
}

const ADMIN_ROLES: readonly Role[] = ['super_admin', 'org_admin'];
const MONEY_ROLES: readonly Role[] = ['super_admin', 'org_admin', 'finance'];
const DIRECTORY_ADD_ROLES: readonly Role[] = ['super_admin', 'org_admin', 'data_entry'];

const SPECS = {
  service: {
    collection: COL.services,
    idPrefix: 'srv',
    scope: 'service_code',
    keyOf: (s: Partial<ServiceCategory>) => (s.code || '').trim(),
    label: 'بند الصرف',
    auditType: 'service',
    duplicateMessage: (v: string) => `يوجد بند صرف بنفس الكود (${v}) في هذه الشركة.`,
    duplicateInAllMessage: (v: string) => `يوجد بند صرف بنفس الكود (${v}) في كل الشركات المختارة.`,
    // rules → services: create/delete isOrgAdmin, update isOrgAdmin || isFinance
    roles: { create: ADMIN_ROLES, update: MONEY_ROLES, delete: ADMIN_ROLES },
    forbidden: {
      create: 'إضافة بنود الصرف متاحة لمدير الشركة فقط.',
      update: 'تعديل بنود الصرف متاح لمدير الشركة ومسؤولي المالية فقط.',
      delete: 'حذف بنود الصرف متاح لمدير الشركة فقط.',
    },
  } as EntitySpec<ServiceCategory>,
  provider: {
    collection: COL.providers,
    idPrefix: 'prov',
    scope: 'provider_name',
    keyOf: (p: Partial<ServiceProvider>) => (p.name || '').trim(),
    label: 'المورد',
    auditType: 'provider',
    duplicateMessage: (v: string) => `يوجد مورد مسجل بنفس الاسم (${v}) في هذه الشركة.`,
    duplicateInAllMessage: (v: string) => `يوجد مورد مسجل بنفس الاسم (${v}) في كل الشركات المختارة.`,
    // rules → providers: create isOrgAdmin || isDataEntry, update isOrgAdmin || isFinance, delete isOrgAdmin
    roles: { create: DIRECTORY_ADD_ROLES, update: MONEY_ROLES, delete: ADMIN_ROLES },
    forbidden: {
      create: 'إضافة الموردين متاحة لمدير الشركة ومدخلي البيانات فقط.',
      update: 'تعديل بيانات الموردين متاح لمدير الشركة ومسؤولي المالية فقط.',
      delete: 'حذف الموردين متاح لمدير الشركة فقط.',
    },
  } as EntitySpec<ServiceProvider>,
  department: {
    collection: COL.departments,
    idPrefix: 'dept',
    scope: 'department_name',
    keyOf: (d: Partial<Department>) => (d.name || '').trim(),
    label: 'القسم',
    auditType: 'department',
    duplicateMessage: (v: string) => `يوجد قسم بنفس الاسم (${v}) في هذه الشركة.`,
    duplicateInAllMessage: (v: string) => `يوجد قسم بنفس الاسم (${v}) في كل الشركات المختارة.`,
    // rules → departments: create isOrgAdmin || isDataEntry, update/delete isOrgAdmin
    roles: { create: DIRECTORY_ADD_ROLES, update: ADMIN_ROLES, delete: ADMIN_ROLES },
    forbidden: {
      create: 'إضافة الأقسام متاحة لمدير الشركة ومدخلي البيانات فقط.',
      update: 'تعديل الأقسام متاح لمدير الشركة فقط.',
      delete: 'حذف الأقسام متاح لمدير الشركة فقط.',
    },
  } as EntitySpec<Department>,
};
export type EntityKind = keyof typeof SPECS;

async function readKeyIfAny(tx: TxContext, scope: UniqueScope, orgId: string, value: string) {
  return value ? readUniqueKey(tx, scope, orgId, value) : null;
}

/**
 * The companies a service is shared with (orgIds) are set by the platform owner only:
 * company staff may keep the list as it is, or name only their own company — never push
 * their service into another tenant (firestore.rules → services, sharingUnchangedOrOwn()).
 */
function assertServiceSharing(actor: Actor, orgId: string, before: unknown, after: unknown) {
  if (actor.role === 'super_admin' || after === undefined) return;
  const list = Array.isArray(after) ? after.map(String) : [];
  const same = JSON.stringify(after) === JSON.stringify(before ?? null);
  if (same || list.length === 0 || (list.length === 1 && list[0] === orgId)) return;
  throw new DomainError('forbidden', 'مشاركة بند الصرف مع شركات أخرى متاحة للمشرف العام فقط.');
}

/** A record that money already went through (a service budget used, a provider paid) is never hard-deleted. */
const hasFinancialHistory = (entity: Record<string, any>) => toMoney(entity.spentAmount) !== 0 || toMoney(entity.totalPaid) !== 0;

export async function createEntity<T extends { id: string; orgId: string }>(
  store: DataStore,
  actor: Actor,
  kind: EntityKind,
  build: (id: string, nowIso: string) => T,
  audit: (entity: T) => string,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<T>> {
  const spec = SPECS[kind] as unknown as EntitySpec<T>;
  assertRole(actor, spec.roles.create, spec.forbidden.create);
  const id = idFromKey(spec.idPrefix, operationKey);
  const nowIso = now.toISOString();
  const entity = build(id, nowIso);
  if (!entity.orgId) throw new DomainError('missing_org', 'يرجى تحديد الشركة.');
  if (kind === 'service') assertServiceSharing(actor, entity.orgId, null, (entity as any).orgIds);

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
  const spec = SPECS[kind] as unknown as EntitySpec<T>;
  assertRole(actor, spec.roles.update, spec.forbidden.update);
  const clean: Record<string, any> = { ...updates };
  delete clean.id;
  delete clean.orgId;
  // Counters maintained by financial transactions are never overwritten from a form.
  delete clean.spentAmount;
  delete clean.totalPaid;
  delete clean.lastDisbursedRequestId;
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    const current = await tx.get<T>(spec.collection, id);
    if (!current) throw new DomainError('not_found', `${spec.label} غير موجود.`);
    // e.g. a service another company shares with this one: usable here, edited only by its own company.
    assertActorCompany(actor, current.orgId, `لا يمكن تعديل ${spec.label} "${current.name || id}" لأنه تابع لشركة أخرى (مشترك مع شركتك للاستخدام فقط).`);
    if (kind === 'service') assertServiceSharing(actor, current.orgId, (current as any).orgIds, clean.orgIds);
    const after = { ...current, ...clean } as T;
    const oldValue = spec.keyOf(current);
    const newValue = spec.keyOf(after);
    // Compared as keys (normalizeKeyValue, as the rules do): toLowerCase would also fold
    // non-ASCII capitals, which the key keeps.
    const changedKey = normalizeKeyValue(newValue, spec.scope) !== normalizeKeyValue(oldValue, spec.scope);
    let oldKey = changedKey ? await readKeyIfAny(tx, spec.scope, current.orgId, oldValue) : null;
    let newKey = changedKey ? await readKeyIfAny(tx, spec.scope, current.orgId, newValue) : null;
    if (newKey && isKeyTakenByOther(newKey, id)) throw new DomainError('duplicate', spec.duplicateMessage(newValue));
    // Same normalized value (only case / spacing / dashes changed): the key stays as it is.
    if (oldKey && newKey && oldKey.docId === newKey.docId) {
      oldKey = null;
      newKey = null;
    }

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

export type EntityRemoval = 'deleted' | 'deactivated';

/**
 * Removes a service / provider / department. `requestedMode` 'deactivate' keeps the record
 * (active: false) — the caller asks for it when the record is in use (requests, visas,
 * custody settlements). A record money already went through (spentAmount / totalPaid) is
 * always deactivated, whatever was asked: deleting it would orphan its financial history.
 * `removal` says what actually happened.
 */
export async function deleteEntity(
  store: DataStore,
  actor: Actor,
  kind: EntityKind,
  id: string,
  requestedMode: 'deactivate' | 'delete',
  operationKey: string,
  now: Date = new Date(),
): Promise<{ value: any; changed: boolean; removal: EntityRemoval | null }> {
  const spec = SPECS[kind] as unknown as EntitySpec<any>;
  assertRole(actor, spec.roles.delete, spec.forbidden.delete);
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const current = await tx.get<any>(spec.collection, id);
    if (!current) return { value: null, changed: false, removal: null };
    assertActorCompany(actor, current.orgId, `لا يمكن حذف ${spec.label} "${current.name || id}" لأنه تابع لشركة أخرى.`);
    const mode = requestedMode === 'delete' && hasFinancialHistory(current) ? 'deactivate' : requestedMode;
    if (mode === 'deactivate' && current.active === false) return { value: current, changed: false, removal: 'deactivated' as const };
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
            : `تم تعطيل ${spec.label} "${current.name}" بدلاً من حذفه لارتباطه بعمليات سابقة (طلبات صرف أو تأشيرات أو تسويات عهد أو مدفوعات)؛ يبقى في السجلات ولا يظهر في العمليات الجديدة.`,
      },
      auditIdFor(operationKey),
      nowIso,
    );
    return { value: current, changed: true, removal: mode === 'delete' ? ('deleted' as const) : ('deactivated' as const) };
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
    const update = recipientUpdateFor(orgId, await tx.get<Organization>(COL.organizations, orgId), remove, add);
    if (update) updates.push(update);
  }
  return updates;
}

/** The org's new recipient list, or null when unchanged or not initialized yet (the backfill computes it). */
function recipientUpdateFor(orgId: string, org: Organization | null, remove: string[], add: string[]) {
  if (!org || !Array.isArray(org.notificationRecipients)) return null;
  const next = new Set(org.notificationRecipients.filter(e => !remove.includes(e)));
  add.forEach(e => next.add(e));
  const list = Array.from(next).sort();
  if (list.join('\n') === [...org.notificationRecipients].sort().join('\n')) return null;
  return { orgId, notificationRecipients: list };
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
 * A membership is addressed to the account `uid`: by its UID, or (an email invitation that was
 * never re-pointed to a login) by the address that account proved (verifiedEmail) or was given
 * (email: only ever its own verified address or what its company's admin wrote, see rules).
 */
const membershipAddressedTo = (mem: Pick<OrganizationMember, 'userId' | 'userEmail'>, uid: string, profile: Record<string, any>) =>
  mem.userId === uid ||
  (!isRealUid(mem.userId) && Boolean(normalizeEmail(mem.userEmail)) &&
    [profile.verifiedEmail, profile.email].some(e => normalizeEmail(e) === normalizeEmail(mem.userEmail)));

/**
 * Whether the users/{uid} profile carries this membership's access: in the membership's org,
 * linked to it (memberId) or to no membership in particular (admin-provisioned), and the
 * membership is that person's. A profile's memberId alone is the profile's own claim: it never
 * pulls someone else's role onto it. Conversely the person's own membership (mem.userId) is
 * carried by their profile unless the profile names another live record of theirs in the
 * same company (a legacy duplicate): naming someone else's record never shields it from a
 * suspension, a role change or the removal. A profile whose primary org is elsewhere is left alone.
 */
async function profileCarriesMembership(
  tx: TxContext,
  uid: string,
  profile: Record<string, any> | null,
  mem: Pick<OrganizationMember, 'id' | 'orgId' | 'userId' | 'userEmail'>,
): Promise<boolean> {
  if (!profile || profile.orgId !== mem.orgId) return false;
  if (!profile.memberId || profile.memberId === mem.id) return membershipAddressedTo(mem, uid, profile);
  if (uid !== mem.userId) return false;
  const linked = await tx.get<OrganizationMember>(COL.members, String(profile.memberId));
  return !(linked && linked.orgId === mem.orgId && membershipAddressedTo(linked, uid, profile));
}

// ---------------------------------------------------------------------------
// Protected memberships. An org admin can never delete, suspend or change the role of
// the platform owner's membership, nor their own (firestore.rules → members,
// isProtectedMembership). Only the platform owner (super admin) can.
// ---------------------------------------------------------------------------
/** Fields that decide what a membership grants, and to whom. */
const GRANT_FIELDS = ['role', 'orgId', 'active', 'userId', 'userEmail'] as const;

type MemberIdentity = Pick<OrganizationMember, 'userId' | 'userEmail' | 'orgId'>;

export const isOwnMembership = (actor: Pick<Actor, 'id' | 'email'>, mem: Pick<OrganizationMember, 'userId' | 'userEmail'>) =>
  mem.userId === actor.id || (Boolean(normalizeEmail(actor.email)) && normalizeEmail(mem.userEmail) === normalizeEmail(actor.email));

/** 'owner' / 'self' when this actor may not delete, suspend or re-role the membership; null otherwise. */
export function membershipProtection(actor: Actor, mem: Pick<OrganizationMember, 'userId' | 'userEmail'>): 'owner' | 'self' | null {
  if (actor.role === 'super_admin') return null;
  if (isPlatformOwnerEmail(mem.userEmail)) return 'owner';
  if (isOwnMembership(actor, mem)) return 'self';
  return null;
}

const PROTECTED_MEMBER_MESSAGES = {
  owner: {
    remove: 'لا يمكن حذف عضوية مالك المنصة من الشركة.',
    change: 'لا يمكن تعليق أو تغيير صلاحية عضوية مالك المنصة.',
  },
  self: {
    remove: 'لا يمكنك حذف عضويتك أنت من الشركة؛ يقوم بذلك مدير آخر أو مالك المنصة.',
    change: 'لا يمكنك تغيير رتبتك أو تعليق حسابك بنفسك؛ يقوم بذلك مدير آخر أو مالك المنصة.',
  },
};

/** Refuses at once (before any slow lookup) what removeMember / firestore.rules would refuse. */
export function assertMemberRemovable(actor: Actor, mem: MemberIdentity) {
  assertRole(actor, ADMIN_ROLES, 'حذف الموظفين متاح لمدير الشركة فقط.');
  assertActorCompany(actor, mem.orgId, 'لا يمكن حذف موظف تابع لشركة أخرى.');
  const protection = membershipProtection(actor, mem);
  if (protection) throw new DomainError('protected_member', PROTECTED_MEMBER_MESSAGES[protection].remove);
}

const sameGrantValue = (field: (typeof GRANT_FIELDS)[number], a: unknown, b: unknown) =>
  field === 'userEmail'
    ? normalizeEmail(a as string) === normalizeEmail(b as string)
    : field === 'active'
    ? (a !== false) === (b !== false)
    : String(a ?? '') === String(b ?? '');

/**
 * The fields of an update that actually change the membership. Forms send the whole record
 * back (role, orgId, active…): an unchanged value is not a change, so it neither needs the
 * admin role nor reaches the database (the rules compare what is written).
 */
export function effectiveMemberChanges(mem: Partial<OrganizationMember>, updates: Partial<OrganizationMember>): Record<string, any> {
  const clean: Record<string, any> = { ...updates };
  delete clean.id;
  delete clean.joinedAt;
  if (clean.userEmail !== undefined) clean.userEmail = normalizeEmail(clean.userEmail);
  for (const f of GRANT_FIELDS) {
    if (clean[f] !== undefined && sameGrantValue(f, clean[f], (mem as Record<string, unknown>)[f])) delete clean[f];
  }
  return clean;
}

/** Refuses at once what updateMemberRecord / firestore.rules would refuse (changes = effectiveMemberChanges). */
export function assertMemberUpdatable(actor: Actor, mem: MemberIdentity, changes: Record<string, any>) {
  const isAdmin = actor.role === 'super_admin' || actor.role === 'org_admin';
  const isSelf = mem.userId === actor.id;
  const touchesGrant = GRANT_FIELDS.some(f => changes[f] !== undefined);
  if (!isAdmin && !isSelf) throw new DomainError('forbidden', 'ليس لديك صلاحية تعديل بيانات هذا الموظف.');
  if (!isAdmin && touchesGrant) throw new DomainError('forbidden', 'لا يمكنك تعديل الرتبة أو الشركة أو حالة الحساب.');
  if (isAdmin && !isSelf) assertActorCompany(actor, mem.orgId, 'لا يمكن تعديل موظف تابع لشركة أخرى.');
  if (isAdmin && touchesGrant) {
    const protection = membershipProtection(actor, mem);
    if (protection) throw new DomainError('protected_member', PROTECTED_MEMBER_MESSAGES[protection].change);
  }
  // rules → members update: an org admin never moves a membership to another company.
  if (isAdmin && changes.orgId !== undefined && actor.role !== 'super_admin') {
    throw new DomainError('forbidden', 'نقل الموظف إلى شركة أخرى متاح للمشرف العام فقط.');
  }
  if (changes.role === 'super_admin' && actor.role !== 'super_admin') {
    throw new DomainError('forbidden', 'لا يمكن منح صلاحية المشرف العام.');
  }
  if (changes.userName !== undefined && !String(changes.userName).trim()) {
    throw new DomainError('invalid_input', 'يرجى إدخال اسم الموظف؛ لا يمكن حفظ الاسم فارغاً.');
  }
}

/**
 * The email invitation (members/pending-<email>_<org>) that holds `email`'s key in this company,
 * when `userId` is a real login for that address (addMemberToOrgs: the platform owner / admin
 * found it PROVEN by verifiedLoginUidOf, or just created it). Adding that login to the company
 * replaces the invitation by the login's own membership (<uid>_<org>) in the same transaction: an
 * invitation grants only through the invitee's profile, which a person who already works in
 * another company keeps there, so the invitation alone would never open this company for them.
 */
async function invitationReplacedBy(
  tx: TxContext,
  key: UniqueKeyRead | null,
  email: string,
  userId: string,
  orgId: string,
): Promise<OrganizationMember | null> {
  if (!key?.owner || !email || !isRealUid(userId) || key.owner.collection !== COL.members) return null;
  if (key.owner.id !== `${pendingUserIdForEmail(email)}_${orgId}`) return null;
  const invitation = await tx.get<OrganizationMember>(COL.members, key.owner.id);
  if (!invitation || invitation.orgId !== orgId || normalizeEmail(invitation.userEmail) !== email) return null;
  // Already taken by another login (its profile linked it): not this one's to replace.
  if (isRealUid(invitation.userId) && invitation.userId !== userId) return null;
  return invitation;
}

/** Write phase of invitationReplacedBy: the invitation goes, its key now names `memberId`. */
function replaceInvitation(tx: TxContext, invitation: OrganizationMember, key: UniqueKeyRead, memberId: string, nowIso: string) {
  tx.delete(COL.members, invitation.id);
  // A key written before 2026-10 sits under its old id: removed, and claimed under the current one.
  if (key.legacyDocId) releaseUniqueKey(tx, key, invitation.id);
  claimUniqueKey(tx, key, { collection: COL.members, id: memberId }, nowIso);
}

const requireMemberName = (name?: string | null) => {
  if (!String(name || '').trim()) throw new DomainError('invalid_input', 'يرجى إدخال اسم الموظف.');
};

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
  requireMemberName(input.userName);
  // Payout details never go into a membership (every member of the company can list those).
  input = splitPayout(input).rest as MemberInput;
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
      joinedAt: localDate(now),
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
        details: `تم إضافة وتعيين موظف جديد: "${member.userName}" (${member.userEmail || '-'} | ${member.jobTitle} - ${member.department}) برتبة ${roleLabel(member.role)}`,
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
 * The login (real UID) a person's memberships CLAIM, or '' when there is none — e.g. only
 * email-invited (pending) memberships. A form hint only ("this email seems to have a login"):
 * a membership's (userId, userEmail) pair is whatever some company's admin wrote, so it is
 * never used to link an account (see verifiedLoginUidOf).
 */
export const knownLoginUidOf = (memberships: Array<Pick<OrganizationMember, 'userId'>>): string =>
  memberships.find(m => isRealUid(m.userId))?.userId || '';

/**
 * The login (real UID) that may be re-used for `email` when the person is added to another
 * company, or '' when none is PROVEN. Any org admin can write a membership pairing an account
 * it controls with someone else's email, so a UID found next to an email is a claim, not
 * proof: it is re-used only when that account recorded the address itself, from its verified
 * sign-in token (users/{uid}.verifiedEmail, which firestore.rules let nobody else write).
 * Otherwise the person is added by email (pending-<email>), which only the verified owner of
 * the address can take. `readVerifiedEmail` returns a profile's verifiedEmail (null when the
 * profile is missing or not readable).
 */
export async function verifiedLoginUidOf(
  memberships: Array<Pick<OrganizationMember, 'userId' | 'userEmail'>>,
  email: string,
  readVerifiedEmail: (uid: string) => Promise<string | null | undefined>,
): Promise<string> {
  const target = normalizeEmail(email);
  if (!target) return '';
  const uids = Array.from(new Set(memberships.filter(m => isRealUid(m.userId) && normalizeEmail(m.userEmail) === target).map(m => m.userId)));
  for (const uid of uids) {
    const proven = await readVerifiedEmail(uid).catch(() => null);
    if (normalizeEmail(proven) === target) return uid;
  }
  return '';
}

/**
 * A login account created by an earlier, unfinished attempt of the same provisioning intent
 * (same idempotency key) is re-used only for the SAME email. A changed email is a different
 * person: re-using that login would attach it (and show its credentials) under another email.
 */
export function reusableProvisionedAccount<A extends { email: string }>(account: A | undefined, email: string): A | undefined {
  if (!account) return undefined;
  if (normalizeEmail(account.email) !== normalizeEmail(email)) {
    throw new DomainError(
      'identity_changed',
      `تم إنشاء حساب دخول للبريد (${normalizeEmail(account.email)}) في محاولة سابقة لم تكتمل، ولا يمكن استخدامه لبريد آخر. أغلق النموذج وافتحه من جديد ثم أعد المحاولة.`,
    );
  }
  return account;
}

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

/** The identity fields of a user's own users/{uid} profile. */
export interface IdentityProfile {
  orgId?: string | null;
  role?: Role | null;
  memberId?: string | null;
  name?: string | null;
  active?: boolean;
}

export interface ProfileMembershipState {
  /** The profile's company/role still come from a membership that exists: safe to use. */
  current: boolean;
  /** The membership the profile should be (re)linked to now, if a write is needed. */
  relinkTo: OrganizationMember | null;
  /** The user was (re)added by email only and must verify it before the link is allowed. */
  awaitingVerification: boolean;
}

/**
 * A users/{uid} profile is a cache of ONE membership (company, role, memberId, name).
 * When that membership is deleted, re-created (e.g. the person deleted and added again)
 * or changed, the profile must stop deciding the user's name, role and company: the live
 * membership wins and the profile is re-linked to it. Legacy profiles without memberId
 * stay current while the user still has a live membership in that company.
 */
export function profileMembershipState(
  profile: IdentityProfile | null,
  memberships: OrganizationMember[],
  identity: { uid: string; email?: string | null; emailVerified: boolean },
): ProfileMembershipState {
  const email = normalizeEmail(identity.email);
  const mine = (m: OrganizationMember) => m.userId === identity.uid || (Boolean(email) && normalizeEmail(m.userEmail) === email);
  const live = memberships.filter(m => Boolean(m.orgId?.trim()) && m.active !== false && mine(m));
  const linkable = (m: OrganizationMember) =>
    LINKABLE_ROLE_PRIORITY[m.role] !== undefined && (m.userId === identity.uid || (identity.emailVerified && normalizeEmail(m.userEmail) === email));
  const byRole = (a: OrganizationMember, b: OrganizationMember) => (LINKABLE_ROLE_PRIORITY[b.role] ?? 0) - (LINKABLE_ROLE_PRIORITY[a.role] ?? 0);

  const orgId = profile?.orgId?.trim() || '';
  let current = false;
  let backing: OrganizationMember | undefined;
  if (orgId) {
    backing = profile?.memberId
      ? live.find(m => m.id === profile.memberId && m.orgId === orgId)
      : live.filter(m => m.orgId === orgId).sort(byRole)[0];
    current = Boolean(backing && backing.role === profile?.role);
  }

  let relinkTo: OrganizationMember | null = null;
  if (current && backing) {
    // Still the same membership: only resync a changed name, or a legacy profile's missing memberId.
    if (linkable(backing) && ((backing.userName && backing.userName !== profile?.name) || !profile?.memberId)) relinkTo = backing;
  } else {
    // Prefer the same company, then the highest role — never a membership the rules would refuse.
    const candidates = live.filter(linkable).sort(byRole);
    relinkTo = candidates.find(m => m.orgId === orgId) ?? candidates[0] ?? null;
  }
  const awaitingVerification = !current && !relinkTo && !identity.emailVerified && live.some(m => m.userId !== identity.uid);
  return { current, relinkTo, awaitingVerification };
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
  const nowIso = now.toISOString();

  return store.runTransaction(async tx => {
    const mem = await tx.get<OrganizationMember>(COL.members, memberId);
    if (!mem) throw new DomainError('not_found', 'سجل الموظف غير موجود.');
    // Payout details provided here go to the person's own profile, never into the membership.
    const { rest, payout } = splitPayout(effectiveMemberChanges(mem, updates));
    const clean: Record<string, any> = rest;
    assertMemberUpdatable(actor, mem, clean);

    const after = { ...mem, ...clean } as OrganizationMember;
    const emailChanged = clean.userEmail !== undefined && clean.userEmail !== normalizeEmail(mem.userEmail);
    const orgChanged = clean.orgId !== undefined && clean.orgId !== mem.orgId;
    let oldKey = (emailChanged || orgChanged) && mem.userEmail ? await readUniqueKey(tx, 'member_email', mem.orgId, mem.userEmail) : null;
    let newKey = (emailChanged || orgChanged) && after.userEmail ? await readUniqueKey(tx, 'member_email', after.orgId, after.userEmail) : null;
    if (newKey && isKeyTakenByOther(newKey, memberId)) {
      throw new DomainError('duplicate', `البريد الإلكتروني (${after.userEmail}) مسجل لموظف آخر في هذه المؤسسة.`);
    }
    if (oldKey && newKey && oldKey.docId === newKey.docId) {
      oldKey = null;
      newKey = null;
    }

    const realUids = Array.from(new Set(linkedUserIds.filter(isRealUid)));
    const syncUids: string[] = [];
    // Suspending: a profile that merely names this record (not the person's: nothing is synced
    // onto it) is suspended too, so naming a record never keeps what it grants.
    const suspendUids: string[] = [];
    for (const uid of realUids) {
      const profile = await tx.get<Record<string, any>>(COL.users, uid);
      if (profile ? await profileCarriesMembership(tx, uid, profile, mem) : uid === mem.userId) syncUids.push(uid);
      else if (after.active === false && uid !== actor.id && profile && profile.orgId === mem.orgId && profile.memberId === memberId) suspendUids.push(uid);
    }
    // A placeholder member (invited by email) is re-pointed at the real account — not on a
    // membership this actor may not re-assign (their own / the platform owner's, see rules).
    if (!isRealUid(mem.userId) && syncUids[0] && !membershipProtection(actor, mem)) clean.userId = syncUids[0];

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
          // Only payout details given in THIS update; the profile's own ones are never overwritten
          // from the membership (which no longer carries them).
          ...payout,
          active: after.active !== false,
          updatedAt: nowIso,
        },
        { merge: true },
      );
    }
    for (const uid of suspendUids) tx.update(COL.users, uid, { active: false, updatedAt: nowIso });

    const roleChanged = clean.role !== undefined && clean.role !== mem.role;
    const statusChanged = clean.active !== undefined && clean.active !== mem.active;
    const nameChanged =
      (clean.userName !== undefined && String(clean.userName).trim() !== mem.userName.trim()) ||
      (clean.jobTitle !== undefined && String(clean.jobTitle).trim() !== (mem.jobTitle || '').trim());
    let details = `تم تعديل بيانات الموظف: "${after.userName}"`;
    if (statusChanged) details = `تم ${after.active ? 'تنشيط وتفعيل' : 'تعليق وإيقاف'} حساب الموظف "${after.userName}"`;
    if (nameChanged) details += ` (تعديل الاسم أو المسمى إلى "${after.userName} - ${after.jobTitle}")`;
    if (roleChanged) details += ` (ترقية أو تعديل الرتبة إلى ${roleLabel(after.role)})`;
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
    assertMemberRemovable(actor, mem);
    const key = mem.userEmail ? await readUniqueKey(tx, 'member_email', mem.orgId, mem.userEmail) : null;
    const detachUids: string[] = [];
    for (const uid of new Set(linkedUserIds.filter(isRealUid))) {
      const profile = await tx.get<Record<string, any>>(COL.users, uid);
      // Revoking: also a profile that merely names this record (memberId), whoever's it is.
      if ((await profileCarriesMembership(tx, uid, profile, mem)) || (profile && profile.orgId === mem.orgId && profile.memberId === memberId)) {
        detachUids.push(uid);
      } else if (
        profile && profile.orgId === mem.orgId && profile.memberId && profile.memberId !== memberId &&
        (uid === mem.userId || (Boolean(mem.userEmail) && normalizeEmail(profile.email) === normalizeEmail(mem.userEmail)))
      ) {
        // The same person's profile, linked to another record of this company that no longer
        // exists (a duplicate deleted earlier): once this one goes, nothing backs the profile.
        const linked = await tx.get<OrganizationMember>(COL.members, profile.memberId);
        if (!linked || linked.orgId !== mem.orgId) detachUids.push(uid);
      }
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

// ---------------------------------------------------------------------------
// Payout details live in users/{uid}, never in members/* (every member of a company
// can list its memberships). Older versions copied them there on every profile save;
// these two operations take them out again without losing them.
// ---------------------------------------------------------------------------
const hasPayoutValue = (v: unknown) => typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null;
const hasPayoutFields = (doc: Record<string, any>) => PAYOUT_FIELDS.some(f => f in doc);

/**
 * The signed-in user's own profile save, mirrored into their membership: name and phone
 * are updated there, and any payout details a previous version copied into it are removed
 * (the caller has just saved them in users/{uid}). Only the member's own login may do this
 * (firestore.rules → members, self-service update).
 */
export async function syncOwnMembership(
  store: DataStore,
  actor: Actor,
  memberId: string,
  fields: { userName?: string; phone?: string },
  now: Date = new Date(),
): Promise<MutationOutcome<OrganizationMember | null>> {
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const mem = await tx.get<OrganizationMember>(COL.members, memberId);
    if (!mem) return { value: null, changed: false };
    if (mem.userId !== actor.id) throw new DomainError('forbidden', 'يمكن تحديث بيانات عضويتك أنت فقط.');
    const userName = fields.userName?.trim();
    const phone = fields.phone === undefined ? undefined : fields.phone.trim();
    const nameChanges = Boolean(userName) && userName !== mem.userName;
    const phoneChanges = phone !== undefined && phone !== (mem.phone || '');
    if (!nameChanges && !phoneChanges && !hasPayoutFields(mem)) return { value: mem, changed: false };
    const next = {
      ...splitPayout(mem).rest,
      ...(nameChanges ? { userName } : {}),
      ...(phoneChanges ? { phone } : {}),
      updatedAt: nowIso,
    } as OrganizationMember;
    // A full write (not a merge): that is what removes the payout fields.
    tx.set(COL.members, memberId, next);
    return { value: next, changed: true };
  });
}

export type PayoutMoveOutcome = 'moved' | 'nothing_to_move' | 'no_profile';

/**
 * Admin clean-up of one membership that still carries payout details: the values the
 * person's users/{uid} profile does not have yet are copied there, then the membership is
 * rewritten without them — in one transaction, so nothing is ever lost. A membership whose
 * person has no profile (never signed in) keeps its values until they sign in and save.
 */
export async function movePayoutToProfile(
  store: DataStore,
  actor: Actor,
  memberId: string,
  now: Date = new Date(),
): Promise<MutationOutcome<PayoutMoveOutcome>> {
  assertRole(actor, ADMIN_ROLES, 'نقل بيانات الاستحقاق متاح لمدير الشركة فقط.');
  const nowIso = now.toISOString();
  return store.runTransaction(async tx => {
    const mem = await tx.get<OrganizationMember>(COL.members, memberId);
    if (!mem || !hasPayoutFields(mem)) return { value: 'nothing_to_move' as const, changed: false };
    assertActorCompany(actor, mem.orgId, 'لا يمكن تعديل موظف تابع لشركة أخرى.');
    const { rest, payout } = splitPayout(mem);
    const values = Object.fromEntries(Object.entries(payout).filter(([, v]) => hasPayoutValue(v)));
    const profile = Object.keys(values).length > 0 && isRealUid(mem.userId) ? await tx.get<Record<string, any>>(COL.users, mem.userId) : null;
    const missing = profile ? Object.fromEntries(Object.entries(values).filter(([f]) => !hasPayoutValue(profile[f]))) : values;
    if (!profile && Object.keys(missing).length > 0) return { value: 'no_profile' as const, changed: false };
    if (profile && Object.keys(missing).length > 0) tx.set(COL.users, mem.userId, { ...missing, updatedAt: nowIso }, { merge: true });
    tx.set(COL.members, memberId, { ...rest, updatedAt: nowIso });
    return { value: 'moved' as const, changed: true };
  });
}

// ---------------------------------------------------------------------------
// One operation, several companies (the company multi-select of the add forms)
// ---------------------------------------------------------------------------
// Memberships, providers and departments stay ONE document per company (own orgId,
// own totals, own unique key), which is what firestore.rules check per document.
// Selecting N companies creates up to N documents in ONE transaction: all or nothing,
// and a retry with the same operation key never creates a second copy anywhere.
// A company where the email / name is already taken is skipped (and reported), never
// a failure for the other companies.

export interface MultiOrgSkip {
  orgId: string;
  reason: 'already_member' | 'duplicate';
  /** Name of the record that already holds the email / name in that company. */
  existingName?: string;
}

export interface MultiOrgResult<T> {
  /** This operation's documents: created now, or by an earlier attempt with the same key (in the order of orgIds). */
  created: T[];
  /** Companies left untouched because the email / name is already taken there. */
  skipped: MultiOrgSkip[];
}

export const MAX_ORGS_PER_OPERATION = 50;

/**
 * The platform owner: the ONLY super admin. Identical to builtInSuperAdmins() in
 * firestore.rules (and DEFAULT_SUPER_ADMINS in AppContext). Nobody else can be promoted.
 */
export const PLATFORM_OWNER_EMAILS: readonly string[] = ['mahmoud@tieapps.com'];
export const isPlatformOwnerEmail = (email?: string | null) => PLATFORM_OWNER_EMAILS.includes(normalizeEmail(email));

export const SUPER_ADMIN_OWNER_ONLY_MESSAGE = 'صلاحية المشرف العام (Super Admin) حصرية لمالك المنصة ولا يمكن منحها لأي مستخدم آخر.';

/** Trimmed, de-duplicated company ids of one operation (1..MAX_ORGS_PER_OPERATION). */
export function normalizeOrgIds(orgIds: readonly string[]): string[] {
  const ids = Array.from(new Set((orgIds || []).map(id => String(id ?? '').trim()).filter(id => id && id !== 'all')));
  if (ids.length === 0) throw new DomainError('missing_org', 'يرجى تحديد شركة واحدة على الأقل.');
  if (ids.length > MAX_ORGS_PER_OPERATION) {
    throw new DomainError('invalid_input', `لا يمكن الإضافة إلى أكثر من ${MAX_ORGS_PER_OPERATION} شركة في عملية واحدة.`);
  }
  if (ids.some(id => id.includes('/'))) throw new DomainError('invalid_input', 'معرّف الشركة غير صالح.');
  return ids;
}

/** Deterministic id of the document an operation creates in one company (a retry addresses the same document). */
export const entityIdInOrg = (kind: EntityKind, operationKey: string, orgId: string) =>
  `${idFromKey(SPECS[kind].idPrefix, operationKey)}-${orgId}`;

const readTargetOrg = assertOrgWritable;

const inOrderOf = <T extends { orgId: string }>(targets: string[], list: T[]) =>
  [...list].sort((a, b) => targets.indexOf(a.orgId) - targets.indexOf(b.orgId));

/**
 * Companies per transaction of a multi-company add. The rules read the caller's membership
 * in every company a commit writes to (plus the profile and the two super-admin lookups), and
 * a commit may read at most 20 documents: 15 companies stay within it. Every document id is
 * derived from the operation key, so each transaction is idempotent and a retry with the same
 * key completes the companies an interrupted run did not reach.
 */
export const ORGS_PER_TRANSACTION = 15;
/** Invitations a multi-company add replaces per transaction (createMemberInOrgs → invitationReplacedBy). */
export const INVITATIONS_PER_TRANSACTION = 5;

interface OrgChunkResult<T> {
  created: T[];
  replayed: T[];
  skipped: MultiOrgSkip[];
}

async function runInOrgChunks<T extends { orgId: string }>(
  store: DataStore,
  targets: string[],
  runChunk: (chunk: string[]) => Promise<OrgChunkResult<T>>,
  takenEverywhere: (skipped: MultiOrgSkip[]) => DomainError,
): Promise<MutationOutcome<MultiOrgResult<T>>> {
  const chunks: string[][] = [];
  for (let i = 0; i < targets.length; i += ORGS_PER_TRANSACTION) chunks.push(targets.slice(i, i + ORGS_PER_TRANSACTION));
  // An unknown or archived company still fails the whole operation before anything is
  // written. Read-only, chunk by chunk too: a transaction's commit re-checks every document
  // it read against the rules, within the same per-commit read budget.
  if (chunks.length > 1) {
    for (const chunk of chunks) {
      await store.runTransaction(async tx => {
        for (const orgId of chunk) await readTargetOrg(tx, orgId);
      });
    }
  }
  const all: OrgChunkResult<T> = { created: [], replayed: [], skipped: [] };
  for (const chunk of chunks) {
    const part = await runChunk(chunk);
    all.created.push(...part.created);
    all.replayed.push(...part.replayed);
    all.skipped.push(...part.skipped);
  }
  if (all.created.length === 0) {
    if (all.replayed.length > 0) return { value: { created: inOrderOf(targets, all.replayed), skipped: all.skipped }, changed: false, reason: 'duplicate_operation' };
    throw takenEverywhere(all.skipped);
  }
  return { value: { created: inOrderOf(targets, [...all.replayed, ...all.created]), skipped: all.skipped }, changed: true };
}

/**
 * Adds one person to every selected company (members/{userId}_{orgId} per company, like
 * createMember), ORGS_PER_TRANSACTION companies per transaction. Companies where they
 * already belong are skipped.
 * Nobody but the platform owner is super admin: the role is always refused here.
 */
export async function createMemberInOrgs(
  store: DataStore,
  actor: Actor,
  input: Omit<MemberInput, 'orgId'>,
  orgIds: string[],
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<MultiOrgResult<OrganizationMember>>> {
  assertRole(actor, ['super_admin', 'org_admin'], 'إضافة الموظفين متاحة لمدير الشركة فقط.');
  if (input.role === 'super_admin') throw new DomainError('forbidden', SUPER_ADMIN_OWNER_ONLY_MESSAGE);
  requireMemberName(input.userName);
  input = splitPayout(input).rest as Omit<MemberInput, 'orgId'>;
  const targets = normalizeOrgIds(orgIds);
  const email = normalizeEmail(input.userEmail);
  const userId = input.userId && !input.userId.startsWith('temp_') ? input.userId : email ? pendingUserIdForEmail(email) : idFromKey('usr', operationKey);
  const who = email ? `البريد الإلكتروني (${email})` : `الموظف (${input.userName})`;
  const nowIso = now.toISOString();
  type Stored = OrganizationMember & { operationKey?: string };

  // `replacing`: this transaction replaces invitations (and nothing else). Otherwise companies whose
  // invitation the login replaces are deferred to transactions of their own: each replacement
  // reads the invitation on top of the caller's membership (rules), INVITATIONS_PER_TRANSACTION
  // of them stay within the per-commit read budget.
  const runChunk = (chunk: string[], replacing: boolean) => store.runTransaction(async (tx): Promise<OrgChunkResult<Stored> & { deferred: string[] }> => {
    // Read phase for every company (a transaction allows no read after its first write).
    const replayed: Stored[] = [];
    const skipped: MultiOrgSkip[] = [];
    const deferred: string[] = [];
    const toCreate: Array<{ org: Organization; member: Stored & { operationKey: string }; key: UniqueKeyRead | null; invitation: OrganizationMember | null }> = [];
    for (const orgId of chunk) {
      const org = await readTargetOrg(tx, orgId);
      const id = `${userId}_${orgId}`;
      const existing = await tx.get<Stored>(COL.members, id);
      if (existing) {
        if (existing.operationKey === operationKey) replayed.push(existing);
        else skipped.push({ orgId, reason: 'already_member', existingName: existing.userName });
        continue;
      }
      const key = email ? await readUniqueKey(tx, 'member_email', orgId, email) : null;
      const invitation = await invitationReplacedBy(tx, key, email, userId, orgId);
      if (invitation && !replacing) {
        deferred.push(orgId);
        continue;
      }
      if (key?.owner && isKeyTakenByOther(key, id) && !invitation) {
        const holder = key.owner.collection === COL.members ? await tx.get<Stored>(COL.members, key.owner.id) : null;
        // Created by this very operation under another id (the real UID became known between attempts).
        if (holder && holder.operationKey === operationKey) replayed.push(holder);
        else skipped.push({ orgId, reason: 'already_member', existingName: holder?.userName });
        continue;
      }
      toCreate.push({
        org,
        key,
        invitation,
        member: { ...input, id, orgId, userId, userEmail: email, joinedAt: localDate(now), active: input.active !== false, operationKey },
      });
    }

    if (toCreate.length === 0) return { created: [], replayed, skipped, deferred };

    const recipientUpdates = toCreate
      .map(({ org, member, invitation }) => recipientUpdateFor(
        member.orgId,
        org,
        invitation && isNotificationRecipient(invitation) ? [normalizeEmail(invitation.userEmail)] : [],
        isNotificationRecipient(member) ? [member.userEmail] : [],
      ))
      .filter((u): u is NonNullable<typeof u> => u !== null);

    for (const { member, key, invitation } of toCreate) {
      tx.set(COL.members, member.id, member);
      if (key && invitation) replaceInvitation(tx, invitation, key, member.id, nowIso);
      else if (key) claimUniqueKey(tx, key, { collection: COL.members, id: member.id }, nowIso);
    }
    writeRecipientUpdates(tx, recipientUpdates, nowIso);
    for (const { org, member } of toCreate) {
      writeAudit(
        tx,
        actor,
        {
          actionType: 'create',
          entityType: 'member',
          entityId: member.id,
          entityName: member.userName,
          orgId: member.orgId,
          orgName: org.name,
          details: `تم إضافة وتعيين موظف جديد: "${member.userName}" (${member.userEmail || '-'} | ${member.jobTitle} - ${member.department}) برتبة ${roleLabel(member.role)}${targets.length > 1 ? ` في "${org.name}" (إضافة واحدة إلى ${targets.length} شركات)` : ''}`,
        },
        auditIdFor(operationKey, member.orgId),
        nowIso,
      );
    }
    return { created: toCreate.map(c => c.member), replayed, skipped, deferred };
  });
  const runWithReplacements = async (chunk: string[]): Promise<OrgChunkResult<Stored>> => {
    const { deferred, ...first } = await runChunk(chunk, false);
    for (let i = 0; i < deferred.length; i += INVITATIONS_PER_TRANSACTION) {
      const part = await runChunk(deferred.slice(i, i + INVITATIONS_PER_TRANSACTION), true);
      first.created.push(...part.created);
      first.replayed.push(...part.replayed);
      first.skipped.push(...part.skipped);
    }
    return first;
  };

  return runInOrgChunks(store, targets, runWithReplacements, skipped => {
    const name = skipped[0]?.existingName;
    return new DomainError(
      'duplicate',
      targets.length === 1
        ? `${who} مسجل بالفعل في هذه المؤسسة${name ? ` باسم "${name}"` : ''}.`
        : `${who} مسجل بالفعل في كل الشركات المختارة.`,
    );
  });
}

/**
 * Creates one provider / department / service document per selected company
 * (id = entityIdInOrg(kind, operationKey, orgId)), ORGS_PER_TRANSACTION companies per
 * transaction; each company keeps its own orgId, totals and unique name key. Companies
 * where the name is taken are skipped.
 */
export async function createEntityInOrgs<T extends { id: string; orgId: string }>(
  store: DataStore,
  actor: Actor,
  kind: EntityKind,
  orgIds: string[],
  build: (id: string, orgId: string, nowIso: string) => T,
  audit: (entity: T) => string,
  operationKey: string,
  now: Date = new Date(),
): Promise<MutationOutcome<MultiOrgResult<T>>> {
  const spec = SPECS[kind] as unknown as EntitySpec<T>;
  assertRole(actor, spec.roles.create, spec.forbidden.create);
  const targets = normalizeOrgIds(orgIds);
  const nowIso = now.toISOString();
  const drafts = targets.map(orgId => {
    const id = entityIdInOrg(kind, operationKey, orgId);
    return { ...build(id, orgId, nowIso), id, orgId } as T;
  });

  const runChunk = (chunk: string[]) => store.runTransaction(async (tx): Promise<OrgChunkResult<T>> => {
    const replayed: T[] = [];
    const skipped: MultiOrgSkip[] = [];
    const toCreate: Array<{ org: Organization; entity: T; key: UniqueKeyRead | null }> = [];
    for (const entity of drafts.filter(d => chunk.includes(d.orgId))) {
      const org = await readTargetOrg(tx, entity.orgId);
      const existing = await tx.get<T>(spec.collection, entity.id);
      if (existing) {
        replayed.push(existing as T);
        continue;
      }
      const value = spec.keyOf(entity);
      const key = await readKeyIfAny(tx, spec.scope, entity.orgId, value);
      if (key?.owner && isKeyTakenByOther(key, entity.id)) {
        const holder = key.owner.collection === spec.collection ? await tx.get<Record<string, any>>(spec.collection, key.owner.id) : null;
        skipped.push({ orgId: entity.orgId, reason: 'duplicate', existingName: String(holder?.name || value) });
        continue;
      }
      toCreate.push({ org, entity, key });
    }

    if (toCreate.length === 0) return { created: [], replayed, skipped };

    for (const { entity, key } of toCreate) {
      tx.set(spec.collection, entity.id, entity);
      if (key) claimUniqueKey(tx, key, { collection: spec.collection, id: entity.id }, nowIso);
    }
    for (const { org, entity } of toCreate) {
      writeAudit(
        tx,
        actor,
        {
          actionType: 'create',
          entityType: spec.auditType,
          entityId: entity.id,
          entityName: (entity as any).name || entity.id,
          orgId: entity.orgId,
          orgName: org.name,
          details: audit(entity),
        },
        auditIdFor(operationKey, entity.orgId),
        nowIso,
      );
    }
    return { created: toCreate.map(c => c.entity), replayed, skipped };
  });

  return runInOrgChunks(store, targets, runChunk, () => {
    const value = spec.keyOf(drafts[0]);
    return new DomainError('duplicate', targets.length === 1 ? spec.duplicateMessage(value) : spec.duplicateInAllMessage(value));
  });
}

// ---------------------------------------------------------------------------
// Uniqueness keys: move the old id format to the current one (platform owner, once)
// ---------------------------------------------------------------------------
/** A record and the unique value it holds, i.e. the key that should name it. */
export interface UniqueKeyOwner {
  scope: UniqueScope;
  orgId: string;
  value: string;
  collection: string;
  id: string;
}

/** Every record that holds a uniqueness key, with the values the domain claims keys for. */
export function uniqueKeyOwnersOf(data: {
  organizations: Organization[];
  members: OrganizationMember[];
  services: ServiceCategory[];
  providers: ServiceProvider[];
  departments: Department[];
  paymentAccounts: PaymentAccount[];
}): UniqueKeyOwner[] {
  return [
    ...data.organizations.map(o => ({ scope: 'org_code' as const, orgId: '-', value: o.code || '', collection: COL.organizations, id: o.id })),
    ...data.members.map(m => ({ scope: 'member_email' as const, orgId: m.orgId, value: normalizeEmail(m.userEmail), collection: COL.members, id: m.id })),
    ...data.services.map(s => ({ scope: SPECS.service.scope, orgId: s.orgId, value: SPECS.service.keyOf(s), collection: COL.services, id: s.id })),
    ...data.providers.map(p => ({ scope: SPECS.provider.scope, orgId: p.orgId, value: SPECS.provider.keyOf(p), collection: COL.providers, id: p.id })),
    ...data.departments.map(d => ({ scope: SPECS.department.scope, orgId: d.orgId, value: SPECS.department.keyOf(d), collection: COL.departments, id: d.id })),
    ...data.paymentAccounts.map(a => ({ scope: 'account_identifier' as const, orgId: a.orgId, value: a.accountIdentifier || '', collection: COL.paymentAccounts, id: a.id })),
  ].filter(o => o.id && o.orgId);
}

export interface UniqueKeyMigration {
  /** Keys moved to the current id format. */
  moved: number;
  /** Old-format keys already replaced by a current one for the same record (removed). */
  replaced: number;
  /** Old-format keys left as they are: they name another record (e.g. one renamed or deleted since). */
  skipped: number;
}

const MIGRATION_CHUNK = 100;

/**
 * Moves the uniqueness keys of existing records from the old id format (legacyUniqueKeyDocId)
 * to uniqueKeyDocId, so they keep protecting against duplicates now that the rules let only
 * the key's own company read it. Platform owner only: nobody else can read an old-format key.
 * A key moves only while it still names one of the records listed in `owners`; running it
 * again finds nothing left to move.
 */
export async function migrateLegacyUniqueKeys(
  store: DataStore,
  actor: Actor,
  owners: UniqueKeyOwner[],
  now: Date = new Date(),
): Promise<UniqueKeyMigration> {
  assertRole(actor, ['super_admin'], 'ترحيل مفاتيح منع التكرار متاح للمشرف العام للمنصة فقط.');
  const nowIso = now.toISOString();
  // One entry per old key, with every record that holds its value: the old id format, and the
  // current format under the value app versions before 2026-10 computed (normalizeKeyValueV1:
  // ahmed.ali@ / ahmedali@ shared one key, tatweel / Arabic digits counted).
  const groups = new Map<string, { legacyId: string; owners: UniqueKeyOwner[] }>();
  for (const o of owners) {
    const currentId = uniqueKeyDocId(o.scope, o.orgId, o.value);
    for (const legacyId of new Set([legacyUniqueKeyDocId(o.scope, o.orgId, o.value), uniqueKeyDocIdV1(o.scope, o.orgId, o.value)])) {
      if (legacyId === currentId) continue;
      const group = groups.get(legacyId) || { legacyId, owners: [] };
      group.owners.push(o);
      groups.set(legacyId, group);
    }
  }
  const currentIdOf = (o: UniqueKeyOwner) => uniqueKeyDocId(o.scope, o.orgId, o.value);
  const work = [...groups.values()];

  const total: UniqueKeyMigration = { moved: 0, replaced: 0, skipped: 0 };
  for (let i = 0; i < work.length; i += MIGRATION_CHUNK) {
    const chunk = work.slice(i, i + MIGRATION_CHUNK);
    const part = await store.runTransaction(async tx => {
      type KeyDoc = { entityCollection?: string; entityId?: string; createdAt?: string };
      // Old-format keys first, all at once (nobody else writes them). A current-format key is
      // one every create of a member / provider / department / account reads and writes, so it
      // is read only where an old key exists: with nothing left to move, the transaction holds
      // no document another user's save is waiting for.
      const legacyKeys = await Promise.all(chunk.map(g => tx.get<KeyDoc>(COL.uniqueKeys, g.legacyId)));
      // The record the old key names, and the key it should have now (records that shared an
      // old key may have different current ones).
      const ownersOf = chunk.map((g, n) => g.owners.find(o => o.id === legacyKeys[n]?.entityId));
      const currentKeys = await Promise.all(
        chunk.map((g, n) => {
          const owner = ownersOf[n];
          return legacyKeys[n] && owner ? tx.get<KeyDoc>(COL.uniqueKeys, currentIdOf(owner)) : Promise.resolve(null);
        }),
      );
      const counts: UniqueKeyMigration = { moved: 0, replaced: 0, skipped: 0 };
      chunk.forEach((g, n) => {
        const legacy = legacyKeys[n];
        const current = currentKeys[n];
        if (!legacy) return;
        const owner = ownersOf[n];
        if (!owner || (current && current.entityId !== owner.id)) {
          counts.skipped += 1;
          return;
        }
        if (current) {
          tx.delete(COL.uniqueKeys, g.legacyId);
          counts.replaced += 1;
          return;
        }
        tx.set(COL.uniqueKeys, currentIdOf(owner), {
          scope: owner.scope,
          orgId: owner.orgId,
          value: normalizeKeyValue(owner.value, owner.scope),
          entityCollection: legacy.entityCollection || owner.collection,
          entityId: owner.id,
          createdAt: legacy.createdAt || nowIso,
          movedAt: nowIso,
        });
        tx.delete(COL.uniqueKeys, g.legacyId);
        counts.moved += 1;
      });
      return counts;
    });
    total.moved += part.moved;
    total.replaced += part.replaced;
    total.skipped += part.skipped;
  }
  return total;
}
