import React, { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Download, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { showToast } from '../utils/toast';
import { formatLocalDateTime, localToday } from '../utils/requestUi';
import {
  CONSISTENCY_CHECKS,
  CONSISTENCY_CHECK_LABELS,
  CONSISTENCY_COLLECTION_LABELS,
  consistencyIssuesToCsv,
  type ConsistencySeverity,
} from '../domain/reconciliation';

type SeverityFilter = 'all' | ConsistencySeverity;

/** Rows drawn in the table; the CSV export always carries every issue. */
const MAX_ROWS = 300;

const money = (v: number | string | null) =>
  v === null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v;

/**
 * Platform owner: "فحص سلامة الحسابات" — re-derives every balance and counter from the
 * records that justify it (src/domain/reconciliation.ts). READ-ONLY: it reads fresh from the
 * database and never writes; any fix goes through the normal, audited operations.
 */
export const FinancialConsistencyCheck: React.FC = () => {
  const { runFinancialConsistencyCheck, consistencyCheck, allOrganizations } = useApp();
  const guard = useSubmitGuard();
  const [filter, setFilter] = useState<SeverityFilter>('all');

  // Its state lives in the app context: leaving Settings mid-run and coming back still shows it.
  const pending = Boolean(consistencyCheck?.pending) || guard.pending;
  const report = consistencyCheck?.result;
  const progress = consistencyCheck?.progress;
  const orgName = (orgId: string) => allOrganizations.find(o => o.id === orgId)?.name || orgId || '—';

  const visible = useMemo(
    () => (report ? report.issues.filter(i => filter === 'all' || i.severity === filter) : []),
    [report, filter],
  );
  // A check skipped for an unreadable collection is not "matching": never show the all-clear then.
  const incomplete = Boolean(report && report.unreadable.length > 0);

  const handleRun = () => {
    if (consistencyCheck?.pending) return;
    void guard.run(async () => {
      try {
        const result = await runFinancialConsistencyCheck();
        if (result.violations > 0) {
          showToast(`انتهى الفحص: ${result.violations} مخالفة و${result.warnings} تحذير. راجع الجدول.`, 'error', 7000);
        } else if (result.warnings > 0) {
          showToast(`انتهى الفحص بدون مخالفات، مع ${result.warnings} تحذير (فروق تاريخية من بيانات قديمة).`, 'warning', 6000);
        } else if (result.unreadable.length > 0) {
          showToast('انتهى الفحص بدون مشاكل، لكن تعذرت قراءة بعض المجموعات؛ راجع التفاصيل.', 'warning', 6000);
        } else {
          showToast('انتهى الفحص: كل الأرصدة والعدادات مطابقة لسجلاتها.', 'success');
        }
      } catch (err: any) {
        showToast(err?.message || 'تعذر تشغيل فحص سلامة الحسابات.', 'error');
      }
    });
  };

  const handleExport = () => {
    if (!report || visible.length === 0) return;
    const csv = consistencyIssuesToCsv(visible, orgName);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `فحص_سلامة_الحسابات_${localToday()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-extrabold text-slate-900">فحص سلامة الحسابات</div>
          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
            يعيد حساب أرصدة الخزائن من دفتر الحركات، ويطابق كل طلب مصروف مع قيده، والمنصرف على البنود والمدفوع للموردين مع الطلبات المصروفة، وأرصدة العهد مع فواتير تسويتها،
            لكل الشركات. الفحص للقراءة فقط ولا يغيّر أي بيانات، ويقرأ كل السجلات من قاعدة البيانات مباشرة (يستهلك قراءات بعدد السجلات).
            شغّله في وقت لا تُنفَّذ فيه عمليات صرف أو تحويل؛ وإن ظهرت مخالفة لعملية تمت أثناء الفحص فأعد الفحص للتأكد منها قبل أي إجراء.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={pending}
          className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          <span>
            {pending
              ? progress
                ? `جارٍ القراءة... (${progress.done}/${progress.total})`
                : 'جارٍ الفحص...'
              : report
              ? 'إعادة الفحص'
              : 'تشغيل الفحص'}
          </span>
        </button>
      </div>

      {consistencyCheck?.error && !pending && (
        <div className="p-3 rounded-xl text-xs font-bold flex items-center gap-2 bg-rose-50 text-rose-800 border border-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{consistencyCheck.error}</span>
        </div>
      )}

      {report && (
        <div className="space-y-3">
          {/* Overall result */}
          <div
            className={`p-3 rounded-xl text-xs font-bold flex flex-wrap items-center gap-2 border ${
              report.violations > 0
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : report.warnings > 0 || incomplete
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
            }`}
          >
            {report.violations > 0 ? (
              <XCircle className="h-4 w-4 shrink-0" />
            ) : report.warnings > 0 || incomplete ? (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span>
              {report.violations > 0
                ? `${report.violations} مخالفة تحتاج مراجعة`
                : incomplete
                ? 'لا توجد مخالفات فيما تم فحصه (بعض الفحوص لم تُنفذ)'
                : report.warnings > 0
                ? 'لا توجد مخالفات'
                : 'كل الأرصدة والعدادات مطابقة لسجلاتها'}
              {report.warnings > 0 ? ` · ${report.warnings} تحذير (فرق تاريخي من بيانات سابقة لدفتر الحركات)` : ''}
            </span>
            <span className="font-normal text-[11px] opacity-80 ms-auto">آخر فحص: {formatLocalDateTime(report.checkedAt)}</span>
          </div>

          {report.unreadable.length > 0 && (
            <div className="p-3 rounded-xl text-[11px] bg-amber-50 text-amber-900 border border-amber-200 space-y-1">
              <div className="font-extrabold">تعذرت قراءة بعض المجموعات، فتم تخطي الفحوص التي تعتمد عليها:</div>
              <ul className="list-disc ps-5">
                {report.unreadable.map(u => (
                  <li key={u.collection}>
                    {CONSISTENCY_COLLECTION_LABELS[u.collection]} <span dir="ltr" className="font-mono">({u.collection})</span>: {u.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Summary per check */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {CONSISTENCY_CHECKS.map(def => {
              const t = report.totals[def.kind];
              return (
                <div key={def.kind} className="p-3 bg-white border border-slate-200 rounded-xl">
                  <div className="text-[11px] font-bold text-slate-800 leading-snug">{def.label}</div>
                  {t.skipped ? (
                    <div className="text-[11px] text-slate-400 mt-1">لم يُفحص (تعذرت قراءة: {t.missing.map(c => CONSISTENCY_COLLECTION_LABELS[c]).join('، ')})</div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[11px]">
                      <span className="text-slate-500">فُحص {t.checked.toLocaleString('en-US')} سجل</span>
                      {t.violations > 0 && <span className="px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-800 font-bold">{t.violations} مخالفة</span>}
                      {t.warnings > 0 && <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold">{t.warnings} تحذير</span>}
                      {t.violations === 0 && t.warnings === 0 && (
                        <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> مطابق
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Issues */}
          {report.issues.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ['all', `الكل (${report.issues.length})`],
                    ['violation', `المخالفات (${report.violations})`],
                    ['warning', `التحذيرات (${report.warnings})`],
                  ] as Array<[SeverityFilter, string]>
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                      filter === value ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {text}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={visible.length === 0}
                  className="ms-auto flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-lg text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>تصدير CSV</span>
                </button>
              </div>

              <div className="max-h-[28rem] overflow-auto bg-white border border-slate-200 rounded-xl">
                <table className="w-full text-[11px] text-right">
                  <thead className="bg-slate-100 text-slate-600 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 font-bold">الخطورة</th>
                      <th className="px-2 py-2 font-bold">المشكلة</th>
                      <th className="px-2 py-2 font-bold">الشركة</th>
                      <th className="px-2 py-2 font-bold">السجل</th>
                      <th className="px-2 py-2 font-bold">المتوقع</th>
                      <th className="px-2 py-2 font-bold">الفعلي</th>
                      <th className="px-2 py-2 font-bold">الفرق</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-2 py-4 text-center text-slate-400">
                          لا توجد {filter === 'violation' ? 'مخالفات' : 'تحذيرات'} في نتيجة هذا الفحص.
                        </td>
                      </tr>
                    )}
                    {visible.slice(0, MAX_ROWS).map((issue, idx) => (
                      <tr key={`${issue.kind}_${issue.collection}_${issue.id}_${idx}`} className="align-top">
                        <td className="px-2 py-2 whitespace-nowrap">
                          {issue.severity === 'violation' ? (
                            <span className="px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-800 font-bold">مخالفة</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold">تحذير</span>
                          )}
                        </td>
                        <td className="px-2 py-2 min-w-[14rem]">
                          <div className="font-bold text-slate-900">{issue.label}</div>
                          <div className="text-slate-400">{CONSISTENCY_CHECK_LABELS[issue.kind]}</div>
                          {issue.detail && <div className="text-slate-500 mt-0.5 leading-relaxed">{issue.detail}</div>}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-slate-700">{issue.orgId ? orgName(issue.orgId) : '—'}</td>
                        <td className="px-2 py-2 min-w-[9rem]">
                          <div className="font-bold text-slate-800">{issue.entityName}</div>
                          <div className="text-slate-400">{CONSISTENCY_COLLECTION_LABELS[issue.collection]}</div>
                          <div dir="ltr" className="font-mono text-[10px] text-slate-400 break-all text-right">{issue.id}</div>
                        </td>
                        <td dir="ltr" className="px-2 py-2 whitespace-nowrap font-mono text-right text-slate-700">{money(issue.expected)}</td>
                        <td dir="ltr" className="px-2 py-2 whitespace-nowrap font-mono text-right text-slate-700">{money(issue.actual)}</td>
                        <td
                          dir="ltr"
                          className={`px-2 py-2 whitespace-nowrap font-mono font-bold text-right ${
                            issue.diff === null ? 'text-slate-400' : issue.diff > 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {issue.diff === null ? '—' : `${issue.diff > 0 ? '+' : ''}${money(issue.diff)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {visible.length > MAX_ROWS && (
                <p className="text-[11px] text-slate-500">
                  يُعرض أول {MAX_ROWS} من {visible.length} مشكلة؛ صدّر ملف CSV للاطلاع على الكل.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
