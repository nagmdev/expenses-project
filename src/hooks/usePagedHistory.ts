import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDb, onSnapshot } from '../lib/firebase';
import {
  EMPTY_PAGER_STATE,
  HISTORY_PAGE_SIZE,
  createPager,
  newestFirstBy,
  type EqFilters,
  type Pager,
  type PagerState,
} from '../lib/pagination';
import { createFirestorePagedSource, eqQuery } from '../lib/pagedFirestore';

export interface PagedHistory<T> extends PagerState<T> {
  loadMore: () => Promise<void>;
  /** Every remaining entry of the scope (e.g. before an export); resolves to the complete list. */
  loadAll: () => Promise<T[]>;
}

/**
 * Newest-first history of `col` within `filters` (null: nothing to load), real time for the
 * first page and everything newer, "تحميل المزيد" for the older pages (src/lib/pagination.ts).
 * Until the composite index of the query is deployed (firestore.indexes.json) it falls back to
 * the whole filtered set, as before. The filters must come from historyScope (rules-provable).
 */
export function usePagedHistory<T extends { id: string }>(opts: {
  col: string;
  filters: EqFilters | null;
  orderField: keyof T & string;
  pageSize?: number;
  enabled?: boolean;
}): PagedHistory<T> {
  const { col, filters, orderField, pageSize = HISTORY_PAGE_SIZE, enabled = true } = opts;
  // Queries are rebuilt only when the scope really changes (filters arrive as new arrays).
  const scopeKey = enabled && filters ? JSON.stringify([col, filters, orderField, pageSize]) : '';
  const [state, setState] = useState<PagerState<T>>(EMPTY_PAGER_STATE as PagerState<T>);
  const pagerRef = useRef<Pager<T> | null>(null);

  useEffect(() => {
    const db = scopeKey ? getDb() : null;
    if (!scopeKey || !db) {
      pagerRef.current = null;
      setState({ ...(EMPTY_PAGER_STATE as PagerState<T>), loading: false });
      return;
    }
    const [, scopeFilters] = JSON.parse(scopeKey) as [string, EqFilters];
    setState(EMPTY_PAGER_STATE as PagerState<T>);
    const pager = createPager<T>(createFirestorePagedSource<T>(db, col, scopeFilters, orderField), {
      pageSize,
      compare: newestFirstBy<T>(orderField),
      onChange: setState,
      label: `${col} [${scopeFilters.map(([f, v]) => `${f}=${v}`).join(', ') || 'all'}]`,
    });
    pagerRef.current = pager;
    pager.start();
    return () => {
      pager.stop();
      if (pagerRef.current === pager) pagerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const loadMore = useCallback(() => pagerRef.current?.loadMore() ?? Promise.resolve(), []);
  const loadAll = useCallback(() => pagerRef.current?.loadAll() ?? Promise.resolve([] as T[]), []);
  return useMemo(() => ({ ...state, loadMore, loadAll }), [state, loadMore, loadAll]);
}

/**
 * A small live query that needs no composite index (equality filters only), e.g. the transfer
 * lines of the treasury. Null filters: nothing to load. `error` is the refusal code, if any.
 */
export function useLiveEqQuery<T extends { id: string }>(col: string, filters: EqFilters | null, enabled = true) {
  const scopeKey = enabled && filters ? JSON.stringify([col, filters]) : '';
  const [state, setState] = useState<{ items: T[]; loaded: boolean; error: string | null }>({ items: [], loaded: false, error: null });
  useEffect(() => {
    const db = scopeKey ? getDb() : null;
    if (!scopeKey || !db) {
      setState({ items: [], loaded: true, error: null });
      return;
    }
    const [, scopeFilters] = JSON.parse(scopeKey) as [string, EqFilters];
    setState({ items: [], loaded: false, error: null });
    return onSnapshot(
      eqQuery(db, col, scopeFilters),
      snap => setState({ items: snap.docs.map(d => ({ ...d.data(), id: d.id } as T)), loaded: true, error: null }),
      err => {
        console.warn(`[Firebase] ${col} listener:`, err?.message || err);
        setState({ items: [], loaded: true, error: err?.code || 'unknown' });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  return state;
}
