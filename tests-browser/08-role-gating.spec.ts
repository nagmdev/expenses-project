import { expect, test } from '@playwright/test';
import { fsWhere, openTab, sidebar, signIn, uniq } from './helpers';
import { fillNewExpenseRequest, submitButton } from './requests';

/** Requests the seed creates for Tie-Tanta (tests-e2e/seed.seed.ts). */
const TANTA_SEEDED_TITLES = ['اشتراك إنترنت شهر أكتوبر', 'باقة إنترنت إضافية', 'راوتر جديد للمكتب'];

/** (8) What each role may see. */
test.describe('role gating', () => {
  test('an employee has no treasury (or other management) menu', async ({ browser }) => {
    const emp = await signIn(browser, 'employee');
    const menu = sidebar(emp.page);
    await expect(menu.getByRole('button', { name: 'طلباتي ومتابعة الصرف' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'عُهدي النقدية وتصفيتها' })).toBeVisible();
    for (const hidden of ['الخزائن وحسابات الدفع', /^طلبات الصرف/, 'لوحة المؤشرات', 'المستخدمون والموظفون', 'سجل التدقيق والعمليات', 'إعدادات النظام']) {
      await expect(menu.getByRole('button', { name: hidden })).toHaveCount(0);
    }
    await emp.context.close();
  });

  test("the Cairo admin sees Cairo's requests but none of Tanta's", async ({ browser }) => {
    // A Cairo request first, so the list is known to be loaded when Tanta's are checked.
    const cairoTitle = `طلب القاهرة ${uniq()}`;
    const emp2 = await signIn(browser, 'employee2');
    await fillNewExpenseRequest(emp2.page, { title: cairoTitle, amount: '75.5' });
    await submitButton(emp2.page).click();
    await expect(emp2.page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => (await fsWhere('requests', 'title', cairoTitle))[0]?.orgId).toBe('org-hcai');

    const admin2 = await signIn(browser, 'admin2');
    await expect(admin2.page.getByRole('banner').getByText('Home-Cairo')).toBeVisible();
    await openTab(admin2.page, /^طلبات الصرف/);
    const main = admin2.page.getByRole('main');
    await expect(main.getByRole('heading', { level: 4, name: cairoTitle, exact: true })).toBeVisible();
    for (const title of TANTA_SEEDED_TITLES) {
      await expect(main.getByText(title)).toHaveCount(0);
    }
    // Searching for them does not find them either
    const search = main.getByPlaceholder('بحث برقم الطلب، الموظف، المورد، أو العنوان...');
    await search.fill('إنترنت');
    await expect(main.getByRole('heading', { level: 4 })).toHaveCount(0);
    await search.fill(cairoTitle);
    await expect(main.getByRole('heading', { level: 4, name: cairoTitle, exact: true })).toBeVisible();

    await Promise.all([emp2.context.close(), admin2.context.close()]);
  });
});
