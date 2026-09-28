import type { AuditActionType, AuditEntityType, AuditLogEntry, Role } from '../types';
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

export function toMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function requirePositiveAmount(value: unknown, message = 'يرجى إدخال مبلغ صحيح أكبر من الصفر.'): number {
  const n = toMoney(Math.abs(Number(value)));
  if (!n || n <= 0) throw new DomainError('invalid_amount', message);
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

export function uniqueKeyDocId(scope: UniqueScope, orgId: string, value: string) {
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

export function assertRole(actor: Actor, allowed: Role[], message: string) {
  if (!allowed.includes(actor.role)) throw new DomainError('forbidden', message);
}
