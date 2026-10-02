import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Download,
  ExternalLink,
  FileText,
  Receipt,
  Maximize2,
  Loader2,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { openFileSafely, downloadFileSafely, dataUrlToBlob } from '../utils/fileUpload';
import { isFirestoreAttachmentUrl, loadAttachmentBlob, resolveAttachmentUrl } from '../lib/attachments';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

export interface InvoiceViewerAttachment {
  url?: string;
  name?: string;
  size?: string | number;
  type?: string;
}

interface InvoiceViewerModalProps {
  attachment: InvoiceViewerAttachment | null;
  onClose: () => void;
}

const DOCUMENT_LOAD_ERROR = 'تعذر تحميل المستند. تحقق من اتصالك بالإنترنت ومن صلاحيتك على هذا الطلب ثم أعد المحاولة.';

/** The loader's own message when it is written in Arabic (e.g. "attachment incomplete"), else ''. */
const arabicReason = (err: unknown): string => {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /\p{Script=Arabic}/u.test(message) ? message : '';
};

const isPdfDocument = (url?: string, type?: string, name?: string): boolean =>
  type === 'pdf' ||
  type === 'application/pdf' ||
  Boolean(name && name.toLowerCase().endsWith('.pdf')) ||
  Boolean(url && url.startsWith('data:application/pdf'));

/** Opens a blob: URL in a new tab (a download when the browser blocks the tab). */
function openObjectUrlInNewTab(objectUrl: string, fileName: string): void {
  const newWin = window.open(objectUrl, '_blank');
  // (the helpers below start a blob: download synchronously and never reject)
  if (!newWin || newWin.closed) void downloadFileSafely(objectUrl, fileName);
}

/**
 * Opens an in-memory document in a new tab. It gets its own short-lived object URL, so
 * closing this preview (which revokes the preview's URL) cannot break the new tab.
 */
function openBlobInNewTab(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  openObjectUrlInNewTab(blobUrl, fileName);
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
}

/** Saves an in-memory document to the user's device. */
function downloadBlob(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  void downloadFileSafely(blobUrl, fileName);
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 45000);
}

interface AttachmentImageProps {
  /** Any stored attachment URL: fsattach:// (Firestore), data: or https. */
  url: string;
  alt: string;
  className?: string;
  title?: string;
  onClick?: () => void;
}

/**
 * Thumbnail of an attached image. Attachments kept in Firestore (fsattach://) are
 * loaded first (a small spinner meanwhile, a warning icon if they cannot be read);
 * data: and https URLs of older records are shown directly, exactly as before.
 */
export const AttachmentImage: React.FC<AttachmentImageProps> = ({ url, alt, className = '', title, onClick }) => {
  const fromFirestore = isFirestoreAttachmentUrl(url);
  const [resolved, setResolved] = useState<{ forUrl: string; src: string; failed: boolean } | null>(null);

  useEffect(() => {
    if (!fromFirestore) return;
    let cancelled = false;
    // The object URL is cached and owned by the attachments module: never revoked here.
    resolveAttachmentUrl(url).then(
      src => {
        if (!cancelled) setResolved({ forUrl: url, src, failed: false });
      },
      err => {
        console.warn('[AttachmentImage] Could not load attachment:', err);
        if (!cancelled) setResolved({ forUrl: url, src: '', failed: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [url, fromFirestore]);

  if (!fromFirestore) {
    return <img src={url} alt={alt} title={title} className={className} onClick={onClick} />;
  }

  const current = resolved && resolved.forUrl === url ? resolved : null;
  if (!current || current.failed) {
    const label = current ? 'تعذر تحميل المرفق' : 'جاري تحميل المرفق...';
    return (
      <span
        role="img"
        aria-label={`${alt}: ${label}`}
        title={current ? `${label} — انقر للمعاينة وإعادة المحاولة` : label}
        className={`${className} inline-flex items-center justify-center bg-slate-50 text-slate-400`}
        onClick={onClick}
      >
        {current ? (
          <AlertTriangle className="h-4 w-4 text-rose-500" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin" />
        )}
      </span>
    );
  }

  return <img src={current.src} alt={alt} title={title} className={className} onClick={onClick} />;
};

interface LoadedDocument {
  forUrl: string;
  /** What the <img>/<iframe> shows ('' when loading failed). */
  src: string;
  /** The document's bytes when they were loaded here (open / download use them). */
  blob: Blob | null;
  error: string;
}

export const InvoiceViewerModal: React.FC<InvoiceViewerModalProps> = ({ attachment, onClose }) => {
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);

  // Reset zoom & rotation when another document is shown (adjusted while rendering,
  // so the new document never flashes with the previous one's zoom).
  const [shownUrl, setShownUrl] = useState(attachment?.url);
  if (shownUrl !== attachment?.url) {
    setShownUrl(attachment?.url);
    setZoom(1);
    setRotation(0);
  }

  const isOpen = Boolean(attachment?.url);
  const docUrl = attachment?.url || '';
  const docIsPdf = isPdfDocument(docUrl, attachment?.type, attachment?.name);

  // Documents kept in Firestore (fsattach://) are read first; a PDF stored inline as a
  // data: URL is turned into a blob: URL (browsers refuse data: documents in frames).
  // Everything else (images in data: URLs, https links of older records) is shown as is.
  const fromFirestore = isFirestoreAttachmentUrl(docUrl);
  const needsLoading = fromFirestore || (docIsPdf && docUrl.startsWith('data:'));
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!docUrl || !needsLoading) return;
    let cancelled = false;
    let ownUrl = '';
    const load = async () => {
      try {
        if (docIsPdf) {
          const raw = docUrl.startsWith('data:') ? dataUrlToBlob(docUrl) : await loadAttachmentBlob(docUrl);
          if (cancelled) return;
          // The browser's PDF viewer needs the right type to show the file in the frame.
          const pdf = raw.type === 'application/pdf' ? raw : new Blob([raw], { type: 'application/pdf' });
          ownUrl = URL.createObjectURL(pdf);
          setLoaded({ forUrl: docUrl, src: ownUrl, blob: pdf, error: '' });
        } else {
          // Image thumbnails already resolved this URL: reuse the cached object URL
          // (owned by the attachments module, so it is never revoked here).
          const src = await resolveAttachmentUrl(docUrl);
          if (cancelled) return;
          setLoaded({ forUrl: docUrl, src, blob: null, error: '' });
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[InvoiceViewer] Failed to load the document:', err);
        if (!fromFirestore) {
          // An inline data: PDF that cannot be converted is still given to the frame as is.
          setLoaded({ forUrl: docUrl, src: docUrl, blob: null, error: '' });
        } else {
          setLoaded({ forUrl: docUrl, src: '', blob: null, error: arabicReason(err) || DOCUMENT_LOAD_ERROR });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (ownUrl) {
        const revoked = ownUrl;
        URL.revokeObjectURL(revoked);
        // Never show a revoked URL again (e.g. the same PDF opened a second time).
        setLoaded(prev => (prev && prev.src === revoked ? null : prev));
      }
    };
  }, [docUrl, docIsPdf, needsLoading, fromFirestore, reloadCount]);

  const current = needsLoading ? (loaded && loaded.forUrl === docUrl ? loaded : null) : null;
  const isLoadingDoc = needsLoading && !current;
  const loadError = current?.error || '';
  const displaySrc = needsLoading ? (current?.src || '') : docUrl;
  const frameSrc = docIsPdf && !isLoadingDoc && !loadError ? displaySrc : '';

  const dialogRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Esc closes ONLY this preview (it is the top-most dialog): the form or detail
  // window behind it stays open with everything typed in it.
  useEscapeToClose(isOpen, onClose, dialogRef);

  // Zoom shortcuts: +, -, 0
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + '+' / '-' / '0' is the browser's own page zoom.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') {
        setZoom(prev => Math.min(prev + 0.25, 3.5));
      } else if (e.key === '-' || e.key === '_') {
        setZoom(prev => Math.max(prev - 0.25, 0.5));
      } else if (e.key === '0') {
        setZoom(1);
        setRotation(0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Keyboard focus: the preview takes it when it opens (so Esc works at once) and gives
  // it back to whatever had it before when it closes.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [isOpen]);

  // A PDF is shown in an iframe. While the keyboard focus is inside it, key presses go
  // to the browser's PDF viewer and never reach this page, so Esc would do nothing.
  // Whenever the frame takes the focus (the viewer grabbing it on load, or a click in the
  // document), hand it straight back to the preview: scrolling, the viewer's toolbar
  // buttons and text selection work with the mouse as before, and Esc always closes the
  // preview.
  useEffect(() => {
    if (!isOpen) return;
    let timer: number | undefined;
    const reclaimFocus = () => {
      if (document.activeElement === iframeRef.current) dialogRef.current?.focus({ preventScroll: true });
    };
    const onWindowBlur = () => {
      window.clearTimeout(timer);
      // The frame becomes document.activeElement right after the window's blur event.
      timer = window.setTimeout(reclaimFocus, 0);
    };
    window.addEventListener('blur', onWindowBlur);
    const frame = iframeRef.current;
    frame?.addEventListener('mouseleave', reclaimFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('blur', onWindowBlur);
      frame?.removeEventListener('mouseleave', reclaimFocus);
    };
    // frameSrc: the frame only mounts once the document has been loaded.
  }, [isOpen, frameSrc]);

  // Same-origin documents (a PDF shown from a blob: URL) also get an Esc listener
  // inside the frame; a cross-origin frame refuses access, which is fine.
  const handleIframeLoad = () => {
    try {
      const inner = iframeRef.current?.contentWindow;
      inner?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape') onCloseRef.current();
      });
    } catch {
      // cross-origin frame: covered by the focus handling above
    }
  };

  if (!attachment || !attachment.url) return null;

  const safeUrl = attachment.url;
  const fileName = attachment.name || 'مستند_الفاتورة';
  const isPdf = docIsPdf;
  // A Firestore document can be opened / saved only once its bytes are here.
  const actionsDisabled = fromFirestore && (isLoadingDoc || Boolean(loadError));

  const handleZoomIn = () => setZoom(prev => Math.min(Number((prev + 0.25).toFixed(2)), 3.5));
  const handleZoomOut = () => setZoom(prev => Math.max(Number((prev - 0.25).toFixed(2)), 0.5));
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };

  // Opening / saving happens right inside the click (no waiting), so the browser never
  // treats the new tab as an unwanted pop-up.
  const handleOpenExternal = () => {
    if (actionsDisabled) return;
    if (current?.blob) openBlobInNewTab(current.blob, fileName);
    else if (fromFirestore && current?.src) openObjectUrlInNewTab(current.src, fileName);
    else if (safeUrl.startsWith('blob:')) openObjectUrlInNewTab(safeUrl, fileName);
    else if (safeUrl) void openFileSafely(safeUrl, fileName);
  };

  const handleDownload = () => {
    if (actionsDisabled) return;
    if (current?.blob) downloadBlob(current.blob, fileName);
    else if (fromFirestore && current?.src) void downloadFileSafely(current.src, fileName);
    else if (safeUrl) void downloadFileSafely(safeUrl, fileName);
  };

  const handleRetry = () => {
    setLoaded(null);
    setReloadCount(n => n + 1);
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`معاينة المستند: ${fileName}`}
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-200 select-none outline-none"
      onClick={onClose}
    >
      {/* Top Navigation & Toolbar */}
      <div 
        className="flex items-center justify-between px-4 py-3 bg-slate-900/90 border-b border-slate-800 text-white shrink-0 z-10 shadow-lg gap-2 flex-wrap"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Document Info */}
        <div className="flex items-center gap-3 min-w-0 max-w-sm sm:max-w-md">
          <div className="p-2 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30 shrink-0">
            {isPdf ? <FileText className="h-5 w-5" /> : <Receipt className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-sm truncate text-slate-100" title={fileName}>
              {fileName}
            </h3>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-mono text-[10px] font-bold border border-slate-700">
                {isPdf ? 'PDF' : 'صورة فاتورة'}
              </span>
              {attachment.size && <span>الحجم: {attachment.size}</span>}
            </div>
          </div>
        </div>

        {/* Center: Image Controls (only relevant for images) */}
        {!isPdf && (
          <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700 shadow-inner">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              title="تصغير (-)"
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleReset}
              title="إعادة ضبط الحجم (0)"
              className="px-2 py-1 text-xs font-mono font-bold text-amber-400 hover:bg-slate-700 rounded-lg transition cursor-pointer"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= 3.5}
              title="تكبير (+)"
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <div className="h-4 w-[1px] bg-slate-700 mx-1" />
            <button
              type="button"
              onClick={handleRotate}
              title="تدوير الصورة 90 درجة"
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition cursor-pointer flex items-center gap-1 text-xs font-medium"
            >
              <RotateCw className="h-4 w-4" />
              <span className="hidden md:inline text-[11px]">تدوير</span>
            </button>
            {(zoom !== 1 || rotation !== 0) && (
              <button
                type="button"
                onClick={handleReset}
                title="إعادة ضبط الوضع الافتراضي"
                className="p-1.5 text-amber-300 hover:bg-slate-700 rounded-lg transition cursor-pointer"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* Actions (Open External, Download, Close) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenExternal}
            disabled={actionsDisabled}
            title="فتح المستند في تبويب جديد بدون حجب"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition border border-slate-700 cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">تبويب جديد ↗</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={actionsDisabled}
            title="تحميل نسخة من الفاتورة إلى جهازك"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            <span>تحميل</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            title="إغلاق المعاينة (Esc)"
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer border border-transparent hover:border-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Main Document Display Area */}
      <div 
        className="flex-1 overflow-auto flex items-center justify-center p-4 sm:p-8 cursor-default"
        onClick={(e) => {
          // If clicking the empty backdrop around the document, close
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        {isLoadingDoc ? (
          <div
            role="status"
            className="flex flex-col items-center gap-3 px-8 py-6 bg-slate-900/80 border border-slate-700 rounded-2xl text-slate-200 text-sm font-bold shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
            <span>جاري تحميل المستند...</span>
          </div>
        ) : loadError ? (
          <div
            role="alert"
            className="max-w-md flex flex-col items-center gap-3 px-6 py-6 bg-slate-900/90 border border-rose-500/40 rounded-2xl text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <AlertTriangle className="h-8 w-8 text-rose-400" />
            <p className="text-sm font-bold text-rose-100 leading-relaxed">{loadError}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl text-xs font-bold transition border border-slate-600 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>إعادة المحاولة</span>
            </button>
          </div>
        ) : isPdf ? (
          <div
            className="w-full max-w-4xl h-[82vh] bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col border border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <iframe
              ref={iframeRef}
              src={frameSrc}
              title={fileName}
              onLoad={handleIframeLoad}
              className="w-full flex-1 border-0"
            />
            <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-slate-300">
              <span>مستند بصيغة PDF</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleOpenExternal}
                  className="text-amber-400 hover:underline flex items-center gap-1 font-bold"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>فتح في نافذة كاملة</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div 
            className="relative flex items-center justify-center transition-transform duration-150 ease-out"
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              transformOrigin: 'center center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={displaySrc}
              alt={fileName}
              className="max-h-[82vh] max-w-[90vw] object-contain rounded-2xl shadow-2xl border border-slate-700/80 bg-white/5 select-none"
              draggable={false}
            />
          </div>
        )}
      </div>

      {/* Bottom hint for user experience */}
      <div 
        className="py-1.5 px-4 bg-slate-900/60 border-t border-slate-800/60 text-center text-[11px] text-slate-400 shrink-0 pointer-events-none"
      >
        {isPdf ? (
          <span>💡 اضغط <strong>Esc</strong> أو زر <strong>✕</strong> لإغلاق المعاينة فقط (تبقى النافذة التي خلفها كما هي) • للبحث والتنقل بلوحة المفاتيح داخل الملف استخدم «فتح في نافذة كاملة»</span>
        ) : (
          <span>💡 اضغط <strong>Esc</strong> لإغلاق المعاينة فقط • استخدم <strong>+</strong> و <strong>-</strong> للتكبير والتصغير • المستند محفوظ بشكل دائم</span>
        )}
      </div>
    </div>
  );
};
