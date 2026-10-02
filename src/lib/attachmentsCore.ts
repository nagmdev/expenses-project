/**
 * Attachments kept INSIDE Cloud Firestore.
 *
 * The Firebase project is on the free Spark plan, which has no Cloud Storage, so every
 * uploaded file (invoice, visa document, custody receipt) is stored as Firestore documents:
 *
 *   attachments/{id}                 { id, orgId, name, mimeType, size, chunkCount, createdBy, createdAt, complete }
 *   attachments/{id}/chunks/{index}  { index, data }   data = a base64 slice of <= ATTACHMENT_CHUNK_CHARS characters
 *
 * Records (requests, visas, custodies) keep `fsattach://<id>` as the attachment's url.
 *
 * Upload order: metadata (complete: false) -> chunk batches -> complete: true. Readers refuse
 * an attachment that is not complete, so a broken upload is never shown as a (truncated) file.
 * Ids are single-use: a delete writes attachmentTombstones/{id} in the same batch, and the
 * rules never let an attachment be created again under a tombstoned id, so the file behind a
 * saved fsattach:// link can be removed but never swapped for other content.
 * firestore.rules (match /attachments, /attachmentTombstones) enforces the same contract on the server.
 *
 * This module has no dependency on the app's Firebase instance: the Firestore operations
 * take the Firestore instance and the signed-in user's uid, so the same code runs in the
 * browser (src/lib/attachments.ts binds it), in unit tests and against the emulator.
 */
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { uuid } from '../utils/ids';

export const ATTACHMENT_URL_PREFIX = 'fsattach://';
/** Per file, after image compression. Keep in step with firestore.rules (attachments: size). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/**
 * Base64 characters per chunk document (Firestore's document limit is 1 MiB). A multiple of
 * 4, so each chunk is complete base64 on its own and decodes independently.
 */
export const ATTACHMENT_CHUNK_CHARS = 700_000;
/** Bytes carried by one full chunk (525,000). */
export const ATTACHMENT_CHUNK_BYTES = (ATTACHMENT_CHUNK_CHARS / 4) * 3;
/** Chunks of the largest allowed file (20). firestore.rules allows up to 32. */
export const ATTACHMENT_MAX_CHUNKS = Math.ceil(MAX_ATTACHMENT_BYTES / ATTACHMENT_CHUNK_BYTES);
/**
 * Base64 characters sent in one batched write: 3 full chunks (~2.1 MB), well under
 * Firestore's 10 MiB request limit.
 */
export const ATTACHMENT_BATCH_CHARS = 3 * ATTACHMENT_CHUNK_CHARS;
export const ATTACHMENTS_COLLECTION = 'attachments';
export const ATTACHMENT_CHUNKS_COLLECTION = 'chunks';
/** attachmentTombstones/{id} = { orgId, deletedBy, deletedAt }: ids that can never be used again. */
export const ATTACHMENT_TOMBSTONES_COLLECTION = 'attachmentTombstones';
/** Longest file name kept in the metadata (firestore.rules allows 255). */
export const MAX_ATTACHMENT_NAME_LENGTH = 200;

export const ALLOWED_ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export type AttachmentMimeType = (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number];

export interface StoredAttachment {
  attachmentId: string;
  /** `fsattach://<attachmentId>`: what records keep as the attachment url. */
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface AttachmentMeta {
  id: string;
  orgId: string;
  name: string;
  mimeType: string;
  size: number;
  chunkCount: number;
  createdBy: string;
  createdAt: string;
  complete: boolean;
}

export interface AttachmentChunk {
  index: number;
  data: string;
}

export type AttachmentErrorCode =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'no_company'
  | 'not_signed_in'
  | 'invalid_url'
  | 'not_found'
  | 'forbidden'
  | 'incomplete'
  | 'corrupt'
  | 'offline'
  | 'upload_failed'
  | 'delete_failed'
  | 'load_failed';

/** Every error this module raises carries an Arabic message that can be shown as is. */
export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode;

  constructor(code: AttachmentErrorCode, message: string) {
    super(message);
    this.name = 'AttachmentError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Sizes, names and types
// ---------------------------------------------------------------------------

/** Format bytes to a human readable size (B, KB, MB). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The limit as people read it: "10 MB". */
export const MAX_ATTACHMENT_SIZE_LABEL = `${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`;

export const ATTACHMENT_MESSAGES = {
  empty: 'الملف فارغ (0 بايت). يرجى اختيار ملف صالح.',
  unsupportedType: 'نوع الملف غير مدعوم. يُسمح فقط برفع الصور (PNG, JPG) ومستندات PDF.',
  tooLarge: (size: number) =>
    `حجم الملف (${formatFileSize(size)}) أكبر من الحد المسموح به (${MAX_ATTACHMENT_SIZE_LABEL}). يرجى تصغير الملف أو ضغطه ثم إعادة المحاولة.`,
  noCompany: 'تعذر رفع الملف: يجب تحديد الشركة أولاً لضمان عزل وتأمين الملفات.',
  notSignedIn: 'تعذر رفع الملف: يجب تسجيل الدخول أولاً.',
  invalidUrl: 'رابط المرفق غير صالح.',
  notFound: 'المرفق غير موجود أو تم حذفه.',
  forbidden: 'لا تملك صلاحية الاطلاع على هذا المرفق، أو أنه غير موجود.',
  deleteForbidden: 'لا تملك صلاحية حذف هذا المرفق، أو أنه حُذف من قبل.',
  incomplete: 'لم يكتمل رفع هذا المرفق (ربما انقطع الاتصال أثناء الرفع)، لذلك لا يمكن عرضه. يرجى إعادة رفع الملف.',
  corrupt: 'ملف المرفق تالف أو ناقص ولا يمكن عرضه. يرجى إعادة رفعه.',
  offline: 'تعذر الاتصال بقاعدة البيانات. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.',
  uploadFailed: (reason = '') =>
    `فشل حفظ المرفق في قاعدة البيانات${reason}. يرجى التحقق من الاتصال بالإنترنت وصلاحيات حسابك وإعادة المحاولة.`,
  deleteFailed: 'تعذر حذف المرفق. يرجى إعادة المحاولة.',
  loadFailed: 'تعذر تحميل المرفق. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.',
} as const;

const EXTENSION_MIME_TYPES: Record<string, AttachmentMimeType> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
};

const MIME_ALIASES: Record<string, AttachmentMimeType> = {
  'application/pdf': 'application/pdf',
  'application/x-pdf': 'application/pdf',
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
};

const extensionOf = (name?: string | null): string => {
  const match = /\.([A-Za-z0-9]+)$/.exec((name || '').trim());
  return match ? match[1].toLowerCase() : '';
};

/**
 * The stored type of a PNG, JPEG or PDF file, or null for anything else. The browser's type
 * wins; the file name decides only when the browser gives none (some phones send '' or
 * application/octet-stream for PDFs).
 */
export function detectAttachmentMimeType(type?: string | null, name?: string | null): AttachmentMimeType | null {
  const clean = (type || '').split(';')[0].trim().toLowerCase();
  if (clean && clean !== 'application/octet-stream') return MIME_ALIASES[clean] ?? null;
  return EXTENSION_MIME_TYPES[extensionOf(name)] ?? null;
}

/** Whether a blob of this type may be shown by the browser (not just downloaded). */
export function isAllowedAttachmentMimeType(type?: string | null): type is AttachmentMimeType {
  return (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes((type || '').toLowerCase());
}

/**
 * Checks a file before it is stored: not empty, PNG / JPEG / PDF, at most MAX_ATTACHMENT_BYTES.
 * Returns the type to store; throws an AttachmentError with an Arabic message otherwise.
 */
export function validateAttachmentFile(file: { size: number; type?: string | null; name?: string | null }): AttachmentMimeType {
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) throw new AttachmentError('empty', ATTACHMENT_MESSAGES.empty);
  const mimeType = detectAttachmentMimeType(file.type, file.name);
  if (!mimeType) throw new AttachmentError('unsupported_type', ATTACHMENT_MESSAGES.unsupportedType);
  if (size > MAX_ATTACHMENT_BYTES) throw new AttachmentError('too_large', ATTACHMENT_MESSAGES.tooLarge(size));
  return mimeType;
}

/** The name kept in the metadata: trimmed, no control characters, at most MAX_ATTACHMENT_NAME_LENGTH. */
export function cleanAttachmentName(name?: string | null): string {
  const clean = Array.from(name || '')
    .filter(ch => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim();
  if (!clean) return 'attachment';
  if (clean.length <= MAX_ATTACHMENT_NAME_LENGTH) return clean;
  const ext = extensionOf(clean);
  const suffix = ext && ext.length < 10 ? `.${ext}` : '';
  return clean.slice(0, MAX_ATTACHMENT_NAME_LENGTH - suffix.length) + suffix;
}

/** 'pdf' | 'png' | 'jpg': the short type RequestAttachment.type records. */
export function attachmentKindOf(mimeType: string): 'pdf' | 'png' | 'jpg' {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  return 'jpg';
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** True for every `fsattach://` url (a malformed one is then refused by the loader, not shown as a link). */
export const isFirestoreAttachmentUrl = (url?: string | null): boolean =>
  typeof url === 'string' && url.startsWith(ATTACHMENT_URL_PREFIX);

/** The attachment id of a well-formed `fsattach://<id>` url, else null. */
export function parseAttachmentUrl(url?: string | null): string | null {
  if (!isFirestoreAttachmentUrl(url)) return null;
  const id = (url as string).slice(ATTACHMENT_URL_PREFIX.length);
  return ATTACHMENT_ID_PATTERN.test(id) ? id : null;
}

export const attachmentUrlFor = (attachmentId: string): string => `${ATTACHMENT_URL_PREFIX}${attachmentId}`;

// ---------------------------------------------------------------------------
// Base64, chunking and assembly (pure)
// ---------------------------------------------------------------------------

/** Base64 of any bytes (built in slices: one String.fromCharCode call per 32 KB). */
export function bytesToBase64(bytes: Uint8Array): string {
  const STEP = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += STEP) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + STEP));
  }
  return btoa(binary);
}

/** Bytes of a base64 string; throws AttachmentError('corrupt') for anything that is not base64. */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new AttachmentError('corrupt', ATTACHMENT_MESSAGES.corrupt);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Splits a file into base64 chunks of `chunkChars` characters (the last one may be shorter).
 * Each chunk encodes its own slice of bytes, so it is valid base64 on its own.
 */
export function splitIntoChunks(bytes: Uint8Array, chunkChars: number = ATTACHMENT_CHUNK_CHARS): string[] {
  if (!Number.isInteger(chunkChars) || chunkChars < 4 || chunkChars % 4 !== 0) {
    throw new RangeError('chunkChars must be a positive multiple of 4');
  }
  const bytesPerChunk = (chunkChars / 4) * 3;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += bytesPerChunk) {
    chunks.push(bytesToBase64(bytes.subarray(offset, offset + bytesPerChunk)));
  }
  return chunks;
}

/**
 * Reassembles the file from its chunk documents (any order). Refuses missing, extra, duplicate
 * or malformed chunks, and a total that differs from the recorded size.
 */
export function joinChunks(
  chunks: ReadonlyArray<{ index?: unknown; data?: unknown }>,
  chunkCount: number,
  expectedSize?: number,
): Uint8Array<ArrayBuffer> {
  const corrupt = () => new AttachmentError('corrupt', ATTACHMENT_MESSAGES.corrupt);
  if (!Number.isInteger(chunkCount) || chunkCount < 0 || chunks.length !== chunkCount) throw corrupt();
  const ordered: string[] = new Array(chunkCount);
  for (const chunk of chunks) {
    const index = chunk.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= chunkCount) throw corrupt();
    if (ordered[index] !== undefined) throw corrupt();
    if (typeof chunk.data !== 'string' || chunk.data === '') throw corrupt();
    ordered[index] = chunk.data;
  }
  const parts = ordered.map(base64ToBytes);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  if (expectedSize !== undefined && total !== expectedSize) throw corrupt();
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Groups chunks into batched writes of at most `maxChars` base64 characters (and at most
 * `maxWrites` documents), keeping their order. A chunk larger than the budget gets its own batch.
 */
export function groupChunksIntoBatches(
  chunks: readonly string[],
  maxChars: number = ATTACHMENT_BATCH_CHARS,
  maxWrites = 100,
): AttachmentChunk[][] {
  const batches: AttachmentChunk[][] = [];
  let current: AttachmentChunk[] = [];
  let currentChars = 0;
  chunks.forEach((data, index) => {
    if (current.length > 0 && (currentChars + data.length > maxChars || current.length >= maxWrites)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push({ index, data });
    currentChars += data.length;
  });
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Decodes a `data:` URL (base64 or percent-encoded). The type is lower-cased; '' when the URL names none. */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array<ArrayBuffer>; mimeType: string } {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.toLowerCase().startsWith('data:') || comma < 0) {
    throw new AttachmentError('invalid_url', ATTACHMENT_MESSAGES.invalidUrl);
  }
  const header = dataUrl.slice(5, comma);
  const params = header.split(';').map(p => p.trim());
  const mimeType = (params[0] || '').toLowerCase();
  const isBase64 = params.slice(1).some(p => p.toLowerCase() === 'base64');
  const payload = dataUrl.slice(comma + 1);
  if (isBase64) return { bytes: base64ToBytes(payload.replace(/\s/g, '')), mimeType };
  let text: string;
  try {
    text = decodeURIComponent(payload);
  } catch {
    throw new AttachmentError('corrupt', ATTACHMENT_MESSAGES.corrupt);
  }
  return { bytes: new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>, mimeType };
}

/** Validates a metadata document read from Firestore. */
export function parseAttachmentMeta(data: unknown, attachmentId: string): AttachmentMeta {
  const d = (data || {}) as Record<string, unknown>;
  const ok =
    typeof d.orgId === 'string' &&
    typeof d.mimeType === 'string' &&
    typeof d.size === 'number' && Number.isInteger(d.size) && d.size >= 0 &&
    typeof d.chunkCount === 'number' && Number.isInteger(d.chunkCount) && d.chunkCount >= 0 && d.chunkCount <= 500;
  if (!ok) throw new AttachmentError('corrupt', ATTACHMENT_MESSAGES.corrupt);
  return {
    id: typeof d.id === 'string' ? d.id : attachmentId,
    orgId: d.orgId as string,
    name: typeof d.name === 'string' ? d.name : 'attachment',
    mimeType: d.mimeType as string,
    size: d.size as number,
    chunkCount: d.chunkCount as number,
    createdBy: typeof d.createdBy === 'string' ? d.createdBy : '',
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : '',
    complete: d.complete === true,
  };
}

// ---------------------------------------------------------------------------
// Firestore (for a given Firestore instance and signed-in user)
// ---------------------------------------------------------------------------

const errorCode = (err: unknown): string => String((err as { code?: unknown } | null)?.code ?? '').replace(/^firestore\//, '');

/** Maps a Firestore read failure to an AttachmentError with an Arabic message. */
function toReadError(err: unknown): AttachmentError {
  if (err instanceof AttachmentError) return err;
  const code = errorCode(err);
  // A missing attachment is refused exactly like another company's (nothing leaks).
  if (code === 'permission-denied') return new AttachmentError('forbidden', ATTACHMENT_MESSAGES.forbidden);
  if (code === 'unavailable' || code === 'deadline-exceeded') return new AttachmentError('offline', ATTACHMENT_MESSAGES.offline);
  return new AttachmentError('load_failed', ATTACHMENT_MESSAGES.loadFailed);
}

function toUploadError(err: unknown): AttachmentError {
  if (err instanceof AttachmentError) return err;
  const code = errorCode(err);
  if (code === 'unavailable' || code === 'deadline-exceeded') return new AttachmentError('offline', ATTACHMENT_MESSAGES.offline);
  if (code === 'permission-denied') {
    return new AttachmentError('upload_failed', ATTACHMENT_MESSAGES.uploadFailed(' (لا تملك صلاحية رفع ملفات لهذه الشركة)'));
  }
  const message = err instanceof Error && err.message ? ` (${err.message})` : '';
  return new AttachmentError('upload_failed', ATTACHMENT_MESSAGES.uploadFailed(message));
}

const metaRef = (db: Firestore, attachmentId: string) => doc(db, ATTACHMENTS_COLLECTION, attachmentId);
const chunkRef = (db: Firestore, attachmentId: string, index: number) =>
  doc(db, ATTACHMENTS_COLLECTION, attachmentId, ATTACHMENT_CHUNKS_COLLECTION, String(index));
const tombstoneRef = (db: Firestore, attachmentId: string) => doc(db, ATTACHMENT_TOMBSTONES_COLLECTION, attachmentId);

/**
 * Deletes the chunks (0..chunkCount-1) and then the metadata, and writes the id's tombstone,
 * in one batched write (the rules refuse a metadata delete without its tombstone).
 */
async function deleteAttachmentDocs(
  db: Firestore,
  uid: string,
  attachmentId: string,
  orgId: string,
  chunkCount: number,
): Promise<void> {
  const batch = writeBatch(db);
  const count = Math.max(0, Math.min(Math.floor(chunkCount) || 0, 400));
  for (let i = 0; i < count; i++) batch.delete(chunkRef(db, attachmentId, i));
  batch.delete(metaRef(db, attachmentId));
  batch.set(tombstoneRef(db, attachmentId), { orgId, deletedBy: uid, deletedAt: new Date().toISOString() });
  await batch.commit();
}

export interface WriteAttachmentOptions {
  orgId: string;
  name: string;
  /** Used only when the blob itself has no type. */
  mimeType?: string;
}

/**
 * Stores a file as attachments/{id} + its chunks, as `uid` (who must be a member of orgId).
 * Order: metadata (complete: false), chunk batches, complete: true. On failure the partial
 * upload is removed (best effort) and an AttachmentError with an Arabic message is thrown.
 */
export async function writeAttachment(
  db: Firestore,
  uid: string,
  file: Blob,
  opts: WriteAttachmentOptions,
): Promise<StoredAttachment> {
  const orgId = (opts.orgId || '').trim();
  if (!orgId || orgId === 'org-main') throw new AttachmentError('no_company', ATTACHMENT_MESSAGES.noCompany);
  if (!uid) throw new AttachmentError('not_signed_in', ATTACHMENT_MESSAGES.notSignedIn);
  const name = cleanAttachmentName(opts.name);
  const mimeType = validateAttachmentFile({ size: file.size, type: file.type || opts.mimeType || '', name });

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new AttachmentError('upload_failed', ATTACHMENT_MESSAGES.uploadFailed(' (تعذر قراءة الملف من الجهاز)'));
  }
  // The bytes actually read are what is checked and stored.
  validateAttachmentFile({ size: bytes.length, type: mimeType });
  const chunks = splitIntoChunks(bytes);

  const id = uuid();
  const meta: AttachmentMeta = {
    id,
    orgId,
    name,
    mimeType,
    size: bytes.length,
    chunkCount: chunks.length,
    createdBy: uid,
    createdAt: new Date().toISOString(),
    complete: false,
  };

  let metaWritten = false;
  try {
    await setDoc(metaRef(db, id), meta);
    metaWritten = true;
    for (const group of groupChunksIntoBatches(chunks)) {
      const batch = writeBatch(db);
      for (const chunk of group) batch.set(chunkRef(db, id, chunk.index), { index: chunk.index, data: chunk.data });
      await batch.commit();
    }
    await updateDoc(metaRef(db, id), { complete: true });
  } catch (err) {
    if (metaWritten) {
      await deleteAttachmentDocs(db, uid, id, orgId, chunks.length).catch(cleanupErr => {
        console.warn('[attachments] Could not remove an unfinished upload:', cleanupErr);
      });
    }
    throw toUploadError(err);
  }

  return { attachmentId: id, url: attachmentUrlFor(id), name, size: bytes.length, mimeType };
}

/** Reads the metadata and the bytes of a complete attachment. */
export async function readAttachment(
  db: Firestore,
  attachmentId: string,
): Promise<{ meta: AttachmentMeta; bytes: Uint8Array<ArrayBuffer> }> {
  if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) throw new AttachmentError('invalid_url', ATTACHMENT_MESSAGES.invalidUrl);
  let metaSnap;
  try {
    metaSnap = await getDoc(metaRef(db, attachmentId));
  } catch (err) {
    throw toReadError(err);
  }
  if (!metaSnap.exists()) throw new AttachmentError('not_found', ATTACHMENT_MESSAGES.notFound);
  const meta = parseAttachmentMeta(metaSnap.data(), attachmentId);
  if (!meta.complete) throw new AttachmentError('incomplete', ATTACHMENT_MESSAGES.incomplete);

  let chunkSnap;
  try {
    chunkSnap = await getDocs(collection(db, ATTACHMENTS_COLLECTION, attachmentId, ATTACHMENT_CHUNKS_COLLECTION));
  } catch (err) {
    throw toReadError(err);
  }
  // Offline, the local cache may hold only some of the chunks.
  if (chunkSnap.metadata.fromCache && chunkSnap.size !== meta.chunkCount) {
    throw new AttachmentError('offline', ATTACHMENT_MESSAGES.offline);
  }
  const bytes = joinChunks(chunkSnap.docs.map(d => d.data() as AttachmentChunk), meta.chunkCount, meta.size);
  return { meta, bytes };
}

/** The attachment as a Blob of its stored type. */
export async function readAttachmentBlob(db: Firestore, attachmentId: string): Promise<Blob> {
  const { meta, bytes } = await readAttachment(db, attachmentId);
  // Only the allowed types are ever shown; anything else can only be downloaded.
  const type = isAllowedAttachmentMimeType(meta.mimeType) ? meta.mimeType : 'application/octet-stream';
  return new Blob([bytes], { type });
}

/**
 * Deletes an attachment as `uid` (its chunks, then its metadata, plus the id's tombstone, in
 * one batch). Allowed to its creator, the company's admins and the platform owner. An
 * attachment already gone is a no-op for those who can still read it; for others the rules
 * cannot tell it apart from a refusal. The id can never be used again afterwards.
 */
export async function removeAttachment(db: Firestore, uid: string, attachmentId: string): Promise<void> {
  if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) return;
  if (!uid) throw new AttachmentError('not_signed_in', ATTACHMENT_MESSAGES.notSignedIn);
  let snap;
  try {
    snap = await getDoc(metaRef(db, attachmentId));
  } catch (err) {
    const read = toReadError(err);
    if (read.code === 'forbidden') throw new AttachmentError('forbidden', ATTACHMENT_MESSAGES.deleteForbidden);
    throw read;
  }
  if (!snap.exists()) return;
  const data = snap.data() as { chunkCount?: unknown; orgId?: unknown };
  const chunkCount = Number(data.chunkCount) || 0;
  const orgId = typeof data.orgId === 'string' ? data.orgId : '';
  try {
    await deleteAttachmentDocs(db, uid, attachmentId, orgId, chunkCount);
  } catch (err) {
    const code = errorCode(err);
    if (code === 'permission-denied') throw new AttachmentError('forbidden', ATTACHMENT_MESSAGES.deleteForbidden);
    if (code === 'unavailable' || code === 'deadline-exceeded') throw new AttachmentError('offline', ATTACHMENT_MESSAGES.offline);
    throw new AttachmentError('delete_failed', ATTACHMENT_MESSAGES.deleteFailed);
  }
}
