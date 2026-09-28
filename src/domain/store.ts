/**
 * Minimal transactional document-store contract used by every business operation.
 *
 * Semantics mirror Cloud Firestore transactions:
 *  - all reads happen before any write inside one transaction,
 *  - reads observe the committed state at the start of the attempt,
 *  - the whole transaction commits atomically or not at all,
 *  - the body may be retried, so it must not have side effects outside `tx`.
 *
 * Production uses `createFirestoreStore` (src/domain/firestoreStore.ts); tests use
 * `createMemoryStore` so the idempotency/concurrency guarantees can be exercised
 * without a Firestore emulator.
 */
export type DocData = Record<string, any>;

export interface TxContext {
  get<T extends DocData = DocData>(collection: string, id: string): Promise<(T & { id: string }) | null>;
  /** Create or fully replace a document (or shallow-merge with { merge: true }). */
  set(collection: string, id: string, data: DocData, options?: { merge?: boolean }): void;
  /** Merge fields into an existing document (fails if it does not exist). */
  update(collection: string, id: string, data: DocData): void;
  delete(collection: string, id: string): void;
}

export interface DataStore {
  runTransaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
}

/** Recursively drop `undefined` values (Firestore rejects them). */
export function stripUndefined<T>(value: T): T {
  if (value === undefined) return null as any;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.filter(v => v !== undefined).map(v => stripUndefined(v)) as any;
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value as Record<string, any>)) {
    if (v !== undefined) out[k] = stripUndefined(v);
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// In-memory implementation (serializable isolation via a global commit lock)
// ---------------------------------------------------------------------------
export interface MemoryStore extends DataStore {
  dump(collection: string): DocData[];
  read(collection: string, id: string): DocData | null;
  seed(collection: string, id: string, data: DocData): void;
  /** Number of committed transactions (useful for asserting "no write happened"). */
  readonly commits: number;
}

export function createMemoryStore(): MemoryStore {
  const data = new Map<string, DocData>();
  const versions = new Map<string, number>();
  let chain: Promise<unknown> = Promise.resolve();
  let commits = 0;

  const k = (c: string, id: string) => `${c}/${id}`;
  const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  const runTransaction = <T,>(fn: (tx: TxContext) => Promise<T>): Promise<T> => {
    const attempt = async (): Promise<T> => {
      const writes: Array<{ key: string; op: 'set' | 'merge' | 'update' | 'delete'; value?: DocData }> = [];
      let wrote = false;
      const tx: TxContext = {
        async get(c, id) {
          if (wrote) throw new Error('Transactions require all reads to be executed before all writes.');
          const v = data.get(k(c, id));
          return v ? ({ ...clone(v), id } as any) : null;
        },
        set(c, id, value, options) {
          wrote = true;
          writes.push({ key: k(c, id), op: options?.merge ? 'merge' : 'set', value: stripUndefined(clone(value)) });
        },
        update(c, id, value) {
          wrote = true;
          writes.push({ key: k(c, id), op: 'update', value: stripUndefined(clone(value)) });
        },
        delete(c, id) {
          wrote = true;
          writes.push({ key: k(c, id), op: 'delete' });
        },
      };
      const result = await fn(tx);
      // Commit atomically: validate first, then apply.
      const staged = new Map(data);
      for (const w of writes) {
        if (w.op === 'update' && !staged.has(w.key)) {
          throw new Error(`No document to update: ${w.key}`);
        }
        if (w.op === 'set') staged.set(w.key, w.value!);
        else if (w.op === 'merge') staged.set(w.key, { ...(staged.get(w.key) || {}), ...w.value! });
        else if (w.op === 'update') staged.set(w.key, { ...staged.get(w.key)!, ...w.value! });
        else staged.delete(w.key);
      }
      for (const w of writes) {
        if (staged.has(w.key)) data.set(w.key, staged.get(w.key)!);
        else data.delete(w.key);
        versions.set(w.key, (versions.get(w.key) || 0) + 1);
      }
      if (writes.length > 0) commits++;
      return result;
    };
    // Serialize whole transactions: equivalent to Firestore's serializable isolation
    // (Firestore achieves it with optimistic retries; the observable outcome is the same).
    const run = chain.then(attempt, attempt);
    chain = run.catch(() => undefined);
    return run;
  };

  return {
    runTransaction,
    dump(c) {
      const prefix = `${c}/`;
      return Array.from(data.entries())
        .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map(([key, v]) => ({ ...clone(v), id: key.slice(prefix.length) }));
    },
    read(c, id) {
      const v = data.get(k(c, id));
      return v ? { ...clone(v), id } : null;
    },
    seed(c, id, value) {
      data.set(k(c, id), stripUndefined(clone(value)));
    },
    get commits() {
      return commits;
    },
  };
}
