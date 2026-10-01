import React, { useEffect, useState } from 'react';
import { subscribeToast, ToastMessage } from '../utils/toast';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    return subscribeToast(toast => {
      setToasts(prev => [...prev, toast]);
      if (toast.duration && toast.duration > 0) {
        setTimeout(() => {
          setToasts(curr => curr.filter(t => t.id !== toast.id));
        }, toast.duration);
      }
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-5 left-5 z-9999 flex flex-col gap-2 max-w-md w-[calc(100%-2.5rem)] pointer-events-none"
      dir="rtl"
      role="region"
      aria-label="الإشعارات التنبيهية"
    >
      {toasts.map(toast => {
        let bg = 'bg-slate-900 text-white border-slate-700';
        let icon = <Info className="w-5 h-5 text-sky-400 shrink-0" />;

        if (toast.type === 'success') {
          bg = 'bg-emerald-950/95 text-emerald-100 border-emerald-700/60 shadow-emerald-950/40';
          icon = <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />;
        } else if (toast.type === 'error') {
          bg = 'bg-rose-950/95 text-rose-100 border-rose-700/60 shadow-rose-950/40';
          icon = <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />;
        } else if (toast.type === 'warning') {
          bg = 'bg-amber-950/95 text-amber-100 border-amber-700/60 shadow-amber-950/40';
          icon = <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />;
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2 duration-200 ${bg}`}
          >
            <div className="flex items-center gap-3">
              {icon}
              <p className="text-sm font-semibold whitespace-pre-line leading-relaxed">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setToasts(curr => curr.filter(t => t.id !== toast.id))}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition shrink-0"
              aria-label="إغلاق التنبيه"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
