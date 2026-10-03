import { describe, expect, it, vi } from 'vitest';
import {
  RENDER_STEP,
  countLabel,
  createPager,
  errorCodeOf,
  historyErrorMessage,
  historyScope,
  isMissingIndexError,
  mergePages,
  newestFirstBy,
  nextVisibleCount,
  type PageDoc,
  type PagedSource,
  type PagerState,
} from '../src/lib/pagination';

/**
 * An in-memory history collection behaving like the Firestore queries the pager uses
 * (orderBy(createdAt desc) + document id as the tie-break, limit, endAt / startAfter cursors).
 */
interface Row {
  id: string;
  createdAt: string;
  orgId?: string;
}

const iso = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
const row = (n: number, id = `r${String(n).padStart(4, '0')}`): Row => ({ id, createdAt: iso(n) });

// Newest first; equal times: higher id first (Firestore orders __name__ in the last orderBy's direction).
const cmp = (a: Row, b: Row) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.createdAt < b.createdAt ? 1 : -1);

class FakeHistory implements PagedSource<Row> {
  rows: Row[] = [];
  reads = 0;
  failFirst: unknown = null;
  failAfter: unknown = null;
  failListen: unknown = null;
  fetchAfterCalls = 0;
  private listeners = new Set<() => void>();

  constructor(rows: Row[] = []) {
    this.rows = [...rows];
  }

  private sorted() {
    return [...this.rows].sort(cmp);
  }
  private doc(r: Row): PageDoc<Row> {
    return { id: r.id, data: { ...r }, cursor: { ...r } };
  }
  add(...rows: Row[]) {
    this.rows.push(...rows);
    this.listeners.forEach(l => l());
  }
  remove(id: string) {
    this.rows = this.rows.filter(r => r.id !== id);
    this.listeners.forEach(l => l());
  }

  async fetchFirst(limit: number) {
    if (this.failFirst) throw this.failFirst;
    const out = this.sorted().slice(0, limit);
    this.reads += out.length;
    return out.map(r => this.doc(r));
  }
  listenFrom(anchor: unknown, onDocs: (docs: PageDoc<Row>[]) => void, onError: (err: unknown) => void) {
    if (this.failListen) {
      const err = this.failListen;
      queueMicrotask(() => onError(err));
      return () => {};
    }
    const emit = () => {
      const docs = this.sorted().filter(r => !anchor || cmp(r, anchor as Row) <= 0);
      onDocs(docs.map(r => this.doc(r)));
    };
    this.listeners.add(emit);
    emit();
    return () => {
      this.listeners.delete(emit);
    };
  }
  async fetchAfter(cursor: unknown, limit: number | null) {
    this.fetchAfterCalls++;
    if (this.failAfter) throw this.failAfter;
    const older = this.sorted().filter(r => cmp(r, cursor as Row) > 0);
    const out = limit == null ? older : older.slice(0, limit);
    this.reads += out.length;
    return out.map(r => this.doc(r));
  }
  listenAll(onDocs: (docs: PageDoc<Row>[]) => void) {
    // The whole set in NO particular order (an unordered equality query).
    const emit = () => onDocs([...this.rows].reverse().map(r => this.doc(r)));
    this.listeners.add(emit);
    emit();
    return () => {
      this.listeners.delete(emit);
    };
  }
  get listenerCount() {
    return this.listeners.size;
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const ids = (items: Row[]) => items.map(r => r.id);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i));

function startPager(source: FakeHistory, pageSize = 5, extra: Partial<Parameters<typeof createPager<Row>>[1]> = {}) {
  const states: PagerState<Row>[] = [];
  const warn = vi.fn();
  const pager = createPager<Row>(source, {
    pageSize,
    compare: newestFirstBy<Row>('createdAt'),
    onChange: s => states.push(s),
    warn,
    ...extra,
  });
  pager.start();
  return { pager, states, warn, last: () => states[states.length - 1] };
}

describe('createPager — cursor pages, newest first', () => {
  it('loads only the first page, newest first, and knows more may exist', async () => {
    const src = new FakeHistory(range(1, 12));
    const { pager, last } = startPager(src, 5);
    expect(pager.getState().loading).toBe(true);
    await flush();
    expect(ids(last().items)).toEqual(['r0012', 'r0011', 'r0010', 'r0009', 'r0008']);
    expect(last()).toMatchObject({ loading: false, hasMore: true, fallback: false, error: null });
  });

  it('"تحميل المزيد" appends the next older page, then stops at the end without duplicates', async () => {
    const src = new FakeHistory(range(1, 12));
    const { pager, last } = startPager(src, 5);
    await flush();
    await pager.loadMore();
    expect(ids(last().items)).toEqual(['r0012', 'r0011', 'r0010', 'r0009', 'r0008', 'r0007', 'r0006', 'r0005', 'r0004', 'r0003']);
    expect(last().hasMore).toBe(true);
    await pager.loadMore();
    expect(ids(last().items)).toEqual(range(1, 12).reverse().map(r => r.id));
    expect(last().hasMore).toBe(false);
    // Nothing more: no further read.
    const calls = src.fetchAfterCalls;
    await pager.loadMore();
    expect(src.fetchAfterCalls).toBe(calls);
  });

  it('an exact multiple of the page size ends with one empty read and hasMore false', async () => {
    const src = new FakeHistory(range(1, 10));
    const { pager, last } = startPager(src, 5);
    await flush();
    await pager.loadMore();
    expect(last().items).toHaveLength(10);
    expect(last().hasMore).toBe(true);
    await pager.loadMore();
    expect(last().items).toHaveLength(10);
    expect(last().hasMore).toBe(false);
  });

  it('new entries appear live at the top and nothing falls out of the window (no gap, no duplicate)', async () => {
    const src = new FakeHistory(range(1, 12));
    const { pager, last } = startPager(src, 5);
    await flush();
    src.add(row(13), row(14), row(15), row(16), row(17), row(18));
    // The live window grew (6 new + the 5 of the first page): a limit(5) listener would have dropped r0008..r0012.
    expect(ids(last().items).slice(0, 7)).toEqual(['r0018', 'r0017', 'r0016', 'r0015', 'r0014', 'r0013', 'r0012']);
    expect(last().items).toHaveLength(11);
    await pager.loadMore();
    await pager.loadMore();
    const all = ids(last().items);
    expect(all).toEqual(range(1, 18).reverse().map(r => r.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it('a live deletion within the window disappears', async () => {
    const src = new FakeHistory(range(1, 8));
    const { last } = startPager(src, 5);
    await flush();
    src.remove('r0007');
    expect(ids(last().items)).toEqual(['r0008', 'r0006', 'r0005', 'r0004']);
  });

  it('entries sharing the same timestamp are neither skipped nor repeated across pages', async () => {
    const same = iso(5);
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => ({ id, createdAt: same }));
    const src = new FakeHistory(rows);
    const { pager, last } = startPager(src, 3);
    await flush();
    await pager.loadMore();
    await pager.loadMore();
    expect(ids(last().items)).toEqual(['g', 'f', 'e', 'd', 'c', 'b', 'a']);
    expect(last().hasMore).toBe(false);
  });

  it('an empty history has nothing more, and its first entry shows up live', async () => {
    const src = new FakeHistory([]);
    const { last } = startPager(src, 5);
    await flush();
    expect(last()).toMatchObject({ loading: false, hasMore: false, items: [] });
    src.add(row(1));
    expect(ids(last().items)).toEqual(['r0001']);
  });

  it('loadAll reads every remaining entry in one go and returns the complete list', async () => {
    const src = new FakeHistory(range(1, 23));
    const { pager, last } = startPager(src, 5);
    await flush();
    const all = await pager.loadAll();
    expect(all).toHaveLength(23);
    expect(ids(all)[0]).toBe('r0023');
    expect(ids(all)[22]).toBe('r0001');
    expect(last().hasMore).toBe(false);
    expect(src.fetchAfterCalls).toBe(1);
  });

  it('loadAll never returns a partial list: a failed read rejects (the export then reports it)', async () => {
    const src = new FakeHistory(range(1, 12));
    const { pager, last } = startPager(src, 5);
    await flush();
    src.failAfter = { code: 'unavailable' };
    await expect(pager.loadAll()).rejects.toThrow(/could not be loaded/);
    expect(last().items).toHaveLength(5);
    src.failAfter = null;
    expect(await pager.loadAll()).toHaveLength(12);
  });

  it('loadAll before the first page arrived rejects instead of returning nothing', async () => {
    const src = new FakeHistory(range(1, 12));
    const { pager } = startPager(src, 5);
    await expect(pager.loadAll()).rejects.toThrow();
  });

  it('concurrent "تحميل المزيد" clicks read the next page once', async () => {
    const src = new FakeHistory(range(1, 20));
    const { pager, last } = startPager(src, 5);
    await flush();
    await Promise.all([pager.loadMore(), pager.loadMore(), pager.loadMore()]);
    expect(src.fetchAfterCalls).toBe(1);
    expect(last().items).toHaveLength(10);
  });

  it('keep() hides records (e.g. demo data) without breaking the cursor', async () => {
    const src = new FakeHistory(range(1, 10));
    const { pager, last } = startPager(src, 5, { keep: r => r.id !== 'r0009' && r.id !== 'r0004' });
    await flush();
    expect(ids(last().items)).toEqual(['r0010', 'r0008', 'r0007', 'r0006']);
    await pager.loadMore();
    expect(ids(last().items)).toEqual(['r0010', 'r0008', 'r0007', 'r0006', 'r0005', 'r0003', 'r0002', 'r0001']);
  });

  it('stop() unsubscribes and ignores late results', async () => {
    const src = new FakeHistory(range(1, 10));
    const { pager, states } = startPager(src, 5);
    await flush();
    expect(src.listenerCount).toBe(1);
    pager.stop();
    expect(src.listenerCount).toBe(0);
    const before = states.length;
    src.add(row(11));
    await pager.loadMore();
    expect(states.length).toBe(before);
  });

  it('stopped before the first page arrives: no listener is ever attached', async () => {
    const src = new FakeHistory(range(1, 10));
    const { pager, states } = startPager(src, 5);
    pager.stop();
    await flush();
    expect(src.listenerCount).toBe(0);
    expect(states).toHaveLength(0);
  });
});

describe('createPager — index not deployed yet (failed-precondition) falls back to the old behaviour', () => {
  const missingIndex = Object.assign(new Error('The query requires an index. You can create it here: https://console.firebase.google.com/...'), {
    code: 'failed-precondition',
  });

  it('first page refused: the whole set is loaded (sorted newest first), with a warning', async () => {
    const src = new FakeHistory(range(1, 12));
    src.failFirst = missingIndex;
    const { last, warn } = startPager(src, 5);
    await flush();
    expect(last()).toMatchObject({ loading: false, hasMore: false, fallback: true, error: null });
    expect(ids(last().items)).toEqual(range(1, 12).reverse().map(r => r.id));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/index not deployed/);
    // Still live in fallback mode.
    src.add(row(13));
    expect(ids(last().items)[0]).toBe('r0013');
  });

  it('live window refused: same fallback', async () => {
    const src = new FakeHistory(range(1, 7));
    src.failListen = missingIndex;
    const { last } = startPager(src, 5);
    await flush();
    await flush();
    expect(last().fallback).toBe(true);
    expect(last().items).toHaveLength(7);
  });

  it('an older page refused: same fallback, nothing lost', async () => {
    const src = new FakeHistory(range(1, 12));
    const { pager, last } = startPager(src, 5);
    await flush();
    src.failAfter = missingIndex;
    await pager.loadMore();
    expect(last()).toMatchObject({ fallback: true, hasMore: false, loadingMore: false });
    expect(last().items).toHaveLength(12);
    // In fallback mode everything is loaded: loadAll returns it at once.
    expect(await pager.loadAll()).toHaveLength(12);
  });

  it('switching to the fallback keeps the rows on screen until the whole list arrives', async () => {
    const src = new FakeHistory(range(1, 12));
    let release: () => void = () => {};
    const slowAll = src.listenAll.bind(src);
    src.listenAll = (onDocs: (docs: PageDoc<Row>[]) => void) => {
      release = () => slowAll(onDocs);
      return () => {};
    };
    const { pager, last } = startPager(src, 5);
    await flush();
    src.failAfter = missingIndex;
    await pager.loadMore();
    expect(last().fallback).toBe(true);
    expect(last().items).toHaveLength(5); // still the first page, never an empty flash
    await expect(pager.loadAll()).rejects.toThrow();
    release();
    expect(last().items).toHaveLength(12);
    expect(await pager.loadAll()).toHaveLength(12);
  });

  it('an index error carrying only its message is recognised too', () => {
    expect(isMissingIndexError({ message: 'FAILED_PRECONDITION: The query requires an index.' })).toBe(true);
    expect(isMissingIndexError({ code: 'failed-precondition' })).toBe(true);
    expect(isMissingIndexError({ code: 'permission-denied', message: 'requires an index' })).toBe(false);
    expect(isMissingIndexError(null)).toBe(false);
    expect(isMissingIndexError(new Error('boom'))).toBe(false);
  });
});

describe('createPager — other errors are reported, never turned into "no data"', () => {
  it('a refused first page reports permission-denied and does not fall back', async () => {
    const src = new FakeHistory(range(1, 5));
    src.failFirst = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    const { last } = startPager(src, 5);
    await flush();
    expect(last()).toMatchObject({ loading: false, fallback: false, error: 'permission-denied', items: [] });
  });

  it('a failed older page keeps what is shown and can be retried', async () => {
    const src = new FakeHistory(range(1, 12));
    const { pager, last } = startPager(src, 5);
    await flush();
    src.failAfter = { code: 'unavailable' };
    await pager.loadMore();
    expect(last()).toMatchObject({ error: 'unavailable', hasMore: true, loadingMore: false, fallback: false });
    expect(last().items).toHaveLength(5);
    src.failAfter = null;
    await pager.loadMore();
    expect(last()).toMatchObject({ error: null });
    expect(last().items).toHaveLength(10);
  });

  it('error codes and their Arabic messages', () => {
    expect(errorCodeOf({ code: 'permission-denied' })).toBe('permission-denied');
    expect(errorCodeOf(new Error('x'))).toBe('unknown');
    expect(historyErrorMessage(null)).toBe('');
    expect(historyErrorMessage('permission-denied')).toContain('صلاحية');
    expect(historyErrorMessage('unavailable')).toContain('الاتصال');
    expect(historyErrorMessage('unknown')).not.toBe('');
  });
});

describe('historyScope — the query shapes firestore.rules can prove', () => {
  it('the platform owner reads every company, or the one it picked', () => {
    expect(historyScope({ isSuperAdmin: true, orgFilter: 'all' })).toEqual([]);
    expect(historyScope({ isSuperAdmin: true })).toEqual([]);
    expect(historyScope({ isSuperAdmin: true, orgFilter: 'org-a' })).toEqual([['orgId', 'org-a']]);
  });

  it("an account statement is filtered on the account's own company", () => {
    expect(historyScope({ isSuperAdmin: true, orgFilter: 'all', extra: [['accountId', 'acc-1']], recordOrgId: 'org-b' }))
      .toEqual([['orgId', 'org-b'], ['accountId', 'acc-1']]);
    expect(historyScope({ isSuperAdmin: false, activeOrgId: 'org-a', extra: [['accountId', 'acc-1']], recordOrgId: 'org-a' }))
      .toEqual([['orgId', 'org-a'], ['accountId', 'acc-1']]);
  });

  it('anyone else ALWAYS filters on their own company, whatever filter the page holds', () => {
    expect(historyScope({ isSuperAdmin: false, activeOrgId: 'org-a', orgFilter: 'all' })).toEqual([['orgId', 'org-a']]);
    expect(historyScope({ isSuperAdmin: false, activeOrgId: 'org-a', orgFilter: 'org-b' })).toEqual([['orgId', 'org-a']]);
    expect(historyScope({ isSuperAdmin: false, activeOrgId: 'org-a', extra: [['referenceType', 'transfer']] }))
      .toEqual([['orgId', 'org-a'], ['referenceType', 'transfer']]);
  });

  it('nothing to load without a company, or for a record of another company', () => {
    expect(historyScope({ isSuperAdmin: false, activeOrgId: '' })).toBeNull();
    expect(historyScope({ isSuperAdmin: false, activeOrgId: 'all' })).toBeNull();
    expect(historyScope({ isSuperAdmin: false, activeOrgId: 'org-a', extra: [['accountId', 'x']], recordOrgId: 'org-b' })).toBeNull();
  });
});

describe('small helpers', () => {
  it('mergePages keeps the live version of a document present twice', () => {
    const live: PageDoc<Row>[] = [{ id: 'a', data: { id: 'a', createdAt: 'live' }, cursor: 1 }];
    const older: PageDoc<Row>[] = [
      { id: 'a', data: { id: 'a', createdAt: 'old' }, cursor: 2 },
      { id: 'b', data: { id: 'b', createdAt: 'old' }, cursor: 3 },
    ];
    expect(mergePages(live, older).map(d => d.data.createdAt)).toEqual(['live', 'old']);
  });

  it('newestFirstBy puts missing / unparsable dates last', () => {
    const list: Row[] = [
      { id: 'x', createdAt: '' },
      { id: 'old', createdAt: iso(1) },
      { id: 'bad', createdAt: 'not a date' },
      { id: 'new', createdAt: iso(9) },
    ];
    expect(ids([...list].sort(newestFirstBy<Row>('createdAt'))).slice(0, 2)).toEqual(['new', 'old']);
  });

  it('nextVisibleCount grows by a step and never past the list', () => {
    expect(nextVisibleCount(30, 100)).toBe(30 + RENDER_STEP);
    expect(nextVisibleCount(90, 100)).toBe(100);
    expect(nextVisibleCount(10, 100, 25)).toBe(35);
    expect(nextVisibleCount(-5, 3, 2)).toBe(2);
  });

  it('countLabel marks a count that is not complete yet', () => {
    expect(countLabel(50, true)).toBe('50+');
    expect(countLabel(12, false)).toBe('12');
  });
});
