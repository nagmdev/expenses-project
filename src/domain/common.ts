import type { AuditActionType, AuditEntityType, AuditLogEntry, Organization, Role } from '../types';
import { encodeKeyPart } from '../utils/ids';
import type { TxContext } from './store';

export const COL = {
  organizations: 'organizations',
  members: 'members',
  users: 'users',
  services: 'services',
  providers: 'providers',
  departments: 'departments',
  requests: 'requests',
  visaRequests: 'visaRequests',
  paymentAccounts: 'paymentAccounts',
  accountTransactions: 'accountTransactions',
  custodies: 'custodies',
  custodySettlements: 'custodySettlements',
  auditLogs: 'auditLogs',
  counters: 'counters',
  uniqueKeys: 'uniqueKeys',
  outbox: 'outbox',
} as const;

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
  /**
   * The company the actor works in (the app's active company). Set for everyone but a
   * super admin, so an edit of another company's record (e.g. a service another company
   * shares with this one) is refused at once instead of by the database rules.
   */
  orgId?: string;
}

/** Error carrying a user-facing (Arabic) message and a stable machine code. */
export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;

export const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();

export const normalizeKeyValue = (value?: string | null) =>
  (value || '').trim().toLowerCase().replace(/[\s\-_.]+/g, '');

export function timelineTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "YYYY-MM-DD" of a moment in local time (a stored calendar date, e.g. joinedAt / invoiceDate). */
export const localDate = (d: Date) => timelineTimestamp(d).slice(0, 10);

/** An amount for a message / audit text: Western digits whatever the browser locale (1,250.5). */
export const formatAmount = (value: unknown) => toMoney(value).toLocaleString('en-US', { maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Arabic labels for the enums that end up in stored texts (timeline, audit):
// a stored text is read by people, never shows a raw code such as "instapay".
// ---------------------------------------------------------------------------
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  instapay: 'انستاباي (InstaPay)',
  bank_transfer: 'تحويل بنكي',
  digital_wallet: 'محفظة إلكترونية',
  wallet: 'محفظة إلكترونية',
  cash: 'نقداً / خزينة',
  cheque: 'شيك مصرفي',
};
export const paymentMethodLabel = (method?: string | null) =>
  (method && PAYMENT_METHOD_LABELS[method]) || (method ? method : 'غير محدد');

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'المشرف العام',
  org_admin: 'مدير الشركة',
  finance: 'المالية والخزينة',
  data_entry: 'مدخل بيانات',
  employee: 'موظف',
};
export const roleLabel = (role?: string | null) => (role && ROLE_LABELS[role as Role]) || role || 'غير محدد';

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  bank: 'حساب بنكي',
  instapay: 'إنستاباي',
  wallet: 'محفظة إلكترونية',
  cash: 'خزينة نقدية',
  other: 'حساب آخر',
};
export const accountTypeLabel = (type?: string | null) => (type && ACCOUNT_TYPE_LABELS[type]) || type || 'غير محدد';

/**
 * A person's payout details (where they receive money). They live in users/{uid} (readable
 * by the person and their company's admins) and in the requests that need them — never in
 * members/*, which every member of the company can list (see firestore.rules → members).
 */
export const PAYOUT_FIELDS = ['instapay', 'wallet', 'walletProvider', 'bankName', 'iban', 'preferredPaymentMethod'] as const;
export type PayoutField = (typeof PAYOUT_FIELDS)[number];

/** Splits payout fields off a record: `rest` is what may be stored in a membership. */
export function splitPayout<T extends Record<string, any>>(record: T): { rest: Omit<T, PayoutField>; payout: Partial<Record<PayoutField, any>> } {
  const rest: Record<string, any> = { ...record };
  const payout: Partial<Record<PayoutField, any>> = {};
  for (const f of PAYOUT_FIELDS) {
    if (f in rest) {
      if (rest[f] !== undefined) payout[f] = rest[f];
      delete rest[f];
    }
  }
  return { rest: rest as Omit<T, PayoutField>, payout };
}

export function toMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function requirePositiveAmount(value: unknown, message = 'يرجى إدخال مبلغ صحيح أكبر من الصفر.'): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) throw new DomainError('invalid_amount', message);
  const n = toMoney(num);
  if (n <= 0) throw new DomainError('invalid_amount', message);
  return n;
}

// ---------------------------------------------------------------------------
// Atomic sequences (request / custody / visa numbers)
// ---------------------------------------------------------------------------
// COUNT(*) + 1 or random numbers are not safe: two concurrent creations read the
// same count (or draw the same random number). A counter document incremented
// inside the same transaction that creates the entity is serialized by Firestore,
// so every number is issued exactly once.
export interface CounterRead {
  name: string;
  next: number;
}

export async function readCounter(tx: TxContext, name: string): Promise<CounterRead> {
  const snap = await tx.get<{ value?: number }>(COL.counters, name);
  const current = Number(snap?.value || 0);
  return { name, next: current + 1 };
}

export function writeCounter(tx: TxContext, counter: CounterRead, nowIso: string) {
  tx.set(COL.counters, counter.name, { value: counter.next, updatedAt: nowIso });
}

export const pad = (n: number, width: number) => String(n).padStart(width, '0');

// ---------------------------------------------------------------------------
// Uniqueness registry
// ---------------------------------------------------------------------------
// Firestore has no UNIQUE constraints. A deterministic "key document" per unique
// value, read and created inside the same transaction as the entity, gives the
// same guarantee: a second creation of the same value finds the key taken.
export type UniqueScope =
  | 'account_identifier'
  | 'service_code'
  | 'provider_name'
  | 'department_name'
  | 'member_email'
  | 'org_code';

export interface UniqueKeyRead {
  docId: string;
  scope: UniqueScope;
  orgId: string;
  value: string;
  owner: { collection: string; id: string } | null;
}

/**
 * `<scope>__<company id>__<value, base64url>`. The company id stays in clear (company ids are
 * `org-<code>` / `org-<uuid>`: document-id safe, never containing "__") so firestore.rules
 * (uniqueKeys) can let only that company's members read the key — whether it exists or not —
 * and nobody can probe whether an email, provider or account number exists in another company.
 */
export function uniqueKeyDocId(scope: UniqueScope, orgId: string, value: string) {
  return `${scope}__${orgId || '-'}__${encodeKeyPart(normalizeKeyValue(value))}`;
}

/**
 * The id format before 2026-10: company id base64url-encoded, which the rules cannot check.
 * Only the platform owner reads these, to move them (directory.ts → migrateLegacyUniqueKeys).
 */
export function legacyUniqueKeyDocId(scope: UniqueScope, orgId: string, value: string) {
  return `${scope}__${encodeKeyPart(orgId || '-')}__${encodeKeyPart(normalizeKeyValue(value))}`;
}

export async function readUniqueKey(tx: TxContext, scope: UniqueScope, orgId: string, value: string): Promise<UniqueKeyRead> {
  const docId = uniqueKeyDocId(scope, orgId, value);
  const snap = await tx.get<{ entityCollection: string; entityId: string }>(COL.uniqueKeys, docId);
  return {
    docId,
    scope,
    orgId,
    value,
    owner: snap ? { collection: snap.entityCollection, id: snap.entityId } : null,
  };
}

export function claimUniqueKey(tx: TxContext, key: UniqueKeyRead, entity: { collection: string; id: string }, nowIso: string) {
  tx.set(COL.uniqueKeys, key.docId, {
    scope: key.scope,
    orgId: key.orgId,
    value: normalizeKeyValue(key.value),
    entityCollection: entity.collection,
    entityId: entity.id,
    createdAt: nowIso,
  });
}

export function releaseUniqueKey(tx: TxContext, key: UniqueKeyRead, entityId: string) {
  if (key.owner && key.owner.id === entityId) tx.delete(COL.uniqueKeys, key.docId);
}

export const isKeyTakenByOther = (key: UniqueKeyRead, entityId: string) => Boolean(key.owner && key.owner.id !== entityId);

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------
export interface AuditInput {
  actionType: AuditActionType;
  entityType: AuditEntityType;
  entityId: string;
  entityName: string;
  details: string;
  orgId?: string;
  orgName?: string;
}

export function buildAuditEntry(actor: Actor, input: AuditInput, id: string, nowIso: string): AuditLogEntry & { operationId: string } {
  return {
    id,
    operationId: id,
    actionType: input.actionType,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    orgId: input.orgId || '',
    orgName: input.orgName || '',
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    details: input.details,
    timestamp: nowIso,
  };
}

/** Audit entry written in the SAME transaction as the business change (atomic + idempotent). */
export function writeAudit(tx: TxContext, actor: Actor, input: AuditInput, auditId: string, nowIso: string) {
  tx.set(COL.auditLogs, auditId, buildAuditEntry(actor, input, auditId, nowIso));
}

export const auditIdFor = (operationKey: string, suffix?: string) => `audit-${operationKey}${suffix ? `-${suffix}` : ''}`;

export function assertRole(actor: Actor, allowed: readonly Role[], message: string) {
  if (!allowed.includes(actor.role)) throw new DomainError('forbidden', message);
}

/**
 * A record of another company is never written by someone working in this one (the
 * rules check the role in the record's own company) — e.g. a service another company
 * shares with this one is read-only here. Only checked when the actor's company is known
 * (Actor.orgId); a super admin works across companies.
 */
export function assertActorCompany(actor: Actor, orgId: string | undefined | null, message: string) {
  if (actor.role === 'super_admin' || !actor.orgId) return;
  if ((orgId || '') !== actor.orgId) throw new DomainError('forbidden', message);
}

/** An archived company keeps its records (readable, reportable) but takes no new ones. */
export const isArchivedOrg = (org?: Pick<Organization, 'archived' | 'status'> | null) =>
  Boolean(org && (org.archived || org.status === 'archived'));

/**
 * Read at the start of a create transaction: the company exists and is not archived, so a
 * stale page (or a picker that still lists an archived company) cannot write into it.
 */
export async function assertOrgWritable(tx: TxContext, orgId: string): Promise<Organization> {
  const org = await tx.get<Organization>(COL.organizations, orgId);
  if (!org) throw new DomainError('not_found', `الشركة المحددة غير موجودة (${orgId}).`);
  if (isArchivedOrg(org)) throw new DomainError('archived_org', `الشركة "${org.name}" مؤرشفة ولا يمكن الإضافة إليها.`);
  return org;
}
