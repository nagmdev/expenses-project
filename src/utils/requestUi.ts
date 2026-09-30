import type { ExpenseRequest, PaymentAccount, PaymentAccountType, PaymentMethod } from '../types';

/**
 * Shared display helpers for the expense-request screens (list, detail modal, tracker,
 * new/edit form) so every screen shows the same method, balance, date and number.
 */

// ---------------------------------------------------------------------------
// Payment method — ONE answer for "how does this request want to be paid?"
// ---------------------------------------------------------------------------
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  instapay: 'انستاباي (InstaPay)',
  bank_transfer: 'تحويل بنكي (IBAN)',
  digital_wallet: 'محفظة إلكترونية',
  wallet: 'محفظة إلكترونية',
  cash: 'نقداً من الخزينة',
  cheque: 'شيك مصرفي',
};

/** How an income (توريد) request arrives — worded as money coming IN. */
export const INCOME_METHOD_LABELS: Record<PaymentMethod, string> = {
  instapay: 'إنستاباي',
  bank_transfer: 'حساب بنكي',
  digital_wallet: 'محفظة كاش',
  wallet: 'محفظة كاش',
  cash: 'خزينة نقدية',
  cheque: 'شيك مصرفي',
};

const KNOWN_METHODS = new Set<string>(Object.keys(PAYMENT_METHOD_LABELS));

/** 'wallet' is a legacy alias of 'digital_wallet'. */
export const normalizePaymentMethod = (method?: string | null): PaymentMethod | null => {
  if (!method || !KNOWN_METHODS.has(method)) return null;
  return method === 'wallet' ? 'digital_wallet' : (method as PaymentMethod);
};

/**
 * The payout method a request asks for. Older records may have no method stored: it is
 * then inferred from the payout details, and a request with nothing at all is a bank
 * transfer. The list badge, the detail modal, the method filter and the edit form all
 * use this, so they can never disagree (and saving an edit never switches the method).
 */
export function resolveRequestPaymentMethod(
  req: Pick<ExpenseRequest, 'preferredPaymentMethod' | 'paymentAccountDetails'>,
): PaymentMethod {
  const stored = normalizePaymentMethod(req.preferredPaymentMethod);
  if (stored) return stored;
  const details = (req.paymentAccountDetails || '').trim();
  if (details.includes('@')) return 'instapay';
  if (details.includes('خزينة')) return 'cash';
  const compact = details.replace(/[\s-]/g, '');
  if (/^\+?\d{8,15}$/.test(compact)) return 'digital_wallet';
  return 'bank_transfer';
}

export const paymentMethodLabel = (method?: string | null): string =>
  PAYMENT_METHOD_LABELS[normalizePaymentMethod(method) ?? 'bank_transfer'];

/** The label of a request's payout method (inferred for old records), for badges, filters and exports. */
export const requestPaymentMethodLabel = (req: Pick<ExpenseRequest, 'preferredPaymentMethod' | 'paymentAccountDetails'>): string =>
  PAYMENT_METHOD_LABELS[resolveRequestPaymentMethod(req)];

export const incomeMethodLabel = (method?: string | null): string =>
  INCOME_METHOD_LABELS[normalizePaymentMethod(method) ?? 'bank_transfer'];

/** Old timeline entries stored the raw method code ("طريقة التحويل: instapay (…)"). */
export const localizePaymentMethodText = (text?: string | null): string =>
  (text || '').replace(/(طريقة التحويل:\s*)(instapay|bank_transfer|digital_wallet|wallet|cash|cheque)\b/g, (_m, prefix: string, code: string) =>
    `${prefix}${paymentMethodLabel(code)}`,
  );

/**
 * The IBAN inside a bank-transfer payout text. The profile auto-fill writes
 * "<bank name> - <IBAN>", a typed value is the IBAN alone.
 */
export const extractIban = (details?: string | null): string => {
  const text = (details || '').trim();
  if (!text) return '';
  const parts = text.split(' - ');
  return parts[parts.length - 1].replace(/[\s-]/g, '').toUpperCase();
};

// ---------------------------------------------------------------------------
// Treasury accounts
// ---------------------------------------------------------------------------
export const ACCOUNT_TYPE_LABELS: Record<PaymentAccountType, string> = {
  bank: 'حساب بنكي',
  instapay: 'إنستاباي',
  wallet: 'محفظة إلكترونية',
  cash: 'خزينة نقدية',
  other: 'حساب آخر',
};

export const accountTypeLabel = (type?: string | null): string =>
  ACCOUNT_TYPE_LABELS[(type as PaymentAccountType) || 'other'] || ACCOUNT_TYPE_LABELS.other;

export const accountTypeToPaymentMethod = (type?: PaymentAccountType | null): PaymentMethod => {
  switch (type) {
    case 'instapay': return 'instapay';
    case 'wallet': return 'digital_wallet';
    case 'cash': return 'cash';
    default: return 'bank_transfer';
  }
};

export const paymentMethodToAccountType = (method?: PaymentMethod | null): PaymentAccountType => {
  switch (normalizePaymentMethod(method)) {
    case 'instapay': return 'instapay';
    case 'digital_wallet': return 'wallet';
    case 'cash': return 'cash';
    case 'bank_transfer': return 'bank';
    default: return 'other';
  }
};

const toMoney = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

/** Same accessor as the domain (src/domain/treasury.ts). */
export const accountBalance = (account?: Pick<PaymentAccount, 'currentBalance' | 'balance'> | null): number =>
  toMoney(account?.currentBalance ?? account?.balance ?? 0);

/** Same normalisation as the domain: an empty currency is EGP. */
export const currencyCode = (currency?: string | null): string => ((currency || '').trim() || 'EGP').toUpperCase();

/**
 * What an account can pay out right now. No money operation may take an account below
 * zero, and an InstaPay channel's payment is also taken from the bank it is linked to,
 * so both must cover it (the domain refuses anything above this).
 */
export const spendableBalance = (account?: PaymentAccount | null, linkedBank?: PaymentAccount | null): number => {
  if (!account) return 0;
  const own = accountBalance(account);
  return linkedBank ? Math.min(own, accountBalance(linkedBank)) : own;
};

export type LinkedBankOf = (account: PaymentAccount | null | undefined) => PaymentAccount | null;

/** Accounts a request can be paid from / received into: same company, active, same currency. */
export const accountsForRequest = (
  accounts: PaymentAccount[],
  req: Pick<ExpenseRequest, 'orgId' | 'currency'>,
): PaymentAccount[] =>
  accounts.filter(
    a =>
      a.active !== false &&
      (!req.orgId || !a.orgId || a.orgId === req.orgId) &&
      currencyCode(a.currency) === currencyCode(req.currency),
  );

/**
 * The account a disbursement form starts on: the request's own target account when it
 * can be used, else an account of the requested method that covers the amount, else any
 * account that covers it, else the first of the requested method, else the first one.
 */
export function pickDisbursementAccount(
  eligible: PaymentAccount[],
  req: Pick<ExpenseRequest, 'amount' | 'targetAccountId' | 'preferredPaymentMethod' | 'paymentAccountDetails' | 'requestType'>,
  linkedBankOf: LinkedBankOf,
): PaymentAccount | null {
  if (eligible.length === 0) return null;
  const target = req.targetAccountId ? eligible.find(a => a.id === req.targetAccountId) : undefined;
  if (target) return target;
  const wantedType = paymentMethodToAccountType(resolveRequestPaymentMethod(req));
  const amount = toMoney(req.amount);
  const covers = (a: PaymentAccount) => req.requestType === 'income' || spendableBalance(a, linkedBankOf(a)) >= amount;
  return (
    eligible.find(a => a.type === wantedType && covers(a)) ||
    eligible.find(covers) ||
    eligible.find(a => a.type === wantedType) ||
    eligible[0]
  );
}

export interface CoverageCheck {
  /** The account of the requested method (or the request's target account), if the company has one. */
  matching: PaymentAccount | null;
  matchingLinkedBank: PaymentAccount | null;
  matchingSpendable: number;
  /** The account able to pay the most (one disbursement is paid from ONE account). */
  best: PaymentAccount | null;
  bestSpendable: number;
  /** ok: the requested method's account covers it · other: another account covers it · none: no account covers it. */
  level: 'ok' | 'other' | 'none';
}

/**
 * Can the company pay this request? Used by the approval warning. An InstaPay channel
 * pays with its linked bank's money, so it is judged together with that bank
 * (spendableBalance), and when it cannot pay, the account that can (usually that
 * bank) is named instead of warning that the payment "may fail".
 */
export function checkRequestCoverage(
  eligible: PaymentAccount[],
  req: Pick<ExpenseRequest, 'amount' | 'targetAccountId' | 'preferredPaymentMethod' | 'paymentAccountDetails'>,
  linkedBankOf: LinkedBankOf,
): CoverageCheck {
  const amount = toMoney(req.amount);
  const wantedType = paymentMethodToAccountType(resolveRequestPaymentMethod(req));
  const matching =
    (req.targetAccountId ? eligible.find(a => a.id === req.targetAccountId) : undefined) ||
    eligible.find(a => a.type === wantedType) ||
    null;
  const matchingLinkedBank = matching ? linkedBankOf(matching) : null;
  const matchingSpendable = matching ? spendableBalance(matching, matchingLinkedBank) : 0;

  let best: PaymentAccount | null = null;
  let bestSpendable = 0;
  for (const a of eligible) {
    const s = spendableBalance(a, linkedBankOf(a));
    // Prefer the matching channel's own bank on a tie (it is where the money really is).
    if (!best || s > bestSpendable || (s === bestSpendable && a.id === matchingLinkedBank?.id)) {
      best = a;
      bestSpendable = s;
    }
  }
  const level: CoverageCheck['level'] =
    matching && matchingSpendable >= amount ? 'ok' : best && bestSpendable >= amount ? 'other' : 'none';
  return { matching, matchingLinkedBank, matchingSpendable, best, bestSpendable, level };
}

/**
 * Arabic reason a disbursement of `amount` from `account` is refused (policy: no money
 * operation takes an account below zero), or null when the account covers it.
 */
export function insufficientBalanceMessage(
  account: PaymentAccount | null | undefined,
  linkedBank: PaymentAccount | null | undefined,
  amount: number,
): string | null {
  if (!account) return null;
  const cur = currencyCode(account.currency);
  const need = toMoney(amount);
  const own = accountBalance(account);
  if (own < need) {
    return `رصيد الحساب "${account.name}" غير كافٍ: المتاح ${fmtMoney(own)} ${cur} والمبلغ المطلوب ${fmtMoney(need)} ${cur}. يرجى إيداع المبلغ في الحساب أولاً (الخزينة ← إيداع وتغذية رصيد) أو اختيار حساب آخر.`;
  }
  if (linkedBank && accountBalance(linkedBank) < need) {
    const bankBalance = accountBalance(linkedBank);
    return `رصيد الحساب البنكي المرتبط "${linkedBank.name}" غير كافٍ للخصم عبر "${account.name}": المتاح ${fmtMoney(bankBalance)} ${cur} والمبلغ المطلوب ${fmtMoney(need)} ${cur}. يرجى إيداع المبلغ في الحساب البنكي أولاً أو اختيار حساب آخر.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Numbers and dates — Western digits, local (browser / Africa-Cairo) time
// ---------------------------------------------------------------------------
export const fmtMoney = (value: unknown): string => toMoney(value).toLocaleString('en-US', { maximumFractionDigits: 2 });

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * "YYYY-MM-DD HH:mm" in the viewer's local time with Western digits. ISO timestamps
 * (stored in UTC) are converted; stamps that are already local wall-clock text (the
 * timeline / disbursement stamps written by the domain) are returned unchanged.
 */
export function formatLocalDateTime(value?: string | null): string {
  if (!value) return '';
  if (!/T\d{2}:\d{2}/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD" of a timestamp in the viewer's local time. */
export const formatLocalDate = (value?: string | null): string => formatLocalDateTime(value).slice(0, 10);

/** Today as "YYYY-MM-DD" in the viewer's local time (file names, filters). */
export const localToday = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

// ---------------------------------------------------------------------------
// Clipboard — never reports "copied" when the browser refused the write
// ---------------------------------------------------------------------------
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied / insecure context: fall back to a hidden textarea below.
  }
  if (typeof document === 'undefined') return false;
  const previousFocus = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  try {
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    if (previousFocus && previousFocus !== document.body && document.contains(previousFocus)) {
      previousFocus.focus({ preventScroll: true });
    }
  }
}
