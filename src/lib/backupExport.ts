/**
 * Platform owner's backup export (Settings → الاتصال السحابي → «تصدير نسخة احتياطية»).
 *
 * Managed Firestore backups / exports need the Blaze plan; on Spark the owner downloads the
 * data instead. Every collection firestore.rules lets the platform owner LIST is read straight
 * from the server (never the live listeners, which only hold what the screens subscribed to,
 * nor the offline cache), one collection at a time, in pages ordered by document id.
 * Read-only: nothing is ever written.
 *
 * Cost: one document = one read of the free daily quota (50,000 reads/day on Spark).
 * Restore is not part of the app: docs/06-security-rules-deploy.md → Backups.
 */
import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  type CollectionReference,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  backupJsonParts,
  serializeDocData,
  type BackupDoc,
  type BackupFile,
  type BackupRedaction,
  type BackupSkipped,
} from '../utils/backupFormat';

export interface BackupSource {
  name: string;
  label: string;
}

/**
 * Every top-level collection the platform owner may list (firestore.rules: `allow list` or
 * `allow read` granted by isSuperAdmin()). Keep in step with the rules' match blocks.
 */
export const BACKUP_COLLECTIONS: readonly BackupSource[] = [
  { name: 'organizations', label: 'الشركات' },
  { name: 'super_admins', label: 'المشرفون العامون' },
  { name: 'users', label: 'حسابات المستخدمين' },
  { name: 'members', label: 'الموظفون والصلاحيات' },
  { name: 'system_settings', label: 'إعدادات المنصة' },
  { name: 'services', label: 'البنود والخدمات' },
  { name: 'providers', label: 'الموردون' },
  { name: 'departments', label: 'الأقسام' },
  { name: 'requests', label: 'طلبات الصرف' },
  { name: 'visaRequests', label: 'طلبات التأشيرات' },
  { name: 'paymentAccounts', label: 'الحسابات والخزائن' },
  { name: 'accountTransactions', label: 'حركات الحسابات' },
  { name: 'custodies', label: 'العهد' },
  { name: 'pettyCashCustodies', label: 'العهد (الإصدار القديم)' },
  { name: 'custodySettlements', label: 'تسويات العهد' },
  { name: 'outbox', label: 'صندوق الإشعارات' },
  { name: 'email_logs', label: 'سجل البريد' },
  { name: 'auditLogs', label: 'سجل التدقيق' },
  { name: 'attachments', label: 'المرفقات (البيانات الوصفية)' },
  { name: 'attachmentTombstones', label: 'معرفات المرفقات المحذوفة' },
];

/** attachments/{id}/chunks/{index}: the files themselves (only when the owner asks for them). */
export const ATTACHMENT_CHUNKS: BackupSource = { name: 'attachmentChunks', label: 'محتوى المرفقات (الملفات)' };

/**
 * counters/{name} can be read one by one but not listed. Their ids are known
 * (src/domain: readCounter(`<prefix>-<year>`)), so each year's counter is read by id. Without
 * them a restore would issue request / custody / visa numbers again from 1.
 */
export const COUNTERS: BackupSource = { name: 'counters', label: 'عدادات الترقيم' };
export const COUNTER_PREFIXES = ['requests', 'visa', 'custodies', 'transfers'] as const;
export const FIRST_COUNTER_YEAR = 2020;

export function counterIds(now: Date): string[] {
  const ids: string[] = [];
  for (let y = FIRST_COUNTER_YEAR; y <= now.getFullYear() + 1; y++) {
    for (const p of COUNTER_PREFIXES) ids.push(`${p}-${y}`);
  }
  return ids;
}

/** Collections the rules let nobody list (get by id only): never in the file. */
export const NOT_EXPORTABLE: readonly BackupSkipped[] = [
  {
    name: 'uniqueKeys',
    reason: 'القواعد لا تسمح بسرد مفاتيح منع التكرار (قراءة بالمعرّف فقط). تُبنى من جديد من السجلات عند الاستعادة (uniqueKeyOwnersOf + uniqueKeyDocId).',
  },
  {
    name: 'legacyRestores',
    reason: 'القواعد لا تسمح بسرد علامات الاسترجاع القديم (قراءة بالمعرّف فقط). لا تلزم للاستعادة.',
  },
  {
    name: 'mail',
    reason: 'طابور إضافة Trigger Email: لا يُسرد (قراءة بالمعرّف فقط)، ومحتواه موجود في outbox.',
  },
];

export type BackupStepState = 'waiting' | 'reading' | 'done' | 'failed' | 'skipped';

export interface BackupStep extends BackupSource {
  state: BackupStepState;
  /** Documents read so far. */
  count: number;
  note?: string;
}

export interface BackupExportOptions {
  includeAttachments: boolean;
  includeSecrets: boolean;
  exportedBy?: string;
  now?: Date;
  signal?: AbortSignal;
  /** Documents per server read (tests use small pages). */
  pageSize?: number;
}

export class BackupCancelledError extends Error {
  constructor() {
    super('تم إلغاء التصدير.');
    this.name = 'BackupCancelledError';
  }
}

const DEFAULT_PAGE_SIZE = 300;
// A chunk holds up to 700,000 base64 characters: small pages keep each response a few MB.
const CHUNK_PAGE_SIZE = 4;

/** The steps of an export, in order (the UI shows them before the first read). */
export function backupSteps(includeAttachments: boolean): BackupStep[] {
  const sources = [...BACKUP_COLLECTIONS, ...(includeAttachments ? [ATTACHMENT_CHUNKS] : []), COUNTERS];
  return sources.map(s => ({ ...s, state: 'waiting', count: 0 }));
}

const errorText = (err: unknown): string => {
  const e = err as { code?: string; message?: string } | null;
  return String(e?.code || e?.message || err || 'unknown');
};

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new BackupCancelledError();
}

/** Every document of `ref`, page by page in document-id order, from the server. */
async function readAll(
  ref: CollectionReference<DocumentData>,
  pageSize: number,
  signal: AbortSignal | undefined,
  onPage: (docs: QueryDocumentSnapshot<DocumentData>[]) => void,
): Promise<void> {
  let last: QueryDocumentSnapshot<DocumentData> | null = null;
  for (;;) {
    throwIfCancelled(signal);
    const q: Query<DocumentData> = last
      ? query(ref, orderBy(documentId()), startAfter(last), limit(pageSize))
      : query(ref, orderBy(documentId()), limit(pageSize));
    const snap: QuerySnapshot<DocumentData> = await getDocsFromServer(q);
    onPage(snap.docs);
    if (snap.docs.length < pageSize) return;
    last = snap.docs[snap.docs.length - 1];
  }
}

/**
 * Reads everything into a backup file. A collection that cannot be read is listed in
 * `skipped` (with the error) and the export goes on; cancelling (opts.signal) throws
 * BackupCancelledError. Never writes.
 */
export async function exportBackup(
  db: Firestore,
  opts: BackupExportOptions,
  onProgress?: (step: BackupStep) => void,
): Promise<BackupFile> {
  const now = opts.now ?? new Date();
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const collections: Record<string, BackupDoc[]> = {};
  const skipped: BackupSkipped[] = [];
  const redacted: BackupRedaction[] = [];

  const toDoc = (snap: DocumentSnapshot<DocumentData>): BackupDoc => {
    const { data, redacted: fields } = serializeDocData(snap.data() ?? {}, { includeSecrets: opts.includeSecrets });
    fields.forEach(field => redacted.push({ path: snap.ref.path, field }));
    return { id: snap.id, path: snap.ref.path, data };
  };
  const report = (source: BackupSource, state: BackupStepState, count: number, note?: string) =>
    onProgress?.({ ...source, state, count, note });

  for (const source of BACKUP_COLLECTIONS) {
    const docs: BackupDoc[] = [];
    report(source, 'reading', 0);
    try {
      await readAll(collection(db, source.name), pageSize, opts.signal, page => {
        page.forEach(s => docs.push(toDoc(s)));
        report(source, 'reading', docs.length);
      });
      collections[source.name] = docs;
      report(source, 'done', docs.length);
    } catch (err) {
      if (err instanceof BackupCancelledError) throw err;
      skipped.push({ name: source.name, reason: `تعذرت القراءة (${errorText(err)})`, failed: true });
      report(source, 'failed', docs.length, errorText(err));
    }
  }

  if (opts.includeAttachments) {
    const chunks: BackupDoc[] = [];
    const failed: string[] = [];
    const attachments = collections.attachments ?? [];
    report(ATTACHMENT_CHUNKS, 'reading', 0);
    for (const att of attachments) {
      try {
        await readAll(collection(db, 'attachments', att.id, 'chunks'), CHUNK_PAGE_SIZE, opts.signal, page => {
          page.forEach(s => chunks.push(toDoc(s)));
          report(ATTACHMENT_CHUNKS, 'reading', chunks.length);
        });
      } catch (err) {
        if (err instanceof BackupCancelledError) throw err;
        failed.push(`${att.id}: ${errorText(err)}`);
      }
    }
    collections[ATTACHMENT_CHUNKS.name] = chunks;
    if (failed.length) {
      skipped.push({ name: ATTACHMENT_CHUNKS.name, reason: `تعذرت قراءة أجزاء ${failed.length} مرفق: ${failed.join('، ')}`, failed: true });
    }
    if (!collections.attachments) {
      skipped.push({ name: ATTACHMENT_CHUNKS.name, reason: 'تعذرت قراءة قائمة المرفقات، فلم تُقرأ ملفاتها.', failed: true });
    }
    report(ATTACHMENT_CHUNKS, failed.length || !collections.attachments ? 'failed' : 'done', chunks.length);
  } else {
    skipped.push({ name: ATTACHMENT_CHUNKS.name, reason: 'لم يُطلب تضمين المرفقات (ملفات كبيرة).' });
  }

  // Counters: by id, a few at a time (missing ones simply do not exist yet).
  throwIfCancelled(opts.signal);
  report(COUNTERS, 'reading', 0);
  const counters: BackupDoc[] = [];
  const counterErrors: string[] = [];
  const ids = counterIds(now);
  for (let i = 0; i < ids.length; i += COUNTER_PREFIXES.length) {
    throwIfCancelled(opts.signal);
    const snaps = await Promise.all(
      ids.slice(i, i + COUNTER_PREFIXES.length).map(id =>
        getDocFromServer(doc(db, COUNTERS.name, id)).catch(err => {
          counterErrors.push(`${id}: ${errorText(err)}`);
          return null;
        }),
      ),
    );
    snaps.forEach(s => {
      if (s?.exists()) counters.push(toDoc(s));
    });
    report(COUNTERS, 'reading', counters.length);
  }
  collections[COUNTERS.name] = counters;
  if (counterErrors.length) skipped.push({ name: COUNTERS.name, reason: `تعذرت قراءة: ${counterErrors.join('، ')}`, failed: true });
  report(COUNTERS, counterErrors.length ? 'failed' : 'done', counters.length);

  skipped.push(...NOT_EXPORTABLE);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    projectId: String(db.app?.options?.projectId || ''),
    ...(opts.exportedBy ? { exportedBy: opts.exportedBy } : {}),
    options: { includeAttachments: opts.includeAttachments, includeSecrets: opts.includeSecrets },
    collections,
    skipped,
    redacted,
  };
}

/** Downloads the file as masrofy-backup-YYYY-MM-DD.json (built in pieces: see backupJsonParts). */
export function saveBackupFile(file: BackupFile, now: Date = new Date()): string {
  const name = backupFileName(now);
  const url = URL.createObjectURL(new Blob(backupJsonParts(file), { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}
