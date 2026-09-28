import { useCallback, useRef, useState } from 'react';
import { newOperationKey } from '../utils/ids';

/**
 * Synchronous submit lock + stable idempotency key for one form/action.
 *
 * `useState` alone cannot prevent double submits: two clicks in the same tick both
 * read `submitting === false` before React commits the update. A ref is mutated
 * synchronously, so the second click is rejected immediately.
 *
 * The idempotency key stays the same across retries of the SAME intent (e.g. the
 * user clicks again after a timeout), so the backend resolves the retry to the
 * record created by the first attempt instead of creating a second one. Call
 * `rotateKey()` once the intent has definitely succeeded (or the form is reset for
 * a new, different submission).
 */
export function createSubmitLock() {
  let locked = false;
  return {
    get locked() {
      return locked;
    },
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (locked) return undefined;
      locked = true;
      try {
        return await fn();
      } finally {
        locked = false;
      }
    },
  };
}

export function useSubmitGuard() {
  const lockRef = useRef<ReturnType<typeof createSubmitLock> | null>(null);
  if (!lockRef.current) lockRef.current = createSubmitLock();
  const keyRef = useRef<string>(newOperationKey());
  const [pending, setPending] = useState(false);

  const run = useCallback(async <T,>(fn: (idempotencyKey: string) => Promise<T>): Promise<T | undefined> => {
    const lock = lockRef.current!;
    if (lock.locked) return undefined;
    setPending(true);
    try {
      return await lock.run(() => fn(keyRef.current));
    } finally {
      setPending(false);
    }
  }, []);

  const rotateKey = useCallback(() => {
    keyRef.current = newOperationKey();
  }, []);

  return { run, pending, rotateKey, get idempotencyKey() { return keyRef.current; } };
}

/** Keyed variant for lists where each row has its own action (approve row X, pay row Y). */
export function useKeyedSubmitGuard() {
  const lockedRef = useRef(new Set<string>());
  const keysRef = useRef(new Map<string, string>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());

  const keyFor = useCallback((scope: string) => {
    let key = keysRef.current.get(scope);
    if (!key) {
      key = newOperationKey();
      keysRef.current.set(scope, key);
    }
    return key;
  }, []);

  const run = useCallback(async <T,>(scope: string, fn: (idempotencyKey: string) => Promise<T>): Promise<T | undefined> => {
    if (lockedRef.current.has(scope)) return undefined;
    lockedRef.current.add(scope);
    setPendingKeys(new Set(lockedRef.current));
    try {
      return await fn(keyFor(scope));
    } finally {
      lockedRef.current.delete(scope);
      setPendingKeys(new Set(lockedRef.current));
    }
  }, [keyFor]);

  const rotateKey = useCallback((scope: string) => {
    keysRef.current.delete(scope);
  }, []);

  return { run, rotateKey, isPending: (scope: string) => pendingKeys.has(scope) };
}
