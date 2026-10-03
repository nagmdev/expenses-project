import { expect, test } from '@playwright/test';
import { account, fsBalance, fsWhere, originOf, sidebar, signIn, uniq } from './helpers';
import { TANTA_BANK, approveInList, fillNewExpenseRequest, openDisburseForm, submitButton } from './requests';

/**
 * (3) The same finance user has the request open in two tabs and confirms the payment in
 * both at the same moment: the request is paid once (the transaction + deterministic ledger
 * id refuse the second), the bank moves once.
 */
test('two tabs of the same finance user disbursing the same request → paid once', async ({ browser }) => {
  const title = `اختبار تبويبين ${uniq()}`;
  const amount = 410.25;

  const emp = await signIn(browser, 'employee');
  await fillNewExpenseRequest(emp.page, { title, amount: '410.25' });
  await submitButton(emp.page).click();
  await expect(emp.page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await fsWhere('requests', 'title', title)).length).toBe(1);

  const admin = await signIn(browser, 'admin');
  await approveInList(admin.page, title);
  await expect.poll(async () => (await fsWhere('requests', 'title', title))[0]?.status).toBe('approved');
  const [request] = await fsWhere('requests', 'title', title);

  // Two tabs, one session
  const fin = await signIn(browser, 'finance');
  const tab2 = await fin.context.newPage();
  await tab2.goto(`${originOf('finance')}/`);
  await expect(sidebar(tab2).getByRole('button', { name: account('finance').name })).toBeVisible({ timeout: 60_000 });

  const confirm1 = await openDisburseForm(fin.page, title);
  const confirm2 = await openDisburseForm(tab2, title);
  await expect(confirm1).toBeEnabled();
  await expect(confirm2).toBeEnabled();

  const bankBefore = await fsBalance(TANTA_BANK);
  await Promise.all([confirm1.click(), confirm2.click()]);

  await expect.poll(async () => (await fsWhere('requests', 'title', title))[0]?.status).toBe('disbursed');
  await expect.poll(() => fsBalance(TANTA_BANK)).toBeCloseTo(bankBefore - amount, 2);
  // Both tabs end on the paid request; neither still offers to pay it.
  for (const page of [fin.page, tab2]) {
    await expect(page.getByRole('main').getByRole('button', { name: '💸 تنفيذ الصرف والتحويل المالي الآن' })).toHaveCount(0);
  }
  expect(await fsWhere('accountTransactions', 'referenceId', request.id)).toHaveLength(1);
  expect(await fsBalance(TANTA_BANK)).toBeCloseTo(bankBefore - amount, 2);

  await Promise.all([emp.context.close(), admin.context.close(), fin.context.close()]);
});
