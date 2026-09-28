/**
 * Collapses concurrent calls that share the same key into ONE execution.
 *
 * The in-flight map is written synchronously (before the first `await`), so a
 * second call in the same tick (double click, Enter + click, StrictMode double
 * invocation) always receives the promise of the first call instead of starting
 * a second write.
 */
const inflight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

export function isInFlight(key: string): boolean {
  return inflight.has(key);
}
