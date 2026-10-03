import { expect, test } from '@playwright/test';
import { account, fillLogin, originOf } from './helpers';

const WRONG_CREDENTIALS = 'البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى التحقق وإعادة المحاولة.';
const RESET_NEUTRAL = 'إذا كان البريد مسجلاً لدينا، فسيصله رابط إعادة التعيين.';

/** (7) Login messages never tell which e-mails have an account. */
test.describe('login', () => {
  test('wrong password shows the generic credentials message', async ({ page }) => {
    await page.goto(`${originOf('employee')}/`);
    await fillLogin(page, account('employee').email, 'not-the-password-1');
    await expect(page.getByText(WRONG_CREDENTIALS)).toBeVisible();
    // Still on the login screen
    await expect(page.getByRole('button', { name: 'تسجيل الدخول الآمن' })).toBeVisible();
    await expect(page.getByRole('complementary')).toHaveCount(0);
  });

  test('unknown e-mail gets the same message as a wrong password', async ({ page }) => {
    await page.goto(`${originOf('employee')}/`);
    await fillLogin(page, `nobody.${Date.now()}@e2e.test`, 'whatever-123');
    await expect(page.getByText(WRONG_CREDENTIALS)).toBeVisible();
  });

  test('forgot password: unknown and known e-mails get the same neutral answer', async ({ page }) => {
    await page.goto(`${originOf('employee')}/`);
    for (const email of [`nobody.${Date.now()}@e2e.test`, account('employee').email]) {
      await page.getByRole('button', { name: 'نسيت كلمة المرور؟' }).click();
      const reset = page.getByRole('dialog', { name: 'استعادة كلمة المرور' });
      await expect(reset).toBeVisible();
      await reset.getByPlaceholder('name@company.com').fill(email);
      await reset.getByRole('button', { name: 'إرسال الرابط' }).click();
      await expect(reset.getByText(RESET_NEUTRAL)).toBeVisible();
      await expect(reset.getByText(/تعذر|غير صحيح|غير مسجل|لا يوجد حساب/)).toHaveCount(0);
      await reset.getByRole('button', { name: 'العودة لتسجيل الدخول' }).click();
      await expect(reset).toHaveCount(0);
    }
  });
});
