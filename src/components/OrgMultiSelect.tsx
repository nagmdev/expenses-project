import React, { useMemo, useState } from 'react';
import { Building2, Search } from 'lucide-react';
import type { Organization } from '../types';

interface OrgMultiSelectProps {
  orgs: Array<Pick<Organization, 'id' | 'name' | 'code' | 'currency'>>;
  selected: string[];
  onChange: (orgIds: string[]) => void;
  label?: string;
  /** Companies that cannot be picked, with the reason shown on the chip (e.g. "مسجل بالفعل"). */
  unavailable?: Record<string, string>;
  /** Shown under the list when nothing is selected. */
  emptyHint?: string;
  disabled?: boolean;
}

/**
 * Company multi-selection (checkbox chips + select all + search), the same look as the
 * service-category form. Unavailable companies stay visible with their reason.
 */
export const OrgMultiSelect: React.FC<OrgMultiSelectProps> = ({
  orgs,
  selected,
  onChange,
  label = 'الشركات التابع لها (تحديد متعدد) *',
  unavailable = {},
  emptyHint = '* يرجى تحديد شركة واحدة على الأقل.',
  disabled = false,
}) => {
  const [query, setQuery] = useState('');
  const selectable = useMemo(() => orgs.filter(o => !unavailable[o.id]), [orgs, unavailable]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter(o => o.name.toLowerCase().includes(q) || (o.code || '').toLowerCase().includes(q));
  }, [orgs, query]);
  const allSelected = selectable.length > 0 && selectable.every(o => selected.includes(o.id));
  // Only companies that will actually receive the record count as selected.
  const selectedCount = selected.filter(id => !unavailable[id] && orgs.some(o => o.id === id)).length;

  const toggle = (orgId: string, checked: boolean) => {
    onChange(checked ? Array.from(new Set([...selected, orgId])) : selected.filter(id => id !== orgId));
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
            onClick={() => onChange(allSelected ? [] : selectable.map(o => o.id))}
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
              const matches = visible.filter(o => !unavailable[o.id]);
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
          const isSelected = !reason && selected.includes(org.id);
          return (
            <label
              key={org.id}
              className={`flex items-center gap-2 p-2 rounded-lg border text-xs font-semibold transition ${
                reason
                  ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                  : isSelected
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-bold shadow-xs cursor-pointer'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100/70 cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={disabled || Boolean(reason)}
                onChange={(e) => toggle(org.id, e.target.checked)}
                className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
              />
              <div className="flex-1 min-w-0">
                <div className="truncate">{org.name}</div>
                <span className="text-[10px] font-normal">
                  {reason ? <span className="text-amber-700 font-bold">{reason}</span> : <span className="text-slate-400">{org.code} ({org.currency})</span>}
                </span>
              </div>
            </label>
          );
        })}
        {visible.length === 0 && <p className="text-[11px] text-slate-400 p-1">لا توجد شركات مطابقة.</p>}
      </div>
      {selectedCount === 0 && emptyHint && <p className="mt-1.5 text-[11px] text-rose-600 font-bold">{emptyHint}</p>}
      {selectedCount > 1 && <p className="mt-1.5 text-[11px] text-emerald-700 font-bold">تم تحديد {selectedCount} شركات</p>}
    </div>
  );
};
