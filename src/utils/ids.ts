/**
 * Canonical identifier generation.
 *
 * Never derive IDs from `Date.now()`: two objects created in the same millisecond
 * (double click, batch operations, two tabs) collide, and every retry of the same
 * operation produces a brand new ID, which is exactly how duplicates are born.
 *
 * - `newId(prefix)` produces a random, collision-free ID for a brand new entity.
 * - `newOperationKey()` produces an idempotency key for ONE user intent (one form
 *   submission). Every retry of that intent must reuse the same key.
 * - `idFromKey(prefix, key)` derives the entity ID from the idempotency key, so a
 *   retried/duplicated submission always targets the same document.
 */

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export function uuid(): string {
  const c: Crypto | undefined = (globalThis as any).crypto;
  // crypto.randomUUID only exists in secure contexts (https / localhost);
  // getRandomValues is available everywhere (e.g. the Vite dev server over LAN http).
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* fall through */
    }
  }
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('Secure random number generator is not available in this environment.');
  }
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const newId = (prefix: string): string => `${prefix}-${uuid()}`;

export const newOperationKey = (): string => uuid();

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function assertOperationKey(key: string): string {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`Invalid idempotency key: "${key}"`);
  }
  return key;
}

export const idFromKey = (prefix: string, key: string): string => `${prefix}-${assertOperationKey(key)}`;

/** Deterministic, reversible, Firestore-safe encoding of an arbitrary string (e.g. an email). */
export function encodeKeyPart(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  bytes.forEach(b => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
