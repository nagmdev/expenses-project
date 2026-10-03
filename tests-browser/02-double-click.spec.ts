import { expect, test } from '@playwright/test';
import { fsBalance, fsWhere, signIn, uniq } from './helpers';
import { TANTA_BANK, approveInList, fillNewExpenseRequest, openDisburseForm, submitButton } from './requests';

/**
 * (2) Impatient double clicks: the submit lock + idempotency key must turn two clicks into
 * one request, and two clicks on «confirm disbursement» into one payment (one ledger line,
 * the balance moved once).
 */
test('double click on submit creates ONE request; double click on disburse pays once', async ({ browser }) => {
  const title = `اختبار النقر المزدوج ${uniq()}`;
  const amount = 321.75;

  const emp = await signIn(browser, 'employee');
  await fillNewExpenseRequest(emp.page, { title, amount: '321.75' });
  await submitButton(emp.page).dblclick();
  await expect(emp.page.getByRole('dialog')).toHaveCount(0);
  await expect(emp.page.getByRole('main').getByRole('heading', { level: 4, name: title, exact: true })).toHaveCount(1);
  await expect.poll(async () => (await fsWhere('requests', 'title', title)).length).toBe(1);

  const admin = await signIn(browser, 'admin');
  await approveInList(admin.page, title);
  await expect.poll(async () => (await fsWhere('requests', 'title', title))[0]?.status).toBe('approved');
  const [request] = await fsWhere('requests', 'title', title);

  const bankBefore = await fsBalance(TANTA_BANK);
  const fin = await signIn(browser, 'finance');
  const confirm = await openDisburseForm(fin.page, title);
  await confirm.dblclick();
  await expect.poll(async () => (await fsWhere('requests', 'title', title))[0]?.status).toBe('disbursed');
  await expect.poll(() => fsBalance(TANTA_BANK)).toBeCloseTo(bankBefore - amount, 2);
  // Exactly one ledger line for the request, and the bank did not move a second time.
  expect(await fsWhere('accountTransactions', 'referenceId', request.id)).toHaveLength(1);
  await expect(fin.page.getByRole('main').getByRole('button', { name: '💸 تنفيذ الصرف والتحويل المالي الآن' })).toHaveCount(0);
  expect(await fsBalance(TANTA_BANK)).toBeCloseTo(bankBefore - amount, 2);
  // Checked again at the end: a second write from the double click would have landed by now
  // (the polls above stop at the first matching value).
  expect(await fsWhere('requests', 'title', title)).toHaveLength(1);
  expect(await fsWhere('accountTransactions', 'referenceId', request.id)).toHaveLength(1);
  await expect(emp.page.getByRole('main').getByRole('heading', { level: 4, name: title, exact: true })).toHaveCount(1);

  await Promise.all([emp.context.close(), admin.context.close(), fin.context.close()]);
});
