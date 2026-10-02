import {
  MAX_ATTACHMENT_BYTES,
  deleteAttachment,
  detectAttachmentMimeType,
  saveAttachment,
  type StoredAttachment,
} from '../lib/attachments';
import { compressImage, dataUrlToBlob } from './fileUpload';

/**
 * Documents attached to visa requests and custody invoices.
 *
 * The file is kept in Firestore (src/lib/attachments.ts, free on the Spark plan) under the
 * record's company; the record itself keeps only the returned fsattach:// link. Older
 * records may still hold a data: or https link: those are shown exactly as before.
 */

/** The per-file limit (after image compression) as the user reads it: "10 ميجابايت". */
export const ATTACHMENT_LIMIT_LABEL = `${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} ميجابايت`;

/** File picker filter: the only types accepted (PDF, PNG, JPG/JPEG). */
export const ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg';

export const UNSUPPORTED_ATTACHMENT_MESSAGE = 'صيغة الملف غير مدعومة. يسمح فقط بـ PDF أو الصور (PNG, JPG)';

/** The type the file will be stored as when it is one we accept (PDF, PNG, JPG/JPEG), else ''. */
export function acceptedAttachmentMime(file: File): string {
  return detectAttachmentMimeType(file.type, file.name) || '';
}

/** The message of an error when it is written in Arabic, else ''. */
export function arabicErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /[؀-ۿ]/.test(message) ? message : '';
}

/**
 * Stores a picked file for a record of company `orgId`: checks the type, compresses images,
 * then saves it in Firestore (which refuses an empty file or one above 10 MB after compression).
 * Throws an Error with an Arabic message the form can show as is.
 */
export async function storeRecordAttachment(file: File, orgId: string): Promise<StoredAttachment> {
  const mime = acceptedAttachmentMime(file);
  if (!mime) throw new Error(UNSUPPORTED_ATTACHMENT_MESSAGE);

  // Some systems give no (or a generic) type: the stored copy always carries the real one.
  const typed = file.type === mime ? file : new File([file], file.name, { type: mime });
  let content: Blob = typed;
  if (mime.startsWith('image/')) {
    try {
      const compressed = dataUrlToBlob((await compressImage(typed)).dataUrl);
      if (compressed.size > 0 && compressed.size < typed.size) content = compressed;
    } catch (err) {
      console.warn('[Attachment] Image compression skipped, storing the original file:', err);
    }
  }

  try {
    return await saveAttachment(content, { orgId, name: file.name });
  } catch (err) {
    console.error('[Attachment] Saving the document failed:', err);
    throw new Error(
      arabicErrorMessage(err) || 'تعذر حفظ المستند. تحقق من اتصالك بالإنترنت ومن صلاحيتك على هذه الشركة ثم أعد المحاولة.'
    );
  }
}

/**
 * Deletes a stored copy that no saved record uses (removed from a form, form closed, company
 * changed). Best effort: a failure only leaves an unused copy behind, so it is logged, not shown.
 */
export function discardStoredAttachment(url: string | null | undefined): void {
  if (!url) return;
  deleteAttachment(url).catch(err => console.warn('[Attachment] Could not delete an unused document:', err));
}
