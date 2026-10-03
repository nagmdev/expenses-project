# مصروفي — Expense System

Multi-company expenses, treasury, custody and visa management. Arabic RTL UI, React 19 +
Vite 8 + TypeScript, Firebase Auth + Cloud Firestore on the free Spark plan, deployed on
Vercel from `main`.

- **Architecture & Source of Truth:** Cloud Firestore is the single source of truth for all
  business data, permissions and tenant isolation. The flow is React UI → `AppContext`
  (`src/context/AppContext.tsx`) → domain layer (`src/domain/*`: one Firestore transaction per
  operation, operation keys for idempotency, `uniqueKeys` for uniqueness, `counters` for
  numbering) → Firestore. See [docs/01-system-overview.md](docs/01-system-overview.md) and
  [docs/02-architecture-and-data-model.md](docs/02-architecture-and-data-model.md).
- **`firestore.rules` is the only server-side guard** (Spark plan: no Cloud Functions). Every
  financial change is bound, in the same commit, to what explains it: its ledger line
  (`lastLedgerId`), custody settlement (`lastSettlementId`) or paid request
  (`lastDisbursedRequestId`). Covered by `tests-rules/binding.test.ts` and
  `tests-rules/attacks.test.ts`.
- **`localStorage` is not a database:** it only keeps UI preferences (active company / page,
  notification read state), an optional custom Firebase connection, and the old version's data,
  which only the legacy-data recovery screen reads (except the old email settings, copied once
  into Firestore in a super-admin session). Firestore's own IndexedDB cache is the offline cache.
- **Data integrity, idempotency & deployment steps:** see
  [docs/05-data-integrity-and-idempotency.md](docs/05-data-integrity-and-idempotency.md) — only
  `firestore.rules` is deployed (`firebase deploy --only firestore:rules`), by hand.
- **Attachments live in Firestore** (the project is on the free Spark plan; Cloud Storage needs
  Blaze): chunked under `attachments/{id}/chunks`, referenced as `fsattach://<id>`, isolated per
  company by `firestore.rules`. Firebase Storage is optional (`VITE_USE_FIREBASE_STORAGE=true`,
  Blaze only); `storage.rules` is kept for a future Blaze upgrade and is not deployed. See
  [docs/06-security-rules-deploy.md](docs/06-security-rules-deploy.md).
- **Notifications:** business operations write an `outbox` event in the same transaction; a
  worker in admin / finance sessions delivers it through `/api/send-email` (Vercel function,
  authenticated with the user's Firebase ID token), the Trigger-Email `mail` collection, or a
  webhook.
- **Security headers:** `vercel.json` sends `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, `Permissions-Policy` and a report-only Content Security Policy on every
  route (see docs/06, "Security headers").
- **Standalone Express API (`server/`):** kept only as a local offline reference and testing
  tool; the app does not use it. It refuses to start when `NODE_ENV === 'production'` unless
  `ALLOW_PROD_STANDALONE_SERVER=true` is set explicitly.
- **Security fixes & Rules hardening:**
  - **Attachments:** strict multi-tenant isolation in `firestore.rules` (`isOrgMember(orgId)`);
    uploads are append-only until complete; ids are single-use (tombstones).
  - **Custody & Settlements:** field whitelisting, balance invariants, and settlement amount
    guards at both domain and rules layers.
  - **Sequence & Uniqueness:** counters only move forward by one; `uniqueKeys` are readable only
    by their company and released only when the record no longer holds the value.
  - **UI/UX:** zero browser `alert()` popups; native animated toast notifications; full button
    `type` attribute compliance.

## Development

Requirements: Node.js 24; Java 21+ only for the rules tests / local emulators.

```bash
npm ci
npm run dev          # Vite dev server
npm run lint         # oxlint
npm run build        # tsc -b + vite build
npm test             # unit tests (tests/)
npm run test:rules   # Firestore rules tests on the emulator (tests-rules/)
```

Local end-to-end environment (emulators only, never production): `npm run e2e:emulators`,
then `npm run e2e:seed` and `npm run dev:e2e`. See
[docs/04-developer-onboarding.md](docs/04-developer-onboarding.md).

**CI:** `.github/workflows/ci.yml` runs lint, build, unit tests and the rules tests on every
push to `main` and every pull request.
