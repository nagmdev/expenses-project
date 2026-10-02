import { useCallback, useEffect, useRef, useState } from 'react';
import { attachmentKindOf, isFirestoreAttachmentUrl, resolveAttachmentUrl } from '../lib/attachments';
import type { InvoiceViewerAttachment } from '../components/InvoiceViewerModal';
import { showToast } from '../utils/toast';
import { arabicErrorMessage } from '../utils/recordAttachments';

const LOAD_ERROR = 'تعذر تحميل المستند. تحقق من اتصالك بالإنترنت ومن صلاحيتك على هذا السجل ثم أعد المحاولة.';

const EXTENSION_BY_TYPE: Record<string, string> = { pdf: '.pdf', png: '.png', jpg: '.jpg' };

/** 'pdf' / 'png' / 'jpg' from a file name's extension, '' when the name does not tell. */
function typeFromName(name?: string): string {
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpg';
  return '';
}

/** The type of a loaded document, read from its in-memory object URL (no network). */
async function objectUrlMime(objectUrl: string): Promise<string> {
  const res = await fetch(objectUrl);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  res.body?.cancel().catch(() => {});
  return mime;
}

export interface AttachmentPreviewRequest {
  /** Stored link: fsattach:// (Firestore), or data: / https of an older record. */
  url: string;
  name: string;
  size?: string | number;
  /** 'pdf' / 'png' / 'jpg' when known; otherwise taken from the name, or from the file itself. */
  type?: string;
}

/**
 * Preview of a record's document in InvoiceViewerModal.
 *
 * - data: and https links of older records go to the viewer exactly as before.
 * - fsattach:// links whose type is known (from the caller or the file name) go to the viewer,
 *   which loads them (spinner, Arabic error and retry).
 * - fsattach:// links of unknown type (a custody invoice keeps only its link) are loaded here
 *   first (`loadingUrl` is set meanwhile, a failure is shown as an Arabic toast), so the viewer
 *   knows whether to show a PDF or an image. The loaded copy is the attachments module's cached
 *   object URL, so the viewer does not download it again.
 */
export function useAttachmentPreview() {
  const [preview, setPreview] = useState<InvoiceViewerAttachment | null>(null);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);
  const requestRef = useRef(0);

  // A load that finishes after the page is gone opens nothing.
  useEffect(() => {
    const requests = requestRef;
    return () => {
      requests.current++;
    };
  }, []);

  const open = useCallback(async (doc: AttachmentPreviewRequest) => {
    if (!doc.url) return;
    const request = ++requestRef.current;
    if (!isFirestoreAttachmentUrl(doc.url)) {
      setLoadingUrl(null);
      setPreview({ url: doc.url, name: doc.name, size: doc.size, type: doc.type });
      return;
    }
    const knownType = doc.type || typeFromName(doc.name);
    if (knownType) {
      setLoadingUrl(null);
      setPreview({ url: doc.url, name: doc.name, size: doc.size, type: knownType });
      return;
    }

    setPreview(null);
    setLoadingUrl(doc.url);
    try {
      const objectUrl = await resolveAttachmentUrl(doc.url);
      const type = attachmentKindOf(await objectUrlMime(objectUrl));
      if (request !== requestRef.current) return;
      setPreview({ url: objectUrl, name: `${doc.name}${EXTENSION_BY_TYPE[type]}`, size: doc.size, type });
    } catch (err) {
      if (request !== requestRef.current) return;
      console.error('[AttachmentPreview] Could not load the document:', err);
      showToast(arabicErrorMessage(err) || LOAD_ERROR, 'error', 6000);
    } finally {
      if (request === requestRef.current) setLoadingUrl(null);
    }
  }, []);

  const close = useCallback(() => {
    requestRef.current++;
    setPreview(null);
    setLoadingUrl(null);
  }, []);

  return { preview, loadingUrl, open, close };
}
