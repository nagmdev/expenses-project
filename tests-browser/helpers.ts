/**
 * Shared helpers of the browser end-to-end tests (Playwright, tests-browser/).
 * Everything runs against the LOCAL emulators of the demo project "demo-expenses-e2e";
 * the accounts and password are the local test credentials of tests-e2e/accounts.ts.
 *
 * Selectors go through roles, placeholders and the visible Arabic text, never CSS classes.
 * Waits are on UI or Firestore state (expect.poll / auto-waiting locators), never fixed sleeps.
 */
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { E2E_ACCOUNTS, E2E_PASSWORD, E2E_PROJECT, type E2EAccount } from '../tests-e2e/accounts';

export const APP_PORT = 5173;
const FIRESTORE = `http://127.0.0.1:8085/v1/projects/${E2E_PROJECT}/databases/(default)/documents`;

export type RoleKey = 'owner' | 'admin' | 'finance' | 'dataentry' | 'employee' | 'admin2' | 'employee2';

export const account = (key: RoleKey): E2EAccount => {
  const a = E2E_ACCOUNTS.find(x => x.key === key);
  if (!a) throw new Error(`unknown e2e account ${key}`);
  return a;
};

/** The origin a role signs in on (its own *.localhost host, so sessions never mix). */
export const originOf = (key: RoleKey) => `http://${account(key).host}:${APP_PORT}`;

/** A short suffix that makes every record a test creates unique across runs. */
export const uniq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();

/** "12,345.5 EGP" / "-4,200" → 12345.5 / -4200 */
export const parseMoney = (text: string | null | undefined): number => {
  const m = String(text ?? '').replace(/[٬,\s]/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) throw new Error(`no amount in "${text}"`);
  return Number(m[0]);
};

/** Fills the login form of the page's origin (the page is on the login screen). */
export async function fillLogin(page: Page, email: string, password: string) {
  await page.getByPlaceholder('name@company.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'تسجيل الدخول الآمن' }).click();
}

/** Signs a role in on `page` (at the role's own origin) and waits for its sidebar. */
export async function signInOn(page: Page, key: RoleKey) {
  const a = account(key);
  await page.goto(`${originOf(key)}/`);
  await fillLogin(page, a.email, E2E_PASSWORD);
  await expect(sidebar(page).getByRole('button', { name: a.name })).toBeVisible({ timeout: 60_000 });
}

/** A fresh browser context signed in as `key`. Close the context at the end of the test. */
export async function signIn(browser: Browser, key: RoleKey): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInOn(page, key);
  return { context, page };
}

export const sidebar = (page: Page) => page.getByRole('complementary');

/** Opens a page from the sidebar by (the start of) its label. */
export async function openTab(page: Page, label: string | RegExp) {
  await sidebar(page).getByRole('button', { name: label }).click();
}

/** The currently open modal dialog whose title matches. */
export const dialog = (page: Page, title: string | RegExp) => page.getByRole('dialog').filter({ hasText: title });

/**
 * A pop-up window that is not marked up as a dialog (several treasury / custody windows):
 * the innermost block holding both its title and its confirm button.
 */
export const panel = (page: Page, heading: string | RegExp, confirm: string | RegExp) =>
  page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: heading }) })
    .filter({ has: page.getByRole('button', { name: confirm }) })
    .last();

/**
 * The input / select / textarea next to a visible label text inside `scope`. Most forms of the
 * app put the label and its control in one small wrapper without `for`/`id`, so this takes the
 * innermost element that contains both.
 */
export function field(scope: Locator | Page, labelText: string | RegExp, kind = 'input, select, textarea'): Locator {
  const page = 'page' in scope ? scope.page() : scope;
  return scope
    .locator('div')
    .filter({ has: page.getByText(labelText, { exact: typeof labelText === 'string' ? false : undefined }) })
    .filter({ has: page.locator(kind) })
    .last()
    .locator(kind)
    .first();
}

/** A toast (bottom notifications region) containing `text`. */
export const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('region', { name: 'الإشعارات التنبيهية' }).getByText(text);

// ---------------------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------------------

/** The account card of the treasury page, by the account's exact name. */
export const accountCard = (page: Page, name: string) =>
  page
    .getByRole('main')
    .locator('div')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .filter({ has: page.getByRole('button', { name: /^عرض كشف وحركات الحساب/ }) })
    .last();

/** The balance shown on an account card. */
export async function cardBalance(page: Page, name: string): Promise<number> {
  const label = accountCard(page, name).getByText('الرصيد المتاح الحالي (Balance)');
  return parseMoney(await label.locator('xpath=following-sibling::div[1]').innerText());
}

// ---------------------------------------------------------------------------------------
// Firestore emulator (read-only checks of what the UI did; "Bearer owner" bypasses the rules
// of the EMULATOR only). Used to assert "exactly one record" after a double click.
// ---------------------------------------------------------------------------------------

type FsValue = Record<string, unknown>;
const decode = (v: FsValue): unknown => {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return decodeFields(((v.mapValue as { fields?: Record<string, FsValue> }).fields) || {});
  if ('arrayValue' in v) return (((v.arrayValue as { values?: FsValue[] }).values) || []).map(decode);
  return undefined;
};
const decodeFields = (fields: Record<string, FsValue>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v)]));

/** Every document of a collection whose `field` equals `value` (string), read from the emulator. */
export async function fsWhere(collection: string, fieldPath: string, value: string): Promise<Array<Record<string, any>>> {
  const res = await fetch(`${FIRESTORE}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue: value } } },
      },
    }),
  });
  if (!res.ok) throw new Error(`emulator query failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ document?: { name: string; fields?: Record<string, FsValue> } }>;
  return rows
    .filter(r => r.document)
    .map(r => ({ id: r.document!.name.split('/').pop(), ...decodeFields(r.document!.fields || {}) }));
}

/** One document from the emulator (null when missing). */
export async function fsGet(collection: string, id: string): Promise<Record<string, any> | null> {
  const res = await fetch(`${FIRESTORE}/${collection}/${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer owner' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`emulator get failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { fields?: Record<string, FsValue> };
  return { id, ...decodeFields(body.fields || {}) };
}

/** Current balance of a payment account as stored in Firestore. */
export async function fsBalance(accountId: string): Promise<number> {
  const acc = await fsGet('paymentAccounts', accountId);
  if (!acc) throw new Error(`no account ${accountId}`);
  return Number(acc.currentBalance ?? acc.balance ?? 0);
}
