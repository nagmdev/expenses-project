import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Ban, CheckCircle2, Clock, DatabaseBackup, Download, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { can } from '../utils/permissions';
import { showToast } from '../utils/toast';
import { BackupCancelledError, backupSteps, saveBackupFile, type BackupStep } from '../lib/backupExport';
import type { BackupSkipped } from '../utils/backupFormat';

interface ExportResult {
  fileName: string;
  total: number;
  skipped: BackupSkipped[];
  redactedCount: number;
  includeSecrets: boolean;
}

/**
 * Platform owner: «تصدير نسخة احتياطية». The Spark plan has no managed backups, so every
 * collection is read fresh from the server and downloaded as one JSON file (read-only).
 * Restore is a manual procedure: docs/06-security-rules-deploy.md → Backups.
 */
export const BackupExportCard: React.FC = () => {
  const { currentRole, exportBackup } = useApp();
  const guard = useSubmitGuard();
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [steps, setSteps] = useState<BackupStep[]>([]);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [feedback, setFeedback] = useState<{ msg: string; isError?: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Leaving the page stops a running export (nothing to undo: it only reads).
  useEffect(() => () => abortRef.current?.abort(), []);

  if (!can(currentRole, 'platformSettings')) return null;

  const handleExport = () => {
    if (includeSecrets && !window.confirm(
      'سيحتوي الملف على المفاتيح السرية كما هي (مفتاح مزود البريد أو كلمة مرور التطبيق، وروابط Webhook). أي شخص يحصل على الملف يستطيع استخدامها. متابعة؟'
    )) return;
    void guard.run(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setResult(null);
      setFeedback(null);
      setSteps(backupSteps(includeAttachments));
      try {
        const file = await exportBackup(
          { includeAttachments, includeSecrets, signal: controller.signal },
          step => setSteps(prev => prev.map(s => (s.name === step.name ? step : s))),
        );
        const fileName = saveBackupFile(file);
        const total = Object.values(file.collections).reduce((sum, docs) => sum + docs.length, 0);
        const failed = file.skipped.filter(s => s.failed);
        setResult({ fileName, total, skipped: file.skipped, redactedCount: file.redacted.length, includeSecrets: file.options.includeSecrets });
        showToast(
          failed.length
            ? `تم تنزيل النسخة (${total} مستند)، لكن تعذرت قراءة ${failed.length} مجموعة. راجع القائمة.`
            : `تم تنزيل النسخة الاحتياطية (${total} مستند).`,
          failed.length ? 'warning' : 'success',
        );
      } catch (err: any) {
        const cancelled = err instanceof BackupCancelledError;
        const msg = cancelled ? 'تم إلغاء التصدير، ولم يُنزَّل أي ملف.' : err?.message || 'تعذر تصدير النسخة الاحتياطية.';
        setFeedback({ msg, isError: !cancelled });
        showToast(msg, cancelled ? 'info' : 'error');
      } finally {
        abortRef.current = null;
      }
    });
  };

  const stepIcon = (s: BackupStep) =>
    s.state === 'reading' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
    : s.state === 'done' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
    : s.state === 'failed' ? <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
    : s.state === 'skipped' ? <Ban className="h-3.5 w-3.5 text-slate-400" />
    : <Clock className="h-3.5 w-3.5 text-slate-300" />;

  return (
    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
            <DatabaseBackup className="h-4 w-4 text-emerald-600" />
            <span>تصدير نسخة احتياطية</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
            خطة Firebase المجانية لا تشمل النسخ الاحتياطي التلقائي. يقرأ التصدير كل بيانات المنصة مباشرة من السحابة (مجموعة بعد مجموعة) وينزّلها في ملف JSON واحد احفظه في مكان آمن. القراءة فقط: لا يتغير شيء في قاعدة البيانات. كل مستند يُحسب قراءة واحدة من الحصة اليومية المجانية (50,000 قراءة).
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {guard.pending && (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              إلغاء
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={guard.pending}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            {guard.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span>{guard.pending ? 'جارٍ التصدير...' : 'تصدير'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="flex items-start gap-2 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer">
          <input
            type="checkbox"
            checked={includeAttachments}
            disabled={guard.pending}
            onChange={e => setIncludeAttachments(e.target.checked)}
            className="h-4 w-4 mt-0.5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
          />
          <span>
            <span className="block text-xs font-bold text-slate-800">تضمين المرفقات</span>
            <span className="block text-[11px] text-slate-500 mt-0.5">الفواتير والمستندات نفسها. الملف يكبر كثيراً (حتى 10 ميجابايت لكل مرفق) ويستهلك قراءات أكثر.</span>
          </span>
        </label>
        <label className={`flex items-start gap-2 p-3 border rounded-xl cursor-pointer ${includeSecrets ? 'bg-rose-50 border-rose-300' : 'bg-white border-slate-200'}`}>
          <input
            type="checkbox"
            checked={includeSecrets}
            disabled={guard.pending}
            onChange={e => setIncludeSecrets(e.target.checked)}
            className="h-4 w-4 mt-0.5 text-rose-600 rounded border-slate-300 focus:ring-rose-500 cursor-pointer"
          />
          <span>
            <span className="block text-xs font-bold text-slate-800">تضمين المفاتيح السرية</span>
            <span className={`block text-[11px] mt-0.5 ${includeSecrets ? 'text-rose-700 font-bold' : 'text-slate-500'}`}>
              {includeSecrets
                ? 'تحذير: سيحتوي الملف على مفاتيح مزود البريد وكلمات مرور التطبيقات وروابط Webhook كما هي. لا ترسله لأحد واحذفه بعد الاستعادة.'
                : 'افتراضياً تُخفى الحقول السرية (مفاتيح API، كلمات المرور، روابط Webhook) في الملف، وتُدخل يدوياً بعد أي استعادة.'}
            </span>
          </span>
        </label>
      </div>

      {steps.length > 0 && (
        <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 bg-white border border-slate-200 rounded-xl">
          {steps.map(s => (
            <li key={s.name} className="px-3 py-1.5 text-[11px] flex items-center gap-2">
              {stepIcon(s)}
              <span className="font-bold text-slate-800">{s.label}</span>
              <span dir="ltr" className="font-mono text-slate-400">{s.name}</span>
              <span className="mr-auto font-mono text-slate-700">{s.state === 'waiting' ? '—' : s.count.toLocaleString('en-US')}</span>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <div className="space-y-2">
          <div className="p-3 rounded-xl text-xs font-bold flex items-center gap-2 bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              تم تنزيل <span dir="ltr" className="font-mono">{result.fileName}</span>: {result.total.toLocaleString('en-US')} مستند.
              {result.includeSecrets
                ? ' المفاتيح السرية مضمنة في الملف.'
                : result.redactedCount > 0 ? ` أُخفي ${result.redactedCount} حقل سري.` : ''}
            </span>
          </div>
          {result.skipped.length > 0 && (
            <div className="p-3 rounded-xl text-[11px] bg-amber-50 text-amber-900 border border-amber-200 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>لم يُضمَّن في الملف:</span>
              </div>
              <ul className="space-y-0.5">
                {result.skipped.map((s, i) => (
                  <li key={`${s.name}-${i}`} className={s.failed ? 'text-rose-700 font-bold' : ''}>
                    <span dir="ltr" className="font-mono">{s.name}</span>: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {feedback && (
        <div className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${
          feedback.isError ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-slate-100 text-slate-700 border border-slate-200'
        }`}>
          {feedback.isError ? <AlertCircle className="h-4 w-4 shrink-0" /> : <Ban className="h-4 w-4 shrink-0" />}
          <span>{feedback.msg}</span>
        </div>
      )}
    </div>
  );
};
