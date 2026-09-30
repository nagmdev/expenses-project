/**
 * Request screens' shared helpers (src/utils/requestUi.ts) and payout validation
 * (src/utils/validation.ts): one payment-method answer for every screen, balances that
 * match the domain (InstaPay judged with its linked bank), local times, IBAN checks.
 */
import { describe, expect, it } from 'vitest';
import type { PaymentAccount } from '../src/types';
import {
  accountsForRequest,
  checkRequestCoverage,
  extractIban,
  fmtMoney,
  formatLocalDate,
  formatLocalDateTime,
  insufficientBalanceMessage,
  localizePaymentMethodText,
  paymentMethodLabel,
  pickDisbursementAccount,
  requestPaymentMethodLabel,
  resolveRequestPaymentMethod,
  spendableBalance,
} from '../src/utils/requestUi';
import { beneficiaryNameError, ibanError, instapayAddressError, walletNumberError } from '../src/utils/validation';

const account = (id: string, type: PaymentAccount['type'], balance: number, extra: Partial<PaymentAccount> = {}): PaymentAccount => ({
  id,
  orgId: 'org-a',
  name: id,
  type,
  accountIdentifier: `${id}-no`,
  currentBalance: balance,
  balance,
  currency: 'EGP',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

const bank = account('bank', 'bank', 196_450);
const instapay = account('instapay', 'instapay', 0, { parentAccountId: 'bank' });
const cash = account('cash', 'cash', 500);
const all = [bank, instapay, cash];
const linkedBankOf = (a: PaymentAccount | null | undefined) =>
  a?.type === 'instapay' && a.parentAccountId ? all.find(x => x.id === a.parentAccountId) || null : null;

describe('payment method: one answer for list badge, filter, detail and edit form', () => {
  it('uses the stored method; the legacy "wallet" code is the e-wallet', () => {
    expect(resolveRequestPaymentMethod({ preferredPaymentMethod: 'instapay' })).toBe('instapay');
    expect(resolveRequestPaymentMethod({ preferredPaymentMethod: 'wallet' })).toBe('digital_wallet');
  });

  it('infers the method of older records from the payout details; nothing at all is a bank transfer', () => {
    expect(resolveRequestPaymentMethod({ paymentAccountDetails: 'sara@instapay' })).toBe('instapay');
    expect(resolveRequestPaymentMethod({ paymentAccountDetails: '01012345678' })).toBe('digital_wallet');
    expect(resolveRequestPaymentMethod({ paymentAccountDetails: 'EG380019000500000000263180002' })).toBe('bank_transfer');
    expect(resolveRequestPaymentMethod({})).toBe('bank_transfer');
    expect(requestPaymentMethodLabel({})).toBe('تحويل بنكي (IBAN)');
    expect(paymentMethodLabel('cash')).toBe('نقداً من الخزينة');
  });

  it('localizes raw method codes written into old timeline entries', () => {
    expect(localizePaymentMethodText('طريقة التحويل: instapay (01000000000)')).toBe('طريقة التحويل: انستاباي (InstaPay) (01000000000)');
    expect(localizePaymentMethodText('تم إرسال الطلب')).toBe('تم إرسال الطلب');
  });

  it('finds the IBAN inside a "bank - IBAN" profile auto-fill', () => {
    expect(extractIban('البنك الأهلي - EG38 0019 0005 0000 0000 2631 8000 2')).toBe('EG380019000500000000263180002');
    expect(extractIban('EG380019000500000000263180002')).toBe('EG380019000500000000263180002');
  });
});

describe('balances: never below zero, InstaPay judged with its linked bank', () => {
  it('an InstaPay channel can spend only what both it and its bank hold', () => {
    expect(spendableBalance(instapay, bank)).toBe(0);
    expect(spendableBalance(account('ip2', 'instapay', 900, { parentAccountId: 'bank' }), account('b2', 'bank', 300))).toBe(300);
    expect(spendableBalance(bank)).toBe(196_450);
  });

  it('approval check: an empty InstaPay channel points to its funded bank instead of warning the payment may fail', () => {
    const cover = checkRequestCoverage(all, { amount: 1800, preferredPaymentMethod: 'instapay' }, linkedBankOf);
    expect(cover.matching?.id).toBe('instapay');
    expect(cover.matchingLinkedBank?.id).toBe('bank');
    expect(cover.level).toBe('other');
    expect(cover.best?.id).toBe('bank');
  });

  it('approval check: ok when the requested method covers it, none when no account does', () => {
    expect(checkRequestCoverage(all, { amount: 400, preferredPaymentMethod: 'cash' }, linkedBankOf).level).toBe('ok');
    expect(checkRequestCoverage(all, { amount: 1_000_000, preferredPaymentMethod: 'cash' }, linkedBankOf).level).toBe('none');
    expect(checkRequestCoverage([], { amount: 1 }, linkedBankOf).level).toBe('none');
  });

  it('disbursement refuses an amount above the chosen account (or its linked bank)', () => {
    expect(insufficientBalanceMessage(cash, null, 500)).toBeNull();
    expect(insufficientBalanceMessage(cash, null, 501)).toContain('غير كافٍ');
    expect(insufficientBalanceMessage(cash, null, 501)).toContain('إيداع');
    const funded = account('ip3', 'instapay', 5000, { parentAccountId: 'b3' });
    expect(insufficientBalanceMessage(funded, account('b3', 'bank', 100), 1000)).toContain('البنكي المرتبط');
  });

  it('the disbursement form starts on the target account, else one of the method that covers the amount', () => {
    expect(pickDisbursementAccount(all, { amount: 10, targetAccountId: 'cash' }, linkedBankOf)?.id).toBe('cash');
    expect(pickDisbursementAccount(all, { amount: 1800, preferredPaymentMethod: 'instapay' }, linkedBankOf)?.id).toBe('bank');
    expect(pickDisbursementAccount(all, { amount: 100, preferredPaymentMethod: 'cash' }, linkedBankOf)?.id).toBe('cash');
    expect(pickDisbursementAccount([], { amount: 1 }, linkedBankOf)).toBeNull();
  });

  it('only accounts of the request company, active and in its currency are offered', () => {
    const list = [bank, account('usd', 'bank', 10, { currency: 'USD' }), account('off', 'cash', 10, { active: false }), account('other', 'cash', 10, { orgId: 'org-b' })];
    expect(accountsForRequest(list, { orgId: 'org-a', currency: 'egp' }).map(a => a.id)).toEqual(['bank']);
  });
});

describe('numbers and dates', () => {
  it('money always uses Western digits', () => {
    expect(fmtMoney(4200)).toBe('4,200');
    expect(fmtMoney('1250.456')).toBe('1,250.46');
  });

  it('UTC timestamps are shown in local time; local wall-clock stamps stay as written', () => {
    const iso = '2026-09-30T10:43:00.000Z';
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    expect(formatLocalDateTime(iso)).toBe(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
    expect(formatLocalDateTime('2026-09-30 13:47')).toBe('2026-09-30 13:47');
    expect(formatLocalDate(iso)).toBe(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    expect(formatLocalDateTime(undefined)).toBe('');
  });
});

describe('payout validation (new / edited request)', () => {
  it('IBAN: format, country length and check digits', () => {
    expect(ibanError('EG380019000500000000263180002')).toBeNull();
    expect(ibanError('SA0380000000608010167519')).toBeNull();
    expect(ibanError('12')).toContain('غير صحيح');
    expect(ibanError('EG3800190005')).not.toBeNull();
    expect(ibanError('EG390019000500000000263180002')).toContain('رقما التحقق');
    expect(ibanError('')).not.toBeNull();
  });

  it('e-wallet: an Egyptian wallet is an 11-digit 010/011/012/015 number', () => {
    expect(walletNumberError('01012345678')).toBeNull();
    expect(walletNumberError('0101234567')).not.toBeNull();
    expect(walletNumberError('01312345678')).not.toBeNull();
  });

  it('InstaPay: name@instapay or the linked mobile number', () => {
    expect(instapayAddressError('sara.e2e@instapay')).toBeNull();
    expect(instapayAddressError('01000000000')).toBeNull();
    expect(instapayAddressError('sara@gmail.com')).not.toBeNull();
    expect(instapayAddressError('')).not.toBeNull();
  });

  it('beneficiary name is required (the field is marked *) and must be a real full name', () => {
    expect(beneficiaryNameError('')).not.toBeNull();
    expect(beneficiaryNameError('   ')).not.toBeNull();
    expect(beneficiaryNameError('أحمد')).not.toBeNull();
    expect(beneficiaryNameError('12345 678')).not.toBeNull();
    expect(beneficiaryNameError('أحمد محمد عبد الرحمن علي')).toBeNull();
  });
});
