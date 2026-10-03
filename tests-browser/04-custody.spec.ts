import { expect, test, type Locator } from '@playwright/test';
import { field, fsBalance, fsWhere, openTab, panel, parseMoney, signIn, uniq } from './helpers';
import { escapeRe, selectedText } from './requests';

const TANTA_CASH = 'vault-cash-org-tegy';
const TANTA_CASH_NAME = 'خزينة نقدية (Tie-Tanta)';

/** The amount printed right after a small caption (custody card / statement figures). */
const amountAfter = async (scope: Locator, caption: string) =>
  parseMoney(await scope.getByText(caption, { exact: true }).locator('xpath=following-sibling::span[1]').innerText());

/**
 * (4) Custody life cycle with decimal amounts: finance issues → the employee sees it and
 * settles an invoice → finance returns the remainder to the cash box; the card's figures add
 * up, the cash box ends where it started minus the invoice, and the card opens its statement.
 */
test('custody: issue (decimals) → employee settles an invoice → finance returns the rest; the card adds up', async ({ browser }) => {
  const notes = `عهدة اختبار ${uniq()}`;
  const total = 1500.75;
  const invoice = 600.25;
  const remainder = 900.5;

  const cashBefore = await fsBalance(TANTA_CASH);

  // Finance issues the custody from the cash box
  const fin = await signIn(browser, 'finance');
  await openTab(fin.page, 'العهد النقدية');
  await fin.page.getByRole('button', { name: 'صرف عهدة جديدة لموظف' }).click();
  const issue = panel(fin.page, 'صرف عهدة نقدية جديدة', 'تأكيد وصرف العهدة');
  const employee = field(issue, 'الموظف أو المندوب المستلم *', 'select');
  await employee.selectOption({ label: (await employee.getByRole('option', { name: /^سارة موظفة طنطا/ }).textContent())!.trim() });
  await field(issue, 'مبلغ العهدة المطلوب صرفه *').fill('1500.75');
  const source = field(issue, 'خصم من الخزينة / حساب الدفع *', 'select');
  await source.selectOption({ label: (await source.getByRole('option', { name: new RegExp(`^${escapeRe(TANTA_CASH_NAME)}`) }).textContent())!.trim() });
  expect(await selectedText(source)).toContain(TANTA_CASH_NAME);
  await field(issue, 'الغرض من العهدة / ملاحظات').fill(notes);
  await issue.getByRole('button', { name: 'تأكيد وصرف العهدة' }).click();
  await expect(issue).toHaveCount(0);

  const finCard = fin.page.getByRole('button', { name: /^عرض كشف حساب العهدة / }).filter({ hasText: notes });
  await expect(finCard).toHaveCount(1);
  await expect.poll(() => amountAfter(finCard, 'إجمالي العهدة')).toBe(total);
  await expect.poll(() => fsBalance(TANTA_CASH)).toBeCloseTo(cashBefore - total, 2);

  // The employee sees it and settles one invoice
  const emp = await signIn(browser, 'employee');
  await openTab(emp.page, 'عُهدي النقدية وتصفيتها');
  const empCard = emp.page.getByRole('button', { name: /^عرض كشف حساب العهدة / }).filter({ hasText: notes });
  await expect(empCard).toHaveCount(1);
  await expect.poll(() => amountAfter(empCard, 'المتبقي نقداً')).toBe(total);
  await empCard.getByRole('button', { name: 'تصفية عهدة (فاتورة)' }).click();
  const settle = panel(emp.page, 'تصفية عهدة (تسجيل فاتورة)', 'تسجيل الفاتورة وتصفية المبلغ');
  await field(settle, 'قيمة الفاتورة *').fill('600.25');
  await settle.getByPlaceholder('شراء أدوات مكتبية وأوراق طباعة للمقر...').fill(`فاتورة ${notes}`);
  await settle.getByRole('button', { name: 'تسجيل الفاتورة وتصفية المبلغ' }).click();
  await expect(settle).toHaveCount(0);
  await expect.poll(() => amountAfter(empCard, 'المصفى بفواتير')).toBe(invoice);
  await expect.poll(() => amountAfter(empCard, 'المتبقي نقداً')).toBe(remainder);

  // Finance returns the remainder to the cash box it came from
  await expect.poll(() => amountAfter(finCard, 'المتبقي نقداً')).toBe(remainder);
  await finCard.getByRole('button', { name: /^إيداع المتبقي للحساب المسحوب منه/ }).click();
  const confirmReturn = fin.page.getByRole('button', { name: new RegExp(`^تأكيد إيداع المتبقي \\(${escapeRe('900.5')} EGP\\) في ${escapeRe(TANTA_CASH_NAME)}`) });
  await confirmReturn.click();
  await expect(confirmReturn).toHaveCount(0);

  // The numbers on the card add up: total = invoices + returned + still with the employee
  await expect(finCard.getByText('أُغلقت — تم رد المتبقي للخزينة')).toBeVisible();
  await expect.poll(() => amountAfter(finCard, 'المتبقي نقداً')).toBe(0);
  const settled = await amountAfter(finCard, 'المصفى بفواتير');
  const returned = parseMoney(await finCard.getByText(/^مُرد للخزينة: /).innerText());
  const left = await amountAfter(finCard, 'المتبقي نقداً');
  expect(await amountAfter(finCard, 'إجمالي العهدة')).toBe(total);
  expect(settled).toBe(invoice);
  expect(returned).toBe(remainder);
  expect(Math.round((settled + returned + left) * 100)).toBe(Math.round(total * 100));
  await expect.poll(() => fsBalance(TANTA_CASH)).toBeCloseTo(cashBefore - invoice, 2);
  const [stored] = await fsWhere('custodies', 'notes', notes);
  expect(stored).toMatchObject({ totalAmount: total, settledAmount: invoice, remainingAmount: 0, returnedAmount: remainder });

  // Clicking the card opens its statement
  await finCard.click();
  const statement = fin.page
    .locator('div')
    .filter({ has: fin.page.getByRole('heading', { name: 'كشف حساب العهدة' }) })
    .filter({ hasText: 'سجل فواتير هذه العهدة' })
    .last();
  await expect(statement).toBeVisible();
  await expect(statement.getByText(`فاتورة ${notes}`)).toBeVisible();
  expect(await amountAfter(statement, 'إجمالي المنصرف')).toBe(total);
  expect(await amountAfter(statement, 'تمت تصفيته بالفواتير')).toBe(invoice);
  expect(await amountAfter(statement, 'مُرد للخزينة')).toBe(remainder);
  expect(await amountAfter(statement, 'المتبقي طرف الموظف')).toBe(0);

  await Promise.all([fin.context.close(), emp.context.close()]);
});
