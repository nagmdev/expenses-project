/**
 * Runs once before the browser tests, after Playwright has started (or found) the dev server.
 * It refuses to run unless:
 *  - the app on :5173 is the e2e build (`npm run dev:e2e`, VITE_USE_FIREBASE_EMULATORS=true).
 *    Locally `reuseExistingServer` reuses whatever answers on 5173: a plain `npm run dev` left
 *    running there talks to PRODUCTION Firebase, and the tests would sign in, write and send
 *    password-reset e-mails against it;
 *  - the Auth and Firestore emulators are up, and the seed has run (`npm run e2e:seed`).
 */
import { APP_PORT, fsGet } from './helpers';

export default async function globalSetup() {
  const app = `http://localhost:${APP_PORT}`;
  // Vite serves every source module with its import.meta.env inlined at the top.
  const res = await fetch(`${app}/src/lib/firebase.ts`).catch(() => null);
  const code = res?.ok ? await res.text() : '';
  if (!/"VITE_USE_FIREBASE_EMULATORS":\s*"true"/.test(code)) {
    throw new Error(
      `The app on ${app} is not the e2e build (Firebase emulators). Stop whatever runs on port ${APP_PORT} ` +
        '(e.g. `npm run dev`, which uses PRODUCTION Firebase) and run `npm run test:e2e`, or start `npm run dev:e2e`.',
    );
  }

  const auth = await fetch('http://127.0.0.1:9099/').catch(() => null);
  if (!auth?.ok) throw new Error('The Auth emulator is not running on 127.0.0.1:9099: run `npm run e2e:emulators` (or `npm run test:e2e`).');

  const seeded = await fsGet('paymentAccounts', 'vault-bank-org-tegy').catch((e: unknown) => {
    throw new Error(`The Firestore emulator is not reachable on 127.0.0.1:8085: run \`npm run e2e:emulators\` (or \`npm run test:e2e\`). ${String(e)}`);
  });
  if (!seeded) throw new Error('The emulators are not seeded: run `npm run e2e:seed` first.');
}
