import { expect, test } from '@playwright/test';
import { fsBalance, fsWhere, signIn, uniq } from './helpers';
import { TANTA_BANK, approveInList, fillNewExpenseRequest, openDisburseForm, submitButton } from './requests';

/**
 * (1) The whole life of an expense request across three roles, each in its own browser
 * session: employee creates (quick template + amount + invoice image) → admin approves →
 * finance disburses from the bank → employee sees it paid and opens the invoice.
 */
test('expense request: create with invoice → approve → disburse → employee sees it paid', async ({ browser }) => {
  const title = `اختبار دورة كاملة ${uniq()}`;
  const amount = 1234.5;

  // Employee: create and submit
  const emp = await signIn(browser, 'employee');
  await fillNewExpenseRequest(emp.page, { title, amount: '1234.50', invoice: true });
  await submitButton(emp.page).click();
  await expect(emp.page.getByRole('dialog')).toHaveCount(0);
  const tracker = emp.page.getByRole('main');
  await expect(tracker.getByRole('heading', { level: 4, name: title, exact: true })).toBeVisible();

  const [saved] = await fsWhere('requests', 'title', title);
  expect(saved).toMatchObject({ status: 'pending', amount, currency: 'EGP', serviceCategoryName: 'WE Internet', preferredPaymentMethod: 'cash' });
  expect(String(saved.invoiceAttachment?.url)).toMatch(/^fsattach:\/\//);

  // Admin: approve
  const admin = await signIn(browser, 'admin');
  await approveInList(admin.page, title);
  await expect.poll(async () => (await fsWhere('requests', 'title', title))[0]?.status).toBe('approved');

  // Finance: disburse from the bank; the bank moves by exactly the amount
  const bankBefore = await fsBalance(TANTA_BANK);
  const fin = await signIn(browser, 'finance');
  const confirm = await openDisburseForm(fin.page, title);
  await confirm.click();
  await expect(fin.page.getByRole('main').getByRole('button', { name: '💸 تنفيذ الصرف والتحويل المالي الآن' })).toHaveCount(0);
  await expect.poll(async () => (await fsWhere('requests', 'title', title))[0]?.status).toBe('disbursed');
  await expect.poll(() => fsBalance(TANTA_BANK)).toBeCloseTo(bankBefore - amount, 2);

  // Employee: sees it paid, opens the invoice and the image really loads
  await tracker.getByRole('heading', { level: 4, name: title, exact: true }).click();
  await expect(tracker.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
  await expect(tracker.getByText('إشعار التحويل البنكي الرسمي (Payment Advice)')).toBeVisible();
  await expect(tracker.getByText('تم الصرف بنجاح')).toBeVisible();
  await tracker.getByRole('button', { name: 'معاينة وتكبير الفاتورة' }).click();
  const viewer = emp.page.getByRole('dialog', { name: /^معاينة المستند: / });
  await expect(viewer).toBeVisible();
  const image = viewer.getByRole('img', { name: 'invoice.png' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  await Promise.all([emp.context.close(), admin.context.close(), fin.context.close()]);
});
