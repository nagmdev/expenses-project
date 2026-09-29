import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Upload, DatabaseBackup, Loader2, X, CheckCircle2, ChevronDown, ChevronUp, RefreshCw, Archive } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getDb } from '../lib/firebase';
import { createFirestoreStore } from '../domain/firestoreStore';
import {
  buildBackupFile,
  checkRecord,
  readBackupFile,
  readLegacySnapshot,
  restoreBlock,
  restoreRecord,
  type BlockReason,
  type LegacyRecord,
  type LegacyStoreSnapshot,
  type RecordStatus,
  type RestoreContext,
  type RestoreOutcome,
} from '../domain/legacyRecovery';

// Per-browser, per-SESSION snooze of the banner (the legacy data itself is never deleted).
const SNOOZE_KEY = 'expenses_legacy_recovery_snoozed';

/** Opens the recovery dialog from anywhere (e.g. the Settings page), even without local data. */
export const OPEN_LEGACY_RECOVERY_EVENT = 'masrofy:open-legacy-recovery';
export const openLegacyRecovery = () => window.dispatchEvent(new Event(OPEN_LEGACY_RECOVERY_EVENT));

const readLocal = (): LegacyStoreSnapshot[] => {
  try {
    return readLegacySnapshot(k => localStorage.getItem(k));
  } catch {
    return [];
  }
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, cancelled: () => boolean): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !cancelled()) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const OUTCOME_LABEL: Record<RestoreOutcome, string> = {
  restored: 'تم الاسترجاع',
  exists: 'موجود بالفعل (لم يُعدّل)',
  handled: 'استُرجع سابقاً',
  duplicate: 'يوجد سجل آخر بنفس الاسم/الكود',
  failed: 'فشل',
  backup_only: 'نسخة احتياطية فقط',
  needs_owner: 'يحتاج المشرف العام',
  other_org: 'تابع لشركة أخرى',
  no_permission: 'ليس لديك صلاحية',
};

const BLOCK_NOTE: Record<Exclude<BlockReason, 'backup_only'>, string> = {
  needs_owner: 'حالته ليست "قيد المراجعة" — يسترجعه المشرف العام فقط',
  other_org: 'تابع لشركة أخرى',
  no_permission: 'يتطلب صلاحية مدير الشركة',
};

const statusKey = (r: LegacyRecord) => `${r.store.collection}/${r.id}`;

/**
 * Banner + dialog to recover records the old app version kept only in this browser
 * (or in a backup file exported from another browser). Only creates missing documents.
 */
export const LegacyDataRecovery: React.FC = () => {
  const { firebaseUser, currentUser, currentRole, effectiveOrgId, superAdminNeedsVerification } = useApp();
  const [localSnapshot] = useState<LegacyStoreSnapshot[]>(readLocal);
  const [snapshot, setSnapshot] = useState<LegacyStoreSnapshot[]>(localSnapshot);
  const [source, setSource] = useState<'browser' | 'file'>('browser');
  const [snoozed, setSnoozed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(SNOOZE_KEY) === '1'; } catch { return false; }
  });
  const [open, setOpen] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, RecordStatus>>({});
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Record<string, Partial<Record<RestoreOutcome, number>>> | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const busyRef = useRef(false);
  const scanRunRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const ctx: RestoreContext = {
    actor: { id: currentUser.id, name: currentUser.name, email: currentUser.email, role: currentRole },
    orgId: effectiveOrgId,
  };
  const localCount = useMemo(() => localSnapshot.reduce((n, s) => n + s.records.length, 0), [localSnapshot]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_LEGACY_RECOVERY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_LEGACY_RECOVERY_EVENT, onOpen);
  }, []);

  const scan = useCallback(async (snap: LegacyStoreSnapshot[]) => {
    const db = getDb();
    if (!db) {
      setScanError('قاعدة البيانات غير متصلة، لا يمكن الفحص الآن. يمكنك تنزيل نسخة احتياطية والمحاولة لاحقاً.');
      return;
    }
    const run = ++scanRunRef.current;
    setScanning(true);
    setScanError(null);
    setResults(null);
    setFailures([]);
    setStatuses({});
    setScannedAt(null);
    try {
      const store = createFirestoreStore(db);
      const all = snap.flatMap(s => s.records);
      // Per-record errors become an 'error' status; one bad record never hides the rest.
      const found = await mapLimit(all, 6, async rec => [statusKey(rec), await checkRecord(store, rec)] as const, () => run !== scanRunRef.current);
      if (run !== scanRunRef.current) return;
      const map = Object.fromEntries(found.filter(Boolean));
      setStatuses(map);
      setScannedAt(Date.now());
      setSelected(Object.fromEntries(snap.map(s => [
        s.store.key,
        Boolean(s.store.likelyLocalOnly) && s.records.some(r => map[statusKey(r)] === 'missing'),
      ])));
    } catch (err: any) {
      if (run === scanRunRef.current) setScanError(err?.message || 'تعذر فحص قاعدة البيانات.');
    } finally {
      if (run === scanRunRef.current) setScanning(false);
    }
  }, []);

  // Auto-scan once when the dialog opens with data that has not been scanned yet.
  useEffect(() => {
    if (open && snapshot.length && scannedAt === null && !scanning && !scanError) void scan(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, snapshot]);

  // Dialog accessibility: focus on open, Escape closes (unless a restore is running).
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const downloadBackup = (snap: LegacyStoreSnapshot[], from: 'browser' | 'file') => {
    const text = buildBackupFile(snap, {
      exportedAt: new Date().toISOString(),
      origin: window.location.origin,
      exportedBy: currentUser.email,
      source: from,
    });
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `masrofy-local-backup-${from}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const importFile = async (file: File) => {
    try {
      const snap = readBackupFile(await file.text());
      if (!snap.length) {
        setScanError('الملف لا يحتوي على سجلات قابلة للاسترجاع.');
        return;
      }
      setSource('file');
      setSnapshot(snap);
      await scan(snap);
    } catch (err: any) {
      setScanError(err?.message || 'تعذر قراءة الملف.');
    }
  };

  const backToBrowser = () => {
    setSource('browser');
    setSnapshot(localSnapshot);
    if (localSnapshot.length) void scan(localSnapshot);
    else {
      setStatuses({});
      setScannedAt(null);
    }
  };

  const restorable = (r: LegacyRecord) => statuses[statusKey(r)] === 'missing' && !restoreBlock(ctx, r);
  const toRestore = useMemo(
    () => snapshot.filter(s => selected[s.store.key]).flatMap(s => s.records.filter(restorable)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, selected, statuses, currentRole, effectiveOrgId, currentUser.id]
  );

  const restoreSelected = async () => {
    const db = getDb();
    if (!db || busyRef.current || toRestore.length === 0) return;
    busyRef.current = true;
    setRestoring(true);
    setProgress({ done: 0, total: toRestore.length });
    const store = createFirestoreStore(db);
    const summary: Record<string, Partial<Record<RestoreOutcome, number>>> = {};
    const failed: string[] = [];
    try {
      let done = 0;
      for (const rec of toRestore) {
        const res = await restoreRecord(store, ctx, rec, source);
        const bucket = (summary[rec.store.key] ||= {});
        bucket[res.outcome] = (bucket[res.outcome] || 0) + 1;
        if (res.outcome === 'failed') failed.push(`${rec.store.label}: ${rec.title} — ${res.error}`);
        if (res.outcome === 'restored' || res.outcome === 'handled') setStatuses(prev => ({ ...prev, [statusKey(rec)]: 'handled' }));
        if (res.outcome === 'exists') setStatuses(prev => ({ ...prev, [statusKey(rec)]: 'exists' }));
        setProgress({ done: ++done, total: toRestore.length });
      }
    } finally {
      setResults(summary);
      setFailures(failed);
      busyRef.current = false;
      setRestoring(false);
    }
  };

  if (!firebaseUser) return null;
  const showBanner = localCount > 0 && !snoozed && !open;

  return (
    <>
      {showBanner && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="font-semibold">
              وُجدت {localCount.toLocaleString()} سجل من النسخة القديمة محفوظة على هذا المتصفح. بعضها قد لا يكون وصل لقاعدة البيانات (خصوصاً طلبات التأشيرات) — راجعها واسترجع الناقص.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setOpen(true)} className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-[11px] transition cursor-pointer">
              مراجعة واسترجاع
            </button>
            <button type="button" onClick={() => downloadBackup(localSnapshot, 'browser')} className="px-3 py-1 bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 rounded-lg font-bold text-[11px] transition cursor-pointer">
              تنزيل نسخة احتياطية
            </button>
            <button
              type="button"
              onClick={() => { setSnoozed(true); try { sessionStorage.setItem(SNOOZE_KEY, '1'); } catch {} }}
              className="text-amber-700 hover:text-amber-900 p-1 rounded-md hover:bg-amber-100 transition cursor-pointer"
              title="إخفاء حتى الجلسة القادمة (البيانات لا تُحذف)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="legacy-recovery-title">
          <div ref={dialogRef} tabIndex={-1} className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] shadow-2xl border border-slate-100 flex flex-col overflow-hidden my-auto outline-none">
            <div className="shrink-0 flex items-center justify-between p-4 sm:p-5 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <DatabaseBackup className="h-5 w-5" />
                </div>
                <div>
                  <h3 id="legacy-recovery-title" className="text-base font-black text-slate-900">استرجاع البيانات المحفوظة محلياً</h3>
                  <p className="text-[11px] text-slate-500">
                    {source === 'file' ? 'المصدر: ملف نسخة احتياطية' : 'المصدر: هذا المتصفح'} — يتم إنشاء السجلات الناقصة فقط، ولا يُعدَّل أو يُحذف أي سجل موجود.
                  </p>
                </div>
              </div>
              <button type="button" disabled={restoring} onClick={() => setOpen(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 cursor-pointer disabled:opacity-50" title="إغلاق">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
              {superAdminNeedsVerification && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>فعّل بريدك أولاً (صلاحية المشرف العام)، وإلا سترفض قاعدة البيانات الفحص والاسترجاع. يمكنك تنزيل نسخة احتياطية الآن.</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => downloadBackup(snapshot, source)} disabled={!snapshot.length} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer">
                  <Download className="h-3.5 w-3.5" /> تنزيل نسخة احتياطية (JSON)
                </button>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={restoring || scanning} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer">
                  <Upload className="h-3.5 w-3.5" /> استيراد من ملف نسخة احتياطية
                </button>
                <button type="button" onClick={() => void scan(snapshot)} disabled={restoring || scanning || !snapshot.length} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer">
                  <RefreshCw className="h-3.5 w-3.5" /> إعادة الفحص
                </button>
                {source === 'file' && (
                  <button type="button" onClick={backToBrowser} disabled={restoring || scanning} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl font-bold cursor-pointer">
                    الرجوع لبيانات هذا المتصفح
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void importFile(f);
                  }}
                />
              </div>

              {scanError && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{scanError}</div>}

              {!snapshot.length && !scanError && (
                <div className="p-6 text-center text-slate-500">لا توجد بيانات قديمة على هذا المتصفح. يمكنك استيراد ملف نسخة احتياطية من جهاز آخر.</div>
              )}

              {scanning && (
                <div className="flex items-center gap-2 text-slate-600 font-semibold">
                  <Loader2 className="h-4 w-4 animate-spin" /> جاري مقارنة السجلات بقاعدة البيانات...
                </div>
              )}

              {!scanning && scannedAt !== null && snapshot.map(s => {
                const count = (st: RecordStatus) => s.records.filter(r => statuses[statusKey(r)] === st).length;
                const missing = s.records.filter(r => statuses[statusKey(r)] === 'missing');
                const canDo = missing.filter(r => !restoreBlock(ctx, r));
                const blocked = missing
                  .map(r => restoreBlock(ctx, r))
                  .filter((b): b is Exclude<BlockReason, 'backup_only'> => Boolean(b) && b !== 'backup_only');
                const res = results?.[s.store.key];
                const resOk = res && !res.failed && !res.duplicate;
                const isBackup = s.store.mode === 'backup';
                return (
                  <div key={s.store.key} className={`border rounded-2xl p-3 ${isBackup ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between gap-3">
                      {isBackup ? (
                        <span className="flex items-center gap-2 font-bold text-slate-700">
                          <Archive className="h-3.5 w-3.5 text-slate-500" /> {s.store.label}
                          <span className="font-normal text-slate-500">({s.records.length} محلياً — نسخة احتياطية فقط)</span>
                        </span>
                      ) : (
                        <label className="flex items-center gap-2 font-bold text-slate-900 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={canDo.length === 0 || restoring}
                            checked={Boolean(selected[s.store.key]) && canDo.length > 0}
                            onChange={e => setSelected(prev => ({ ...prev, [s.store.key]: e.target.checked }))}
                          />
                          {s.store.label}
                          <span className="font-normal text-slate-500">({s.records.length} محلياً)</span>
                        </label>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className={`px-2 py-0.5 rounded-full ${missing.length ? 'bg-amber-100 text-amber-800 font-bold' : 'bg-slate-100 text-slate-500'}`}>ناقص: {missing.length}</span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">موجود: {count('exists')}</span>
                        {count('handled') > 0 && <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">استُرجع سابقاً: {count('handled')}</span>}
                        {count('no_access') > 0 && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">بدون صلاحية: {count('no_access')}</span>}
                        {count('error') > 0 && <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">تعذر الفحص: {count('error')}</span>}
                      </div>
                    </div>
                    {isBackup && missing.length > 0 && (
                      <p className="mt-2 text-[11px] text-slate-500">{s.store.backupReason} يتم الاحتفاظ بها في ملف النسخة الاحتياطية فقط لمراجعتها يدوياً.</p>
                    )}
                    {!isBackup && missing.length > 0 && !s.store.likelyLocalOnly && (
                      <p className="mt-2 text-[11px] text-slate-500">تنبيه: سجل ناقص هنا قد يكون حُذف عمداً من جهاز آخر. راجع القائمة قبل الاسترجاع.</p>
                    )}
                    {blocked.length > 0 && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        لن يُسترجع {blocked.length}: {Array.from(new Set(blocked)).map(b => BLOCK_NOTE[b]).join('، ')}.
                      </p>
                    )}
                    {res && (
                      <p className={`mt-2 text-[11px] font-semibold flex items-center gap-1 ${resOk ? 'text-slate-700' : 'text-rose-700'}`}>
                        {resOk ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />}
                        {Object.entries(res).map(([k, n]) => `${OUTCOME_LABEL[k as RestoreOutcome]}: ${n}`).join(' | ')}
                      </p>
                    )}
                    {missing.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setExpanded(prev => ({ ...prev, [s.store.key]: !prev[s.store.key] }))}
                          className="mt-2 text-[11px] text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                        >
                          {expanded[s.store.key] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          عرض السجلات الناقصة
                        </button>
                        {expanded[s.store.key] && (
                          <ul className="mt-2 max-h-48 overflow-y-auto space-y-1 text-[11px] text-slate-700 bg-slate-50 rounded-xl p-2">
                            {missing.slice(0, 200).map(r => <li key={r.id} className="truncate">• {r.title}</li>)}
                            {missing.length > 200 && <li className="text-slate-400">... و{missing.length - 200} سجل آخر</li>}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {failures.length > 0 && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 space-y-1">
                  <div className="font-bold">تعذر استرجاع {failures.length} سجل:</div>
                  {failures.slice(0, 20).map((f, i) => <div key={i} className="text-[11px] break-words">{f}</div>)}
                  {failures.length > 20 && <div className="text-[11px]">... و{failures.length - 20} أخرى</div>}
                </div>
              )}
            </div>

            <div className="shrink-0 flex items-center justify-between gap-3 p-4 border-t border-slate-100">
              <span className="text-[11px] text-slate-500">
                {restoring ? `جاري الاسترجاع ${progress.done}/${progress.total}...` : `سيتم إنشاء ${toRestore.length} سجل ناقص فقط.`}
              </span>
              <button
                type="button"
                disabled={restoring || scanning || toRestore.length === 0}
                onClick={() => void restoreSelected()}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-bold flex items-center gap-2 cursor-pointer"
              >
                {restoring && <Loader2 className="h-4 w-4 animate-spin" />}
                استرجاع السجلات الناقصة المحددة ({toRestore.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
