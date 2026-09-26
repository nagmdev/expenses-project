import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  RotateCcw, 
  Download, 
  ExternalLink, 
  FileText, 
  Receipt,
  Maximize2
} from 'lucide-react';
import { openFileSafely, downloadFileSafely, dataUrlToBlob } from '../utils/fileUpload';

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

export const InvoiceViewerModal: React.FC<InvoiceViewerModalProps> = ({ attachment, onClose }) => {
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);

  // Reset zoom & rotation when attachment changes
  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [attachment?.url]);

  // Keyboard shortcut support: Esc to close, +, -, 0
  useEffect(() => {
    if (!attachment) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
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
  }, [attachment, onClose]);

  // Generate safe blob URL for PDFs if using base64 data URL
  const pdfBlobUrl = useMemo(() => {
    if (!attachment?.url) return '';
    const isPdf = attachment.type === 'pdf' || 
      (attachment.name && attachment.name.toLowerCase().endsWith('.pdf')) ||
      attachment.url.startsWith('data:application/pdf');
    
    if (isPdf && attachment.url.startsWith('data:')) {
      try {
        const blob = dataUrlToBlob(attachment.url);
        return URL.createObjectURL(blob);
      } catch (e) {
        console.error('Failed to convert PDF data URL to blob:', e);
      }
    }
    return attachment.url;
  }, [attachment?.url, attachment?.type, attachment?.name]);

  // Clean up blob URL on unmount or URL change
  useEffect(() => {
    return () => {
      if (pdfBlobUrl && pdfBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [pdfBlobUrl]);

  if (!attachment || !attachment.url) return null;

  const safeUrl = attachment.url;
  const fileName = attachment.name || 'مستند_الفاتورة';
  const isPdf = attachment.type === 'pdf' || 
    (attachment.name && attachment.name.toLowerCase().endsWith('.pdf')) ||
    safeUrl.startsWith('data:application/pdf');

  const handleZoomIn = () => setZoom(prev => Math.min(Number((prev + 0.25).toFixed(2)), 3.5));
  const handleZoomOut = () => setZoom(prev => Math.max(Number((prev - 0.25).toFixed(2)), 0.5));
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };

  const handleOpenExternal = () => {
    if (safeUrl) openFileSafely(safeUrl, fileName);
  };

  const handleDownload = () => {
    if (safeUrl) downloadFileSafely(safeUrl, fileName);
  };

  return (
    <div 
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-200 select-none"
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
            title="فتح المستند في تبويب جديد بدون حجب"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition border border-slate-700 cursor-pointer shadow-2xs"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">تبويب جديد ↗</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            title="تحميل نسخة من الفاتورة إلى جهازك"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
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
        {isPdf ? (
          <div 
            className="w-full max-w-4xl h-[82vh] bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col border border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <iframe
              src={pdfBlobUrl}
              title={fileName}
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
              src={attachment.url}
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
        <span>💡 اضغط <strong>Esc</strong> للإغلاق • استخدم <strong>+</strong> و <strong>-</strong> للتكبير والتصغير • المستند محفوظ بشكل دائم</span>
      </div>
    </div>
  );
};
