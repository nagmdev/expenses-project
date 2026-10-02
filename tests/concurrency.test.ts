import { describe, expect, it } from 'vitest';
import {
  issueCustody,
  settleCustodyItem,
  transferBetweenAccounts,
} from '../src/domain/treasury';
import {
  createExpenseRequest,
  disburseExpenseRequest,
  transitionExpenseRequest,
  updateExpenseRequest,
} from '../src/domain/requests';
import { toMoney, DomainError, type Actor } from '../src/domain/common';
import {
  freshStore,
  seedAccount,
  ORG,
  admin,
  finance,
  employee,
  notify,
  key,
  draft,
} from './helpers';

const now = new Date('2026-10-02T10:00:00.000Z');
const ORG_B = 'org-beta';

describe('Concurrency & Multi-Tenant Mathematical Integrity Test Matrix', () => {
  describe('1. Simultaneous Custody Settlements & Balance Invariants', () => {
    const issueHelper = (store: ReturnType<typeof freshStore>, amount = 1000) =>
      issueCustody(
        store,
        finance,
        {
          orgId: ORG,
          employeeId: employee.id,
          employeeName: employee.name,
          employeeEmail: employee.email,
          amount,
          sourceAccountId: 'cash',
        },
        key(),
        now
      );

    it('simultaneous custody settlements exceeding remaining balance: one succeeds, second rejected, balance never negative', async () => {
      const store = freshStore();
      seedAccount(store, 'cash', 10_000);
      const c = await issueHelper(store, 1000);

      // Concurrent attempts: 700 + 600 = 1300 > 1000 available
      const outcomes = await Promise.allSettled([
        settleCustodyItem(
          store,
          employee,
          { custodyId: c.value.id, amount: 700, description: 'تسوية جزئية أ' },
          key(),
          now
        ),
        settleCustodyItem(
          store,
          employee,
          { custodyId: c.value.id, amount: 600, description: 'تسوية جزئية ب' },
          key(),
          now
        ),
      ]);

      const succeeded = outcomes.filter(o => o.status === 'fulfilled');
      const failed = outcomes.filter(o => o.status === 'rejected');

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      // The rejected settlement failed with an invalid_settlement domain error
      const error = (failed[0] as PromiseRejectedResult).reason;
      expect(error).toBeInstanceOf(DomainError);
      expect(error.code).toBe('insufficient_funds');

      // Crucial financial invariant: remainingAmount is non-negative and exactly consistent
      const custody = store.read('custodies', c.value.id)!;
      expect(custody.remainingAmount).toBeGreaterThanOrEqual(0);
      expect(custody.settledAmount + custody.remainingAmount).toBe(custody.totalAmount);
      expect(custody.status).toBe('active');

      // The succeeded amount was either 700 or 600
      expect([700, 600]).toContain(custody.settledAmount);
      expect([300, 400]).toContain(custody.remainingAmount);

      // Exactly 1 settlement record created
      const settlements = store.dump('custodySettlements').filter(s => s.custodyId === c.value.id);
      expect(settlements).toHaveLength(1);
    });

    it('concurrent split settlements exactly exhausting custody converge with status "settled" and remaining = 0', async () => {
      const store = freshStore();
      seedAccount(store, 'cash', 10_000);
      const c = await issueHelper(store, 1000);

      // 500 + 500 = 1000
      const outcomes = await Promise.allSettled([
        settleCustodyItem(store, employee, { custodyId: c.value.id, amount: 500, description: 'قسط 1' }, key(), now),
        settleCustodyItem(store, employee, { custodyId: c.value.id, amount: 500, description: 'قسط 2' }, key(), now),
      ]);

      expect(outcomes.every(o => o.status === 'fulfilled')).toBe(true);
      const custody = store.read('custodies', c.value.id)!;
      expect(custody.remainingAmount).toBe(0);
      expect(custody.settledAmount).toBe(1000);
      expect(custody.status).toBe('settled');
    });

    it('massive oversubscribed concurrency (10 parallel requests of 150 against 1000): strictly bounds to budget', async () => {
      const store = freshStore();
      seedAccount(store, 'cash', 10_000);
      const c = await issueHelper(store, 1000);

      // 10 x 150 = 1500 > 1000. Exactly 6 should succeed (6 * 150 = 900 <= 1000, 7 * 150 = 1050 > 1000)
      const outcomes = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          settleCustodyItem(
            store,
            employee,
            { custodyId: c.value.id, amount: 150, description: `طلب متزامن ${i + 1}` },
            key(),
            now
          )
        )
      );

      const succeeded = outcomes.filter(o => o.status === 'fulfilled');
      const failed = outcomes.filter(o => o.status === 'rejected');

      expect(succeeded).toHaveLength(6);
      expect(failed).toHaveLength(4);

      const custody = store.read('custodies', c.value.id)!;
      expect(custody.settledAmount).toBe(900);
      expect(custody.remainingAmount).toBe(100);
      expect(custody.remainingAmount).toBeGreaterThanOrEqual(0);
      expect(custody.status).toBe('active');
    });
  });

  describe('2. Concurrent Account Transfers & Overdraft Prevention', () => {
    it('concurrent transfers exceeding source balance: one succeeds, one rejected, no overdraft', async () => {
      const store = freshStore();
      seedAccount(store, 'acc-source', 1000);
      seedAccount(store, 'acc-target', 200);

      // Concurrently attempt 600 and 700 (sum 1300 > 1000 available)
      const outcomes = await Promise.allSettled([
        transferBetweenAccounts(
          store,
          finance,
          { fromAccountId: 'acc-source', toAccountId: 'acc-target', amount: 600, description: 'تحويل 1' },
          key(),
          now
        ),
        transferBetweenAccounts(
          store,
          finance,
          { fromAccountId: 'acc-source', toAccountId: 'acc-target', amount: 700, description: 'تحويل 2' },
          key(),
          now
        ),
      ]);

      const succeeded = outcomes.filter(o => o.status === 'fulfilled');
      const failed = outcomes.filter(o => o.status === 'rejected');

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const error = (failed[0] as PromiseRejectedResult).reason;
      expect(error).toBeInstanceOf(DomainError);
      expect(error.code).toBe('insufficient_funds');

      const source = store.read('paymentAccounts', 'acc-source')!;
      const target = store.read('paymentAccounts', 'acc-target')!;

      // Conservation of money: total across both accounts remains exactly 1200
      expect(source.balance + target.balance).toBe(1200);
      expect(source.balance).toBeGreaterThanOrEqual(0);

      // Either 600 succeeded (source=400, target=800) or 700 succeeded (source=300, target=900)
      if (source.balance === 400) {
        expect(target.balance).toBe(800);
      } else {
        expect(source.balance).toBe(300);
        expect(target.balance).toBe(900);
      }
    });

    it('bi-directional concurrent transfers succeed safely without deadlocking or money loss', async () => {
      const store = freshStore();
      seedAccount(store, 'acc-a', 500);
      seedAccount(store, 'acc-b', 500);

      // Transfer 400 from A -> B and 400 from B -> A concurrently
      const outcomes = await Promise.allSettled([
        transferBetweenAccounts(
          store,
          finance,
          { fromAccountId: 'acc-a', toAccountId: 'acc-b', amount: 400, description: 'A to B' },
          key(),
          now
        ),
        transferBetweenAccounts(
          store,
          finance,
          { fromAccountId: 'acc-b', toAccountId: 'acc-a', amount: 400, description: 'B to A' },
          key(),
          now
        ),
      ]);

      expect(outcomes.every(o => o.status === 'fulfilled')).toBe(true);

      const accA = store.read('paymentAccounts', 'acc-a')!;
      const accB = store.read('paymentAccounts', 'acc-b')!;

      // Each transferred 400 out and received 400 in -> final balance 500
      expect(accA.balance).toBe(500);
      expect(accB.balance).toBe(500);
      expect(accA.balance + accB.balance).toBe(1000);
    });

    it('duplicate transfer with same operationKey is idempotent and does not double-debit', async () => {
      const store = freshStore();
      seedAccount(store, 'acc-source', 1000);
      seedAccount(store, 'acc-target', 0);
      const k = key();

      const outcomes = await Promise.allSettled([
        transferBetweenAccounts(
          store,
          finance,
          { fromAccountId: 'acc-source', toAccountId: 'acc-target', amount: 500, description: 'تحويل مكرر' },
          k,
          now
        ),
        transferBetweenAccounts(
          store,
          finance,
          { fromAccountId: 'acc-source', toAccountId: 'acc-target', amount: 500, description: 'تحويل مكرر' },
          k,
          now
        ),
      ]);

      expect(outcomes.every(o => o.status === 'fulfilled')).toBe(true);

      const source = store.read('paymentAccounts', 'acc-source')!;
      const target = store.read('paymentAccounts', 'acc-target')!;

      expect(source.balance).toBe(500);
      expect(target.balance).toBe(500);

      // Only one pair of ledger transactions (out and in)
      const txs = store.dump('accountTransactions');
      expect(txs).toHaveLength(2);
    });
  });

  describe('3. Cross-Tenant Isolation & Mutation Rejection', () => {
    it('disbursing a request belonging to tenant B from an account in tenant A is rejected', async () => {
      const store = freshStore();
      store.seed('organizations', ORG_B, { id: ORG_B, name: 'Beta', currency: 'EGP', active: true });
      seedAccount(store, 'acc-org-a', 5000);

      // Create request in ORG_B
      const reqOutcome = await createExpenseRequest(
        store,
        employee,
        draft({ orgId: ORG_B, title: 'Beta Expense', amount: 300 }),
        key(),
        notify,
        now
      );
      const reqId = reqOutcome.value.id;

      // Approve request
      await transitionExpenseRequest(store, admin, reqId, { type: 'approve' }, key(), notify, now);

      // Attempt to disburse using account from ORG (mismatched tenant)
      await expect(
        disburseExpenseRequest(
          store,
          finance,
          reqId,
          { accountId: 'acc-org-a', paymentMethod: 'cash', referenceNumber: 'REF-BETA-01' },
          notify,
          now
        )
      ).rejects.toThrow(DomainError);

      try {
        await disburseExpenseRequest(
          store,
          finance,
          reqId,
          { accountId: 'acc-org-a', paymentMethod: 'cash', referenceNumber: 'REF-BETA-01' },
          notify,
          now
        );
      } catch (err: any) {
        expect(err.code).toBe('cross_org');
      }

      // Account balance must be completely untouched
      const acc = store.read('paymentAccounts', 'acc-org-a')!;
      expect(acc.balance).toBe(5000);

      // Request must remain approved, never disbursed
      const req = store.read('requests', reqId)!;
      expect(req.status).toBe('approved');
    });

    it('inter-company account transfer between different orgs is rejected', async () => {
      const store = freshStore();
      seedAccount(store, 'acc-org-a', 5000);
      store.seed('paymentAccounts', 'acc-org-b', {
        id: 'acc-org-b',
        orgId: ORG_B,
        name: 'Beta Account',
        type: 'cash',
        currency: 'EGP',
        active: true,
        balance: 1000,
        currentBalance: 1000,
        initialBalance: 1000,
      });

      await expect(
        transferBetweenAccounts(
          store,
          finance,
          { fromAccountId: 'acc-org-a', toAccountId: 'acc-org-b', amount: 500, description: 'Cross transfer' },
          key(),
          now
        )
      ).rejects.toThrow(DomainError);

      try {
        await transferBetweenAccounts(
          store,
          finance,
          { fromAccountId: 'acc-org-a', toAccountId: 'acc-org-b', amount: 500, description: 'Cross transfer' },
          key(),
          now
        );
      } catch (err: any) {
        expect(err.code).toBe('cross_org');
      }

      // Neither account changed
      expect(store.read('paymentAccounts', 'acc-org-a')!.balance).toBe(5000);
      expect(store.read('paymentAccounts', 'acc-org-b')!.balance).toBe(1000);
    });

    it('stranger actor from another tenant cannot settle a custody', async () => {
      const store = freshStore();
      seedAccount(store, 'cash', 10_000);
      const c = await issueCustody(
        store,
        finance,
        {
          orgId: ORG,
          employeeId: employee.id,
          employeeName: employee.name,
          employeeEmail: employee.email,
          amount: 500,
          sourceAccountId: 'cash',
        },
        key(),
        now
      );

      const intruder: Actor = {
        id: 'uidIntruderFromAnotherOrg',
        name: 'مخترق',
        email: 'intruder@other-company.test',
        role: 'employee',
      };

      await expect(
        settleCustodyItem(
          store,
          intruder,
          { custodyId: c.value.id, amount: 200, description: 'محاولة غير مصرح بها' },
          key(),
          now
        )
      ).rejects.toThrow(DomainError);

      try {
        await settleCustodyItem(
          store,
          intruder,
          { custodyId: c.value.id, amount: 200, description: 'محاولة غير مصرح بها' },
          key(),
          now
        );
      } catch (err: any) {
        expect(err.code).toBe('forbidden');
      }

      const custody = store.read('custodies', c.value.id)!;
      expect(custody.remainingAmount).toBe(500);
      expect(custody.settledAmount).toBe(0);
    });

    it('protected fields including orgId are immutable across updates', async () => {
      const store = freshStore();
      const reqOutcome = await createExpenseRequest(store, employee, draft(), key(), notify, now);
      const reqId = reqOutcome.value.id;

      // Attempt to tamper with orgId, status, and id via update
      const updateRes = await updateExpenseRequest(
        store,
        employee,
        reqId,
        {
          orgId: 'malicious-org',
          status: 'disbursed',
          title: 'عنوان معدل مصرح به',
        } as any,
        key(),
        now
      );

      expect(updateRes.changed).toBe(true);
      const req = store.read('requests', reqId)!;
      expect(req.orgId).toBe(ORG); // Must remain untouched
      expect(req.status).toBe('pending'); // Cannot bypass workflow to 'disbursed'
      expect(req.title).toBe('عنوان معدل مصرح به'); // Permitted field changed
    });
  });

  describe('4. Floating Point Precision & toMoney Invariants', () => {
    it('toMoney eliminates standard binary floating-point representation drift', () => {
      // 0.1 + 0.2 === 0.30000000000000004 in raw IEEE 754
      expect(0.1 + 0.2).not.toBe(0.3);
      expect(toMoney(0.1 + 0.2)).toBe(0.3);

      // Banker/half-up cent rounding
      expect(toMoney(10.005)).toBe(10.01);
      expect(toMoney(10.004)).toBe(10.0);
      expect(toMoney(10.001)).toBe(10.0);

      // Non-finite or invalid inputs default safely to 0
      expect(toMoney(NaN)).toBe(0);
      expect(toMoney(Infinity)).toBe(0);
      expect(toMoney('invalid')).toBe(0);
    });

    it('split fractional settlements preserve exact zero remaining without sub-cent leak', async () => {
      const store = freshStore();
      seedAccount(store, 'cash', 10_000);

      // 100.00 split into 33.33 + 33.33 + 33.34 = 100.00 exactly
      const c = await issueCustody(
        store,
        finance,
        {
          orgId: ORG,
          employeeId: employee.id,
          employeeName: employee.name,
          employeeEmail: employee.email,
          amount: 100,
          sourceAccountId: 'cash',
        },
        key(),
        now
      );

      await settleCustodyItem(store, employee, { custodyId: c.value.id, amount: 33.33, description: 'دفعة 1' }, key(), now);
      let custody = store.read('custodies', c.value.id)!;
      expect(custody.remainingAmount).toBe(66.67);

      await settleCustodyItem(store, employee, { custodyId: c.value.id, amount: 33.33, description: 'دفعة 2' }, key(), now);
      custody = store.read('custodies', c.value.id)!;
      expect(custody.remainingAmount).toBe(33.34);

      await settleCustodyItem(store, employee, { custodyId: c.value.id, amount: 33.34, description: 'دفعة 3' }, key(), now);
      custody = store.read('custodies', c.value.id)!;

      // Must be precisely 0.00, not 0.000000000000001 or -0.000000000000001
      expect(custody.remainingAmount).toBe(0);
      expect(custody.settledAmount).toBe(100);
      expect(custody.status).toBe('settled');
    });

    it('account balance decrements with fractional cents prevent overspending even by 1 cent', async () => {
      const store = freshStore();
      seedAccount(store, 'acc-cents', 100.15);
      seedAccount(store, 'acc-target', 0);

      // Transfer 100.14
      await transferBetweenAccounts(
        store,
        finance,
        { fromAccountId: 'acc-cents', toAccountId: 'acc-target', amount: 100.14, description: 'تحويل كسور' },
        key(),
        now
      );

      let source = store.read('paymentAccounts', 'acc-cents')!;
      expect(source.balance).toBe(0.01);

      // Attempting to transfer 0.02 (1 cent more than remaining) must fail
      await expect(
        transferBetweenAccounts(
          store,
          finance,
          { fromAccountId: 'acc-cents', toAccountId: 'acc-target', amount: 0.02, description: 'تجاوز بقرش' },
          key(),
          now
        )
      ).rejects.toThrow(DomainError);

      // Transferring the remaining 0.01 leaves exactly 0.00
      await transferBetweenAccounts(
        store,
        finance,
        { fromAccountId: 'acc-cents', toAccountId: 'acc-target', amount: 0.01, description: 'آخر قرش' },
        key(),
        now
      );

      source = store.read('paymentAccounts', 'acc-cents')!;
      expect(source.balance).toBe(0);
    });
  });
});
