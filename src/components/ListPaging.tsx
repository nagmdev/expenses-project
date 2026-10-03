import React from 'react';
import { ChevronDown, History, Loader2 } from 'lucide-react';
import { historyErrorMessage } from '../lib/pagination';

/** "عرض المزيد" under a progressively rendered list (useProgressiveList; nothing when every row is shown). */
export const ShowMoreButton: React.FC<{ remaining: number; noun: string; onClick: () => void; className?: string }> = ({
  remaining,
  noun,
  onClick,
  className = 'pt-2 text-center',
}) => {
  if (remaining <= 0) return null;
  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        className="w-full py-3 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-2xl border border-slate-200 shadow-2xs transition flex items-center justify-center gap-2 cursor-pointer active:scale-98"
      >
        <span>عرض المزيد (المتبقي: {remaining} {noun})</span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>
    </div>
  );
};

/**
 * Footer of a paged history list (ledger, audit log, email log): "تحميل المزيد" for the older
 * pages, the read error if any, or "كل السجلات معروضة" once everything is loaded.
 */
export const HistoryPagerFooter: React.FC<{
  history: { hasMore: boolean; loadingMore: boolean; loading: boolean; error: string | null; loadMore: () => Promise<void> };
  shown: number;
  noun: string;
  className?: string;
}> = ({ history, shown, noun, className = 'p-3 border-t border-slate-100 text-center space-y-2' }) => {
  const errorText = historyErrorMessage(history.error);
  // While the first page loads, the list itself says so (its empty state).
  if (history.loading && !errorText) return null;
  if (!history.hasMore && !errorText) {
    return shown > 0 ? (
      <div className={className}>
        <span className="text-[11px] text-slate-400 font-semibold">تم عرض كل {noun} ({shown})</span>
      </div>
    ) : null;
  }
  return (
    <div className={className}>
      {errorText && <p className="text-[11px] font-bold text-rose-600">{errorText}</p>}
      {history.hasMore && (
        <button
          type="button"
          onClick={() => void history.loadMore()}
          disabled={history.loadingMore}
          className="w-full py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-2xl border border-slate-200 shadow-2xs transition flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-60 disabled:cursor-wait"
        >
          {history.loadingMore ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <History className="h-4 w-4 text-slate-400" />}
          <span>{history.loadingMore ? 'جارٍ تحميل الأقدم...' : `تحميل المزيد من ${noun} الأقدم`}</span>
        </button>
      )}
    </div>
  );
};

