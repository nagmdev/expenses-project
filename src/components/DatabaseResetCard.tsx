import React, { useState, useRef } from 'react';
import { 
  AlertTriangle, 
  Trash2, 
  CheckCircle2, 
  Loader2, 
  ShieldCheck, 
  X,
  RefreshCw,
  Info
} from 'lucide-react';
import { initFirebase } from '../lib/firebase';
import { 
  resetDatabaseCollections, 
  type ResetStepProgress, 
  type ResetSummary, 
  RESET_COLLECTIONS 
} from '../lib/databaseReset';

export const DatabaseResetCard: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [currentCollectionLabel, setCurrentCollectionLabel] = useState('');
  const [stepsProgress, setStepsProgress] = useState<ResetStepProgress[]>([]);
  const [result, setResult] = useState<ResetSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);

  const CONFIRMATION_KEYWORD = 'تصفير';

  const handleOpenModal = () => {
    setConfirmText('');
    setErrorMsg(null);
    setResult(null);
    setStepsProgress([]);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (isRunning) return; // Prevent closing while running
    setIsModalOpen(false);
    setConfirmText('');
  };

  const handleExecuteReset = async () => {
    if (confirmText.trim() !== CONFIRMATION_KEYWORD) return;

    setErrorMsg(null);
    setResult(null);
    setIsRunning(true);
    const abortCtrl = new AbortController();
    abortCtrlRef.current = abortCtrl;

    try {
      const { db } = initFirebase();
      if (!db) {
        throw new Error('قاعدة بيانات Firebase غير متصلة.');
      }

      const summary = await resetDatabaseCollections(
        db,
        (steps, currentCol) => {
          setStepsProgress(steps);
          const found = RESET_COLLECTIONS.find(c => c.name === currentCol);
          if (found) setCurrentCollectionLabel(found.label);
        },
        abortCtrl.signal
      );

      setResult(summary);
      if (!summary.success) {
        setErrorMsg(summary.error || 'حدث خطأ أثناء تصفير بعض المجموعات.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsRunning(false);
      abortCtrlRef.current = null;
    }
  };

  const handleCancelExecution = () => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
    }
  };

  const handleReloadPage = () => {
    try {
      localStorage.removeItem('expenses_active_org_id_v3');
      localStorage.setItem('expenses_active_tab_v3', 'dashboard');
    } catch {}
    window.location.reload();
  };

  const completedCount = stepsProgress.filter(s => s.status === 'completed').length;
  const totalCollections = RESET_COLLECTIONS.length;
  const progressPercent = totalCollections > 0 ? Math.round((completedCount / totalCollections) * 100) : 0;

  return (
    <div className="p-5 bg-rose-50/60 border border-rose-200 rounded-2xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-extrabold text-rose-950 flex items-center gap-2">
              <span>تصفير قاعدة البيانات (إعادة ضبط المصنع)</span>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-200 text-rose-800 rounded-full">
                منطقة الخطر
              </span>
            </div>
            <p className="text-xs text-rose-800/80 mt-1 leading-relaxed max-w-2xl">
              حذف كافة الشركات القديمة (مثل هوم، كايرو، تاي، طنطا)، الخزائن، الحركات المالية، طلبات الصرف والتأشيرات، والعهد والبنود —
              <strong> مع الاحتفاظ الكامل ببيانات المستخدمين والمشرفين وصلاحياتهم دون أي مساس</strong> حتى لا تضطر لإعادة إنشاء الحسابات.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpenModal}
          className="shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer"
        >
          <Trash2 className="h-4 w-4" />
          <span>تصفير قاعدة البيانات الآن</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
        <div className="p-3 bg-white/80 border border-rose-100 rounded-xl space-y-1">
          <div className="font-bold text-rose-900 flex items-center gap-1.5">
            <Trash2 className="h-3.5 w-3.5 text-rose-600" />
            <span>سيتم حذفها بالكامل (20 مجموعة):</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            الشركات، الخزائن والحسابات، القيود والعمليات، طلبات الصرف، طلبات التأشيرات، العهد والتسويات، البنود والخدمات، الموردين، الأقسام، المرفقات والملفات، سجلات التدقيق والبريد، والعدادات ومفاتيح التكرار.
          </p>
        </div>

        <div className="p-3 bg-white/80 border border-emerald-200 rounded-xl space-y-1">
          <div className="font-bold text-emerald-900 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>سيتم الإبقاء عليها بالكامل (محمية):</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            حسابات المستخدمين تسجيل الدخول (<code>users</code>)، سجل المشرفين العامين (<code>super_admins</code>)، الموظفون والصلاحيات (<code>members</code>)، وإعدادات النظام والبريد (<code>system_settings</code>).
          </p>
        </div>
      </div>

      {/* Confirmation & Execution Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-5 my-8 text-right">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-rose-600 font-extrabold text-base">
                <AlertTriangle className="h-5 w-5" />
                <span>تأكيد تصفير قاعدة البيانات</span>
              </div>
              {!isRunning && (
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            {!result?.success && !isRunning && (
              <div className="space-y-4">
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-900 leading-relaxed space-y-2">
                  <div className="font-extrabold flex items-center gap-1.5 text-rose-950">
                    <Info className="h-4 w-4 text-rose-600" />
                    <span>تنبيه هام جداً وغير قابل للتراجع:</span>
                  </div>
                  <p>
                    هذه العملية ستقوم بحذف جميع بيانات المعاملات المالية، الشركات، الخزائن، والطلبات، حتى تبدأ من الصفر تماماً.
                  </p>
                  <p className="font-semibold text-emerald-800">
                    ✓ ستبقى حسابات المستخدمين وصلاحياتهم محفوظة لتتمكن من تسجيل الدخول وإعادة إنشاء الشركات.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-800">
                    لتأكيد البدء، اكتب كلمة <strong className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded font-mono text-sm border border-rose-200">تصفير</strong> في الحقل التالي:
                  </label>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    placeholder="اكتب: تصفير"
                    className="w-full px-4 py-2.5 text-center text-sm font-bold border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 transition"
                  />
                </div>

                {errorMsg && (
                  <div className="p-3 bg-rose-100 border border-rose-300 rounded-xl text-xs text-rose-900 font-bold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-5 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
                  >
                    إلغاء وتراجع
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteReset}
                    disabled={confirmText.trim() !== CONFIRMATION_KEYWORD}
                    className="flex items-center gap-2 px-6 py-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>تأكيد وحذف البيانات</span>
                  </button>
                </div>
              </div>
            )}

            {isRunning && (
              <div className="space-y-4 py-4 text-center">
                <Loader2 className="h-10 w-10 text-rose-600 animate-spin mx-auto" />
                <div>
                  <h4 className="font-extrabold text-sm text-slate-900">جارٍ تصفير قاعدة البيانات...</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    المجموعة الحالية: <strong className="text-rose-600">{currentCollectionLabel || '...'}</strong>
                  </p>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                    <div 
                      className="bg-rose-600 h-full transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] font-mono text-slate-500">
                    <span>{completedCount} من {totalCollections} مجموعة</span>
                    <span>{progressPercent}%</span>
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-slate-50 text-[11px] text-right">
                  {stepsProgress.map(s => (
                    <div key={s.collection} className="px-3 py-1.5 flex items-center justify-between">
                      <span className="font-medium text-slate-700">{s.label}</span>
                      <span className="font-mono text-slate-500">
                        {s.status === 'completed' && <span className="text-emerald-600 font-bold">✓ ({s.deletedCount} مستند)</span>}
                        {s.status === 'in_progress' && <span className="text-amber-600 font-bold">جارٍ الحذف...</span>}
                        {s.status === 'pending' && <span className="text-slate-400">بانتظار...</span>}
                        {s.status === 'failed' && <span className="text-rose-600 font-bold">فشل!</span>}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleCancelExecution}
                  className="px-4 py-1.5 text-xs text-slate-500 hover:text-rose-600 transition"
                >
                  إيقاف مؤقت للعملية
                </button>
              </div>
            )}

            {result?.success && (
              <div className="space-y-4 py-3 text-center">
                <div className="h-14 w-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <div>
                  <h4 className="font-extrabold text-base text-slate-900">تم تصفير قاعدة البيانات بنجاح!</h4>
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                    تم حذف <strong>{result.totalDeleted} مستند</strong> بنجاح عبر كافة المجموعات التشغيلية.
                    <br />
                    حسابات المستخدمين والمشرفين بقيت محفوظة كما هي.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleReloadPage}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>تحديث والعودة للوحة التحكم (إنشاء الشركة الأولى)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
