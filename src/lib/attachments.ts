/**
 * Attachments (invoices, visa documents, custody receipts) for the app: stored INSIDE
 * Cloud Firestore, chunked, so they work on the free Spark plan (Cloud Storage needs Blaze).
 *
 * Records keep `fsattach://<attachmentId>` as the url. Older records may still hold `data:`
 * URLs (files kept inline in the document) or https Firebase Storage URLs: both keep working
 * here (display, open, download).
 *
 * Layout, chunking and validation: src/lib/attachmentsCore.ts. Server-side contract:
 * firestore.rules (match /attachments).
 */
import { auth, getDb, type Firestore } from './firebase';
import {
  ATTACHMENT_MESSAGES,
  AttachmentError,
  dataUrlToBytes,
  isAllowedAttachmentMimeType,
  isFirestoreAttachmentUrl,
  parseAttachmentUrl,
  readAttachmentBlob,
  removeAttachment,
  writeAttachment,
  type StoredAttachment,
} from './attachmentsCore';

export {
  ATTACHMENT_URL_PREFIX,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_SIZE_LABEL,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  AttachmentError,
  attachmentKindOf,
  attachmentUrlFor,
  detectAttachmentMimeType,
  formatFileSize,
  isAllowedAttachmentMimeType,
  isFirestoreAttachmentUrl,
  parseAttachmentUrl,
  validateAttachmentFile,
  splitIntoChunks,
  joinChunks,
} from './attachmentsCore';
export type { StoredAttachment, AttachmentMeta, AttachmentMimeType, AttachmentErrorCode } from './attachmentsCore';

function requireDb(): Firestore {
  const db = getDb();
  if (!db) throw new AttachmentError('offline', ATTACHMENT_MESSAGES.offline);
  return db;
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * Stores a file (already compressed if it is an image) in Firestore for the company `orgId`,
 * as the signed-in user. Returns the `fsattach://` url to keep on the record.
 * Throws an AttachmentError with an Arabic message (empty, too large, unsupported type,
 * no company, signed out, offline, refused).
 */
export async function saveAttachment(file: Blob, opts: { orgId: string; name: string }): Promise<StoredAttachment> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new AttachmentError('not_signed_in', ATTACHMENT_MESSAGES.notSignedIn);
  // Firestore would queue the writes until the connection comes back; say so at once instead.
  if (isOffline()) throw new AttachmentError('offline', ATTACHMENT_MESSAGES.offline);
  return writeAttachment(requireDb(), uid, file, opts);
}

/**
 * The file behind an attachment url:
 *  - `fsattach://` -> read from Firestore (refused while incomplete);
 *  - `data:` -> decoded (older records);
 *  - http(s) / blob: -> fetched (older Firebase Storage records).
 */
export async function loadAttachmentBlob(url: string): Promise<Blob> {
  if (isFirestoreAttachmentUrl(url)) {
    const id = parseAttachmentUrl(url);
    if (!id) throw new AttachmentError('invalid_url', ATTACHMENT_MESSAGES.invalidUrl);
    return readAttachmentBlob(requireDb(), id);
  }
  if (typeof url === 'string' && url.toLowerCase().startsWith('data:')) {
    const { bytes, mimeType } = dataUrlToBytes(url);
    // Only PNG / JPEG / PDF are shown by the browser; anything else stays a download.
    return new Blob([bytes], { type: isAllowedAttachmentMimeType(mimeType) ? mimeType : 'application/octet-stream' });
  }
  if (typeof url === 'string' && /^(https?:|blob:)/i.test(url)) {
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new AttachmentError('load_failed', ATTACHMENT_MESSAGES.loadFailed);
    }
    if (!response.ok) {
      throw new AttachmentError(
        response.status === 403 || response.status === 401 ? 'forbidden' : response.status === 404 ? 'not_found' : 'load_failed',
        response.status === 403 || response.status === 401
          ? ATTACHMENT_MESSAGES.forbidden
          : response.status === 404
            ? ATTACHMENT_MESSAGES.notFound
            : ATTACHMENT_MESSAGES.loadFailed,
      );
    }
    return response.blob();
  }
  throw new AttachmentError('invalid_url', ATTACHMENT_MESSAGES.invalidUrl);
}

// ---------------------------------------------------------------------------
// Object URLs for <img> / <iframe> / <a>, cached per attachment url
// ---------------------------------------------------------------------------

interface CachedObjectUrl {
  promise: Promise<string>;
  objectUrl: string;
  bytes: number;
}

/** Cached object URLs stay valid until the cache holds more than this many bytes (oldest go first). */
const OBJECT_URL_CACHE_BYTES = 150 * 1024 * 1024;
const objectUrlCache = new Map<string, CachedObjectUrl>();
let cachedBytes = 0;
/** The account the cached files were read for (the cache never outlives a sign-out / account switch). */
let cacheOwnerUid = '';

function dropCached(url: string): void {
  const entry = objectUrlCache.get(url);
  if (!entry) return;
  objectUrlCache.delete(url);
  cachedBytes -= entry.bytes;
  if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
}

function trimCache(keep: string): void {
  for (const [url, entry] of objectUrlCache) {
    if (cachedBytes <= OBJECT_URL_CACHE_BYTES) break;
    if (url !== keep && entry.objectUrl) dropCached(url);
  }
}

/**
 * A URL an <img>, <iframe> or <a> can use: an object URL for `fsattach://` (read once, then
 * cached per url for the session), and `data:` / https URLs unchanged.
 * The cached object URLs belong to this module: callers must not revoke them.
 */
export async function resolveAttachmentUrl(url: string): Promise<string> {
  if (!isFirestoreAttachmentUrl(url)) return url;
  // Files read for one account are never handed to the next one signed in on this tab:
  // each account's reads go through the Firestore rules again.
  const uid = auth.currentUser?.uid ?? '';
  if (uid !== cacheOwnerUid) {
    clearAttachmentUrlCache();
    cacheOwnerUid = uid;
  }
  const cached = objectUrlCache.get(url);
  if (cached) {
    // most recently used last
    objectUrlCache.delete(url);
    objectUrlCache.set(url, cached);
    return cached.promise;
  }
  const entry: CachedObjectUrl = { promise: Promise.resolve(''), objectUrl: '', bytes: 0 };
  entry.promise = loadAttachmentBlob(url).then(
    blob => {
      const objectUrl = URL.createObjectURL(blob);
      if (objectUrlCache.get(url) !== entry) {
        // released (e.g. deleted) while loading: hand out the URL but do not keep it
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        return objectUrl;
      }
      entry.objectUrl = objectUrl;
      entry.bytes = blob.size;
      cachedBytes += blob.size;
      trimCache(url);
      return objectUrl;
    },
    err => {
      if (objectUrlCache.get(url) === entry) objectUrlCache.delete(url);
      throw err;
    },
  );
  objectUrlCache.set(url, entry);
  return entry.promise;
}

/** Forgets (and revokes) the cached object URL of an attachment url. */
export function releaseAttachmentUrl(url: string): void {
  dropCached(url);
}

/** Revokes every cached object URL (e.g. on sign-out). */
export function clearAttachmentUrlCache(): void {
  for (const url of Array.from(objectUrlCache.keys())) dropCached(url);
}

/**
 * Deletes an `fsattach://` attachment as the signed-in user (its creator, the company's admins
 * and the platform owner may). Its id can never be used again. Older `data:` / https urls are
 * left alone (no-op).
 */
export async function deleteAttachment(url: string): Promise<void> {
  if (!isFirestoreAttachmentUrl(url)) return;
  const id = parseAttachmentUrl(url);
  if (!id) return;
  const uid = auth.currentUser?.uid;
  if (!uid) throw new AttachmentError('not_signed_in', ATTACHMENT_MESSAGES.notSignedIn);
  await removeAttachment(requireDb(), uid, id);
  releaseAttachmentUrl(url);
}
