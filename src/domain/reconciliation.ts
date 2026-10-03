/**
 * Financial consistency check ("فحص سلامة الحسابات") — READ-ONLY.
 *
 * Re-derives every stored money counter from the records that justify it and lists
 * where the two disagree. Nothing here writes: the owner reads the report, and any fix
 * goes through the normal (audited, ledger-bound) operations.
 *
 * What is compared (the exact semantics of the domain operations):
 *  - payment accounts: createMovementBatch writes currentBalance and its legacy alias
 *    balance together, with lastLedgerId = the account's ONE new ledger line of the
 *    transaction, whose balanceAfter is the new balance. The opening balance is
 *    initialBalance (its 'initial' line tx-open-<id>, when not zero); every other line
 *    moves the balance by its amount ('in' +, 'out' -). InstaPay mirror lines
 *    (<ledgerId>-parent) belong to the parent bank (their accountId).
 *  - requests: disburseExpenseRequest writes the line tx-req-<request id>
 *    (referenceType 'request', referenceId = the request, the disbursement's account,
 *    'out' — 'in' for an income request — of the request's amount). Visa payments are
 *    'request' lines too (tx-<key>, referenceId = the visa request).
 *  - services.spentAmount: raised by every disbursed non-income request on the service,
 *    of a company the service names (orgId / orgIds: a shared service counts every
 *    company's requests). providers.totalPaid: every disbursed non-income request.
 *  - custodies: totalAmount = remainingAmount + settledAmount + returnedAmount
 *    (issue / replenish raise total and remaining; settle moves remaining to settled;
 *    return moves remaining to returned). settledAmount = its custodySettlements.
 *
 * Money is compared with a 0.01 tolerance (legacy float noise such as 0.1 + 0.2 is not
 * an issue). Data written before the ledger existed (accounts without initialBalance or
 * without ledger lines, lines without the domain's ids, custodies without settledAmount,
 * disbursements without an operation key, counters never raised by the domain) cannot be
 * re-derived exactly: its differences are reported as 'warning' (historic drift), never
 * as 'violation'. A violation is a difference in data the current domain wrote.
 */
import type {
  AccountTransaction,
  CustodySettlementItem,
  ExpenseRequest,
  PaymentAccount,
  PettyCashCustody,
  ServiceCategory,
  ServiceProvider,
  VisaRequest,
} from '../types';
import { COL, toMoney } from './common';

export type ConsistencySeverity = 'violation' | 'warning';

/** Every collection the check reads (pettyCashCustodies: the read-only pre-2026 custodies). */
export const CONSISTENCY_COLLECTIONS = [
  COL.paymentAccounts,
  COL.accountTransactions,
  COL.requests,
  COL.visaRequests,
  COL.services,
  COL.providers,
  COL.custodies,
  'pettyCashCustodies',
  COL.custodySettlements,
] as const;
export type ConsistencyCollection = (typeof CONSISTENCY_COLLECTIONS)[number];

export const CONSISTENCY_COLLECTION_LABELS: Record<ConsistencyCollection, string> = {
  paymentAccounts: 'الخزائن والحسابات',
  accountTransactions: 'دفتر الحركات المالية',
  requests: 'طلبات الصرف',
  visaRequests: 'طلبات التأشيرات',
  services: 'بنود الصرف',
  providers: 'الموردين',
  custodies: 'العهد',
  pettyCashCustodies: 'العهد القديمة',
  custodySettlements: 'فواتير تسوية العهد',
};

type Doc<T> = Partial<T> & { id: string } & Record<string, any>;

/** The records read for one run. A collection left undefined could not be read: its checks are skipped. */
export interface ConsistencyData {
  paymentAccounts?: Doc<PaymentAccount>[];
  accountTransactions?: Doc<AccountTransaction>[];
  requests?: Doc<ExpenseRequest>[];
  visaRequests?: Doc<VisaRequest>[];
  services?: Doc<ServiceCategory>[];
  providers?: Doc<ServiceProvider>[];
  custodies?: Doc<PettyCashCustody>[];
  pettyCashCustodies?: Doc<PettyCashCustody>[];
  custodySettlements?: Doc<CustodySettlementItem>[];
}

export type ConsistencyCheckKind =
  | 'account_balance_fields'
  | 'account_last_ledger_ref'
  | 'account_last_line'
  | 'account_ledger_sum'
  | 'account_negative_balance'
  | 'request_ledger_line'
  | 'ledger_request_ref'
  | 'service_spent'
  | 'provider_paid'
  | 'custody_totals'
  | 'custody_settled'
  | 'custody_negative_remaining';

interface CheckDef {
  kind: ConsistencyCheckKind;
  label: string;
  /** Every one of these must have been read. */
  needs: ConsistencyCollection[];
  /** At least one of these must have been read. */
  needsAny?: ConsistencyCollection[];
}

export const CONSISTENCY_CHECKS: CheckDef[] = [
  { kind: 'account_balance_fields', label: 'تطابق حقلي الرصيد (الحالي / القديم)', needs: [COL.paymentAccounts] },
  { kind: 'account_last_ledger_ref', label: 'مؤشر آخر حركة يشير إلى قيد موجود للحساب', needs: [COL.paymentAccounts, COL.accountTransactions] },
  { kind: 'account_last_line', label: 'الرصيد بعد آخر حركة = الرصيد الحالي', needs: [COL.paymentAccounts, COL.accountTransactions] },
  { kind: 'account_ledger_sum', label: 'الرصيد الافتتاحي + مجموع الحركات = الرصيد الحالي', needs: [COL.paymentAccounts, COL.accountTransactions] },
  { kind: 'account_negative_balance', label: 'حسابات برصيد سالب', needs: [COL.paymentAccounts] },
  { kind: 'request_ledger_line', label: 'قيد الصرف لكل طلب مصروف (المبلغ والحساب)', needs: [COL.requests, COL.accountTransactions] },
  { kind: 'ledger_request_ref', label: 'قيود الطلبات تشير إلى طلبات موجودة ومصروفة', needs: [COL.accountTransactions, COL.requests] },
  { kind: 'service_spent', label: 'المنصرف على البند = مجموع طلباته المصروفة', needs: [COL.services, COL.requests] },
  { kind: 'provider_paid', label: 'المدفوع للمورد = مجموع طلباته المصروفة', needs: [COL.providers, COL.requests] },
  { kind: 'custody_totals', label: 'إجمالي العهدة = المتبقي + المسوّى + المردود', needs: [], needsAny: [COL.custodies, 'pettyCashCustodies'] },
  { kind: 'custody_settled', label: 'المسوّى من العهدة = مجموع فواتير تسويتها', needs: [COL.custodySettlements], needsAny: [COL.custodies, 'pettyCashCustodies'] },
  { kind: 'custody_negative_remaining', label: 'عهد بمتبقٍ سالب', needs: [], needsAny: [COL.custodies, 'pettyCashCustodies'] },
];

export const CONSISTENCY_CHECK_LABELS = Object.fromEntries(CONSISTENCY_CHECKS.map(c => [c.kind, c.label])) as Record<ConsistencyCheckKind, string>;

export interface ConsistencyIssue {
  severity: ConsistencySeverity;
  kind: ConsistencyCheckKind;
  collection: ConsistencyCollection;
  id: string;
  orgId: string;
  /** What is wrong, in Arabic (one short line). */
  label: string;
  /** The record as people know it (account name, request number, custody number…). */
  entityName: string;
  expected: number | string | null;
  actual: number | string | null;
  /** actual − expected (money), or null when the values are not amounts. */
  diff: number | null;
  /** How the expected value was derived / why the severity (Arabic). */
  detail: string;
}

export interface ConsistencyCheckTotal {
  kind: ConsistencyCheckKind;
  label: string;
  /** Records examined by this check. */
  checked: number;
  violations: number;
  warnings: number;
  /** True when a collection it needs could not be read (see `missing`). */
  skipped: boolean;
  missing: ConsistencyCollection[];
}

export interface ConsistencyReport {
  checkedAt: string;
  totals: Record<ConsistencyCheckKind, ConsistencyCheckTotal>;
  issues: ConsistencyIssue[];
  /** Records read per collection. */
  counts: Partial<Record<ConsistencyCollection, number>>;
  /** Collections that could not be read (their checks are skipped). */
  missing: ConsistencyCollection[];
  violations: number;
  warnings: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Differences up to one cent (0.01) are rounding, not an issue. */
export const MONEY_TOLERANCE = 0.01;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const moneyDiffers = (a: unknown, b: unknown) => Math.abs(num(a) - num(b)) > MONEY_TOLERANCE + 1e-9;
const sum = (values: number[]) => toMoney(values.reduce((s, v) => s + v, 0));
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** The balance the domain reads (treasury.ts → balanceOf). */
const balanceOf = (a: Doc<PaymentAccount>) => num(a.currentBalance ?? a.balance ?? 0);
const signed = (l: Doc<AccountTransaction>) => (l.type === 'out' ? -num(l.amount) : num(l.amount));

/**
 * A line the current domain wrote: createMovementBatch stores operationLedgerId, and an
 * account's opening line is tx-open-<id>. Lines of older app versions (tx-<timestamp>,
 * tx-<uuid>, tx-parent-…) carry neither.
 */
export const isDomainLedgerLine = (l: Doc<AccountTransaction>) =>
  Boolean(l.operationLedgerId) || str(l.id).startsWith('tx-open-');

/** Ids older app versions derived from the clock (cus-1727…-123, stl-1727…-456). */
const TIMESTAMP_ID = /^[a-z]+-\d{10,}(-\d+)?$/i;

/** A disbursement the domain made carries its operation key (requests.ts → disburseExpenseRequest). */
const isDomainDisbursement = (r: Doc<ExpenseRequest>) => Boolean((r.disbursement as Record<string, any> | undefined)?.operationKey);

const isIncome = (r: Doc<ExpenseRequest>) => r.requestType === 'income';
const isDisbursed = (r: Doc<ExpenseRequest>) => r.status === 'disbursed';

const byCreated = (a: { createdAt?: unknown; id: string }, b: { createdAt?: unknown; id: string }) =>
  str(a.createdAt).localeCompare(str(b.createdAt)) || a.id.localeCompare(b.id);

function groupBy<T>(items: T[], key: (t: T) => string) {
  const map = new Map<string, T[]>();
  items.forEach(item => {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  });
  return map;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------
export function checkFinancialConsistency(data: ConsistencyData, now: Date = new Date()): ConsistencyReport {
  const has = (c: ConsistencyCollection) => Array.isArray(data[c]);
  const missing = CONSISTENCY_COLLECTIONS.filter(c => !has(c));
  const counts: ConsistencyReport['counts'] = {};
  CONSISTENCY_COLLECTIONS.forEach(c => {
    if (has(c)) counts[c] = data[c]!.length;
  });

  const totals = {} as Record<ConsistencyCheckKind, ConsistencyCheckTotal>;
  CONSISTENCY_CHECKS.forEach(def => {
    const lacking = def.needs.filter(c => !has(c));
    const anyLacking = def.needsAny && !def.needsAny.some(has) ? def.needsAny : [];
    const miss = [...lacking, ...anyLacking];
    totals[def.kind] = { kind: def.kind, label: def.label, checked: 0, violations: 0, warnings: 0, skipped: miss.length > 0, missing: miss };
  });
  const runs = (kind: ConsistencyCheckKind) => !totals[kind].skipped;
  const examined = (kind: ConsistencyCheckKind, n = 1) => {
    totals[kind].checked += n;
  };

  const issues: ConsistencyIssue[] = [];
  const report = (issue: Omit<ConsistencyIssue, 'diff'> & { diff?: number | null }) => {
    const diff =
      issue.diff !== undefined ? issue.diff : isNum(issue.expected) && isNum(issue.actual) ? toMoney(issue.actual - issue.expected) : null;
    issues.push({ ...issue, diff });
    if (issue.severity === 'violation') totals[issue.kind].violations++;
    else totals[issue.kind].warnings++;
  };

  const accounts = data.paymentAccounts || [];
  const lines = data.accountTransactions || [];
  const requests = data.requests || [];
  const linesById = new Map(lines.map(l => [l.id, l]));
  const linesByAccount = groupBy(lines, l => str(l.accountId));
  const requestsById = new Map(requests.map(r => [r.id, r]));
  const visaIds = new Set((data.visaRequests || []).map(v => v.id));

  // ---------------- payment accounts ----------------
  accounts.forEach(account => {
    const name = str(account.name) || account.id;
    const orgId = str(account.orgId);
    const base = { collection: COL.paymentAccounts, id: account.id, orgId, entityName: name } as const;
    const own = (linesByAccount.get(account.id) || []).slice().sort(byCreated);
    const balance = balanceOf(account);
    const hasOpening = isNum(account.initialBalance);
    const legacyLines = own.filter(l => !isDomainLedgerLine(l));
    const lastId = str(account.lastLedgerId);
    // Written before the ledger: no opening balance field, lines of older versions, or a
    // balance with no line at all (and no line bound to it).
    const legacy = !hasOpening || legacyLines.length > 0 || (own.length === 0 && !lastId);
    const legacyWhy = !hasOpening
      ? 'حساب قديم بدون رصيد افتتاحي مسجل (initialBalance)'
      : legacyLines.length > 0
      ? `للحساب ${legacyLines.length} حركة مسجلة بإصدار قديم قبل دفتر الحركات الحالي`
      : 'حساب قديم بدون حركات في دفتر الحركات';

    // 1. currentBalance and its legacy alias balance are always written together. Once the
    // domain moved the account (lastLedgerId), or when everything about it is the domain's,
    // a difference was written afterwards outside the operations; on a legacy account never
    // moved since, it is what an older version left.
    if (runs('account_balance_fields')) {
      examined('account_balance_fields');
      if (account.currentBalance != null && account.balance != null && moneyDiffers(account.currentBalance, account.balance)) {
        const bound = Boolean(lastId) || !legacy;
        report({
          ...base,
          severity: bound ? 'violation' : 'warning',
          kind: 'account_balance_fields',
          label: 'حقل الرصيد الحالي لا يطابق حقل الرصيد القديم',
          expected: toMoney(account.currentBalance),
          actual: toMoney(account.balance),
          detail: bound
            ? 'كل حركة تكتب الحقلين معاً (currentBalance و balance)؛ اختلافهما يعني تعديلاً خارج العمليات المعتمدة.'
            : `${legacyWhy}: فرق تاريخي.`,
        });
      }
    }

    // 2. lastLedgerId names an existing line of THIS account.
    let lastLine: Doc<AccountTransaction> | undefined;
    if (runs('account_last_ledger_ref')) {
      examined('account_last_ledger_ref');
      if (lastId) {
        const line = linesById.get(lastId);
        if (!line) {
          report({
            ...base,
            severity: 'violation',
            kind: 'account_last_ledger_ref',
            label: 'آخر حركة مسجلة على الحساب غير موجودة في الدفتر',
            expected: lastId,
            actual: null,
            diff: null,
            detail: 'مؤشر آخر حركة (lastLedgerId) يشير إلى قيد محذوف أو لم يُكتب.',
          });
        } else if (str(line.accountId) !== account.id) {
          report({
            ...base,
            severity: 'violation',
            kind: 'account_last_ledger_ref',
            label: 'آخر حركة مسجلة على الحساب تخص حساباً آخر',
            expected: account.id,
            actual: str(line.accountId),
            diff: null,
            detail: `القيد ${lastId} مسجل على حساب آخر.`,
          });
        } else {
          lastLine = line;
        }
      }
    }

    // 3. the balance after the last line is the balance now.
    if (runs('account_last_line')) {
      examined('account_last_line');
      if (lastLine) {
        if (moneyDiffers(lastLine.balanceAfter, balance)) {
          report({
            ...base,
            severity: 'violation',
            kind: 'account_last_line',
            label: 'الرصيد بعد آخر حركة لا يطابق الرصيد الحالي',
            expected: toMoney(lastLine.balanceAfter),
            actual: toMoney(balance),
            detail: `آخر حركة (${lastLine.id}) تركت الرصيد ${toMoney(lastLine.balanceAfter)}.`,
          });
        }
      } else if (!lastId && own.length > 0) {
        // No bound line (written before the rules bound balances to lines): the newest line(s) by date.
        const newest = own[own.length - 1];
        const sameMoment = own.filter(l => str(l.createdAt) === str(newest.createdAt));
        if (sameMoment.every(l => moneyDiffers(l.balanceAfter, balance))) {
          report({
            ...base,
            severity: 'warning',
            kind: 'account_last_line',
            label: 'الرصيد بعد آخر حركة لا يطابق الرصيد الحالي',
            expected: toMoney(newest.balanceAfter),
            actual: toMoney(balance),
            detail: 'حساب بدون مؤشر آخر حركة (سُجلت حركاته قبل ربط الرصيد بالدفتر): آخر حركة حسب التاريخ؛ فرق تاريخي محتمل.',
          });
        }
      }
    }

    // 4. opening balance + every movement = the balance now.
    if (runs('account_ledger_sum')) {
      examined('account_ledger_sum');
      const openingLines = own.filter(l => l.referenceType === 'initial');
      const moves = own.filter(l => l.referenceType !== 'initial');
      const openingFromLines = sum(openingLines.map(signed));
      const opening = hasOpening ? toMoney(account.initialBalance) : openingFromLines;
      const expected = toMoney(opening + sum(moves.map(signed)));
      if (moneyDiffers(expected, balance)) {
        report({
          ...base,
          severity: legacy ? 'warning' : 'violation',
          kind: 'account_ledger_sum',
          label: 'الرصيد الحالي لا يطابق الرصيد الافتتاحي + مجموع الحركات',
          expected,
          actual: toMoney(balance),
          detail: `${legacy ? `${legacyWhy}: فرق تاريخي. ` : ''}الرصيد الافتتاحي ${opening}، ${moves.length} حركة بصافي ${sum(moves.map(signed))}.`,
        });
      } else if (hasOpening && openingLines.length > 0 && moneyDiffers(openingFromLines, account.initialBalance)) {
        report({
          ...base,
          severity: legacy ? 'warning' : 'violation',
          kind: 'account_ledger_sum',
          label: 'قيد الرصيد الافتتاحي لا يطابق الرصيد الافتتاحي المسجل',
          expected: toMoney(account.initialBalance),
          actual: openingFromLines,
          detail: 'قيد الرصيد الافتتاحي (initial) في الدفتر يختلف عن حقل initialBalance للحساب.',
        });
      }
      // A legacy account still has a ledger-bound era: from its first line written by the
      // current domain on, the balance follows the lines exactly.
      if (legacy) {
        const firstDomain = own.find(l => isDomainLedgerLine(l) && l.referenceType !== 'initial');
        if (firstDomain) {
          const era = own.slice(own.indexOf(firstDomain)).filter(l => l.referenceType !== 'initial');
          const eraExpected = toMoney(num(firstDomain.balanceBefore) + sum(era.map(signed)));
          const eraLegacy = era.some(l => !isDomainLedgerLine(l));
          if (moneyDiffers(eraExpected, balance)) {
            report({
              ...base,
              severity: eraLegacy ? 'warning' : 'violation',
              kind: 'account_ledger_sum',
              label: 'الرصيد الحالي لا يطابق الحركات منذ بدء الدفتر الحالي',
              expected: eraExpected,
              actual: toMoney(balance),
              detail: `منذ القيد ${firstDomain.id} (الرصيد قبله ${toMoney(firstDomain.balanceBefore)}): ${era.length} حركة بصافي ${sum(era.map(signed))}.${eraLegacy ? ' بينها حركات بإصدار قديم.' : ''}`,
            });
          }
        }
      }
    }

    // 5. no operation takes an account below zero (only the owner-confirmed bank correction
    // of a detached legacy wallet may: a manual_adjustment that names the wallet). Deposits
    // made after that correction need not bring the bank back above zero, so the correction
    // is looked for in the account's whole history, not only as its last line.
    if (runs('account_negative_balance')) {
      examined('account_negative_balance');
      if (toMoney(balance) < 0) {
        const detachCorrection = own.some(l => l.referenceType === 'manual_adjustment' && Boolean(l.referenceId) && l.type === 'out');
        report({
          ...base,
          severity: legacy || detachCorrection ? 'warning' : 'violation',
          kind: 'account_negative_balance',
          label: 'رصيد الحساب سالب',
          expected: 0,
          actual: toMoney(balance),
          detail: detachCorrection
            ? 'آخر حركة تصحيح رصيد البنك عند فصل محفظة (مسموح أن ينزل الرصيد تحت الصفر بتأكيد المدير).'
            : legacy
            ? `${legacyWhy}: فرق تاريخي.`
            : 'لا تسمح أي عملية بالنزول تحت الصفر.',
        });
      }
    }
  });

  // ---------------- requests ↔ ledger ----------------
  const requestLabel = (r: Doc<ExpenseRequest>) => str(r.requestNumber) || r.id;
  if (runs('request_ledger_line')) {
    requests.filter(isDisbursed).forEach(r => {
      examined('request_ledger_line');
      const base = { collection: COL.requests, id: r.id, orgId: str(r.orgId), entityName: requestLabel(r), kind: 'request_ledger_line' } as const;
      const amount = toMoney(r.amount);
      const line = linesById.get(`tx-req-${r.id}`);
      const disbursement = (r.disbursement || {}) as Record<string, any>;
      if (!line) {
        const older = lines.filter(
          l => l.referenceType === 'request' && str(l.referenceId) === r.id && !str(l.id).endsWith('-parent') && !str(l.id).startsWith('tx-parent-'),
        );
        if (isDomainDisbursement(r)) {
          report({
            ...base,
            severity: 'violation',
            label: 'طلب مصروف بدون قيد صرف في دفتر الحركات',
            expected: amount,
            actual: older.length ? sum(older.map(l => num(l.amount))) : null,
            diff: null,
            detail: `الصرف يكتب القيد tx-req-${r.id} في نفس العملية؛ لا يوجد.`,
          });
        } else if (older.length === 0) {
          report({
            ...base,
            severity: 'warning',
            label: 'صرف قديم بدون قيد في دفتر الحركات',
            expected: amount,
            actual: null,
            diff: null,
            detail: 'صُرف الطلب بإصدار قديم قبل دفتر الحركات الحالي: فرق تاريخي.',
          });
        } else if (moneyDiffers(sum(older.map(l => num(l.amount))), amount)) {
          report({
            ...base,
            severity: 'warning',
            label: 'مبلغ قيد الصرف القديم لا يطابق مبلغ الطلب',
            expected: amount,
            actual: sum(older.map(l => num(l.amount))),
            detail: `قيود بإصدار قديم: ${older.map(l => l.id).join('، ')}. فرق تاريخي.`,
          });
        }
        return;
      }
      if (str(line.referenceId) !== r.id || line.referenceType !== 'request') {
        report({
          ...base,
          severity: 'violation',
          label: 'قيد الصرف لا يشير إلى هذا الطلب',
          expected: r.id,
          actual: `${str(line.referenceType)}:${str(line.referenceId)}`,
          diff: null,
          detail: `القيد ${line.id}.`,
        });
      }
      if (moneyDiffers(line.amount, amount)) {
        report({
          ...base,
          severity: 'violation',
          label: 'مبلغ قيد الصرف لا يطابق مبلغ الطلب',
          expected: amount,
          actual: toMoney(line.amount),
          detail: `القيد ${line.id}.`,
        });
      }
      const expectedType = isIncome(r) ? 'in' : 'out';
      if (line.type !== expectedType) {
        report({
          ...base,
          severity: 'violation',
          label: 'اتجاه قيد الصرف لا يطابق نوع الطلب',
          expected: expectedType,
          actual: str(line.type),
          diff: null,
          detail: `طلب ${isIncome(r) ? 'توريد (وارد)' : 'صرف (منصرف)'}؛ القيد ${line.id}.`,
        });
      }
      if (str(disbursement.accountId) && str(line.accountId) !== str(disbursement.accountId)) {
        report({
          ...base,
          severity: 'violation',
          label: 'حساب قيد الصرف لا يطابق حساب الصرف المسجل في الطلب',
          expected: str(disbursement.accountName) || str(disbursement.accountId),
          actual: str(line.accountName) || str(line.accountId),
          diff: null,
          detail: `الطلب: ${str(disbursement.accountId)} — القيد: ${str(line.accountId)}.`,
        });
      }
    });
  }

  if (runs('ledger_request_ref')) {
    const visasKnown = has(COL.visaRequests);
    lines
      .filter(l => l.referenceType === 'request')
      .forEach(l => {
        const refId = str(l.referenceId);
        const lineId = str(l.id);
        const base = {
          collection: COL.accountTransactions,
          id: lineId,
          orgId: str(l.orgId),
          entityName: str(l.referenceNumber) || lineId,
          kind: 'ledger_request_ref',
          diff: null,
        } as const;
        if (lineId.startsWith('tx-req-')) {
          examined('ledger_request_ref');
          const req = requestsById.get(refId);
          if (lineId !== `tx-req-${refId}` && lineId !== `tx-req-${refId}-parent`) {
            report({
              ...base,
              severity: 'violation',
              label: 'رقم قيد الصرف لا يطابق الطلب الذي يشير إليه',
              expected: `tx-req-${refId}`,
              actual: lineId,
              detail: 'قيد الصرف يُسمّى برقم طلبه دائماً.',
            });
          }
          if (!req) {
            report({
              ...base,
              severity: 'violation',
              label: 'قيد صرف يشير إلى طلب غير موجود',
              expected: refId || null,
              actual: null,
              detail: `حركة ${l.type === 'in' ? 'وارد' : 'منصرف'} بمبلغ ${toMoney(l.amount)} على "${str(l.accountName) || str(l.accountId)}" والطلب محذوف أو لم يُكتب.`,
            });
          } else if (!isDisbursed(req)) {
            report({
              ...base,
              severity: 'violation',
              label: 'قيد صرف لطلب غير مصروف',
              expected: 'disbursed',
              actual: str(req.status),
              detail: `الطلب ${requestLabel(req)} حالته "${str(req.status)}" رغم تحرك المال بمبلغ ${toMoney(l.amount)}.`,
            });
          }
          return;
        }
        // Visa payments and lines of older versions: the reference must still exist.
        if (requestsById.has(refId) || visaIds.has(refId)) {
          examined('ledger_request_ref');
          return;
        }
        if (!visasKnown) return; // could be a visa request that was not read
        examined('ledger_request_ref');
        report({
          ...base,
          severity: 'warning',
          label: 'قيد يشير إلى طلب أو تأشيرة غير موجودة',
          expected: refId || null,
          actual: null,
          detail: isDomainLedgerLine(l)
            ? `قيد بمبلغ ${toMoney(l.amount)} (غالباً دفعة تأشيرة) وطلبه محذوف.`
            : `قيد بإصدار قديم بمبلغ ${toMoney(l.amount)} وطلبه محذوف: فرق تاريخي.`,
        });
      });
  }

  // ---------------- counters: services / providers ----------------
  const paidRequests = requests.filter(r => isDisbursed(r) && !isIncome(r));
  const checkCounter = (
    kind: 'service_spent' | 'provider_paid',
    collection: ConsistencyCollection,
    entity: Doc<ServiceCategory> | Doc<ServiceProvider>,
    actualValue: unknown,
    all: Doc<ExpenseRequest>[],
    counted: Doc<ExpenseRequest>[],
    belongs: (r: Doc<ExpenseRequest>) => boolean,
  ) => {
    examined(kind);
    const base = { collection, id: entity.id, orgId: str(entity.orgId), entityName: str(entity.name) || entity.id, kind } as const;
    const actual = toMoney(actualValue);
    const expected = sum(counted.map(r => num(r.amount)));
    const expectedAll = sum(all.map(r => num(r.amount)));
    const lastReqId = str(entity.lastDisbursedRequestId);
    const legacyRequests = all.filter(r => !isDomainDisbursement(r));
    // Never raised by the current domain (no lastDisbursedRequestId), or raised by payments of
    // older versions: the counter carries history that cannot be re-derived.
    const legacy = !lastReqId || legacyRequests.length > 0;
    if (moneyDiffers(actual, expected) && moneyDiffers(actual, expectedAll)) {
      const what = kind === 'service_spent' ? 'المنصرف على البند' : 'المدفوع للمورد';
      report({
        ...base,
        severity: legacy ? 'warning' : 'violation',
        label: `${what} لا يطابق مجموع الطلبات المصروفة`,
        expected,
        actual,
        detail: [
          `${counted.length} طلب مصروف${expectedAll !== expected ? ` (و${all.length - counted.length} طلب لشركة لم يعد البند مشتركاً معها: ${expectedAll} مع احتسابها)` : ''}.`,
          !lastReqId ? 'العداد لم يرفعه أي صرف بالإصدار الحالي: رصيد تاريخي.' : '',
          legacyRequests.length ? `${legacyRequests.length} طلب صُرف بإصدار قديم: فرق تاريخي.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
    if (lastReqId) {
      const last = requestsById.get(lastReqId);
      if (!last || !isDisbursed(last) || !belongs(last)) {
        report({
          ...base,
          severity: 'violation',
          label: 'آخر طلب رفع العداد غير موجود أو غير مصروف أو لا يخص هذا السجل',
          expected: lastReqId,
          actual: last ? `${requestLabel(last)} (${str(last.status)})` : null,
          diff: null,
          detail: 'المؤشر lastDisbursedRequestId يجب أن يشير إلى طلب مصروف على هذا السجل.',
        });
      }
    }
  };

  if (runs('service_spent')) {
    const byService = groupBy(paidRequests, r => str(r.serviceCategoryId));
    (data.services || []).forEach(s => {
      const names = (orgId: string) => str(s.orgId) === orgId || (Array.isArray(s.orgIds) && s.orgIds.includes(orgId));
      const all = byService.get(s.id) || [];
      checkCounter('service_spent', COL.services, s, s.spentAmount, all, all.filter(r => names(str(r.orgId))), r => str(r.serviceCategoryId) === s.id);
    });
  }
  if (runs('provider_paid')) {
    const byProvider = groupBy(paidRequests, r => str(r.providerId));
    (data.providers || []).forEach(p => {
      const all = byProvider.get(p.id) || [];
      checkCounter('provider_paid', COL.providers, p, p.totalPaid, all, all, r => str(r.providerId) === p.id);
    });
  }

  // ---------------- custodies ----------------
  const settlementsByCustody = groupBy(data.custodySettlements || [], s => str(s.custodyId));
  const custodySets: Array<[ConsistencyCollection, Doc<PettyCashCustody>[]]> = [];
  if (has(COL.custodies)) custodySets.push([COL.custodies, data.custodies!]);
  if (has('pettyCashCustodies')) custodySets.push(['pettyCashCustodies', data.pettyCashCustodies!]);
  const knownCustodyIds = new Set<string>();

  custodySets.forEach(([collection, list]) => {
    list.forEach(c => {
      knownCustodyIds.add(c.id);
      const hasSettled = isNum(c.settledAmount);
      // The pre-2026 collection, a custody without settledAmount, or a clock-derived id: older versions.
      const legacy = collection === 'pettyCashCustodies' || !hasSettled || TIMESTAMP_ID.test(c.id);
      const legacyWhy =
        collection === 'pettyCashCustodies'
          ? 'عهدة من المجموعة القديمة (pettyCashCustodies)'
          : !hasSettled
          ? 'عهدة قديمة بدون حقل المسوّى (settledAmount)'
          : 'عهدة أنشأها إصدار قديم';
      const base = {
        collection,
        id: c.id,
        orgId: str(c.orgId),
        entityName: [str(c.custodyNumber), str(c.employeeName)].filter(Boolean).join(' - ') || c.id,
      } as const;
      const remaining = num(c.remainingAmount);
      const settled = num(c.settledAmount);
      const returned = num(c.returnedAmount);

      if (runs('custody_totals')) {
        examined('custody_totals');
        const parts = toMoney(remaining + settled + returned);
        if (moneyDiffers(c.totalAmount, parts)) {
          report({
            ...base,
            severity: legacy ? 'warning' : 'violation',
            kind: 'custody_totals',
            label: 'إجمالي العهدة لا يساوي المتبقي + المسوّى + المردود',
            expected: toMoney(c.totalAmount),
            actual: parts,
            detail: `${legacy ? `${legacyWhy}: فرق تاريخي. ` : ''}المتبقي ${toMoney(remaining)} + المسوّى ${toMoney(settled)} + المردود ${toMoney(returned)}.`,
          });
        }
      }

      if (runs('custody_settled')) {
        examined('custody_settled');
        const own = settlementsByCustody.get(c.id) || [];
        const approved = own.filter(s => !s.status || s.status === 'approved');
        const others = own.length - approved.length;
        const legacySettlements = own.filter(s => TIMESTAMP_ID.test(s.id)).length;
        const expected = sum(approved.map(s => num(s.amount)));
        if (moneyDiffers(expected, settled)) {
          report({
            ...base,
            severity: legacy || legacySettlements > 0 || others > 0 ? 'warning' : 'violation',
            kind: 'custody_settled',
            label: 'المسوّى من العهدة لا يطابق مجموع فواتير تسويتها',
            expected,
            actual: toMoney(settled),
            detail: [
              `${approved.length} فاتورة معتمدة.`,
              others ? `${others} فاتورة غير معتمدة لم تُحتسب.` : '',
              legacy ? `${legacyWhy}: فرق تاريخي.` : legacySettlements ? `${legacySettlements} فاتورة بإصدار قديم: فرق تاريخي.` : '',
            ]
              .filter(Boolean)
              .join(' '),
          });
        }
      }

      if (runs('custody_negative_remaining')) {
        examined('custody_negative_remaining');
        if (toMoney(remaining) < 0) {
          report({
            ...base,
            severity: legacy ? 'warning' : 'violation',
            kind: 'custody_negative_remaining',
            label: 'المتبقي من العهدة سالب',
            expected: 0,
            actual: toMoney(remaining),
            detail: legacy ? `${legacyWhy}: فرق تاريخي.` : 'لا تسمح التسوية بأكثر من المتبقي.',
          });
        }
      }
    });
  });

  // Invoices of a custody that no longer exists (only the owner can delete a custody).
  if (runs('custody_settled')) {
    (data.custodySettlements || []).forEach(s => {
      if (knownCustodyIds.has(str(s.custodyId))) return;
      examined('custody_settled');
      report({
        collection: COL.custodySettlements,
        id: s.id,
        orgId: str(s.orgId),
        entityName: [str(s.invoiceNumber) && `فاتورة ${str(s.invoiceNumber)}`, str(s.employeeName)].filter(Boolean).join(' - ') || s.id,
        severity: 'warning',
        kind: 'custody_settled',
        label: 'فاتورة تسوية لعهدة غير موجودة',
        expected: str(s.custodyId) || null,
        actual: null,
        diff: null,
        detail: `فاتورة بمبلغ ${toMoney(s.amount)} وعهدتها محذوفة.`,
      });
    });
  }

  const order = new Map(CONSISTENCY_CHECKS.map((c, i) => [c.kind, i]));
  issues.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'violation' ? -1 : 1) ||
      order.get(a.kind)! - order.get(b.kind)! ||
      a.orgId.localeCompare(b.orgId) ||
      a.id.localeCompare(b.id),
  );

  return {
    checkedAt: now.toISOString(),
    totals,
    issues,
    counts,
    missing,
    violations: issues.filter(i => i.severity === 'violation').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
  };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
export const SEVERITY_LABELS: Record<ConsistencySeverity, string> = {
  violation: 'مخالفة',
  warning: 'تحذير (فرق تاريخي)',
};

/** A text cell that a spreadsheet would run as a formula (=, +, -, @, tab, CR) is prefixed with '. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = typeof value === 'number' ? String(value) : String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** The issues as a UTF-8 CSV (with BOM, so Excel shows the Arabic). */
export function consistencyIssuesToCsv(issues: ConsistencyIssue[], orgName: (orgId: string) => string = id => id): string {
  const headers = ['الخطورة', 'الفحص', 'المشكلة', 'الشركة', 'المجموعة', 'السجل', 'المعرف', 'المتوقع', 'الفعلي', 'الفرق', 'التفاصيل'];
  const rows = issues.map(i =>
    [
      SEVERITY_LABELS[i.severity],
      CONSISTENCY_CHECK_LABELS[i.kind],
      i.label,
      i.orgId ? orgName(i.orgId) : '',
      CONSISTENCY_COLLECTION_LABELS[i.collection],
      i.entityName,
      i.id,
      i.expected,
      i.actual,
      i.diff,
      i.detail,
    ]
      .map(csvCell)
      .join(','),
  );
  return '\uFEFF' + [headers.map(csvCell).join(','), ...rows].join('\r\n');
}
