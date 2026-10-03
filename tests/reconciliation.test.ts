/**
 * Financial consistency check (src/domain/reconciliation.ts): read-only re-derivation of
 * every money counter. Data written by the real domain operations has no issue; every
 * corruption is reported, legacy data (written before the ledger) only as a warning.
 */
import { describe, expect, it } from 'vitest';
import {
  checkFinancialConsistency,
  consistencyIssuesToCsv,
  moneyDiffers,
  type ConsistencyCheckKind,
  type ConsistencyData,
  type ConsistencyIssue,
} from '../src/domain/reconciliation';
import {
  adjustAccountBalance,
  createPaymentAccount,
  issueCustody,
  replenishCustody,
  returnCustodyRemainders,
  settleCustodyItem,
  transferBetweenAccounts,
} from '../src/domain/treasury';
import { createExpenseRequest, disburseExpenseRequest, transitionExpenseRequest } from '../src/domain/requests';
import { addVisaPayment, createVisaRequest, decideVisaRequest } from '../src/domain/visa';
import type { MemoryStore } from '../src/domain/store';
import { ORG, admin, draft, employee, finance, freshStore, key, notify } from './helpers';

const now = new Date('2026-10-03T10:00:00.000Z');

const COLLECTIONS = [
  'paymentAccounts',
  'accountTransactions',
  'requests',
  'visaRequests',
  'services',
  'providers',
  'custodies',
  'pettyCashCustodies',
  'custodySettlements',
] as const;

const snapshot = (store: MemoryStore): ConsistencyData =>
  Object.fromEntries(COLLECTIONS.map(c => [c, store.dump(c)])) as ConsistencyData;

const ofKind = (issues: ConsistencyIssue[], kind: ConsistencyCheckKind) => issues.filter(i => i.kind === kind);

/** A realistic book written ONLY by the domain operations. */
async function domainBook() {
  const store = freshStore();
  const bank = await createPaymentAccount(store, admin, { orgId: ORG, name: 'CIB', type: 'bank', accountIdentifier: 'EG-1', currency: 'EGP', active: true, initialBalance: 10000 }, key(), now);
  const insta = await createPaymentAccount(store, admin, { orgId: ORG, name: 'InstaPay', type: 'instapay', accountIdentifier: 'co@instapay', currency: 'EGP', active: true, parentAccountId: bank.value.id, initialBalance: 0 }, key(), now);
  const cash = await createPaymentAccount(store, admin, { orgId: ORG, name: 'Cash', type: 'cash', accountIdentifier: 'CASH-1', currency: 'EGP', active: true, initialBalance: 0 }, key(), now);
  await adjustAccountBalance(store, finance, { accountId: cash.value.id, type: 'in', amount: 0.1, description: 'float a' }, key(), now);
  await adjustAccountBalance(store, finance, { accountId: cash.value.id, type: 'in', amount: 0.2, description: 'float b' }, key(), now);
  await adjustAccountBalance(store, finance, { accountId: cash.value.id, type: 'in', amount: 2000, description: 'top up' }, key(), now);
  await adjustAccountBalance(store, finance, { accountId: insta.value.id, type: 'in', amount: 1000, description: 'insta top up' }, key(), now);

  // An expense paid through InstaPay (mirrors to the bank) and an income into cash.
  const expense = await createExpenseRequest(store, employee, draft({ amount: 400.1 }), key(), notify, now);
  await transitionExpenseRequest(store, admin, expense.value.id, { type: 'approve' }, key(), notify, now);
  await disburseExpenseRequest(store, finance, expense.value.id, { paymentMethod: 'instapay', referenceNumber: 'R-1', accountId: insta.value.id }, key(), notify, now);
  const income = await createExpenseRequest(store, employee, draft({ amount: 250, requestType: 'income' }), key(), notify, now);
  await transitionExpenseRequest(store, admin, income.value.id, { type: 'approve' }, key(), notify, now);
  await disburseExpenseRequest(store, finance, income.value.id, { paymentMethod: 'cash', referenceNumber: 'R-2', accountId: cash.value.id }, key(), notify, now);
  const expense2 = await createExpenseRequest(store, employee, draft({ amount: 0.2 }), key(), notify, now);
  await transitionExpenseRequest(store, admin, expense2.value.id, { type: 'approve' }, key(), notify, now);
  await disburseExpenseRequest(store, finance, expense2.value.id, { paymentMethod: 'cash', referenceNumber: 'R-3', accountId: cash.value.id }, key(), notify, now);

  await transferBetweenAccounts(store, finance, { fromAccountId: bank.value.id, toAccountId: cash.value.id, amount: 1000 }, key(), now);

  // Custody: issue, two invoices, top-up, return of the rest.
  const custody = await issueCustody(store, finance, { orgId: ORG, employeeId: employee.id, employeeName: employee.name, amount: 500, sourceAccountId: cash.value.id }, key(), now);
  await settleCustodyItem(store, employee, { custodyId: custody.value.id, amount: 0.1, description: 'a' }, key(), now);
  await settleCustodyItem(store, employee, { custodyId: custody.value.id, amount: 120.2, description: 'b' }, key(), now);
  await replenishCustody(store, finance, { custodyId: custody.value.id, amount: 100, sourceAccountId: cash.value.id }, key(), now);
  await returnCustodyRemainders(store, finance, { custodyIds: [custody.value.id] }, key(), now);

  // A visa payment ('request' line referencing a visa request).
  const visa = await createVisaRequest(store, employee, {
    orgId: ORG, requestDate: '2026-10-03', travelerName: 'T', passportNumber: 'P', destinationCountry: 'SA',
    hasTraveledBefore: false, expectedTravelDate: '2026-12-01', visaType: 'tourist', serviceProviderId: 'prov-1',
    serviceProviderName: 'AWS', assignedApprover: 'x', totalAmount: 1000, currency: 'EGP', paymentMode: 'installments',
    requesterId: employee.id, requesterName: employee.name,
  }, key(), now);
  await decideVisaRequest(store, admin, visa.value.id, { type: 'approve', approverName: 'x' }, key(), now);
  await addVisaPayment(store, finance, visa.value.id, { amount: 300, currency: 'EGP', date: '2026-10-03', paymentMethod: 'cash', accountId: cash.value.id }, key(), now);

  return { store, bank: bank.value.id, insta: insta.value.id, cash: cash.value.id, expense: expense.value.id, income: income.value.id, custody: custody.value.id };
}

describe('money comparison', () => {
  it('ignores float noise and differences up to one cent', () => {
    expect(moneyDiffers(0.1 + 0.2, 0.3)).toBe(false);
    expect(moneyDiffers(100, 100.01)).toBe(false);
    expect(moneyDiffers(100, 100.02)).toBe(true);
    expect(moneyDiffers('5', 5)).toBe(false);
  });
});

describe('a book written by the domain operations', () => {
  it('has no issue at all (accounts, mirror lines, requests, counters, custodies, visa lines)', async () => {
    const { store } = await domainBook();
    const report = checkFinancialConsistency(snapshot(store), now);
    expect(report.issues).toEqual([]);
    expect(report.violations).toBe(0);
    expect(report.warnings).toBe(0);
    expect(report.missing).toEqual([]);
    expect(report.checkedAt).toBe(now.toISOString());
    // every check really ran over records
    for (const kind of ['account_ledger_sum', 'account_last_line', 'request_ledger_line', 'ledger_request_ref', 'service_spent', 'provider_paid', 'custody_totals', 'custody_settled'] as const) {
      expect(report.totals[kind].skipped).toBe(false);
      expect(report.totals[kind].checked).toBeGreaterThan(0);
    }
    expect(report.counts.paymentAccounts).toBe(3);
  });

  it('never writes anything (pure function over the data it is given)', async () => {
    const { store } = await domainBook();
    const data = snapshot(store);
    const before = JSON.stringify(data);
    const commits = store.commits;
    checkFinancialConsistency(data, now);
    expect(JSON.stringify(data)).toBe(before);
    expect(store.commits).toBe(commits);
  });
});

describe('payment accounts', () => {
  it('a balance changed outside the ledger: last line, ledger sum and alias field all disagree → violations', async () => {
    const { store, cash } = await domainBook();
    const data = snapshot(store);
    const acc = data.paymentAccounts!.find(a => a.id === cash)!;
    acc.currentBalance = Number(acc.currentBalance) + 500;
    const { issues } = checkFinancialConsistency(data, now);
    const own = issues.filter(i => i.id === cash);
    expect(own.map(i => i.kind).sort()).toEqual(['account_balance_fields', 'account_last_line', 'account_ledger_sum']);
    expect(own.every(i => i.severity === 'violation')).toBe(true);
    const sumIssue = ofKind(own, 'account_ledger_sum')[0];
    expect(sumIssue.diff).toBe(500);
    expect(sumIssue.orgId).toBe(ORG);
    expect(sumIssue.entityName).toBe('Cash');
  });

  it('a deleted ledger line: lastLedgerId points nowhere and the sum no longer matches', async () => {
    const { store, cash } = await domainBook();
    const data = snapshot(store);
    const acc = data.paymentAccounts!.find(a => a.id === cash)!;
    data.accountTransactions = data.accountTransactions!.filter(l => l.id !== acc.lastLedgerId);
    const { issues } = checkFinancialConsistency(data, now);
    const ref = ofKind(issues, 'account_last_ledger_ref').filter(i => i.id === cash);
    expect(ref).toHaveLength(1);
    expect(ref[0].severity).toBe('violation');
    expect(ofKind(issues, 'account_ledger_sum').find(i => i.id === cash)?.severity).toBe('violation');
  });

  it('lastLedgerId naming another account\'s line → violation', async () => {
    const { store, cash, bank } = await domainBook();
    const data = snapshot(store);
    const bankAcc = data.paymentAccounts!.find(a => a.id === bank)!;
    data.paymentAccounts!.find(a => a.id === cash)!.lastLedgerId = bankAcc.lastLedgerId;
    const { issues } = checkFinancialConsistency(data, now);
    expect(ofKind(issues, 'account_last_ledger_ref').map(i => [i.id, i.severity])).toEqual([[cash, 'violation']]);
  });

  it('opening balance edited without its opening line → violation', async () => {
    const { store, bank } = await domainBook();
    const data = snapshot(store);
    data.paymentAccounts!.find(a => a.id === bank)!.initialBalance = 12000;
    const issues = checkFinancialConsistency(data, now).issues.filter(i => i.id === bank);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'account_ledger_sum', severity: 'violation', expected: 12000 - 10000 + Number(data.paymentAccounts!.find(a => a.id === bank)!.currentBalance) });
  });

  it('float balances (0.1 + 0.2) are not an issue', () => {
    const data: ConsistencyData = {
      paymentAccounts: [{ id: 'a', orgId: ORG, name: 'A', initialBalance: 0, currentBalance: 0.30000000000000004, balance: 0.3, lastLedgerId: 'l2' }],
      accountTransactions: [
        { id: 'l1', operationLedgerId: 'l1', accountId: 'a', orgId: ORG, type: 'in', amount: 0.1, balanceBefore: 0, balanceAfter: 0.1, referenceType: 'manual_adjustment', createdAt: '2026-10-01T00:00:00.000Z' },
        { id: 'l2', operationLedgerId: 'l2', accountId: 'a', orgId: ORG, type: 'in', amount: 0.2, balanceBefore: 0.1, balanceAfter: 0.3, referenceType: 'manual_adjustment', createdAt: '2026-10-02T00:00:00.000Z' },
      ],
    };
    expect(checkFinancialConsistency(data, now).issues).toEqual([]);
  });

  it('a negative balance from a normal operation → violation; from a detached-wallet bank correction → warning', () => {
    const base = (referenceId?: string): ConsistencyData => ({
      paymentAccounts: [{ id: 'a', orgId: ORG, name: 'A', initialBalance: 100, currentBalance: -50, balance: -50, lastLedgerId: 'l1' }],
      accountTransactions: [
        { id: 'l1', operationLedgerId: 'l1', accountId: 'a', orgId: ORG, type: 'out', amount: 150, balanceBefore: 100, balanceAfter: -50, referenceType: 'manual_adjustment', referenceId, createdAt: '2026-10-01T00:00:00.000Z' },
      ],
    });
    const plain = checkFinancialConsistency(base(), now).issues;
    expect(plain).toHaveLength(1);
    expect(plain[0]).toMatchObject({ kind: 'account_negative_balance', severity: 'violation', actual: -50, expected: 0, diff: -50 });
    const detach = checkFinancialConsistency(base('wallet-1'), now).issues;
    expect(detach).toHaveLength(1);
    expect(detach[0]).toMatchObject({ kind: 'account_negative_balance', severity: 'warning' });
  });

  describe('legacy accounts (written before the ledger) → warnings only', () => {
    it('no initialBalance field and no lines', () => {
      const data: ConsistencyData = {
        paymentAccounts: [{ id: 'old', orgId: ORG, name: 'Old', balance: 900, currentBalance: 950 }],
        accountTransactions: [],
      };
      const { issues } = checkFinancialConsistency(data, now);
      expect(issues.map(i => i.kind).sort()).toEqual(['account_balance_fields', 'account_ledger_sum']);
      expect(issues.every(i => i.severity === 'warning')).toBe(true);
    });

    it('an opening balance but no ledger line at all', () => {
      const data: ConsistencyData = {
        paymentAccounts: [{ id: 'old', orgId: ORG, name: 'Old', initialBalance: 1000, balance: 700, currentBalance: 700 }],
        accountTransactions: [],
      };
      const { issues } = checkFinancialConsistency(data, now);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ kind: 'account_ledger_sum', severity: 'warning', expected: 1000, actual: 700, diff: -300 });
    });

    it('lines of an older version (no operationLedgerId), a negative legacy balance, and no lastLedgerId', () => {
      const data: ConsistencyData = {
        paymentAccounts: [{ id: 'old', orgId: ORG, name: 'Old', initialBalance: 0, balance: -20, currentBalance: -20 }],
        accountTransactions: [
          { id: 'tx-1727000000000', accountId: 'old', orgId: ORG, type: 'out', amount: 10, balanceBefore: 0, balanceAfter: -10, referenceType: 'manual_adjustment', createdAt: '2026-09-01T00:00:00.000Z' },
        ],
      };
      const { issues } = checkFinancialConsistency(data, now);
      expect(issues.map(i => i.kind).sort()).toEqual(['account_last_line', 'account_ledger_sum', 'account_negative_balance']);
      expect(issues.every(i => i.severity === 'warning')).toBe(true);
    });

    it('a legacy account whose ledger-bound era drifted → violation for that era', () => {
      const data: ConsistencyData = {
        paymentAccounts: [{ id: 'old', orgId: ORG, name: 'Old', balance: 1500, currentBalance: 1500, lastLedgerId: 'tx-new' }],
        accountTransactions: [
          { id: 'tx-1727000000000', accountId: 'old', orgId: ORG, type: 'in', amount: 999, balanceBefore: 0, balanceAfter: 999, referenceType: 'manual_adjustment', createdAt: '2026-09-01T00:00:00.000Z' },
          // the current domain's line: balance 1000 → 1200, yet the account says 1500
          { id: 'tx-new', operationLedgerId: 'tx-new', accountId: 'old', orgId: ORG, type: 'in', amount: 200, balanceBefore: 1000, balanceAfter: 1200, referenceType: 'manual_adjustment', createdAt: '2026-10-01T00:00:00.000Z' },
        ],
      };
      const sums = ofKind(checkFinancialConsistency(data, now).issues, 'account_ledger_sum');
      expect(sums.map(i => i.severity).sort()).toEqual(['violation', 'warning']);
      expect(sums.find(i => i.severity === 'violation')).toMatchObject({ expected: 1200, actual: 1500, diff: 300 });
    });

    it('a legacy account whose ledger-bound era is consistent → only the historic warning', () => {
      const data: ConsistencyData = {
        paymentAccounts: [{ id: 'old', orgId: ORG, name: 'Old', balance: 1200, currentBalance: 1200, lastLedgerId: 'tx-new' }],
        accountTransactions: [
          { id: 'tx-1727000000000', accountId: 'old', orgId: ORG, type: 'in', amount: 999, balanceBefore: 0, balanceAfter: 999, referenceType: 'manual_adjustment', createdAt: '2026-09-01T00:00:00.000Z' },
          { id: 'tx-new', operationLedgerId: 'tx-new', accountId: 'old', orgId: ORG, type: 'in', amount: 200, balanceBefore: 1000, balanceAfter: 1200, referenceType: 'manual_adjustment', createdAt: '2026-10-01T00:00:00.000Z' },
        ],
      };
      const { issues } = checkFinancialConsistency(data, now);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ kind: 'account_ledger_sum', severity: 'warning', expected: 1199, actual: 1200 });
    });
  });
});

describe('requests and their ledger lines', () => {
  it('a disbursed request whose tx-req line is missing → violation (and its service/provider counters still match)', async () => {
    const { store, expense } = await domainBook();
    const data = snapshot(store);
    data.accountTransactions = data.accountTransactions!.filter(l => l.id !== `tx-req-${expense}`);
    const issues = ofKind(checkFinancialConsistency(data, now).issues, 'request_ledger_line');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: expense, severity: 'violation', collection: 'requests' });
  });

  it('a line with another amount, account or direction → one violation each', async () => {
    const { store, expense, cash } = await domainBook();
    const data = snapshot(store);
    const line = data.accountTransactions!.find(l => l.id === `tx-req-${expense}`)!;
    line.amount = 401;
    line.accountId = cash;
    line.type = 'in';
    const issues = ofKind(checkFinancialConsistency(data, now).issues, 'request_ledger_line');
    expect(issues.map(i => i.label)).toEqual([
      'مبلغ قيد الصرف لا يطابق مبلغ الطلب',
      'اتجاه قيد الصرف لا يطابق نوع الطلب',
      'حساب قيد الصرف لا يطابق حساب الصرف المسجل في الطلب',
    ]);
    expect(issues.every(i => i.severity === 'violation')).toBe(true);
    expect(issues[0]).toMatchObject({ expected: 400.1, actual: 401, diff: 0.9 });
  });

  it('a request edited after payment (its amount) → violation on the line and on the counters', async () => {
    const { store, expense } = await domainBook();
    const data = snapshot(store);
    data.requests!.find(r => r.id === expense)!.amount = 500;
    const { issues } = checkFinancialConsistency(data, now);
    expect(ofKind(issues, 'request_ledger_line')[0]).toMatchObject({ severity: 'violation', expected: 500, actual: 400.1 });
    expect(ofKind(issues, 'service_spent')[0]).toMatchObject({ severity: 'violation', id: 'srv-1', expected: 500.2, actual: 400.3 });
    expect(ofKind(issues, 'provider_paid')[0]).toMatchObject({ severity: 'violation', id: 'prov-1' });
  });

  it('a payment line whose request was deleted, or reverted to approved → violation', async () => {
    const { store, expense, income } = await domainBook();
    const data = snapshot(store);
    data.requests = data.requests!.filter(r => r.id !== expense);
    data.requests!.find(r => r.id === income)!.status = 'approved';
    const issues = ofKind(checkFinancialConsistency(data, now).issues, 'ledger_request_ref');
    // the expense line and its InstaPay mirror line, plus the income line
    expect(issues.map(i => i.id).sort()).toEqual([`tx-req-${expense}`, `tx-req-${expense}-parent`, `tx-req-${income}`].sort());
    expect(issues.every(i => i.severity === 'violation')).toBe(true);
    expect(issues.find(i => i.id === `tx-req-${income}`)!.label).toBe('قيد صرف لطلب غير مصروف');
  });

  it('a visa payment line whose visa request was deleted → warning; not judged when visas were not read', async () => {
    const { store } = await domainBook();
    const data = snapshot(store);
    data.visaRequests = [];
    const issues = ofKind(checkFinancialConsistency(data, now).issues, 'ledger_request_ref');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    const notRead = { ...data, visaRequests: undefined };
    const report = checkFinancialConsistency(notRead, now);
    expect(ofKind(report.issues, 'ledger_request_ref')).toEqual([]);
    expect(report.missing).toEqual(['visaRequests']);
  });

  describe('legacy disbursements (no operation key) → warnings', () => {
    const legacyReq = { id: 'req-old', requestNumber: 'REQ-OLD', orgId: ORG, status: 'disbursed' as const, amount: 300, requestType: 'expense' as const, serviceCategoryId: 'srv-x', providerId: 'prov-x', disbursement: { accountId: 'a', disbursedAt: '', disbursedBy: '', paymentMethod: 'cash' as const, referenceNumber: 'r' } };

    it('without any ledger line', () => {
      const issues = checkFinancialConsistency({ requests: [legacyReq], accountTransactions: [] }, now).issues;
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ kind: 'request_ledger_line', severity: 'warning' });
    });

    it('with an older line of another amount (tx-<uuid>), while its mirror line is ignored', () => {
      const lines = [
        { id: 'tx-6f1c', accountId: 'a', orgId: ORG, type: 'out' as const, amount: 250, referenceType: 'request' as const, referenceId: 'req-old', createdAt: '2026-09-01' },
        { id: 'tx-parent-6f1d', accountId: 'b', orgId: ORG, type: 'out' as const, amount: 250, referenceType: 'request' as const, referenceId: 'req-old', createdAt: '2026-09-01' },
      ];
      const issues = checkFinancialConsistency({ requests: [legacyReq], accountTransactions: lines, visaRequests: [] }, now).issues;
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ kind: 'request_ledger_line', severity: 'warning', expected: 300, actual: 250 });
      // a matching older line is fine
      lines[0].amount = 300;
      expect(checkFinancialConsistency({ requests: [legacyReq], accountTransactions: lines, visaRequests: [] }, now).issues).toEqual([]);
    });

    it('counters raised by legacy payments, or never raised by the domain', () => {
      const data: ConsistencyData = {
        requests: [legacyReq],
        services: [{ id: 'srv-x', orgId: ORG, name: 'X', spentAmount: 1000, lastDisbursedRequestId: 'req-old' }],
        providers: [{ id: 'prov-x', orgId: ORG, name: 'P', totalPaid: 50 }],
      };
      const { issues } = checkFinancialConsistency(data, now);
      expect(issues.map(i => [i.kind, i.severity])).toEqual([
        ['service_spent', 'warning'],
        ['provider_paid', 'warning'],
      ]);
    });
  });
});

describe('service and provider counters', () => {
  const paid = (id: string, orgId: string, amount: number, extra: Record<string, unknown> = {}) => ({
    id,
    requestNumber: id.toUpperCase(),
    orgId,
    status: 'disbursed' as const,
    amount,
    requestType: 'expense' as const,
    serviceCategoryId: 'srv-s',
    providerId: 'prov-p',
    disbursement: { operationKey: `k-${id}`, accountId: 'a', disbursedAt: '', disbursedBy: '', paymentMethod: 'cash' as const, referenceNumber: 'r' },
    ...extra,
  });

  it('a shared service counts every company\'s paid requests; income and unpaid requests never count', () => {
    const data: ConsistencyData = {
      requests: [
        paid('r1', 'org-a', 0.1),
        paid('r2', 'org-b', 0.2),
        paid('r3', 'org-a', 999, { requestType: 'income' }),
        paid('r4', 'org-a', 999, { status: 'approved' }),
        paid('r5', 'org-a', 100, { requestType: 'advance' }),
      ],
      services: [{ id: 'srv-s', orgId: 'org-a', orgIds: ['org-a', 'org-b'], name: 'Shared', spentAmount: 100.3, lastDisbursedRequestId: 'r5' }],
      providers: [{ id: 'prov-p', orgId: 'org-a', name: 'P', totalPaid: 100.3, lastDisbursedRequestId: 'r2' }],
    };
    expect(checkFinancialConsistency(data, now).issues).toEqual([]);
  });

  it('a service no longer shared with a company still matches with that company\'s past payments', () => {
    const data: ConsistencyData = {
      requests: [paid('r1', 'org-a', 10), paid('r2', 'org-b', 20)],
      services: [{ id: 'srv-s', orgId: 'org-a', orgIds: ['org-a'], name: 'S', spentAmount: 30, lastDisbursedRequestId: 'r1' }],
    };
    expect(checkFinancialConsistency(data, now).issues).toEqual([]);
  });

  it('a counter off by more than a cent → violation with the derived value; the pointer to a non-paid request → violation', () => {
    const data: ConsistencyData = {
      requests: [paid('r1', 'org-a', 10), paid('r2', 'org-a', 20, { status: 'approved' })],
      services: [{ id: 'srv-s', orgId: 'org-a', name: 'S', spentAmount: 10.02, lastDisbursedRequestId: 'r1' }],
      providers: [{ id: 'prov-p', orgId: 'org-a', name: 'P', totalPaid: 10.01, lastDisbursedRequestId: 'r2' }],
    };
    const { issues } = checkFinancialConsistency(data, now);
    expect(issues.map(i => [i.kind, i.severity, i.label])).toEqual([
      ['service_spent', 'violation', 'المنصرف على البند لا يطابق مجموع الطلبات المصروفة'],
      ['provider_paid', 'violation', 'آخر طلب رفع العداد غير موجود أو غير مصروف أو لا يخص هذا السجل'],
    ]);
    expect(issues[0]).toMatchObject({ expected: 10, actual: 10.02, diff: 0.02 });
  });
});

describe('custodies', () => {
  const custody = (extra: Record<string, unknown> = {}) => ({
    id: 'cus-6f1c2b3a',
    orgId: ORG,
    custodyNumber: 'CUS-2026-00001',
    employeeName: 'E',
    totalAmount: 600,
    remainingAmount: 0,
    settledAmount: 120.3,
    returnedAmount: 479.7,
    lastLedgerId: 'tx-x',
    ...extra,
  });
  const settlements = [
    { id: 'stl-a', custodyId: 'cus-6f1c2b3a', orgId: ORG, amount: 0.1, status: 'approved' as const },
    { id: 'stl-b', custodyId: 'cus-6f1c2b3a', orgId: ORG, amount: 120.2, status: 'approved' as const },
  ];

  it('consistent totals with float invoices (0.1 + 120.2) → no issue', () => {
    expect(checkFinancialConsistency({ custodies: [custody()], custodySettlements: settlements }, now).issues).toEqual([]);
  });

  it('totals that do not add up, settled ≠ invoices, negative remainder → violations', () => {
    const data: ConsistencyData = {
      custodies: [custody({ remainingAmount: -10, settledAmount: 200 })],
      custodySettlements: settlements,
    };
    const { issues } = checkFinancialConsistency(data, now);
    expect(issues.map(i => [i.kind, i.severity])).toEqual([
      ['custody_totals', 'violation'],
      ['custody_settled', 'violation'],
      ['custody_negative_remaining', 'violation'],
    ]);
    expect(issues[0]).toMatchObject({ expected: 600, actual: 669.7, diff: 69.7 });
    expect(issues[1]).toMatchObject({ expected: 120.3, actual: 200 });
  });

  it('a domain custody whose invoice was deleted → violation', async () => {
    const { store, custody: id } = await domainBook();
    const data = snapshot(store);
    data.custodySettlements = data.custodySettlements!.slice(1);
    const issues = ofKind(checkFinancialConsistency(data, now).issues, 'custody_settled');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id, severity: 'violation' });
  });

  it('legacy custodies (no settledAmount, clock-derived id, the old collection) → warnings', () => {
    const data: ConsistencyData = {
      custodies: [
        custody({ id: 'cus-noSettled', settledAmount: undefined, remainingAmount: 100 }),
        custody({ id: 'cus-1727000000000-123', remainingAmount: -5, lastLedgerId: undefined }),
      ],
      pettyCashCustodies: [custody({ id: 'pc-1', totalAmount: 1000 })],
      custodySettlements: [{ id: 'stl-1727000000000-456', custodyId: 'cus-noSettled', orgId: ORG, amount: 50, status: 'approved' }],
    };
    const { issues, violations, warnings } = checkFinancialConsistency(data, now);
    expect(violations).toBe(0);
    expect(warnings).toBe(issues.length);
    expect(issues.map(i => `${i.collection}/${i.id}:${i.kind}`).sort()).toEqual([
      'custodies/cus-1727000000000-123:custody_negative_remaining',
      'custodies/cus-1727000000000-123:custody_settled',
      'custodies/cus-1727000000000-123:custody_totals',
      'custodies/cus-noSettled:custody_settled',
      'custodies/cus-noSettled:custody_totals',
      'pettyCashCustodies/pc-1:custody_settled',
      'pettyCashCustodies/pc-1:custody_totals',
    ]);
  });

  it('an invoice of a deleted custody → warning', () => {
    const { issues } = checkFinancialConsistency({ custodies: [], custodySettlements: [{ id: 'stl-z', custodyId: 'gone', orgId: ORG, amount: 5 }] }, now);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ collection: 'custodySettlements', kind: 'custody_settled', severity: 'warning' });
  });
});

describe('collections that could not be read', () => {
  it('skips exactly the checks that need them and reports the collections', () => {
    const report = checkFinancialConsistency({ paymentAccounts: [{ id: 'a', orgId: ORG, name: 'A', initialBalance: 0, currentBalance: -1, balance: -1 }] }, now);
    expect(report.missing).toContain('accountTransactions');
    expect(report.totals.account_ledger_sum).toMatchObject({ skipped: true, checked: 0, missing: ['accountTransactions'] });
    expect(report.totals.account_balance_fields.skipped).toBe(false);
    expect(report.totals.custody_totals).toMatchObject({ skipped: true, missing: ['custodies', 'pettyCashCustodies'] });
    // the checks that could run still did (legacy: an account with no lines read as legacy)
    expect(report.issues.map(i => i.kind)).toEqual(['account_negative_balance']);
  });
});

describe('CSV export', () => {
  it('has a BOM, Arabic headers, company names and neutralised formula cells', () => {
    const issue: ConsistencyIssue = {
      severity: 'violation',
      kind: 'service_spent',
      collection: 'services',
      id: 'srv-1',
      orgId: ORG,
      label: 'المنصرف على البند لا يطابق مجموع الطلبات المصروفة',
      entityName: '=HYPERLINK("x")',
      expected: 10,
      actual: -5,
      diff: -15,
      detail: 'a "quoted" detail',
    };
    const csv = consistencyIssuesToCsv([issue], id => (id === ORG ? 'أكمي' : id));
    expect(csv.startsWith('﻿"الخطورة"')).toBe(true);
    const row = csv.split('\r\n')[1];
    expect(row).toContain('"مخالفة"');
    expect(row).toContain('"أكمي"');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain('"-5","-15"');
    expect(row).toContain('"a ""quoted"" detail"');
  });
});
