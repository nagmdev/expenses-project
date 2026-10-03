/**
 * Cursor pagination for the append-only history lists (treasury ledger / account statements,
 * audit log, notification outbox), newest first.
 *
 *   1. one read of the newest `pageSize` documents (the first page);
 *   2. a LIVE listener on every document from the newest down to the oldest of that first page
 *      (endAt(anchor)): new entries appear at once, and an entry never "falls off" the live
 *      window when newer ones arrive (a limit() listener would drop it, leaving a gap);
 *   3. "تحميل المزيد": one read of the next `pageSize` documents strictly older than the oldest
 *      loaded one (startAfter(cursor)). Older pages are a snapshot: history does not change.
 *
 * When Firestore answers failed-precondition (the composite index of the query is not
 * deployed yet, or still building), the pager logs a warning and falls back to the previous
 * behaviour: the whole (unordered) set, live, sorted here. Production keeps working before
 * the owner deploys firestore.indexes.json; it is only less economical.
 *
 * Nothing here knows Firestore (see src/hooks/usePagedHistory.ts for the binding), so the
 * logic is unit tested with an in-memory source (tests/pagination.test.ts).
 */

/** Rows per page of an append-only history list. */
export const HISTORY_PAGE_SIZE = 50;
/** Rows rendered at first (and added per "عرض المزيد") for the lists that stay fully loaded. */
export const RENDER_STEP = 30;
/**
 * The audit log entries AppContext keeps live for everyone who may read them: notifications'
 * "recent activity" (MAX_ACTIVITY_ITEMS) and the settings page's latest 30 need only the newest.
 */
export const RECENT_AUDIT_WINDOW = 100;

export interface PageDoc<T> {
  id: string;
  data: T;
  /** Opaque position of the document in the query (a Firestore DocumentSnapshot). */
  cursor: unknown;
}

export type Unsubscribe = () => void;

export interface PagedSource<T> {
  /** One read of the newest `limit` documents, newest first. */
  fetchFirst(limit: number): Promise<PageDoc<T>[]>;
  /** Live: every document from the newest down to `anchor` included (null: the whole ordered query). */
  listenFrom(anchor: unknown | null, onDocs: (docs: PageDoc<T>[]) => void, onError: (err: unknown) => void): Unsubscribe;
  /** One read of up to `limit` documents strictly older than `cursor` (null: all of them), newest first. */
  fetchAfter(cursor: unknown, limit: number | null): Promise<PageDoc<T>[]>;
  /** The previous behaviour: the whole set, live, in no particular order (needs no composite index). */
  listenAll(onDocs: (docs: PageDoc<T>[]) => void, onError: (err: unknown) => void): Unsubscribe;
}

export interface PagerState<T> {
  items: T[];
  /** The first page is not there yet. */
  loading: boolean;
  loadingMore: boolean;
  /** Older documents may exist beyond the loaded ones. */
  hasMore: boolean;
  /** The index was missing: the whole set is loaded the old way (hasMore is then false). */
  fallback: boolean;
  /** Error code of a refused / failed read (e.g. 'permission-denied'), null when fine. */
  error: string | null;
}

export const EMPTY_PAGER_STATE: PagerState<never> = {
  items: [],
  loading: true,
  loadingMore: false,
  hasMore: false,
  fallback: false,
  error: null,
};

/** Firestore's answer when a query needs a composite index that is not deployed (or still building). */
export function isMissingIndexError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof e?.code === 'string' ? e.code : '';
  if (code === 'failed-precondition' || code === 'firestore/failed-precondition') return true;
  // Some SDK paths only keep the message ("The query requires an index. You can create it here: …").
  return !code && typeof e?.message === 'string' && /requires an index/i.test(e.message);
}

export function errorCodeOf(err: unknown): string {
  const e = err as { code?: unknown } | null | undefined;
  return typeof e?.code === 'string' && e.code ? e.code : 'unknown';
}

/** Live window first, then the older pages; a document present in both keeps its live version. */
export function mergePages<T>(live: PageDoc<T>[], older: PageDoc<T>[]): PageDoc<T>[] {
  const seen = new Set<string>();
  const out: PageDoc<T>[] = [];
  for (const d of [...live, ...older]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

/** Newest first on an ISO-8601 (or any Date-parsable) field; unparsable / missing values last. */
export function newestFirstBy<T>(field: keyof T): (a: T, b: T) => number {
  const time = (x: T) => {
    const t = new Date(String(x[field] ?? '')).getTime();
    return Number.isFinite(t) ? t : -Infinity;
  };
  return (a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (ta === tb) return 0;
    return tb > ta ? 1 : -1;
  };
}

export interface PagerOptions<T> {
  pageSize: number;
  /** Order of the fallback (whole-set) mode; the paged mode keeps Firestore's order. */
  compare: (a: T, b: T) => number;
  /** Documents never shown (demo / dummy records). */
  keep?: (item: T) => boolean;
  onChange: (state: PagerState<T>) => void;
  /** Where the missing-index fallback is reported (console.warn by default). */
  warn?: (message: string, err: unknown) => void;
  /** A name for the warnings. */
  label?: string;
}

export interface Pager<T> {
  start(): void;
  loadMore(): Promise<void>;
  /** Loads every remaining document (e.g. before an export) and returns the complete list. */
  loadAll(): Promise<T[]>;
  stop(): void;
  getState(): PagerState<T>;
}

export function createPager<T>(source: PagedSource<T>, opts: PagerOptions<T>): Pager<T> {
  const { pageSize, compare, onChange } = opts;
  const keep = opts.keep || (() => true);
  const warn = opts.warn || ((message: string, err: unknown) => console.warn(message, (err as any)?.message || err));
  const label = opts.label || 'history';

  let stopped = false;
  let started = false;
  let live: PageDoc<T>[] = [];
  let older: PageDoc<T>[] = [];
  let anchor: unknown | null = null;
  let all: T[] = [];
  let unsub: Unsubscribe = () => {};
  let inFlight: Promise<void> | null = null;
  let fallbackReady = false;
  let state: PagerState<T> = { ...EMPTY_PAGER_STATE, items: [] };

  const pagedItems = () => mergePages(live, older).map(d => d.data).filter(keep);

  const emit = (patch: Partial<PagerState<T>>) => {
    if (stopped) return;
    state = { ...state, ...patch };
    state.items = state.fallback ? all : pagedItems();
    onChange(state);
  };

  const goFallback = (err: unknown) => {
    warn(`[Pagination] ${label}: index not deployed yet, loading the whole list instead.`, err);
    unsub();
    // What is on screen stays there until the whole list arrives.
    all = pagedItems();
    live = [];
    older = [];
    unsub = source.listenAll(
      docs => {
        all = docs.map(d => d.data).filter(keep).sort(compare);
        fallbackReady = true;
        emit({ loading: false, loadingMore: false, hasMore: false, fallback: true, error: null });
      },
      e => {
        warn(`[Pagination] ${label}: listener failed.`, e);
        emit({ loading: false, loadingMore: false, hasMore: false, fallback: true, error: errorCodeOf(e) });
      },
    );
    // Until the whole list arrives the screen is not complete: `loading` (an export waits for it).
    if (!fallbackReady) emit({ loading: true, hasMore: false, loadingMore: false, fallback: true });
  };

  // A failure of the first page / the live window: fall back on a missing index, otherwise report it.
  const fail = (err: unknown) => {
    if (stopped) return;
    if (!state.fallback && isMissingIndexError(err)) {
      goFallback(err);
      return;
    }
    warn(`[Pagination] ${label}: read failed.`, err);
    emit({ loading: false, loadingMore: false, error: errorCodeOf(err) });
  };

  const fetchOlder = (limit: number | null): Promise<void> => {
    if (stopped || state.fallback || state.loading || !state.hasMore) return Promise.resolve();
    if (inFlight) return inFlight;
    const cursor = older.length ? older[older.length - 1].cursor : anchor;
    if (cursor == null) return Promise.resolve();
    emit({ loadingMore: true, error: null });
    inFlight = source
      .fetchAfter(cursor, limit)
      .then(page => {
        if (stopped || state.fallback) return;
        older = [...older, ...page];
        emit({ loadingMore: false, hasMore: limit != null && page.length >= limit });
      })
      .catch(err => fail(err))
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      source
        .fetchFirst(pageSize)
        .then(first => {
          if (stopped) return;
          live = first;
          anchor = first.length ? first[first.length - 1].cursor : null;
          emit({ loading: false, hasMore: first.length >= pageSize, error: null });
          unsub = source.listenFrom(anchor, docs => {
            if (state.fallback) return;
            live = docs;
            emit({});
          }, fail);
        })
        .catch(fail);
    },
    loadMore: () => fetchOlder(pageSize),
    async loadAll() {
      // A page already on its way finishes first; then everything older in one read.
      if (inFlight) await inFlight;
      await fetchOlder(null);
      // Never a silently partial list (an export would miss entries).
      const complete = state.fallback ? fallbackReady && !state.error : !state.loading && !state.hasMore && !state.error;
      if (!complete) throw new Error(`[Pagination] ${label}: the complete list could not be loaded (${state.error || 'not loaded yet'}).`);
      return state.items;
    },
    stop() {
      stopped = true;
      unsub();
    },
    getState: () => state,
  };
}

/** Equality filters of a history query: [field, value] pairs. */
export type EqFilters = Array<[string, string]>;

/**
 * The scope of a history query, as firestore.rules can prove it: the platform owner may read
 * every company (no filter, or the company it picked); anyone else ALWAYS filters on their own
 * company (orgId equality), or the list query is refused. Null: nothing to load.
 */
export function historyScope(opts: {
  isSuperAdmin: boolean;
  /** The owner's company filter ('all' or an orgId). */
  orgFilter?: string;
  /** The company of a non-owner (AppContext activeOrgId). */
  activeOrgId?: string;
  /** Further equality filters (e.g. a statement: accountId). */
  extra?: EqFilters;
  /** The company of the record the extra filters point to (an account's orgId), if known. */
  recordOrgId?: string;
}): EqFilters | null {
  const extra = opts.extra || [];
  let orgId: string;
  if (opts.isSuperAdmin) {
    orgId = opts.recordOrgId || (opts.orgFilter && opts.orgFilter !== 'all' ? opts.orgFilter : '');
  } else {
    orgId = opts.activeOrgId && opts.activeOrgId !== 'all' ? opts.activeOrgId : '';
    if (!orgId) return null;
    // A record of another company is never readable here: nothing to query.
    if (opts.recordOrgId && opts.recordOrgId !== orgId) return null;
  }
  return [...(orgId ? ([['orgId', orgId]] as EqFilters) : []), ...extra];
}

/** Time of an ISO-8601 (or any Date-parsable) value; NaN when missing / unparsable. */
const timeOf = (value: unknown): number => (value == null || value === '' ? NaN : new Date(String(value)).getTime());

/** The time of the oldest loaded entry of a paged history (NaN when nothing is loaded). */
export function oldestLoadedTime<T>(items: T[], field: keyof T): number {
  let oldest = NaN;
  for (const item of items) {
    const t = timeOf(item[field]);
    if (Number.isFinite(t) && !(t >= oldest)) oldest = t;
  }
  return oldest;
}

/**
 * Two paged histories shown as ONE list (the email log: the outbox + the legacy email_logs)
 * must not show an entry of one source below a stretch the other source has not loaded yet:
 * the hidden entries would later appear in the middle of the list (a gap that looks like
 * "nothing happened then"). The returned time is the oldest point both sources have fully
 * loaded: entries older than it are held back until "تحميل المزيد" reaches them.
 * -Infinity: nothing to hold back (no source has older pages left).
 */
export function mergedHistoryCutoff(sources: Array<{ hasMore: boolean; oldest: number }>): number {
  let cutoff = -Infinity;
  for (const s of sources) {
    if (s.hasMore && Number.isFinite(s.oldest) && s.oldest > cutoff) cutoff = s.oldest;
  }
  return cutoff;
}

/** Keeps the entries at or after `cutoff` (mergedHistoryCutoff); entries without a time are held back too while a cutoff applies. */
export function atOrAfter<T>(items: T[], field: keyof T, cutoff: number): T[] {
  if (cutoff === -Infinity) return items;
  return items.filter(item => timeOf(item[field]) >= cutoff);
}

/** How many rows a progressively rendered list shows next ("عرض المزيد"). */
export function nextVisibleCount(current: number, total: number, step: number = RENDER_STEP): number {
  return Math.min(total, Math.max(current, 0) + step);
}

/** Arabic message of a refused / failed history read ('' when fine). */
export const historyErrorMessage = (code: string | null): string =>
  !code
    ? ''
    : code === 'permission-denied'
    ? 'لا تملك صلاحية قراءة هذا السجل.'
    : code === 'unavailable'
    ? 'تعذر الاتصال بقاعدة البيانات. تحقق من الاتصال ثم أعد المحاولة.'
    : 'تعذر تحميل السجل. أعد المحاولة.';

/** A count shown next to a paged list: "N" when every row is loaded, "N+" while older pages remain. */
export const countLabel = (shown: number, hasMore: boolean): string => `${shown}${hasMore ? '+' : ''}`;
