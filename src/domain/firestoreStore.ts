import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { stripUndefined, type DataStore, type TxContext } from './store';

/** Firestore-backed implementation of the transactional DataStore contract. */
export function createFirestoreStore(db: Firestore): DataStore {
  return {
    runTransaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
      return runTransaction(db, async t => {
        const tx: TxContext = {
          async get(collection, id) {
            const snap = await t.get(doc(db, collection, id));
            return snap.exists() ? ({ ...snap.data(), id: snap.id } as any) : null;
          },
          set(collection, id, data, options) {
            t.set(doc(db, collection, id), stripUndefined(data), { merge: Boolean(options?.merge) });
          },
          update(collection, id, data) {
            t.update(doc(db, collection, id), stripUndefined(data));
          },
          delete(collection, id) {
            t.delete(doc(db, collection, id));
          },
        };
        return fn(tx);
      });
    },
  };
}
