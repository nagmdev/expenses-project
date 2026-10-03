import { defineConfig, devices } from '@playwright/test';

/**
 * Real-browser end-to-end tests (tests-browser/) against the LOCAL e2e environment:
 * Firebase Auth + Firestore emulators (demo project "demo-expenses-e2e", never production),
 * seeded by tests-e2e/seed.seed.ts, and the app served by `npm run dev:e2e`.
 * Each role signs in on its own http://<role>.localhost:5173 origin (tests-e2e/accounts.ts).
 *
 *   npm run test:e2e   → starts the emulators, seeds them, runs every test (see package.json)
 *
 * With the emulators already up (`npm run e2e:emulators` + `npm run e2e:seed`):
 *   npx playwright test            (reuses a running `npm run dev:e2e`, or starts it)
 */
export default defineConfig({
  testDir: 'tests-browser',
  // Refuses to run against anything but the e2e build + running, seeded emulators.
  globalSetup: './tests-browser/global-setup.ts',
  // One worker: the tests share one seeded emulator (money moves, balances are compared).
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    // The sidebar is a slide-in drawer below the lg breakpoint (1024px).
    viewport: { width: 1440, height: 900 },
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
