/**
 * Expense-request steps shared by the browser tests: create (employee), approve (admin),
 * disburse (finance) — through the same screens a person uses.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import path from 'path';
import { dialog, field, openTab } from './helpers';

export const INVOICE_PNG = path.join(import.meta.dirname, 'fixtures', 'invoice.png');
export const TANTA_BANK = 'vault-bank-org-tegy';
export const TANTA_BANK_NAME = 'حساب بنكي رئيسي (Tie-Tanta)';

export const newRequestDialog = (page: Page) => dialog(page, 'طلب صرف ومطالبة مالية');

/**
 * Opens the new-request form and fills it: the internet quick template, a unique title, the
 * amount, cash payout, and (optionally) the invoice image. Leaves the form open, unsubmitted.
 */
export async function fillNewExpenseRequest(page: Page, opts: { title: string; amount: string; invoice?: boolean }) {
  await page.getByRole('banner').getByRole('button', { name: 'طلب صرف جديد' }).click();
  const form = newRequestDialog(page);
  await expect(form).toBeVisible();
  // The template picks its service from the company's services: wait until they are loaded.
  const service = field(form, 'بند الخدمة / مركز التكلفة *', 'select');
  await expect(service.getByRole('option', { name: /^WE Internet/ })).toHaveCount(1);

  await form.getByRole('button', { name: '⚡ فواتير إنترنت وهاتف' }).click();
  // The template writes its own title; this test needs one it can find again.
  const title = form.getByPlaceholder('اكتب موضوع وعنوان الطلب بالتفصيل هنا...');
  await expect(title).toHaveValue('سداد فاتورة الإنترنت الشهرية');
  await title.fill(opts.title);
  // The template also picks the matching service.
  await expect.poll(() => selectedText(service)).toContain('WE Internet');

  await form.getByPlaceholder('0.00').fill(opts.amount);
  await form
    .getByRole('combobox')
    .filter({ has: page.getByRole('option', { name: 'نقداً من الخزينة' }) })
    .selectOption('cash');

  if (opts.invoice) {
    const chooser = page.waitForEvent('filechooser');
    await form.getByRole('button', { name: 'اختيار ملف من جهازك' }).click();
    await (await chooser).setFiles(INVOICE_PNG);
    await expect(form.getByText('مرفق جاهز ✓')).toBeVisible({ timeout: 60_000 });
  }
  return form;
}

export const submitButton = (page: Page) =>
  newRequestDialog(page).getByRole('button', { name: 'إرسال طلب الصرف للاعتماد (- OUT)' });

/** Opens the requests page and selects the request with this (unique) title. */
export async function openRequestInList(page: Page, title: string) {
  await openTab(page, /^طلبات الصرف/);
  const main = page.getByRole('main');
  await main.getByPlaceholder('بحث برقم الطلب، الموظف، المورد، أو العنوان...').fill(title);
  const row = main.getByRole('heading', { level: 4, name: title, exact: true });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(main.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
  return main;
}

export async function approveInList(page: Page, title: string) {
  const main = await openRequestInList(page, title);
  await main.getByRole('button', { name: 'اعتماد الطلب ✓' }).click();
  await main.getByRole('button', { name: 'تأكيد الاعتماد المالي' }).click();
  await expect(main.getByRole('button', { name: '💸 تنفيذ الصرف والتحويل المالي الآن' })).toBeVisible();
}

/** Opens the disbursement form of an approved request (finance) with the account chosen. */
export async function openDisburseForm(page: Page, title: string, accountName = TANTA_BANK_NAME) {
  const main = await openRequestInList(page, title);
  await main.getByRole('button', { name: '💸 تنفيذ الصرف والتحويل المالي الآن' }).click();
  const accountSelect = field(main, 'خزينة / حساب الصرف المحول منه (- OUT) *', 'select');
  const option = accountSelect.getByRole('option', { name: new RegExp(`^${escapeRe(accountName)} — `) });
  await accountSelect.selectOption({ label: (await option.textContent())!.trim() });
  await main.getByPlaceholder('مثال: TXN-94827103').fill(`TXN-E2E-${Date.now()}`);
  return main.getByRole('button', { name: '💸 تأكيد تحويل وصرف المبلغ من الخزينة (- OUT)' });
}

/** The visible text of a <select>'s chosen option. */
export const selectedText = (select: Locator) =>
  select.evaluate(s => (s as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() || '');

export const escapeRe =(s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
