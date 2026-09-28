/**
 * Phase 5 — payment accounts ("cards"), balances, custodies and visa payments.
 */
import { describe, expect, it } from 'vitest';
import { adjustAccountBalance, createPaymentAccount, issueCustody, replenishCustody, settleCustodyItem, updatePaymentAccount } from '../src/domain/treasury';
import { addVisaPayment, createVisaRequest, decideVisaRequest } from '../src/domain/visa';
import { createOrganization } from '../src/domain/directory';
import { ORG, admin, burst, employee, finance, freshStore, key, seedAccount } from './helpers';

const now = new Date('2026-09-28T10:00:00.000Z');
const cardInput = (identifier = 'EG12CIB0001', initialBalance = 5000) => ({
  orgId: ORG,
  name: 'CIB Main',
  type: 'bank' as const,
  accountIdentifier: identifier,
  currency: 'EGP',
  active: true,
  initialBalance,
});

describe('creating a payment account (card)', () => {
  it('double click / Enter+click (same key) → ONE card and ONE opening transaction', async () => {
    const store = freshStore();
    const k = key();
    await burst(2, () => createPaymentAccount(store, admin, cardInput(), k, now));
    expect(store.dump('paymentAccounts')).toHaveLength(1);
    expect(store.dump('accountTransactions')).toHaveLength(1);
    expect(store.dump('auditLogs')).toHaveLength(1);
  });

  it('rapid click ×10 → one card', async () => {
    const store = freshStore();
    const k = key();
    await burst(10, () => createPaymentAccount(store, admin, cardInput(), k, now));
    expect(store.dump('paymentAccounts')).toHaveLength(1);
  });

  it('two tabs creating the SAME account number (different keys) → second is rejected by the unique key', async () => {
    const store = freshStore();
    const results = await Promise.allSettled([
      createPaymentAccount(store, admin, cardInput('EG12 cib-0001'), key(), now),
      createPaymentAccount(store, admin, cardInput('eg12cib0001'), key(), now),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'duplicate' } });
    expect(store.dump('paymentAccounts')).toHaveLength(1);
    expect(store.dump('accountTransactions')).toHaveLength(1); // no orphan opening entry
  });

  it('account + opening balance are atomic: a failed create leaves neither behind', async () => {
    const store = freshStore();
    await createPaymentAccount(store, admin, cardInput(), key(), now);
    await expect(createPaymentAccount(store, admin, cardInput(), key(), now)).rejects.toBeTruthy();
    expect(store.dump('paymentAccounts')).toHaveLength(1);
    expect(store.dump('accountTransactions')).toHaveLength(1);
  });

  it('balance fields cannot be overwritten through a generic update', async () => {
    const store = freshStore();
    const res = await createPaymentAccount(store, admin, cardInput(), key(), now);
    await updatePaymentAccount(store, admin, res.value.id, { name: 'Renamed', currentBalance: 1_000_000, balance: 1_000_000 }, key(), now);
    const acc = store.read('paymentAccounts', res.value.id)!;
    expect(acc.name).toBe('Renamed');
    expect(acc.currentBalance).toBe(5000);
  });

  it('a new organization gets its 4 standard cards exactly once, in the same transaction', async () => {
    const store = freshStore();
    const k = key();
    const superAdmin = { ...admin, role: 'super_admin' as const };
    await burst(3, () => createOrganization(store, superAdmin, { name: 'Beta', code: 'BETA', currency: 'EGP', budget: 1, description: '' }, k, now));
    expect(store.dump('organizations').filter(o => o.code === 'BETA')).toHaveLength(1);
    expect(store.dump('paymentAccounts').filter(a => a.orgId === 'org-beta')).toHaveLength(4);
    await expect(createOrganization(store, superAdmin, { name: 'Beta 2', code: 'BETA', currency: 'EGP', budget: 1, description: '' }, key(), now))
      .rejects.toMatchObject({ code: 'duplicate' });
  });
});

describe('balances never lose an update', () => {
  it('two concurrent withdrawals (200 and 300 from 1000) → 500, and the ledger chain is consistent', async () => {
    const store = freshStore();
    seedAccount(store, 'acc', 1000);
    await Promise.all([
      adjustAccountBalance(store, finance, { accountId: 'acc', type: 'out', amount: 200, description: 'A' }, key(), now),
      adjustAccountBalance(store, finance, { accountId: 'acc', type: 'out', amount: 300, description: 'B' }, key(), now),
    ]);
    expect(store.read('paymentAccounts', 'acc')!.currentBalance).toBe(500);
    const ledger = store.dump('accountTransactions');
    expect(ledger).toHaveLength(2);
    const afters = ledger.map(t => t.balanceAfter).sort((a, b) => a - b);
    expect(afters).toEqual([500, ledger.find(t => t.balanceAfter !== 500)!.balanceAfter]);
    ledger.forEach(t => expect(t.balanceBefore - t.amount).toBe(t.balanceAfter));
  });

  it('a retried deposit (same key) is applied once', async () => {
    const store = freshStore();
    seedAccount(store, 'acc', 1000);
    const k = key();
    await burst(5, () => adjustAccountBalance(store, finance, { accountId: 'acc', type: 'in', amount: 250, description: 'dep' }, k, now));
    expect(store.read('paymentAccounts', 'acc')!.currentBalance).toBe(1250);
    expect(store.dump('accountTransactions')).toHaveLength(1);
  });

  it('employees cannot move money', async () => {
    const store = freshStore();
    seedAccount(store, 'acc', 1000);
    await expect(adjustAccountBalance(store, employee, { accountId: 'acc', type: 'out', amount: 1, description: '' }, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('custodies', () => {
  const issue = (store: ReturnType<typeof freshStore>, k: string, amount = 1000) =>
    issueCustody(store, finance, { orgId: ORG, employeeId: employee.id, employeeName: employee.name, amount, sourceAccountId: 'cash' }, k, now);

  it('double submit issues ONE custody and deducts once', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    const k = key();
    await burst(3, () => issue(store, k));
    expect(store.dump('custodies')).toHaveLength(1);
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(4000);
  });

  it('concurrent custodies get unique numbers', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 50_000);
    const res = await Promise.all(Array.from({ length: 20 }, () => issue(store, key(), 100)));
    expect(new Set(res.map(r => r.value.custodyNumber)).size).toBe(20);
  });

  it('two concurrent settlements are both applied (no lost update on remaining)', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    const c = await issue(store, key());
    await Promise.all([
      settleCustodyItem(store, employee, { custodyId: c.value.id, amount: 300, description: 'a' }, key(), now),
      settleCustodyItem(store, employee, { custodyId: c.value.id, amount: 400, description: 'b' }, key(), now),
    ]);
    const custody = store.read('custodies', c.value.id)!;
    expect(custody.remainingAmount).toBe(300);
    expect(custody.settledAmount).toBe(700);
  });

  it('issue + replenish of the same custody are BOTH kept in the ledger (never "de-duplicated")', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    const c = await issue(store, key());
    await replenishCustody(store, finance, { custodyId: c.value.id, amount: 1000, sourceAccountId: 'cash' }, key(), now);
    const ledger = store.dump('accountTransactions').filter(t => t.referenceNumber === c.value.custodyNumber);
    expect(ledger).toHaveLength(2);
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(3000);
  });
});

describe('visa payments', () => {
  it('two concurrent payments cannot exceed the visa total', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 10_000);
    const visa = await createVisaRequest(store, employee, {
      orgId: ORG, requestDate: '2026-09-28', travelerName: 'T', passportNumber: 'P', destinationCountry: 'SA',
      hasTraveledBefore: false, expectedTravelDate: '2026-12-01', visaType: 'tourist', serviceProviderId: 'prov-1',
      serviceProviderName: 'AWS', assignedApprover: 'x', totalAmount: 1000, currency: 'EGP', paymentMode: 'installments',
      requesterId: employee.id, requesterName: employee.name,
    }, key(), now);
    await decideVisaRequest(store, admin, visa.value.id, { type: 'approve', approverName: 'x' }, key(), now);
    const pay = () => addVisaPayment(store, finance, visa.value.id, { amount: 600, currency: 'EGP', date: '2026-09-28', paymentMethod: 'cash', accountId: 'cash' }, key(), now);
    const results = await Promise.allSettled([pay(), pay()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(store.read('visaRequests', visa.value.id)!.paidAmount).toBe(600);
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(9400);
    // ledger goes to the real ledger collection (it used to go to a non-existent "transactions" collection)
    expect(store.dump('accountTransactions')).toHaveLength(1);
  });
});
