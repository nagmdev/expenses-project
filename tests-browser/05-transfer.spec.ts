import { expect, test } from '@playwright/test';
import { accountCard, cardBalance, field, fsBalance, openTab, panel, signIn, uniq } from './helpers';
import { TANTA_BANK, TANTA_BANK_NAME, escapeRe } from './requests';

const TANTA_WALLET = 'vault-wallet-org-tegy';
const TANTA_WALLET_NAME = 'محفظة إلكترونية (Tie-Tanta)';
const cents = (n: number) => Math.round(n * 100);

/** (5) A transfer with decimals between two accounts moves both balances by exactly that amount. */
test('transfer between accounts with decimals updates both balances', async ({ browser }) => {
  const amount = 250.35;
  const fin = await signIn(browser, 'finance');
  await openTab(fin.page, 'الخزائن وحسابات الدفع');
  await expect(accountCard(fin.page, TANTA_BANK_NAME)).toBeVisible();
  await expect(accountCard(fin.page, TANTA_WALLET_NAME)).toBeVisible();

  const bankBefore = await cardBalance(fin.page, TANTA_BANK_NAME);
  const walletBefore = await cardBalance(fin.page, TANTA_WALLET_NAME);
  expect(cents(bankBefore)).toBe(cents(await fsBalance(TANTA_BANK)));
  expect(cents(walletBefore)).toBe(cents(await fsBalance(TANTA_WALLET)));

  await accountCard(fin.page, TANTA_BANK_NAME).getByRole('button', { name: 'تحويل', exact: true }).click();
  const transfer = panel(fin.page, 'تحويل بين الحسابات والخزائن (Transfer)', 'تأكيد التحويل');
  const from = field(transfer, 'من حساب / خزينة (المحوَّل منه) *', 'select');
  await expect.poll(async () => from.evaluate(s => (s as HTMLSelectElement).selectedOptions[0]?.textContent || '')).toMatch(new RegExp(`^${escapeRe(TANTA_BANK_NAME)}`));
  const to = field(transfer, 'إلى حساب / خزينة (المحوَّل إليه) *', 'select');
  await to.selectOption({ label: (await to.getByRole('option', { name: new RegExp(`^${escapeRe(TANTA_WALLET_NAME)}`) }).textContent())!.trim() });
  await transfer.getByPlaceholder('0.00').fill('250.35');
  await field(transfer, 'البيان (اختياري)').fill(`تحويل اختبار ${uniq()}`);
  await transfer.getByRole('button', { name: 'تأكيد التحويل' }).click();
  await expect(transfer).toHaveCount(0);

  // Both cards show the new balances (live), and they match what is stored
  await expect.poll(async () => cents(await cardBalance(fin.page, TANTA_BANK_NAME))).toBe(cents(bankBefore - amount));
  await expect.poll(async () => cents(await cardBalance(fin.page, TANTA_WALLET_NAME))).toBe(cents(walletBefore + amount));
  expect(cents(await fsBalance(TANTA_BANK))).toBe(cents(bankBefore - amount));
  expect(cents(await fsBalance(TANTA_WALLET))).toBe(cents(walletBefore + amount));

  await fin.context.close();
});
