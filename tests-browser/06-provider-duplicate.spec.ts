import { expect, test } from '@playwright/test';
import { fsWhere, openTab, panel, signIn } from './helpers';

/** A unique suffix in Arabic-Indic digits (٠-٩), so every run adds a new, all-Arabic name. */
const arabicTag = () => [...String(Date.now()).slice(-6)].map(d => String.fromCharCode(0x0660 + Number(d))).join('');

/**
 * (6) Data entry adds a provider to its company; the same Arabic name typed again with
 * tatweel (ـ) and extra spaces is the same provider and is refused (same normalisation as
 * the unique-name key: whitespace and tatweel ignored).
 */
test('data entry adds a provider; an Arabic duplicate with tatweel / spaces is refused', async ({ browser }) => {
  const tag = arabicTag();
  const name = `مؤسسة النور للتوريدات ${tag}`;
  const duplicate = `مؤسسـة   النـــور  للتوريـدات ${tag}`;

  const de = await signIn(browser, 'dataentry');
  await openTab(de.page, 'الموردين ومقدمي الخدمات');
  const main = de.page.getByRole('main');

  // Add
  await main.getByRole('button', { name: 'إضافة مقدم خدمة جديد' }).click();
  let form = panel(de.page, 'إضافة مقدم خدمة جديد', 'حفظ مقدم الخدمة');
  await form.getByRole('checkbox', { name: /^Tie-Tanta/ }).check();
  await form.getByPlaceholder('مثال: شركة سحابة الخليج للتقنية...').fill(name);
  await form.getByRole('button', { name: 'حفظ مقدم الخدمة' }).click();
  await expect(form).toHaveCount(0);
  await expect(main.getByRole('status').filter({ hasText: `تمت إضافة المورد "${name}" بنجاح` })).toBeVisible();
  await expect.poll(async () => (await fsWhere('providers', 'name', name)).length).toBe(1);

  // The duplicate: the company is marked as already having it and saving is refused
  await main.getByRole('button', { name: 'إضافة مقدم خدمة جديد' }).click();
  form = de.page
    .locator('div')
    .filter({ has: de.page.getByRole('heading', { name: 'إضافة مقدم خدمة جديد' }) })
    .filter({ has: de.page.getByRole('button', { name: 'إلغاء' }) })
    .last();
  await form.getByRole('checkbox', { name: /^Tie-Tanta/ }).check();
  await form.getByPlaceholder('مثال: شركة سحابة الخليج للتقنية...').fill(duplicate);
  await expect(form.getByRole('checkbox', { name: /^Tie-Tanta/ })).toBeDisabled();
  await expect(form.getByText('يوجد مورد بنفس الاسم', { exact: true })).toBeVisible();
  await expect(form.getByText('* يوجد مورد بنفس الاسم في الشركات المحددة. غيّر الاسم أو اختر شركة أخرى.')).toBeVisible();
  const save = form.getByRole('button', { name: /^حفظ مقدم الخدمة|^حفظ المورد في/ });
  await expect(save).toBeDisabled();
  // Enter in the name field cannot slip it through either
  await form.getByPlaceholder('مثال: شركة سحابة الخليج للتقنية...').press('Enter');
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: 'إلغاء' }).click();

  expect(await fsWhere('providers', 'name', duplicate)).toHaveLength(0);
  expect(await fsWhere('providers', 'name', name)).toHaveLength(1);

  await de.context.close();
});
