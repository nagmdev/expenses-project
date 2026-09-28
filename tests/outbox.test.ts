/**
 * Phase 3 — notification outbox: exactly-once enqueue, single delivery across
 * concurrent dispatchers, retries with backoff, dead-letter, per-recipient progress.
 */
import { describe, expect, it, vi } from 'vitest';
import { NonRetryableDeliveryError, computeBackoffMs, dispatchOutboxEvent, type OutboxTransport } from '../src/domain/outbox';
import { createExpenseRequest } from '../src/domain/requests';
import { draft, employee, freshStore, key, notify } from './helpers';
import { singleFlight } from '../src/utils/singleFlight';
import { createSubmitLock } from '../src/hooks/useSubmitGuard';

const t0 = new Date('2026-09-28T10:00:00.000Z');

async function withEvent(recipients = ['a@x.test', 'b@x.test']) {
  const store = freshStore();
  const res = await createExpenseRequest(store, employee, draft(), key(), { ...notify, adminRecipients: recipients }, t0);
  return { store, eventId: res.outboxEventIds[0] };
}

describe('outbox dispatch', () => {
  it('two tabs dispatching the same event → each recipient receives it once', async () => {
    const { store, eventId } = await withEvent();
    const deliver = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 5));
    });
    const transport: OutboxTransport = { deliver };
    const results = await Promise.all([
      dispatchOutboxEvent(store, eventId, transport, () => t0),
      dispatchOutboxEvent(store, eventId, transport, () => t0),
    ]);
    expect(results.sort()).toEqual(['sent', 'skipped']);
    expect(deliver).toHaveBeenCalledTimes(2); // 2 recipients × 1
    expect(deliver.mock.calls.map(c => c[2])).toEqual([`${eventId}:a@x.test`, `${eventId}:b@x.test`]); // idempotency keys
    expect(store.read('outbox', eventId)!.status).toBe('sent');
  });

  it('provider failure → failed with backoff; retry later only sends to recipients not yet delivered', async () => {
    const { store, eventId } = await withEvent();
    let calls = 0;
    const flaky: OutboxTransport = {
      async deliver(_ev, target) {
        calls++;
        if (target === 'b@x.test' && calls <= 2) throw new Error('timeout');
      },
    };
    expect(await dispatchOutboxEvent(store, eventId, flaky, () => t0)).toBe('failed');
    const failed = store.read('outbox', eventId)!;
    expect(failed.deliveredTo).toEqual(['a@x.test']);
    expect(new Date(failed.nextAttemptAt).getTime()).toBeGreaterThan(t0.getTime());

    // Not due yet → nothing happens
    expect(await dispatchOutboxEvent(store, eventId, flaky, () => t0)).toBe('skipped');

    const later = new Date(t0.getTime() + 60 * 60_000);
    const seen: string[] = [];
    const ok: OutboxTransport = { async deliver(_ev, target) { seen.push(target); } };
    expect(await dispatchOutboxEvent(store, eventId, ok, () => later)).toBe('sent');
    expect(seen).toEqual(['b@x.test']); // a@ was not emailed twice
  });

  it('non-retryable errors (provider not configured) go straight to dead-letter', async () => {
    const { store, eventId } = await withEvent();
    const transport: OutboxTransport = { async deliver() { throw new NonRetryableDeliveryError('no provider'); } };
    expect(await dispatchOutboxEvent(store, eventId, transport, () => t0)).toBe('dead');
    expect(store.read('outbox', eventId)!.status).toBe('dead');
  });

  it('gives up (dead) after max attempts', async () => {
    const { store, eventId } = await withEvent(['a@x.test']);
    const transport: OutboxTransport = { async deliver() { throw new Error('down'); } };
    let clock = t0.getTime();
    let result = '';
    for (let i = 0; i < 10 && result !== 'dead'; i++) {
      clock += 2 * 60 * 60_000;
      result = await dispatchOutboxEvent(store, eventId, transport, () => new Date(clock));
    }
    expect(result).toBe('dead');
    expect(store.read('outbox', eventId)!.attempts).toBe(6);
  });

  it('backoff grows exponentially and is capped', () => {
    const fixed = () => 0.5;
    expect(computeBackoffMs(1, fixed)).toBe(30_000);
    expect(computeBackoffMs(2, fixed)).toBe(60_000);
    expect(computeBackoffMs(3, fixed)).toBe(120_000);
    expect(computeBackoffMs(20, fixed)).toBe(60 * 60_000);
  });
});

describe('frontend guards', () => {
  it('submit lock: Enter + click in the same tick runs the handler once', async () => {
    const lock = createSubmitLock();
    const handler = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 5));
      return 'ok';
    });
    const [a, b] = await Promise.all([lock.run(handler), lock.run(handler)]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect([a, b]).toEqual(['ok', undefined]);
    // released afterwards → a later, separate submission works
    await lock.run(handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('singleFlight collapses concurrent identical mutations into one call', async () => {
    const fn = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 5));
      return 42;
    });
    const results = await Promise.all(Array.from({ length: 10 }, () => singleFlight('approve:req-1', fn)));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array(10).fill(42));
  });
});
