/**
 * Phase 5 — payment accounts ("cards"), balances, custodies and visa payments.
 */
import { describe, expect, it } from 'vitest';
import {
  adjustAccountBalance,
  applyMovement,
  createMovementBatch,
  createPaymentAccount,
  custodyReturnLedgerId,
  detachLegacyWallet,
  isLegacyLinkedWallet,
  issueCustody,
  readAccountWithParent,
  replenishCustody,
  returnCustodyRemainders,
  settleCustodyItem,
  transferBetweenAccounts,
  updatePaymentAccount,
} from '../src/domain/treasury';
import { addVisaPayment, createVisaRequest, decideVisaRequest } from '../src/domain/visa';
import { createOrganization } from '../src/domain/directory';
import { createExpenseRequest, disburseExpenseRequest, transitionExpenseRequest } from '../src/domain/requests';
import { requirePositiveAmount, type Actor } from '../src/domain/common';
import type { TxContext } from '../src/domain/store';
import { ORG, admin, burst, draft, employee, finance, freshStore, key, notify, otherEmployee, seedAccount } from './helpers';

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

  it('cannot settle an amount greater than the remaining balance', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    const c = await issue(store, key(), 500);
    await expect(
      settleCustodyItem(store, employee, { custodyId: c.value.id, amount: 600, description: 'too much' }, key(), now),
    ).rejects.toMatchObject({ code: 'insufficient_funds' });
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

// ---------------------------------------------------------------------------
// Movement batch (several movements in ONE transaction) + applyMovement contract
// ---------------------------------------------------------------------------
describe('movement batch', () => {
  const base = { referenceType: 'manual_adjustment' as const, description: 'd', parentDescription: 'p', actor: finance, nowIso: now.toISOString() };

  it('chains movements on the same account AND on an InstaPay parent; each account is written once', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 1000, { type: 'bank' });
    seedAccount(store, 'insta', 500, { type: 'instapay', parentAccountId: 'bank' });
    const accountWrites: string[] = [];
    await store.runTransaction(async tx => {
      const insta = await readAccountWithParent(tx, 'insta');
      const bank = await readAccountWithParent(tx, 'bank');
      const batch = createMovementBatch();
      batch.add({ ...base, account: insta.account, parent: insta.parent, type: 'out', amount: 300, allowOverdraft: false, ledgerId: 'L1' }); // insta 500→200, bank 1000→700
      batch.add({ ...base, account: bank.account, parent: bank.parent, type: 'out', amount: 600, allowOverdraft: false, ledgerId: 'L2' }); // bank 700→100
      // Chained: the bank now holds 100, not the 1000 read at the start → refused, and nothing recorded.
      expect(() => batch.add({ ...base, account: bank.account, parent: null, type: 'out', amount: 200, allowOverdraft: false, ledgerId: 'L3' }))
        .toThrow(expect.objectContaining({ code: 'insufficient_funds' }));
      batch.add({ ...base, account: insta.account, parent: insta.parent, type: 'in', amount: 50, allowOverdraft: false, ledgerId: 'L4' }); // insta 200→250, bank 100→150
      expect(batch.writeCount).toBe(2 + 5);
      const spy: TxContext = {
        get: tx.get,
        set: tx.set,
        delete: tx.delete,
        update(c, id, data) {
          if (c === 'paymentAccounts') accountWrites.push(id);
          tx.update(c, id, data);
        },
      };
      batch.write(spy);
    });
    expect(accountWrites.sort()).toEqual(['bank', 'insta']);
    expect(store.read('paymentAccounts', 'insta')).toMatchObject({ currentBalance: 250, balance: 250, totalIn: 50, totalOut: 300 });
    expect(store.read('paymentAccounts', 'bank')).toMatchObject({ currentBalance: 150, balance: 150, totalIn: 50, totalOut: 900 });
    const chain = Object.fromEntries(store.dump('accountTransactions').map(t => [t.id, [t.accountId, t.balanceBefore, t.balanceAfter]]));
    expect(chain).toEqual({
      L1: ['insta', 500, 200],
      'L1-parent': ['bank', 1000, 700],
      L2: ['bank', 700, 100],
      L4: ['insta', 200, 250],
      'L4-parent': ['bank', 100, 150],
    });
  });

  it('applyMovement keeps its exact output (ids incl. "-parent", fields, account patch, errors)', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 1000, { type: 'bank', totalIn: 10, totalOut: 5 });
    seedAccount(store, 'insta', 300, { type: 'instapay', parentAccountId: 'bank' });
    const nowIso = now.toISOString();
    const expected = {
      id: 'tx-k1',
      operationLedgerId: 'tx-k1',
      orgId: ORG,
      accountId: 'insta',
      accountName: 'Account insta',
      type: 'out',
      amount: 100,
      balanceBefore: 300,
      balanceAfter: 200,
      referenceType: 'request',
      referenceId: 'r1',
      referenceNumber: 'REQ-1',
      description: 'd',
      actorName: finance.name,
      actorId: finance.id,
      createdAt: nowIso,
    };
    await store.runTransaction(async tx => {
      const { account, parent } = await readAccountWithParent(tx, 'insta');
      const m = applyMovement({ ...base, account, parent, type: 'out', amount: 100, allowOverdraft: false, ledgerId: 'tx-k1', referenceType: 'request', referenceId: 'r1', referenceNumber: 'REQ-1', parentDescription: 'pd' });
      expect(Object.keys(m).sort()).toEqual(['balanceAfter', 'balanceBefore', 'ledger', 'write']);
      expect(m.balanceBefore).toBe(300);
      expect(m.balanceAfter).toBe(200);
      expect(m.ledger).toEqual(expected);
      m.write(tx);
    });
    expect(store.read('accountTransactions', 'tx-k1')).toEqual(expected);
    expect(store.read('accountTransactions', 'tx-k1-parent')).toEqual({
      ...expected,
      id: 'tx-k1-parent',
      operationLedgerId: 'tx-k1-parent',
      accountId: 'bank',
      accountName: 'Account bank',
      balanceBefore: 1000,
      balanceAfter: 900,
      description: 'pd',
    });
    expect(store.read('paymentAccounts', 'bank')).toMatchObject({ currentBalance: 900, balance: 900, totalIn: 10, totalOut: 105, updatedAt: nowIso });
    expect(store.read('paymentAccounts', 'insta')).toMatchObject({ currentBalance: 200, balance: 200, totalIn: 0, totalOut: 100, updatedAt: nowIso });

    const attempt = (accountId: string, amount: number) =>
      store.runTransaction(async tx => {
        const { account, parent } = await readAccountWithParent(tx, accountId);
        applyMovement({ ...base, account, parent, type: 'out', amount, allowOverdraft: false, ledgerId: 'tx-k2' }).write(tx);
      });
    // Policy: no money operation takes an account below zero, and the refusal tells the user
    // what to do (deposit first). The message names the account, both amounts and the fix.
    await expect(attempt('insta', 5000)).rejects.toMatchObject({
      code: 'insufficient_funds',
      message: 'رصيد الحساب "Account insta" غير كافٍ لإتمام العملية: الرصيد المتوفر (200 EGP) أقل من المبلغ المطلوب (5,000 EGP). يرجى إيداع المبلغ في الحساب أولاً (إيداع وتغذية رصيد + IN) أو اختيار حساب آخر.',
    });
    seedAccount(store, 'insta-rich', 5000, { type: 'instapay', parentAccountId: 'bank' });
    await expect(attempt('insta-rich', 1000)).rejects.toMatchObject({
      code: 'insufficient_funds',
      message: 'رصيد الحساب البنكي المرتبط "Account bank" غير كافٍ لإتمام الخصم عبر "Account insta-rich": الرصيد المتوفر (900 EGP) أقل من المبلغ المطلوب (1,000 EGP). يرجى إيداع المبلغ في الحساب البنكي أولاً أو اختيار حساب آخر.',
    });
  });
});

// ---------------------------------------------------------------------------
// E-wallet = standalone treasury; InstaPay = channel on a bank
// ---------------------------------------------------------------------------
describe('e-wallets are standalone treasuries (legacy linked ones until detached), InstaPay still mirrors its bank', () => {
  it('readAccountWithParent follows the link of an InstaPay and of a not-yet-detached legacy wallet only', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 1000, { type: 'bank' });
    seedAccount(store, 'insta', 0, { type: 'instapay', parentAccountId: 'bank' });
    seedAccount(store, 'legacy-wallet', 0, { type: 'wallet', parentAccountId: 'bank' });
    seedAccount(store, 'wallet', 0, { type: 'wallet' });
    seedAccount(store, 'cash', 0, { parentAccountId: 'bank' }); // stray field on a cash box: never mirrors
    await store.runTransaction(async tx => {
      expect((await readAccountWithParent(tx, 'insta')).parent?.id).toBe('bank');
      expect((await readAccountWithParent(tx, 'legacy-wallet')).parent?.id).toBe('bank');
      expect((await readAccountWithParent(tx, 'wallet')).parent).toBeNull();
      expect((await readAccountWithParent(tx, 'cash')).parent).toBeNull();
    });
    expect(isLegacyLinkedWallet(store.read('paymentAccounts', 'legacy-wallet') as any)).toBe(true);
    expect(isLegacyLinkedWallet(store.read('paymentAccounts', 'insta') as any)).toBe(false);
  });

  it('a standalone wallet never touches any bank: deposit, custody, disbursement, return, transfer', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 10_000, { type: 'bank' });
    seedAccount(store, 'wallet', 1000, { type: 'wallet' });

    await adjustAccountBalance(store, finance, { accountId: 'wallet', type: 'in', amount: 500, description: 'شحن محفظة' }, key(), now);
    const c = await issueCustody(store, finance, { orgId: ORG, employeeId: employee.id, employeeName: employee.name, amount: 300, sourceAccountId: 'wallet' }, key(), now);
    const req = await createExpenseRequest(store, employee, draft({ amount: 200 }), key(), notify, now);
    await transitionExpenseRequest(store, admin, req.value.id, { type: 'approve' }, key(), notify, now);
    await disburseExpenseRequest(store, finance, req.value.id, { paymentMethod: 'wallet', referenceNumber: 'W-1', accountId: 'wallet' }, key(), notify, now);
    await returnCustodyRemainders(store, finance, { custodyIds: [c.value.id] }, key(), now);

    expect(store.read('paymentAccounts', 'wallet')!.currentBalance).toBe(1000 + 500 - 300 - 200 + 300);
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(10_000);
    expect(store.dump('accountTransactions').filter(t => t.accountId === 'bank' || t.id.endsWith('-parent'))).toHaveLength(0);

    // A wallet can receive from (and send to) a bank: they are two separate funds.
    await transferBetweenAccounts(store, finance, { fromAccountId: 'bank', toAccountId: 'wallet', amount: 1000 }, key(), now);
    await transferBetweenAccounts(store, finance, { fromAccountId: 'wallet', toAccountId: 'bank', amount: 300 }, key(), now);
    expect(store.read('paymentAccounts', 'wallet')!.currentBalance).toBe(1300 + 1000 - 300);
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(10_000 - 1000 + 300);
    expect(store.dump('accountTransactions').filter(t => t.id.endsWith('-parent'))).toHaveLength(0);
  });

  it('a legacy wallet keeps mirroring (balances stay consistent) until detached; detaching books the confirmed correction on the bank once', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 10_000, { type: 'bank', name: 'CIB' });
    seedAccount(store, 'wallet', 1000, { type: 'wallet', parentAccountId: 'bank', parentAccountName: 'CIB' });

    await adjustAccountBalance(store, finance, { accountId: 'wallet', type: 'in', amount: 500, description: 'شحن محفظة' }, key(), now);
    await issueCustody(store, finance, { orgId: ORG, employeeId: employee.id, employeeName: employee.name, amount: 300, sourceAccountId: 'wallet' }, key(), now);
    expect(store.read('paymentAccounts', 'wallet')).toMatchObject({ currentBalance: 1200, totalIn: 500, totalOut: 300 });
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(10_200); // mirrored, as before
    // while linked they are one fund: no transfer between them
    await expect(transferBetweenAccounts(store, finance, { fromAccountId: 'wallet', toAccountId: 'bank', amount: 1 }, key(), now)).rejects.toMatchObject({ code: 'same_funds' });

    const suggested = 300 - 500; // wallet totalOut - totalIn = what mirroring moved on the bank, reversed
    const input = { walletId: 'wallet', bankCorrection: suggested, expectedWalletTotals: { totalIn: 500, totalOut: 300 } };
    await expect(detachLegacyWallet(store, finance, input, key(), now)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(detachLegacyWallet(store, admin, { ...input, expectedWalletTotals: { totalIn: 500, totalOut: 0 } }, key(), now)).rejects.toMatchObject({ code: 'stale' });
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(10_200);

    const k = key();
    const [first, second] = await burst(2, () => detachLegacyWallet(store, admin, input, k, now));
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('fulfilled');
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(10_000);
    expect(store.read('paymentAccounts', 'wallet')).toMatchObject({ currentBalance: 1200, parentAccountId: '', parentAccountName: '' });
    expect(store.read('accountTransactions', `tx-${k}`)).toMatchObject({ accountId: 'bank', type: 'out', amount: 200, balanceBefore: 10_200, balanceAfter: 10_000, referenceType: 'manual_adjustment', referenceId: 'wallet' });
    expect(store.read('auditLogs', `audit-${k}`)!.details).toContain('فصل المحفظة');
    const retry = await detachLegacyWallet(store, admin, input, k, now);
    expect(retry.changed).toBe(false);
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(10_000);

    // from now on the wallet is its own fund
    const mirrorsBefore = store.dump('accountTransactions').filter(t => t.id.endsWith('-parent')).length;
    await adjustAccountBalance(store, finance, { accountId: 'wallet', type: 'out', amount: 100, description: 'سحب' }, key(), now);
    await transferBetweenAccounts(store, finance, { fromAccountId: 'wallet', toAccountId: 'bank', amount: 100 }, key(), now);
    expect(store.read('paymentAccounts', 'wallet')!.currentBalance).toBe(1000);
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(10_100);
    expect(store.dump('accountTransactions').filter(t => t.id.endsWith('-parent'))).toHaveLength(mirrorsBefore);
  });

  it('detaching with no correction only removes the link; a missing bank can only be detached without one', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 5000, { type: 'bank' });
    seedAccount(store, 'wallet', 0, { type: 'wallet', parentAccountId: 'bank' });
    seedAccount(store, 'orphan', 0, { type: 'wallet', parentAccountId: 'deleted-bank' });
    const ledgerBefore = store.dump('accountTransactions').length;
    await detachLegacyWallet(store, admin, { walletId: 'wallet', bankCorrection: 0 }, key(), now);
    expect(store.read('paymentAccounts', 'wallet')!.parentAccountId).toBe('');
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(5000);
    expect(store.dump('accountTransactions')).toHaveLength(ledgerBefore);

    await expect(detachLegacyWallet(store, admin, { walletId: 'orphan', bankCorrection: 50 }, key(), now)).rejects.toMatchObject({ code: 'account_not_found' });
    await detachLegacyWallet(store, admin, { walletId: 'orphan', bankCorrection: 0 }, key(), now);
    expect(store.read('paymentAccounts', 'orphan')!.parentAccountId).toBe('');
  });

  it('InstaPay still mirrors every movement on its linked bank', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 5000, { type: 'bank' });
    seedAccount(store, 'insta', 1000, { type: 'instapay', parentAccountId: 'bank' });
    const k = key();
    await adjustAccountBalance(store, finance, { accountId: 'insta', type: 'in', amount: 250, description: 'وارد إنستاباي' }, k, now);
    await issueCustody(store, finance, { orgId: ORG, employeeId: employee.id, employeeName: employee.name, amount: 100, sourceAccountId: 'insta' }, key(), now);
    expect(store.read('paymentAccounts', 'insta')!.currentBalance).toBe(1150);
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(5150);
    expect(store.read('accountTransactions', `tx-${k}-parent`)).toMatchObject({ accountId: 'bank', type: 'in', amount: 250, balanceBefore: 5000, balanceAfter: 5250 });
  });

  it('a new wallet is never linked to a bank; a legacy link survives edits until detached; an InstaPay keeps its bank', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 0, { type: 'bank' });
    const wallet = await createPaymentAccount(store, admin, { ...cardInput('01012345678', 0), name: 'Vodafone Cash', type: 'wallet', parentAccountId: 'bank', parentAccountName: 'Account bank' }, key(), now);
    expect(store.read('paymentAccounts', wallet.value.id)!.parentAccountId).toBeUndefined();
    expect(store.read('paymentAccounts', wallet.value.id)!.parentAccountName).toBeUndefined();

    const insta = await createPaymentAccount(store, admin, { ...cardInput('acme@instapay', 0), name: 'InstaPay', type: 'instapay', parentAccountId: 'bank', parentAccountName: 'Account bank' }, key(), now);
    expect(store.read('paymentAccounts', insta.value.id)).toMatchObject({ parentAccountId: 'bank', parentAccountName: 'Account bank' });
    await updatePaymentAccount(store, admin, insta.value.id, { name: 'InstaPay 2', parentAccountId: 'bank' }, key(), now);
    expect(store.read('paymentAccounts', insta.value.id)!.parentAccountId).toBe('bank');
    await expect(updatePaymentAccount(store, admin, insta.value.id, { parentAccountId: insta.value.id }, key(), now)).rejects.toMatchObject({ code: 'invalid_parent' });

    // InstaPay turned into a wallet → its link is carried over (it mirrored until now) and it
    // becomes a legacy linked wallet, detachable with the bank correction.
    await updatePaymentAccount(store, admin, insta.value.id, { type: 'wallet' }, key(), now);
    expect(store.read('paymentAccounts', insta.value.id)).toMatchObject({ type: 'wallet', parentAccountId: 'bank' });

    // A legacy wallet keeps its link through ordinary edits (only detachLegacyWallet removes it),
    // and a wallet can never be (re)linked by the form.
    seedAccount(store, 'legacy-wallet', 0, { type: 'wallet', parentAccountId: 'bank', parentAccountName: 'Account bank' });
    await updatePaymentAccount(store, admin, 'legacy-wallet', { name: 'Orange Cash', parentAccountId: '', parentAccountName: '' }, key(), now);
    expect(store.read('paymentAccounts', 'legacy-wallet')).toMatchObject({ name: 'Orange Cash', parentAccountId: 'bank', parentAccountName: 'Account bank' });
    seedAccount(store, 'free-wallet', 0, { type: 'wallet' });
    await updatePaymentAccount(store, admin, 'free-wallet', { parentAccountId: 'bank', parentAccountName: 'Account bank' }, key(), now);
    expect(store.read('paymentAccounts', 'free-wallet')!.parentAccountId).toBeUndefined();
    // …and a still-linked account cannot silently become a type that does not mirror
    await expect(updatePaymentAccount(store, admin, 'legacy-wallet', { type: 'cash' }, key(), now)).rejects.toMatchObject({ code: 'linked_account' });

    // A plain cash box without a link is left untouched (no empty fields added).
    seedAccount(store, 'cash', 0);
    await updatePaymentAccount(store, admin, 'cash', { name: 'Main cash' }, key(), now);
    expect('parentAccountId' in store.read('paymentAccounts', 'cash')!).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Custody return (إيداع المتبقي من العهدة / استرداد العهد)
// ---------------------------------------------------------------------------
describe('custody return — the remainder goes back to a treasury exactly once', () => {
  const issueFrom = (store: ReturnType<typeof freshStore>, sourceAccountId: string, amount: number, who: Actor = employee) =>
    issueCustody(store, finance, { orgId: ORG, employeeId: who.id, employeeName: who.name, amount, sourceAccountId }, key(), now);
  const giveBack = (store: ReturnType<typeof freshStore>, custodyIds: string[], k = key(), extra: { targetAccountId?: string; notes?: string } = {}, who: Actor = finance) =>
    returnCustodyRemainders(store, who, { custodyIds, ...extra }, k, now);
  const returnLedger = (store: ReturnType<typeof freshStore>) => store.dump('accountTransactions').filter(t => t.referenceType === 'custody_return');

  it('per-custody button: deposits exactly the remainder into the account the custody was withdrawn from', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    const c = await issueFrom(store, 'cash', 1000);
    await settleCustodyItem(store, employee, { custodyId: c.value.id, amount: 300, description: 'بنزين' }, key(), now);
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(4000);

    const k = key();
    const res = await giveBack(store, [c.value.id], k);
    expect(res.changed).toBe(true);
    expect(res.value).toEqual({
      returned: [{ custodyId: c.value.id, custodyNumber: c.value.custodyNumber, employeeName: employee.name, amount: 700, accountId: 'cash', accountName: 'Account cash' }],
      skipped: [],
      totalReturned: 700,
    });
    expect(store.read('paymentAccounts', 'cash')).toMatchObject({ currentBalance: 4700, balance: 4700, totalIn: 700, totalOut: 1000 });
    const ledger = returnLedger(store);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      id: custodyReturnLedgerId(k, c.value.id),
      accountId: 'cash',
      type: 'in',
      amount: 700,
      balanceBefore: 4000,
      balanceAfter: 4700,
      referenceType: 'custody_return',
      referenceId: c.value.id,
      referenceNumber: c.value.custodyNumber,
      actorId: finance.id,
    });
    expect(ledger[0].description).toContain(employee.name);
    expect(ledger[0].description).toContain(c.value.custodyNumber);
    expect(store.read('custodies', c.value.id)).toMatchObject({
      totalAmount: 1000,
      settledAmount: 300,
      remainingAmount: 0,
      returnedAmount: 700,
      status: 'settled',
      settledAt: now.toISOString(),
      returnedAt: now.toISOString(),
      returnedToAccountId: 'cash',
      returnedToAccountName: 'Account cash',
    });
    expect(store.read('auditLogs', `audit-${k}-${c.value.id}`)).toMatchObject({ entityType: 'custody', entityId: c.value.id, actorId: finance.id });
  });

  it('double submit / rapid clicks (same key) → returned ONCE; the replays report duplicate_operation', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    const c = await issueFrom(store, 'cash', 1000);
    const k = key();
    const results = await burst(3, () => giveBack(store, [c.value.id], k));
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    const values = results.map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof giveBack>>>).value);
    expect(values.filter(v => v.changed)).toHaveLength(1);
    values.filter(v => !v.changed).forEach(v => {
      expect(v.reason).toBe('duplicate_operation');
      expect(v.value.skipped).toEqual([{ custodyId: c.value.id, reason: 'already_done' }]);
    });
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(5000);
    expect(returnLedger(store)).toHaveLength(1);
    expect(store.read('custodies', c.value.id)!.returnedAmount).toBe(1000);
  });

  it('two users / tabs (different keys) at the same time → the money is returned once, the other is refused', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    const c = await issueFrom(store, 'cash', 1000);
    const results = await Promise.allSettled([giveBack(store, [c.value.id]), giveBack(store, [c.value.id])]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'nothing_to_return' } });
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(5000);
    expect(returnLedger(store)).toHaveLength(1);
  });

  it('bulk: 3 custodies into ONE chosen account in one operation → balance = before + sum, one chained entry per custody', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 10_000);
    seedAccount(store, 'bank', 2000, { type: 'bank' });
    const a = await issueFrom(store, 'cash', 500);
    const b = await issueFrom(store, 'cash', 700, otherEmployee);
    const c = await issueFrom(store, 'cash', 900);
    await settleCustodyItem(store, finance, { custodyId: b.value.id, amount: 200, description: 'x' }, key(), now);

    const commits = store.commits;
    const res = await giveBack(store, [a.value.id, b.value.id, c.value.id], key(), { targetAccountId: 'bank', notes: 'تصفية نهاية الشهر' });
    expect(store.commits).toBe(commits + 1); // one transaction
    expect(res.value.totalReturned).toBe(500 + 500 + 900);
    expect(res.value.returned.map(r => [r.employeeName, r.amount, r.accountId])).toEqual([
      [employee.name, 500, 'bank'],
      [otherEmployee.name, 500, 'bank'],
      [employee.name, 900, 'bank'],
    ]);
    expect(store.read('paymentAccounts', 'bank')).toMatchObject({ currentBalance: 3900, totalIn: 1900 });
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(10_000 - 2100); // the source is not touched

    const ledger = returnLedger(store).sort((x, y) => x.balanceBefore - y.balanceBefore);
    expect(ledger).toHaveLength(3);
    expect(ledger[0].balanceBefore).toBe(2000);
    for (let i = 1; i < ledger.length; i++) expect(ledger[i].balanceBefore).toBe(ledger[i - 1].balanceAfter);
    expect(ledger[2].balanceAfter).toBe(3900);
    ledger.forEach(t => expect(t.balanceBefore + t.amount).toBe(t.balanceAfter));
    ledger.forEach(t => expect(t.description).toContain('تصفية نهاية الشهر'));
    [a, b, c].forEach(x => expect(store.read('custodies', x.value.id)).toMatchObject({ remainingAmount: 0, status: 'settled', returnedToAccountId: 'bank' }));
    expect(new Set(store.dump('auditLogs').filter(l => l.details.startsWith('رد المتبقي')).map(l => l.id)).size).toBe(3);
  });

  it('per-custody mode with several custodies: each goes back to its own source, balances chained (InstaPay parent included)', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 10_000, { type: 'bank' });
    seedAccount(store, 'insta', 3000, { type: 'instapay', parentAccountId: 'bank' });
    seedAccount(store, 'cash', 5000);
    const fromInsta = await issueFrom(store, 'insta', 400); // insta 2600, bank 9600
    const fromBank = await issueFrom(store, 'bank', 600); // bank 9000
    const fromCash1 = await issueFrom(store, 'cash', 100);
    const fromCash2 = await issueFrom(store, 'cash', 200); // cash 4700

    const k = key();
    const res = await giveBack(store, [fromInsta.value.id, fromBank.value.id, fromCash1.value.id, fromCash2.value.id], k);
    expect(res.value.returned.map(r => r.accountId)).toEqual(['insta', 'bank', 'cash', 'cash']);
    expect(store.read('paymentAccounts', 'insta')!.currentBalance).toBe(3000);
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(10_000);
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(5000);
    const byId = (id: string) => store.read('accountTransactions', id)!;
    const insta = custodyReturnLedgerId(k, fromInsta.value.id);
    expect(byId(`${insta}-parent`)).toMatchObject({ accountId: 'bank', balanceBefore: 9000, balanceAfter: 9400 });
    expect(byId(custodyReturnLedgerId(k, fromBank.value.id))).toMatchObject({ accountId: 'bank', balanceBefore: 9400, balanceAfter: 10_000 });
    expect(byId(custodyReturnLedgerId(k, fromCash1.value.id))).toMatchObject({ balanceBefore: 4700, balanceAfter: 4800 });
    expect(byId(custodyReturnLedgerId(k, fromCash2.value.id))).toMatchObject({ balanceBefore: 4800, balanceAfter: 5000 });
  });

  it('an InstaPay target mirrors the deposit on its linked bank', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    seedAccount(store, 'bank', 10_000, { type: 'bank' });
    seedAccount(store, 'insta', 1000, { type: 'instapay', parentAccountId: 'bank' });
    const c = await issueFrom(store, 'cash', 800);
    const k = key();
    await giveBack(store, [c.value.id], k, { targetAccountId: 'insta' });
    expect(store.read('paymentAccounts', 'insta')!.currentBalance).toBe(1800);
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(10_800);
    const id = custodyReturnLedgerId(k, c.value.id);
    expect(returnLedger(store).map(t => t.id).sort()).toEqual([id, `${id}-parent`]);
  });

  it('skips an already-empty custody and an unknown id (and de-duplicates ids); nothing to return at all → refused', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    const empty = await issueFrom(store, 'cash', 300);
    await settleCustodyItem(store, employee, { custodyId: empty.value.id, amount: 300, description: 'صرفت بالكامل' }, key(), now);
    const live = await issueFrom(store, 'cash', 400);

    const res = await giveBack(store, [empty.value.id, 'cus-missing', live.value.id, ` ${live.value.id} `]);
    expect(res.value.returned.map(r => r.custodyId)).toEqual([live.value.id]);
    expect(res.value.skipped).toEqual([
      { custodyId: empty.value.id, reason: 'nothing_remaining' },
      { custodyId: 'cus-missing', reason: 'not_found' },
    ]);
    expect(res.value.totalReturned).toBe(400);
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(5000 - 300);
    await expect(giveBack(store, [empty.value.id, live.value.id])).rejects.toMatchObject({ code: 'nothing_to_return', message: 'لا يوجد متبقٍ في العهد المحددة لرده.' });
  });

  it('refuses another company’s account, a different currency, or a missing account — atomically, nothing written', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    seedAccount(store, 'foreign', 0, { orgId: 'org-other' });
    seedAccount(store, 'usd', 0, { currency: 'USD' });
    const ok = await issueFrom(store, 'cash', 1000);
    const orphan = await issueFrom(store, 'cash', 500);
    store.seed('custodies', 'cus-foreign', { ...store.read('custodies', ok.value.id)!, id: 'cus-foreign', orgId: 'org-other', custodyNumber: 'CUS-X' });
    const commits = store.commits;

    await expect(giveBack(store, [ok.value.id], key(), { targetAccountId: 'foreign' })).rejects.toMatchObject({ code: 'cross_org' });
    // one bad custody in a bulk selection refuses the whole operation
    await expect(giveBack(store, [ok.value.id, 'cus-foreign'], key(), { targetAccountId: 'cash' })).rejects.toMatchObject({ code: 'cross_org' });
    await expect(giveBack(store, [ok.value.id], key(), { targetAccountId: 'usd' })).rejects.toMatchObject({ code: 'currency_mismatch' });
    await expect(giveBack(store, [ok.value.id], key(), { targetAccountId: 'nope' })).rejects.toMatchObject({
      code: 'account_not_found',
      message: expect.stringContaining('يرجى اختيار حساب آخر'),
    });
    store.seed('custodies', orphan.value.id, { ...store.read('custodies', orphan.value.id)!, sourceAccountId: 'deleted-account' });
    await expect(giveBack(store, [orphan.value.id])).rejects.toMatchObject({ code: 'account_not_found', message: expect.stringContaining('يرجى اختيار حساب آخر') });

    expect(store.commits).toBe(commits);
    expect(store.read('custodies', ok.value.id)!.remainingAmount).toBe(1000);
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(3500);
  });

  it('employees cannot return custody money (not even their own); 1..100 custodies per operation', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    const c = await issueFrom(store, 'cash', 1000);
    await expect(giveBack(store, [c.value.id], key(), {}, employee)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(giveBack(store, [])).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(giveBack(store, ['', '  '])).rejects.toMatchObject({ code: 'invalid_input' });
    const tooMany = Array.from({ length: 101 }, (_, i) => `cus-${i}`);
    await expect(giveBack(store, tooMany)).rejects.toMatchObject({ code: 'too_many' });
    // 100 distinct ids (after de-duplication) are fine
    const res = await giveBack(store, [...tooMany.slice(0, 99), c.value.id, c.value.id]);
    expect(res.value.returned).toHaveLength(1);
    expect(res.value.skipped).toHaveLength(99);
    expect(store.read('custodies', c.value.id)!.remainingAmount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Transfer between accounts (ترانسفير)
// ---------------------------------------------------------------------------
describe('transfer between accounts', () => {
  const transfer = (store: ReturnType<typeof freshStore>, fromAccountId: string, toAccountId: string, amount: number, k = key(), description?: string, who: Actor = finance) =>
    transferBetweenAccounts(store, who, { fromAccountId, toAccountId, amount, description }, k, now);

  it('moves the money: both balances, an out/in ledger pair, a TRF number and one audit entry', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 5000, { type: 'bank' });
    seedAccount(store, 'cash', 1000);
    const k = key();
    const res = await transfer(store, 'bank', 'cash', 1200, k, 'تغذية الخزينة النقدية');
    expect(res.changed).toBe(true);
    expect(res.value.transferNumber).toBe('TRF-2026-000001');
    expect(store.read('paymentAccounts', 'bank')).toMatchObject({ currentBalance: 3800, balance: 3800, totalOut: 1200 });
    expect(store.read('paymentAccounts', 'cash')).toMatchObject({ currentBalance: 2200, balance: 2200, totalIn: 1200 });

    const common = { amount: 1200, referenceType: 'transfer', referenceId: `trf-${k}`, referenceNumber: 'TRF-2026-000001', actorId: finance.id };
    expect(store.read('accountTransactions', `tx-${k}-out`)).toMatchObject({
      ...common, accountId: 'bank', type: 'out', balanceBefore: 5000, balanceAfter: 3800, description: 'تحويل صادر إلى (Account cash): تغذية الخزينة النقدية',
    });
    expect(store.read('accountTransactions', `tx-${k}-in`)).toMatchObject({
      ...common, accountId: 'cash', type: 'in', balanceBefore: 1000, balanceAfter: 2200, description: 'تحويل وارد من (Account bank): تغذية الخزينة النقدية',
    });
    expect(store.dump('accountTransactions')).toHaveLength(2);
    expect(res.value.out).toMatchObject({ id: `tx-${k}-out`, balanceAfter: 3800 });
    expect(res.value.in).toMatchObject({ id: `tx-${k}-in`, balanceAfter: 2200 });
    expect(store.dump('auditLogs').map(a => a.id)).toEqual([`audit-${k}`]);
    expect(store.read('counters', 'transfers-2026')!.value).toBe(1);

    const second = await transfer(store, 'cash', 'bank', 200);
    expect(second.value.transferNumber).toBe('TRF-2026-000002');
    expect(second.value.out.description).toBe('تحويل صادر إلى (Account bank)');
  });

  it('never overdraws the source: refused and NOTHING written (no balance change, no ledger, no number burnt)', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 100);
    seedAccount(store, 'bank', 0, { type: 'bank' });
    seedAccount(store, 'bank2', 50, { type: 'bank' });
    seedAccount(store, 'insta2', 1000, { type: 'instapay', parentAccountId: 'bank2' });
    const commits = store.commits;
    await expect(transfer(store, 'cash', 'bank', 500)).rejects.toMatchObject({ code: 'insufficient_funds' });
    // an InstaPay channel is limited by the bank behind it
    await expect(transfer(store, 'insta2', 'cash', 500)).rejects.toMatchObject({ code: 'insufficient_funds', message: expect.stringContaining('Account bank2') });
    expect(store.commits).toBe(commits);
    expect(store.dump('accountTransactions')).toHaveLength(0);
    expect(store.read('counters', 'transfers-2026')).toBeNull();
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(100);
    expect(store.read('paymentAccounts', 'insta2')!.currentBalance).toBe(1000);
  });

  it('refuses: same account, inactive/missing account, another company, another currency, the same underlying funds', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 5000, { type: 'bank' });
    seedAccount(store, 'insta', 5000, { type: 'instapay', parentAccountId: 'bank' });
    seedAccount(store, 'insta2', 5000, { type: 'instapay', parentAccountId: 'bank' });
    seedAccount(store, 'cash', 5000);
    seedAccount(store, 'foreign', 0, { orgId: 'org-other' });
    seedAccount(store, 'usd', 0, { currency: 'USD' });
    seedAccount(store, 'off', 0, { active: false });
    const commits = store.commits;

    await expect(transfer(store, 'cash', 'cash', 10)).rejects.toMatchObject({ code: 'same_account' });
    await expect(transfer(store, 'cash', 'off', 10)).rejects.toMatchObject({ code: 'inactive_account' });
    await expect(transfer(store, 'cash', 'nope', 10)).rejects.toMatchObject({ code: 'account_not_found' });
    await expect(transfer(store, 'cash', 'foreign', 10)).rejects.toMatchObject({ code: 'cross_org' });
    await expect(transfer(store, 'cash', 'usd', 10)).rejects.toMatchObject({ code: 'currency_mismatch' });
    await expect(transfer(store, 'bank', 'insta', 10)).rejects.toMatchObject({ code: 'same_funds' });
    await expect(transfer(store, 'insta', 'bank', 10)).rejects.toMatchObject({ code: 'same_funds' });
    await expect(transfer(store, 'insta', 'insta2', 10)).rejects.toMatchObject({ code: 'same_funds' });
    await expect(transfer(store, 'cash', 'bank', 0)).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(transfer(store, 'cash', 'bank', 10, key(), undefined, employee)).rejects.toMatchObject({ code: 'forbidden' });
    expect(store.commits).toBe(commits);
  });

  it('InstaPay on either side mirrors on its bank; InstaPay → another bank’s InstaPay is allowed', async () => {
    const store = freshStore();
    seedAccount(store, 'bankA', 5000, { type: 'bank' });
    seedAccount(store, 'instaA', 5000, { type: 'instapay', parentAccountId: 'bankA' });
    seedAccount(store, 'bankB', 1000, { type: 'bank' });
    seedAccount(store, 'instaB', 1000, { type: 'instapay', parentAccountId: 'bankB' });
    const k = key();
    await transfer(store, 'instaA', 'instaB', 700, k);
    expect(store.read('paymentAccounts', 'instaA')!.currentBalance).toBe(4300);
    expect(store.read('paymentAccounts', 'bankA')!.currentBalance).toBe(4300);
    expect(store.read('paymentAccounts', 'instaB')!.currentBalance).toBe(1700);
    expect(store.read('paymentAccounts', 'bankB')!.currentBalance).toBe(1700);
    expect(store.dump('accountTransactions').map(t => t.id).sort()).toEqual([`tx-${k}-in`, `tx-${k}-in-parent`, `tx-${k}-out`, `tx-${k}-out-parent`]);
  });

  it('double click / retry (same key) → ONE transfer', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 5000, { type: 'bank' });
    seedAccount(store, 'cash', 1000);
    const k = key();
    const results = await burst(5, () => transfer(store, 'bank', 'cash', 1000, k));
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    const values = results.map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof transfer>>>).value);
    expect(values.filter(v => v.changed)).toHaveLength(1);
    values.forEach(v => expect(v.value.transferNumber).toBe('TRF-2026-000001'));
    values.filter(v => !v.changed).forEach(v => {
      expect(v.reason).toBe('duplicate_operation');
      expect(v.value.in.id).toBe(`tx-${k}-in`);
    });
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(4000);
    expect(store.read('paymentAccounts', 'cash')!.currentBalance).toBe(2000);
    expect(store.dump('accountTransactions')).toHaveLength(2);
    expect(store.dump('auditLogs')).toHaveLength(1);
    expect(store.read('counters', 'transfers-2026')!.value).toBe(1);
  });

  it('concurrent transfers from ONE account never lose an update and together never overdraw it', async () => {
    const store = freshStore();
    seedAccount(store, 'bank', 1000, { type: 'bank' });
    seedAccount(store, 'cash', 0);
    seedAccount(store, 'wallet', 0, { type: 'wallet' });
    const results = await Promise.allSettled([
      transfer(store, 'bank', 'cash', 400),
      transfer(store, 'bank', 'wallet', 400),
      transfer(store, 'bank', 'cash', 400),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'insufficient_funds' } });
    expect(store.read('paymentAccounts', 'bank')!.currentBalance).toBe(200);
    const received = store.read('paymentAccounts', 'cash')!.currentBalance + store.read('paymentAccounts', 'wallet')!.currentBalance;
    expect(received).toBe(800);
    const outs = store.dump('accountTransactions').filter(t => t.accountId === 'bank').sort((a, b) => b.balanceBefore - a.balanceBefore);
    expect(outs.map(t => [t.balanceBefore, t.balanceAfter])).toEqual([[1000, 600], [600, 200]]);
    expect(new Set(store.dump('accountTransactions').map(t => t.referenceNumber)).size).toBe(2);
    expect(store.read('counters', 'transfers-2026')!.value).toBe(2);
  });

  it('requirePositiveAmount strictly rejects negative numbers, zero, and non-finite values', () => {
    expect(() => requirePositiveAmount(-100)).toThrow();
    expect(() => requirePositiveAmount(-0.01)).toThrow();
    expect(() => requirePositiveAmount(0)).toThrow();
    expect(() => requirePositiveAmount('not-a-number')).toThrow();
    expect(requirePositiveAmount(100)).toBe(100);
    expect(requirePositiveAmount('250.5')).toBe(250.5);
  });

  it('issueCustody records employeeEmail and settleCustodyItem allows settlement by matching email or name in org', async () => {
    const store = freshStore();
    seedAccount(store, 'cash', 5000);
    const k = key();
    const custodyRes = await issueCustody(
      store,
      finance,
      {
        orgId: ORG,
        employeeId: 'emp_custom_hussein_99',
        employeeName: 'حسين محمد',
        employeeEmail: 'hussein@example.com',
        amount: 1500,
        sourceAccountId: 'cash',
        notes: 'عهدة مشتريات للموظف حسين',
      },
      k,
      now,
    );
    expect(custodyRes.value.employeeEmail).toBe('hussein@example.com');
    expect(custodyRes.value.employeeId).toBe('emp_custom_hussein_99');

    // Hussein logs in with his Firebase Auth UID (which does not equal emp_custom_hussein_99)
    const husseinActor: Actor = {
      id: 'firebase_uid_hussein_777',
      name: 'حسين محمد',
      email: 'hussein@example.com',
      role: 'employee',
      orgId: ORG,
    };

    // Hussein settles an invoice against his custody
    const settlementRes = await settleCustodyItem(
      store,
      husseinActor,
      {
        custodyId: custodyRes.value.id,
        amount: 500,
        description: 'فاتورة أدوات مكتبية',
        invoiceNumber: 'INV-001',
      },
      key(),
      now,
    );
    expect(settlementRes.value.amount).toBe(500);
    expect(settlementRes.value.employeeEmail).toBe('hussein@example.com');

    const updatedCustody = store.read('custodies', custodyRes.value.id);
    expect(updatedCustody?.remainingAmount).toBe(1000);
    expect(updatedCustody?.settledAmount).toBe(500);

    // Another employee from another company cannot settle Hussein's custody
    const strangerActor: Actor = {
      id: 'stranger_uid',
      name: 'شخص غريب',
      email: 'stranger@example.com',
      role: 'employee',
      orgId: 'OTHER_ORG',
    };
    await expect(
      settleCustodyItem(store, strangerActor, { custodyId: custodyRes.value.id, amount: 100, description: 'forged' }, key(), now),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
