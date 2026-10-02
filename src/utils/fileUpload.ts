import { deleteStorageObject } from '../lib/firebase';
import { deleteAttachment, isFirestoreAttachmentUrl, loadAttachmentBlob, saveAttachment } from '../lib/attachments';
import {
  ATTACHMENT_MESSAGES,
  AttachmentError,
  attachmentKindOf,
  dataUrlToBytes,
  detectAttachmentMimeType,
  formatFileSize,
  isAllowedAttachmentMimeType,
} from '../lib/attachmentsCore';
import { RequestAttachment } from '../types';
import { newId } from './ids';
import { localToday } from './requestUi';
import { showToast } from './toast';

export { formatFileSize };

/**
 * Compress an image file using an offscreen HTML Canvas.
 * Reduces 3-10MB mobile phone camera pictures to ~60-120KB JPEG
 * while keeping invoice text, stamps, and numbers razor sharp.
 */
export async function compressImage(
  file: File,
  maxWidth = 1280,
  maxHeight = 1280,
  quality = 0.82
): Promise<{ dataUrl: string; sizeString: string; byteSize: number }> {
  return new Promise((resolve, reject) => {
    // If not an image, reject
    if (!file.type.startsWith('image/')) {
      reject(new Error('الملف ليس صورة صالحة للضغط'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('فشل قراءة ملف الصورة'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('فشل معالجة محتوى الصورة'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calculate aspect-ratio preserved dimensions
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          // Fallback to original DataURL if canvas context fails
          const originalData = e.target?.result as string;
          resolve({
            dataUrl: originalData,
            sizeString: formatFileSize(file.size),
            byteSize: file.size,
          });
          return;
        }

        // Draw image smoothly
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Export as optimized JPEG
        const dataUrl = canvas.toDataURL('image/jpeg', quality);

        // Calculate approximate size of base64 DataURL
        const byteSize = Math.round((dataUrl.length * 3) / 4);
        resolve({
          dataUrl,
          sizeString: formatFileSize(byteSize),
          byteSize,
        });
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a `data:` URL (base64 or percent-encoded) to a Blob of its type
 * (image/jpeg when the URL names none).
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const { bytes, mimeType } = dataUrlToBytes(dataUrl);
  return new Blob([bytes], { type: mimeType || 'image/jpeg' });
}

/** The Arabic reason of a failure when there is one, else the given fallback. */
function arabicMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /[؀-ۿ]/.test(message) ? message : fallback;
}

function reportFileError(err: unknown): void {
  console.error('[attachments] Could not open the file:', err);
  showToast(arabicMessage(err, ATTACHMENT_MESSAGES.loadFailed), 'error');
}

const EXTENSION_FOR_TYPE: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };

/** Adds the extension of the blob's type when the name has none ("invoice" -> "invoice.pdf"). */
function withExtension(fileName: string, type: string): string {
  const ext = EXTENSION_FOR_TYPE[type];
  if (!ext || /\.[A-Za-z0-9]{1,5}$/.test(fileName)) return fileName;
  return `${fileName}.${ext}`;
}

/** Only web and in-memory URLs are ever opened or downloaded directly (never javascript: etc.). */
const isWebUrl = (url: string) => /^(https?:|blob:)/i.test(url);

function clickDownload(href: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function saveBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  clickDownload(href, withExtension(fileName, blob.type));
  setTimeout(() => URL.revokeObjectURL(href), 45000);
}

/**
 * Shows a blob in `target` (a tab opened during the click) or a new tab. PDFs and images only:
 * any other type is downloaded instead, so stored content can never run as a page of this site.
 */
function showBlob(blob: Blob, fileName: string, target: Window | null): void {
  if (!isAllowedAttachmentMimeType(blob.type)) {
    target?.close();
    saveBlob(blob, fileName);
    return;
  }
  const blobUrl = URL.createObjectURL(blob);
  let win: Window | null = target && !target.closed ? target : null;
  if (win) {
    win.location.href = blobUrl;
  } else {
    win = window.open(blobUrl, '_blank');
  }
  if (!win || win.closed) {
    // Popup blocked: download instead.
    clickDownload(blobUrl, withExtension(fileName, blob.type));
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
}

/**
 * Safely open any file/attachment in a new browser window/tab.
 *  - `fsattach://` (Firestore): a tab is opened at once (while the click still counts as a user
 *    gesture), the file is read, then shown in it.
 *  - `data:` URLs are turned into in-memory Blob URLs first (Chromium refuses to navigate a
 *    top frame to a data URL).
 *  - http(s) / blob: URLs open as they are.
 * Failures are shown as an Arabic toast; the returned promise never rejects.
 */
export async function openFileSafely(url: string, fileName = 'document'): Promise<void> {
  if (!url) return;
  if (isFirestoreAttachmentUrl(url)) {
    let pending: Window | null = null;
    try {
      pending = window.open('', '_blank');
      if (pending) {
        pending.document.title = fileName;
        pending.document.body.dir = 'rtl';
        pending.document.body.style.fontFamily = 'sans-serif';
        pending.document.body.textContent = 'جاري تحميل المرفق...';
      }
    } catch {
      // the tab stays blank until the file is shown
    }
    try {
      showBlob(await loadAttachmentBlob(url), fileName, pending);
    } catch (err) {
      pending?.close();
      reportFileError(err);
    }
    return;
  }
  if (url.toLowerCase().startsWith('data:')) {
    // Decoded synchronously, so the new tab still opens within the click.
    try {
      showBlob(inlineDataUrlToBlob(url), fileName, null);
    } catch (err) {
      reportFileError(err);
    }
    return;
  }
  if (isWebUrl(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  reportFileError(new AttachmentError('invalid_url', ATTACHMENT_MESSAGES.invalidUrl));
}

/** A `data:` URL as a Blob that is only ever shown when it is a PNG, JPEG or PDF. */
function inlineDataUrlToBlob(url: string): Blob {
  const { bytes, mimeType } = dataUrlToBytes(url);
  return new Blob([bytes], { type: isAllowedAttachmentMimeType(mimeType) ? mimeType : 'application/octet-stream' });
}

/**
 * Safely trigger browser download for any file/attachment: `fsattach://` (read from
 * Firestore), base64 `data:` URLs and remote / blob URLs.
 * Failures are shown as an Arabic toast; the returned promise never rejects.
 */
export async function downloadFileSafely(url: string, fileName = 'attachment'): Promise<void> {
  if (!url) return;
  if (url.toLowerCase().startsWith('data:')) {
    try {
      saveBlob(inlineDataUrlToBlob(url), fileName);
    } catch (err) {
      reportFileError(err);
    }
    return;
  }
  if (isFirestoreAttachmentUrl(url)) {
    try {
      saveBlob(await loadAttachmentBlob(url), fileName);
    } catch (err) {
      reportFileError(err);
    }
    return;
  }
  if (!isWebUrl(url)) {
    reportFileError(new AttachmentError('invalid_url', ATTACHMENT_MESSAGES.invalidUrl));
    return;
  }
  try {
    clickDownload(url, fileName);
  } catch (err) {
    console.error('[downloadFileSafely] Download failed:', err);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Upload an invoice or receipt file.
 * Images are compressed first; the file is then stored in Firestore (chunked, see
 * src/lib/attachments.ts) for the company `orgId`, and the record keeps its `fsattach://` url.
 * Fails explicitly (Arabic message) when the file is empty, too large (10 MB after
 * compression), not PNG / JPG / PDF, or cannot be saved.
 */
export async function processAndUploadInvoice(
  file: File,
  orgId: string,
  requestId?: string
): Promise<RequestAttachment> {
  void requestId; // kept for callers; attachments are linked to records by their url
  const cleanOrgId = (orgId || '').trim();
  if (!cleanOrgId || cleanOrgId === 'org-main') {
    throw new AttachmentError('no_company', ATTACHMENT_MESSAGES.noCompany);
  }

  const now = new Date();
  if (file.size <= 0) throw new AttachmentError('empty', ATTACHMENT_MESSAGES.empty);
  // PNG / JPG / PDF by type (or by name when the browser gives no type). Other image formats
  // (WebP, HEIC…) are accepted only if the browser can convert them to JPEG below.
  const originalType = detectAttachmentMimeType(file.type, file.name);
  const isImage = file.type.startsWith('image/') || originalType === 'image/png' || originalType === 'image/jpeg';
  if (!isImage && originalType !== 'application/pdf') {
    throw new AttachmentError('unsupported_type', ATTACHMENT_MESSAGES.unsupportedType);
  }

  // Step 1: compress images (the stored copy is a JPEG unless the original PNG/JPEG is smaller).
  let blobToStore: Blob = file;
  if (isImage && file.type.startsWith('image/')) {
    try {
      const compressed = dataUrlToBlob((await compressImage(file)).dataUrl);
      if (!isAllowedAttachmentMimeType(originalType) || compressed.size < file.size) {
        blobToStore = compressed;
      }
    } catch (compressionErr) {
      console.warn('[Invoice Upload] Compression skipped, using raw file:', compressionErr);
    }
  }
  if (blobToStore === file && originalType && file.type !== originalType) {
    // e.g. a PDF a phone sent as '' or application/octet-stream: store it under its real type.
    blobToStore = new Blob([file], { type: originalType });
  }

  // Step 2: store it in Firestore (validates type and size: PNG / JPG / PDF, 10 MB).
  const stored = await saveAttachment(blobToStore, { orgId: cleanOrgId, name: file.name });

  return {
    id: newId('att'),
    name: file.name,
    size: formatFileSize(stored.size),
    type: attachmentKindOf(stored.mimeType),
    url: stored.url,
    uploadedAt: localToday(now),
  };
}

/**
 * Deletes an uploaded attachment:
 *  - an `fsattach://` url -> the Firestore attachment (creator, company admins, platform owner);
 *  - a legacy Firebase Storage path -> only when Firebase Storage is enabled
 *    (VITE_USE_FIREBASE_STORAGE=true, Blaze plan); otherwise nothing happens.
 */
export async function deleteAttachmentFile(storagePathOrUrl: string): Promise<void> {
  if (!storagePathOrUrl) return;
  if (isFirestoreAttachmentUrl(storagePathOrUrl)) {
    await deleteAttachment(storagePathOrUrl);
    return;
  }
  await deleteStorageObject(storagePathOrUrl);
}
