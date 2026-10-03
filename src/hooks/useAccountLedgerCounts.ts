import { useEffect, useRef, useState } from 'react';
import { getDb, getCountFromServer } from '../lib/firebase';
import { eqQuery } from '../lib/pagedFirestore';
import type { PaymentAccount } from '../types';

/**
 * Number of ledger lines per account (the card's "عرض كشف وحركات الحساب (N)" and the history
 * check before a delete), counted by Firestore (count() aggregation: 1 read per 1000 lines)
 * instead of loading the whole ledger. Filtered on the account's own company, so
 * firestore.rules can prove the query for finance / org admins too.
 *
 * A count is re-read only when its account changed (every movement writes the account's
 * lastLedgerId and balance), so it follows the live accounts. Unknown (not counted yet, or
 * refused) accounts are simply absent from the map.
 */
export const ledgerVersionOf = (acc: PaymentAccount): string =>
  [acc.lastLedgerId || '', acc.currentBalance ?? acc.balance ?? '', acc.totalIn ?? '', acc.totalOut ?? ''].join('|');

const MAX_PARALLEL = 6;

export function useAccountLedgerCounts(accounts: PaymentAccount[], enabled = true): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(() => new Map());
  // accountId -> version already counted (or being counted)
  const versionsRef = useRef(new Map<string, string>());
  const signature = enabled ? JSON.stringify(accounts.map(a => [a.id, a.orgId || '', ledgerVersionOf(a)])) : '';

  useEffect(() => {
    const db = signature ? getDb() : null;
    if (!db) return;
    const versions = versionsRef.current;
    let cancelled = false;
    const done = new Set<string>();
    const todo = (JSON.parse(signature) as Array<[string, string, string]>)
      .map(([id, orgId, version]) => ({ id, orgId, version }))
      .filter(a => a.id && a.orgId && versions.get(a.id) !== a.version);
    todo.forEach(a => versions.set(a.id, a.version));

    const countOne = async (a: { id: string; orgId: string; version: string }) => {
      try {
        const snap = await getCountFromServer(eqQuery(db, 'accountTransactions', [['orgId', a.orgId], ['accountId', a.id]]));
        if (cancelled) return;
        done.add(a.id);
        const n = snap.data().count;
        setCounts(prev => {
          if (prev.get(a.id) === n) return prev;
          const next = new Map(prev);
          next.set(a.id, n);
          return next;
        });
      } catch (err: any) {
        console.warn('[Treasury] ledger count:', a.id, err?.message || err);
        // Counted again on the next change of the account (or the next visit).
        if (versions.get(a.id) === a.version) versions.delete(a.id);
      }
    };

    (async () => {
      for (let i = 0; i < todo.length && !cancelled; i += MAX_PARALLEL) {
        await Promise.all(todo.slice(i, i + MAX_PARALLEL).map(countOne));
      }
    })();
    return () => {
      cancelled = true;
      // What an interrupted batch did not count yet is counted by the next run.
      todo.forEach(a => {
        if (!done.has(a.id) && versions.get(a.id) === a.version) versions.delete(a.id);
      });
    };
  }, [signature]);

  return counts;
}
