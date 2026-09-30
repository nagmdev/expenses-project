import React, { useMemo, useState } from 'react';
import { Building2, Lock, Search } from 'lucide-react';
import type { Organization } from '../types';

interface OrgMultiSelectProps {
  orgs: Array<Pick<Organization, 'id' | 'name' | 'code' | 'currency'>>;
  selected: string[];
  onChange: (orgIds: string[]) => void;
  label?: string;
  /** Companies that cannot be picked, with the reason shown on the chip (e.g. "مسجل بالفعل"). */
  unavailable?: Record<string, string>;
  /**
   * Companies that stay selected and cannot be unticked, with the reason shown on the chip
   * (e.g. the company that owns a shared service: it can never be dropped from the record).
   */
  locked?: Record<string, string>;
  /** Shown under the list when nothing is selected. */
  emptyHint?: string;
  disabled?: boolean;
}

/**
 * Company multi-selection (checkbox chips + select all + search), the same look as the
 * service-category form. Unavailable companies stay visible with their reason.
 * Selected ids that are not in `orgs` (a company this viewer cannot see, e.g. another
 * company a service is shared with) are kept untouched by every change made here.
 */
export const OrgMultiSelect: React.FC<OrgMultiSelectProps> = ({
  orgs,
  selected,
  onChange,
  label = 'الشركات التابع لها (تحديد متعدد) *',
  unavailable = {},
  locked = {},
  emptyHint = '* يرجى تحديد شركة واحدة على الأقل.',
  disabled = false,
}) => {
  const [query, setQuery] = useState('');
  const isListed = (orgId: string) => orgs.some(o => o.id === orgId);
  const isLocked = (orgId: string) => Boolean(locked[orgId]) && !unavailable[orgId];
  const selectable = useMemo(() => orgs.filter(o => !unavailable[o.id]), [orgs, unavailable]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter(o => o.name.toLowerCase().includes(q) || (o.code || '').toLowerCase().includes(q));
  }, [orgs, query]);
  const isChosen = (orgId: string) => isLocked(orgId) || (!unavailable[orgId] && selected.includes(orgId));
  const allSelected = selectable.length > 0 && selectable.every(o => isChosen(o.id));
  // Only companies that will actually receive the record count as selected.
  const selectedCount = orgs.filter(o => isChosen(o.id)).length;

  /** Every change keeps the locked companies and the selected companies this list does not show. */
  const emit = (listedIds: string[]) => {
    const outside = selected.filter(id => !isListed(id));
    const lockedIds = orgs.filter(o => isLocked(o.id)).map(o => o.id);
    onChange(Array.from(new Set([...outside, ...lockedIds, ...listedIds])));
  };

  const toggle = (orgId: string, checked: boolean) => {
    if (isLocked(orgId)) return;
    const listed = selected.filter(id => isListed(id));
    emit(checked ? [...listed, orgId] : listed.filter(id => id !== orgId));
  };

  return (
    <div className="bg-slate-50/70 p-3 rounded-2xl border border-slate-200/80">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="font-bold text-slate-700 flex items-center gap-1.5 text-xs">
          <Building2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <span>{label}</span>
        </label>
        {selectable.length > 1 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => emit(allSelected ? [] : selectable.map(o => o.id))}
            className="text-[11px] text-emerald-700 hover:text-emerald-800 font-bold hover:underline cursor-pointer disabled:opacity-50 shrink-0"
          >
            {allSelected ? 'إلغاء تحديد الكل' : 'تحديد كل الشركات'}
          </button>
        )}
      </div>

      {orgs.length > 6 && (
        <div className="relative mb-1.5">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter in the search box must never submit the surrounding add form.
              if (e.key !== 'Enter') return;
              e.preventDefault();
              // A single available match: Enter toggles it.
              const matches = visible.filter(o => !unavailable[o.id] && !isLocked(o.id));
              if (!disabled && matches.length === 1) toggle(matches[0].id, !selected.includes(matches[0].id));
            }}
            placeholder="ابحث باسم الشركة أو الكود..."
            className="w-full pr-8 pl-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 bg-white border border-slate-200 rounded-xl">
        {visible.map(org => {
          const reason = unavailable[org.id];
          const lockReason = isLocked(org.id) ? locked[org.id] : '';
          const isSelected = isChosen(org.id);
          return (
            <label
              key={org.id}
              title={reason || lockReason || undefined}
              className={`flex items-center gap-2 p-2 rounded-lg border text-xs font-semibold transition ${
                reason
                  ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                  : lockReason
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-bold cursor-default'
                  : isSelected
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-bold shadow-xs cursor-pointer'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100/70 cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={disabled || Boolean(reason) || Boolean(lockReason)}
                onChange={(e) => toggle(org.id, e.target.checked)}
                className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 min-w-0">
                  {lockReason && <Lock className="h-3 w-3 text-emerald-700 shrink-0" />}
                  <span className="truncate">{org.name}</span>
                </div>
                <span className="text-[10px] font-normal">
                  {reason ? (
                    <span className="text-amber-700 font-bold">{reason}</span>
                  ) : lockReason ? (
                    <span className="text-emerald-700 font-bold">{lockReason}</span>
                  ) : (
                    <span className="text-slate-400">{org.code} ({org.currency})</span>
                  )}
                </span>
              </div>
            </label>
          );
        })}
        {visible.length === 0 && (
          <p className="text-[11px] text-slate-400 p-1">{orgs.length === 0 ? 'لا توجد شركات متاحة.' : 'لا توجد شركات مطابقة للبحث.'}</p>
        )}
      </div>
      {selectedCount === 0 && emptyHint && <p className="mt-1.5 text-[11px] text-rose-600 font-bold">{emptyHint}</p>}
      {selectedCount > 1 && <p className="mt-1.5 text-[11px] text-emerald-700 font-bold">تم تحديد {selectedCount} شركات</p>}
    </div>
  );
};
