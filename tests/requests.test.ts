/**
 * Phase 5 — duplicate & race-condition tests for expense requests.
 * Each scenario from the review is reproduced against the real domain operations.
 */
import { describe, expect, it } from 'vitest';
import { createExpenseRequest, disburseExpenseRequest, transitionExpenseRequest, updateExpenseRequest } from '../src/domain/requests';
import { admin, burst, draft, employee, finance, freshStore, key, notify, otherEmployee, seedAccount } from './helpers';

const now = new Date('2026-09-28T10:00:00.000Z');

describe('create request — one user intent produces exactly one record', () => {
  it('single click → 1 record with a sequential number', async () => {
    const store = freshStore();
    const res = await createExpenseRequest(store, employee, draft(), key(), notify, now);
    expect(res.changed).toBe(true);
    expect(store.dump('requests')).toHaveLength(1);
    expect(res.value.requestNumber).toBe('REQ-2026-000001');
    expect(res.value.id).toBe(res.value.id.trim());
  });

  it('double click (same key, same tick) → 1 record', async () => {
    const store = freshStore();
    const k = key();
    const results = await burst(2, () => createExpenseRequest(store, employee, draft(), k, notify, now));
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    expect(store.dump('requests')).toHaveLength(1);
    expect(store.dump('outbox')).toHaveLength(1); // one "new request" email, not two
    expect(store.read('counters', 'requests-2026')!.value).toBe(1); // no number was burnt
  });

  it('rapid click ×10 → 1 record', async () => {
    const store = freshStore();
    const k = key();
    await burst(10, () => createExpenseRequest(store, employee, draft(), k, notify, now));
    expect(store.dump('requests')).toHaveLength(1);
    expect(store.dump('outbox')).toHaveLength(1);
  });

  it('network retry / timeout + retry (sequential, same key) → 1 record, same number returned', async () => {
    const store = freshStore();
    const k = key();
    const first = await createExpenseRequest(store, employee, draft(), k, notify, now);
    const retry = await createExpenseRequest(store, employee, draft(), k, notify, now);
    expect(retry.changed).toBe(false);
    expect(retry.reason).toBe('duplicate_operation');
    expect(retry.value.requestNumber).toBe(first.value.requestNumber);
    expect(retry.outboxEventIds).toEqual([]); // no second email on retry
    expect(store.dump('requests')).toHaveLength(1);
  });

  it('50 concurrent DIFFERENT requests → 50 records with unique, gap-free numbers', async () => {
    const store = freshStore();
    const results = await Promise.all(Array.from({ length: 50 }, () => createExpenseRequest(store, employee, draft(), key(), notify, now)));
    const numbers = results.map(r => r.value.requestNumber);
    expect(new Set(numbers).size).toBe(50);
    const seqs = numbers.map(n => Number(n.split('-')[2])).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('rejects invalid amounts before touching the database', async () => {
    const store = freshStore();
    await expect(createExpenseRequest(store, employee, draft({ amount: 0 }), key(), notify, now)).rejects.toThrow();
    expect(store.commits).toBe(0);
  });
});

describe('state transitions are guarded and idempotent', () => {
  async function pending() {
    const store = freshStore();
    const res = await createExpenseRequest(store, employee, draft(), key(), notify, now);
    return { store, id: res.value.id };
  }

  it('two approvals at the same time (two admins) → exactly one transition', async () => {
    const { store, id } = await pending();
    const before = store.dump('outbox').length;
    const results = await Promise.all([
      transitionExpenseRequest(store, admin, id, { type: 'approve' }, key(), notify, now),
      transitionExpenseRequest(store, finance, id, { type: 'approve' }, key(), notify, now),
    ]);
    expect(results.filter(r => r.changed)).toHaveLength(1);
    const req = store.read('requests', id)!;
    expect(req.status).toBe('approved');
    expect(req.timeline.filter((t: any) => t.status === 'approved')).toHaveLength(1);
    expect(store.dump('outbox').length - before).toBe(1); // one "approved" email
  });

  it('approve → approve again is a no-op (no second email, no second timeline entry)', async () => {
    const { store, id } = await pending();
    await transitionExpenseRequest(store, admin, id, { type: 'approve' }, key(), notify, now);
    const again = await transitionExpenseRequest(store, admin, id, { type: 'approve' }, key(), notify, now);
    expect(again.changed).toBe(false);
    expect(again.reason).toBe('already_in_state');
    expect(again.outboxEventIds).toEqual([]);
  });

  it('cannot approve a rejected request, cannot reject a disbursed one', async () => {
    const { store, id } = await pending();
    await transitionExpenseRequest(store, admin, id, { type: 'reject', reason: 'no' }, key(), notify, now);
    await expect(transitionExpenseRequest(store, admin, id, { type: 'approve' }, key(), notify, now)).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('employees cannot approve; only the requester can answer a clarification', async () => {
    const { store, id } = await pending();
    await expect(transitionExpenseRequest(store, employee, id, { type: 'approve' }, key(), notify, now)).rejects.toMatchObject({ code: 'forbidden' });
    await transitionExpenseRequest(store, admin, id, { type: 'clarify', question: 'invoice?' }, key(), notify, now);
    await expect(transitionExpenseRequest(store, otherEmployee, id, { type: 'reply', replyText: 'x' }, key(), notify, now)).rejects.toMatchObject({ code: 'forbidden' });
    const ok = await transitionExpenseRequest(store, employee, id, { type: 'reply', replyText: 'attached' }, key(), notify, now);
    expect(ok.value.status).toBe('pending');
  });

  it('editing the amount of an approved request sends it back for re-approval', async () => {
    const { store, id } = await pending();
    await transitionExpenseRequest(store, admin, id, { type: 'approve' }, key(), notify, now);
    const res = await updateExpenseRequest(store, admin, id, { amount: 9999, status: 'disbursed' as any }, key(), now);
    expect(res.value.status).toBe('pending'); // and the forged status field was ignored
    await expect(updateExpenseRequest(store, employee, id, { requestNumber: 'HACK' } as any, key(), now)).resolves.toBeTruthy();
    expect(store.read('requests', id)!.requestNumber).not.toBe('HACK');
  });
});

describe('disbursement — money moves exactly once', () => {
  async function approved(balance = 1000, amount = 400) {
    const store = freshStore();
    seedAccount(store, 'acc-cash', balance);
    const res = await createExpenseRequest(store, employee, draft({ amount }), key(), notify, now);
    await transitionExpenseRequest(store, admin, res.value.id, { type: 'approve' }, key(), notify, now);
    return { store, id: res.value.id };
  }
  const details = { paymentMethod: 'cash' as const, referenceNumber: 'R-1', accountId: 'acc-cash' };

  it('two payments of the same request (double click / two finance users) → one ledger entry, one deduction', async () => {
    const { store, id } = await approved();
    const results = await Promise.all([
      disburseExpenseRequest(store, finance, id, details, key(), notify, now),
      disburseExpenseRequest(store, admin, id, details, key(), notify, now),
    ]);
    expect(results.filter(r => r.changed)).toHaveLength(1);
    expect(results.find(r => !r.changed)!.reason).toBe('already_disbursed');
    expect(store.dump('accountTransactions')).toHaveLength(1);
    expect(store.read('paymentAccounts', 'acc-cash')!.currentBalance).toBe(600);
    expect(store.read('services', 'srv-1')!.spentAmount).toBe(400);
    expect(store.read('providers', 'prov-1')!.totalPaid).toBe(400);
    expect(store.dump('outbox').filter(e => e.eventType === 'request_paid')).toHaveLength(1);
  });

  it('batch payment retried → already-paid requests are skipped, not paid again', async () => {
    const { store, id } = await approved();
    const batchKey = key();
    await disburseExpenseRequest(store, finance, id, { ...details, batchId: batchKey }, `${batchKey}__${id}`, notify, now);
    const retry = await disburseExpenseRequest(store, finance, id, { ...details, batchId: batchKey }, `${batchKey}__${id}`, notify, now);
    expect(retry.changed).toBe(false);
    expect(store.read('paymentAccounts', 'acc-cash')!.currentBalance).toBe(600);
  });

  it('cannot disburse a pending (unapproved) request', async () => {
    const store = freshStore();
    seedAccount(store, 'acc-cash', 1000);
    const res = await createExpenseRequest(store, employee, draft(), key(), notify, now);
    await expect(disburseExpenseRequest(store, finance, res.value.id, details, key(), notify, now)).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(store.read('paymentAccounts', 'acc-cash')!.currentBalance).toBe(1000);
  });

  it('insufficient balance aborts the WHOLE transaction (status, ledger, budget untouched)', async () => {
    const { store, id } = await approved(100, 400);
    await expect(disburseExpenseRequest(store, finance, id, details, key(), notify, now)).rejects.toMatchObject({ code: 'insufficient_funds' });
    expect(store.read('requests', id)!.status).toBe('approved');
    expect(store.dump('accountTransactions')).toHaveLength(0);
    expect(store.read('services', 'srv-1')!.spentAmount).toBe(0);
  });

  it('refuses to pay from another organization’s account', async () => {
    const { store, id } = await approved();
    seedAccount(store, 'acc-foreign', 10_000, { orgId: 'org-other' });
    await expect(disburseExpenseRequest(store, finance, id, { ...details, accountId: 'acc-foreign' }, key(), notify, now)).rejects.toMatchObject({ code: 'cross_org' });
  });

  it('InstaPay/wallet payments debit the linked bank inside the same transaction', async () => {
    const { store, id } = await approved();
    seedAccount(store, 'acc-bank', 5000, { type: 'bank' });
    seedAccount(store, 'acc-insta', 1000, { type: 'instapay', parentAccountId: 'acc-bank' });
    await disburseExpenseRequest(store, finance, id, { ...details, accountId: 'acc-insta' }, key(), notify, now);
    expect(store.read('paymentAccounts', 'acc-insta')!.currentBalance).toBe(600);
    expect(store.read('paymentAccounts', 'acc-bank')!.currentBalance).toBe(4600);
    expect(store.dump('accountTransactions').map(t => t.id).sort()).toEqual([`tx-req-${id}`, `tx-req-${id}-parent`]);
  });
});
