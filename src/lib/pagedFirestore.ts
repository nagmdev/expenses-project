import {
  collection,
  endAt,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { EqFilters, PageDoc, PagedSource } from './pagination';

/**
 * The Firestore queries of the paged history lists (src/lib/pagination.ts), in one place so
 * the rules suite (tests-rules/pagination.test.ts) runs exactly the queries the app sends.
 *
 * Every query is equality filters (the scope firestore.rules can prove: historyScope) plus,
 * for the paged ones, orderBy(orderField, 'desc'). The composite indexes they need are in
 * firestore.indexes.json.
 */

/** Equality-only query (needs no composite index): `col` where field == value for each filter. */
export function eqQuery(db: Firestore, col: string, filters: EqFilters): Query<DocumentData> {
  return query(collection(db, col), ...filters.map(([field, value]) => where(field, '==', value)));
}

export function createFirestorePagedSource<T>(db: Firestore, col: string, filters: EqFilters, orderField: string): PagedSource<T> {
  const ref = collection(db, col);
  const eq: QueryConstraint[] = filters.map(([field, value]) => where(field, '==', value));
  const ordered = (...more: QueryConstraint[]) => query(ref, ...eq, orderBy(orderField, 'desc'), ...more);
  const toDocs = (docs: QueryDocumentSnapshot[]): PageDoc<T>[] =>
    docs.map(d => ({ id: d.id, data: { ...d.data(), id: d.id } as T, cursor: d }));

  return {
    fetchFirst: async n => toDocs((await getDocs(ordered(limit(n)))).docs),
    listenFrom: (anchor, onDocs, onError) =>
      onSnapshot(
        anchor ? ordered(endAt(anchor as QueryDocumentSnapshot)) : ordered(),
        snap => onDocs(toDocs(snap.docs)),
        onError,
      ),
    fetchAfter: async (cursor, n) =>
      toDocs((await getDocs(ordered(startAfter(cursor as QueryDocumentSnapshot), ...(n == null ? [] : [limit(n)])))).docs),
    // The previous behaviour (while an index is missing): the whole filtered set, unordered.
    listenAll: (onDocs, onError) => onSnapshot(query(ref, ...eq), snap => onDocs(toDocs(snap.docs)), onError),
  };
}
