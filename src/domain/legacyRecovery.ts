/**
 * Recovery of records that the OLD app version kept only in a browser's localStorage.
 *
 * The old version wrote to localStorage first and only logged Firestore failures, so
 * some records never reached the database — above all every visa request (the
 * visaRequests collection had no security rule, so every write was denied).
 *
 * Safety rules of this module:
 *  - Only plain business records can be restored (visa requests, expense requests,
 *    departments, services, providers). Financial stores (accounts, ledger, custodies,
 *    settlements), memberships (access grants) and organizations are BACKUP-ONLY: they
 *    are included in the downloadable file but can never be written back, because a
 *    stale copy would add ledger rows to live accounts, resurrect deleted balances or
 *    re-grant revoked access.
 *  - It only ever CREATES documents that do not exist (checked in the same transaction).
 *    It never overwrites, merges into, or deletes anything, and never touches localStorage.
 *  - Every restore leaves a permanent marker (legacyRestores/{collection}__{id}), so a
 *    record that is restored and later deleted on purpose is never brought back again.
 *  - Unique names/codes are claimed like a normal create, so a restore can't duplicate one.
 *  - Each restore is audited atomically, under the record's own organization.
 */
import {
  COL,
  auditIdFor,
  claimUniqueKey,
  isKeyTakenByOther,
  readUniqueKey,
  toMoney,
  writeAudit,
  type Actor,
  type UniqueScope,
} from './common';
import type { DataStore, DocData } from './store';

export const LEGACY_RESTORES = 'legacyRestores';

export interface LegacyStoreDef {
  key: string;
  collection: string;
  label: string;
  /** 'backup' = included in the downloadable backup only, never written back. */
  mode: 'restore' | 'backup';
  /** Pre-selected: records that almost certainly never reached Firestore. */
  likelyLocalOnly?: boolean;
  /** Firestore only accepts creating these in status "pending" unless you are super admin. */
  statusGated?: boolean;
  unique?: { scope: UniqueScope; field: string };
  backupReason?: string;
}

export const LEGACY_STORES: LegacyStoreDef[] = [
  { key: 'expenses_visa_requests_v3', collection: COL.visaRequests, label: 'طلبات التأشيرات', mode: 'restore', likelyLocalOnly: true, statusGated: true },
  { key: 'expenses_requests_v3', collection: COL.requests, label: 'طلبات الصرف', mode: 'restore', statusGated: true },
  { key: 'expenses_departments_v3', collection: COL.departments, label: 'الأقسام', mode: 'restore', unique: { scope: 'department_name', field: 'name' } },
  { key: 'expenses_services_v3', collection: COL.services, label: 'بنود الصرف', mode: 'restore', unique: { scope: 'service_code', field: 'code' } },
  { key: 'expenses_providers_v3', collection: COL.providers, label: 'الموردين', mode: 'restore', unique: { scope: 'provider_name', field: 'name' } },
  { key: 'expenses_organizations_v3', collection: COL.organizations, label: 'الشركات', mode: 'backup', backupReason: 'الشركات كانت تُحفظ دائماً في قاعدة البيانات؛ الناقص منها محذوف عمداً.' },
  { key: 'expenses_members_v3', collection: COL.members, label: 'الموظفين', mode: 'backup', backupReason: 'عضوية الموظف صلاحية دخول؛ استرجاعها قد يعيد صلاحية أُلغيت عمداً.' },
  { key: 'expenses_payment_accounts_v3', collection: COL.paymentAccounts, label: 'الخزائن والحسابات', mode: 'backup', backupReason: 'استرجاع حساب محذوف يعيد رصيداً قديماً ويُفسد إجماليات الخزينة.' },
  { key: 'expenses_account_transactions_v3', collection: COL.accountTransactions, label: 'الحركات المالية', mode: 'backup', backupReason: 'إضافة حركات قديمة لحسابات قائمة تجعل الدفتر لا يطابق الرصيد.' },
  { key: 'expense_system_custodies', collection: COL.custodies, label: 'العهد', mode: 'backup', backupReason: 'العهد ترتبط بحركات خزينة؛ لا تُسترجع بدون مراجعة محاسبية.' },
  { key: 'expense_system_custody_settlements', collection: COL.custodySettlements, label: 'تسويات العهد', mode: 'backup', backupReason: 'التسويات تغيّر المتبقي من العهدة؛ لا تُسترجع بدون مراجعة محاسبية.' },
];

// Demo records of the very first version (never restore them).
const DEMO_IDS = new Set([
  'org-ofq', 'org-rwd', 'mem-1', 'mem-2', 'mem-3',
  'srv-cloud', 'srv-software', 'srv-hardware', 'srv-legal', 'srv-mkt', 'srv-travel',
  'prov-aws', 'prov-github', 'prov-jarir', 'prov-law',
  'req-101', 'req-102', 'req-103',
]);

// Valid Firestore document id: no "/", not "." or "..", not __reserved__.
const VALID_ID = /^(?!\.\.?$)(?!__.*__$)[^/]{1,700}$/;

export interface LegacyRecord {
  store: LegacyStoreDef;
  id: string;
  data: DocData;
  title: string;
}

export interface LegacyStoreSnapshot {
  store: LegacyStoreDef;
  records: LegacyRecord[];
  /** Raw text as found (for the downloadable backup). */
  raw: string;
}

export function recordTitle(collection: string, d: DocData): string {
  const pick = (...vals: unknown[]) => vals.find(v => typeof v === 'string' && v.trim()) as string | undefined;
  switch (collection) {
    case COL.visaRequests:
      return [pick(d.requestNumber), pick(d.travelerName), d.totalAmount ? `${d.totalAmount} ${d.currency || ''}` : ''].filter(Boolean).join(' — ');
    case COL.requests:
      return [pick(d.requestNumber), pick(d.title), d.amount ? `${d.amount} ${d.currency || ''}` : '', pick(d.requesterName)].filter(Boolean).join(' — ');
    case COL.custodies:
      return [pick(d.custodyNumber), pick(d.employeeName), d.totalAmount ? `${d.totalAmount} ${d.currency || ''}` : ''].filter(Boolean).join(' — ');
    case COL.custodySettlements:
    case COL.accountTransactions:
      return [pick(d.description), d.amount ? `${d.amount} ${d.currency || ''}` : '', pick(d.createdAt)?.slice(0, 10)].filter(Boolean).join(' — ');
    case COL.members:
      return [pick(d.userName), pick(d.userEmail), pick(d.role)].filter(Boolean).join(' — ');
    default:
      return pick(d.name, d.title, d.id) || String(d.id);
  }
}

/** Parses the legacy stores from any key→string source (localStorage or an imported backup file). */
export function readLegacySnapshot(read: (key: string) => string | null | undefined): LegacyStoreSnapshot[] {
  const out: LegacyStoreSnapshot[] = [];
  for (const store of LEGACY_STORES) {
    let raw: string | null | undefined;
    try {
      raw = read(store.key);
    } catch {
      raw = null;
    }
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const seen = new Set<string>();
    const records: LegacyRecord[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const id = (item as DocData).id;
      if (typeof id !== 'string' || !VALID_ID.test(id) || DEMO_IDS.has(id) || seen.has(id)) continue;
      if (DEMO_IDS.has((item as DocData).orgId)) continue;
      seen.add(id);
      records.push({ store, id, data: item as DocData, title: recordTitle(store.collection, item as DocData) });
    }
    if (records.length) out.push({ store, records, raw });
  }
  return out;
}

/** Accepts a backup file: { stores: { "<legacy key>": "<json string>" | [records] } } or the flat map. */
export function readBackupFile(text: string): LegacyStoreSnapshot[] {
  const obj = JSON.parse(text);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('ملف النسخة الاحتياطية غير صالح.');
  const source = obj.stores && typeof obj.stores === 'object' ? obj.stores : obj;
  return readLegacySnapshot(key => {
    const v = source[key];
    if (v === undefined || v === null) return null;
    return typeof v === 'string' ? v : JSON.stringify(v);
  });
}

export function buildBackupFile(snapshots: LegacyStoreSnapshot[], meta: Record<string, unknown>): string {
  const stores: Record<string, unknown> = {};
  for (const s of snapshots) stores[s.store.key] = s.raw;
  return JSON.stringify({ format: 'expenses-legacy-local-backup', version: 1, ...meta, stores }, null, 2);
}

export const markerId = (rec: Pick<LegacyRecord, 'store' | 'id'>) => `${rec.store.collection}__${rec.id}`.slice(0, 1400);

/** 'not_checked': never looked up, because this user could not restore it anyway (see needsLookup). */
export type RecordStatus = 'missing' | 'exists' | 'handled' | 'no_access' | 'error' | 'not_checked';

/** Read-only check. "handled" = restored once before (even if deleted since): never offered again. */
export async function checkRecord(store: DataStore, rec: LegacyRecord): Promise<RecordStatus> {
  try {
    return await store.runTransaction(async tx => {
      if (await tx.get(LEGACY_RESTORES, markerId(rec))) return 'handled';
      return (await tx.get(rec.store.collection, rec.id)) ? 'exists' : 'missing';
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied' || /permission/i.test(String(err?.message))) return 'no_access';
    return 'error';
  }
}

export type BlockReason = 'backup_only' | 'needs_owner' | 'other_org' | 'no_permission';

export interface RestoreContext {
  actor: Actor;
  /** The organization the (non-super-admin) actor works in. */
  orgId: string;
}

/** Mirrors the create rules so the UI never attempts a write the database will refuse. */
export function restoreBlock(ctx: RestoreContext, rec: LegacyRecord): BlockReason | null {
  const { actor } = ctx;
  if (rec.store.mode === 'backup') return 'backup_only';
  if (actor.role === 'super_admin') return null;
  if (!rec.data.orgId || rec.data.orgId !== ctx.orgId) return 'other_org';
  if (rec.store.statusGated) {
    if (rec.data.status !== 'pending') return 'needs_owner';
    // A new request carries no decision records (firestore.rules → requests create).
    if (rec.store.collection === COL.requests &&
        ['disbursement', 'approvedBy', 'approvedAt', 'rejectionReason'].some(f => f in rec.data)) {
      return 'needs_owner';
    }
    if (actor.role !== 'org_admin' && rec.data.requesterId !== actor.id) return 'no_permission';
    return null;
  }
  // A service budget already used / a provider already paid (or a counter that is not a
  // number): only the platform owner may restore those counters (firestore.rules →
  // services / providers create, counterIsZero).
  const counter = rec.store.collection === COL.services ? rec.data.spentAmount
    : rec.store.collection === COL.providers ? rec.data.totalPaid
    : undefined;
  if (counter !== undefined && counter !== null && (typeof counter !== 'number' || toMoney(counter) !== 0)) {
    return 'needs_owner';
  }
  return actor.role === 'org_admin' ? null : 'no_permission';
}

/**
 * Whether the scan should look a record up at all. Backup-only data and another company's
 * data can never be restored by this user, and the rules refuse reading another company's
 * existing documents: every such read only printed a permission-denied error in the console.
 */
export const needsLookup = (ctx: RestoreContext, rec: LegacyRecord) => {
  const block = restoreBlock(ctx, rec);
  return block !== 'backup_only' && block !== 'other_org';
};

export type RestoreOutcome = 'restored' | 'exists' | 'handled' | 'duplicate' | 'failed' | BlockReason;

export interface RestoreResult {
  record: LegacyRecord;
  outcome: RestoreOutcome;
  error?: string;
}

/** Create-if-absent with marker + unique key + audit, all in one transaction. Never overwrites. */
export async function restoreRecord(
  store: DataStore,
  ctx: RestoreContext,
  rec: LegacyRecord,
  source: 'browser' | 'file',
  now: Date = new Date(),
): Promise<RestoreResult> {
  const blocked = restoreBlock(ctx, rec);
  if (blocked) return { record: rec, outcome: blocked };
  const nowIso = now.toISOString();
  const { actor } = ctx;
  try {
    const outcome = await store.runTransaction(async tx => {
      if (await tx.get(LEGACY_RESTORES, markerId(rec))) return 'handled' as const;
      if (await tx.get(rec.store.collection, rec.id)) return 'exists' as const;
      const uniqueValue = rec.store.unique ? String(rec.data[rec.store.unique.field] || '').trim() : '';
      const key = rec.store.unique && uniqueValue && rec.data.orgId
        ? await readUniqueKey(tx, rec.store.unique.scope, rec.data.orgId, uniqueValue)
        : null;
      if (key && isKeyTakenByOther(key, rec.id)) return 'duplicate' as const;

      tx.set(rec.store.collection, rec.id, {
        ...rec.data,
        id: rec.id,
        restoredFromLocalStorage: true,
        restoredAt: nowIso,
        restoredBy: actor.id,
      });
      tx.set(LEGACY_RESTORES, markerId(rec), {
        collection: rec.store.collection,
        docId: rec.id,
        orgId: rec.data.orgId || '',
        restoredBy: actor.id,
        restoredAt: nowIso,
        source,
      });
      if (key) claimUniqueKey(tx, key, { collection: rec.store.collection, id: rec.id }, nowIso);
      writeAudit(
        tx,
        actor,
        {
          actionType: 'create',
          entityType: 'organization',
          entityId: rec.id,
          entityName: `${rec.store.label}: ${rec.title}`.slice(0, 300),
          orgId: rec.data.orgId || '',
          details: `استرجاع سجل كان محفوظاً على المتصفح فقط (${source === 'file' ? 'من ملف نسخة احتياطية' : 'من هذا المتصفح'}) إلى قاعدة البيانات — ${rec.store.label}: ${rec.title}`,
        },
        auditIdFor(`restore-${markerId(rec)}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 300)),
        nowIso,
      );
      return 'restored' as const;
    });
    return { record: rec, outcome };
  } catch (err: any) {
    return { record: rec, outcome: 'failed', error: String(err?.message || err) };
  }
}
