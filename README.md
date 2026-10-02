# مصروفي — Expense System

- **Architecture & Source of Truth:** Cloud Firestore is the single and sole production source of truth for all business data, permissions, and tenant isolation.
- **Standalone Express API (`server/`):** Kept exclusively as a local offline reference and development testing tool. It is strictly guarded against execution in production environments (`NODE_ENV === 'production'`).
- **Data integrity, idempotency & deployment steps:** see [docs/05-data-integrity-and-idempotency.md](docs/05-data-integrity-and-idempotency.md) — only `firestore.rules` is deployed (`firebase deploy --only firestore:rules`).
- **Attachments live in Firestore** (the project is on the free Spark plan; Cloud Storage needs Blaze): chunked under `attachments/{id}`, isolated per company by `firestore.rules`. Firebase Storage is optional (`VITE_USE_FIREBASE_STORAGE=true`, Blaze only); `storage.rules` is kept for a future Blaze upgrade and is not deployed. See [docs/06-security-rules-deploy.md](docs/06-security-rules-deploy.md).
- **Security fixes & Rules hardening:**
  - **Attachments:** Strict multi-tenant isolation in `firestore.rules` (`isOrgMember(orgId)`); uploads are append-only until complete.
  - **Custody & Settlements:** Field whitelisting, mathematical balance invariants, and settlement amount guards at both domain and rules layers.
  - **Sequence & Uniqueness:** Sequence counters protected from unauthorized incrementing; uniqueKeys deletion strictly tied to entity removal.
  - **UI/UX:** Zero browser `alert()` popups; native animated Toast notification system; full button `type` attribute compliance.
- **Tests:** `npm test`.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
