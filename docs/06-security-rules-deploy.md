# Deploying the security fixes (firestore.rules + /api/send-email)

## What changed

### Profile privilege escalation

- `users/{uid}` self-writes can no longer grant access. A user may write their own
  profile, but `role` / `orgId` / `active` must stay unchanged, be empty (bare profile),
  or match the membership named in the new `memberId` field exactly: same org and
  role, not suspended, and addressed to the caller's UID or **verified** email.
  `email` may only be set to the caller's own verified address.
- First sign-in linking (`forceRefreshUserState`) now writes `memberId`, and takes
  `role` / `orgId` from that same membership (`pickMembershipToLink`).
- Pending-member ids are unchanged. The rule reads the membership the client names
  and checks its fields, so legacy `pending-<base64>`, `temp_…` and `usr-…` ids work
  as-is and no data migration is needed.
- `users.role` now applies only to `users.orgId`, and `members/{uid}_{orgId}` counts
  only if its `orgId` field equals `orgId`. A role in one company no longer carries
  over to another.
- Membership self-updates can no longer change `userId`, `userEmail` or `active`
  (role/orgId were already locked).
- `super_admins`: only super admins can list it. Anyone can read their own record.
- Email-based super-admin checks (hard-coded list, `super_admins/{email}`) now require
  `email_verified`. The `*@tieapps-verify.com` wildcard grant was removed entirely
  (anyone could register an unverified account on that domain and become super admin).
- **Single platform owner.** The only built-in super admin is `mahmoud@tieapps.com`
  (`builtInSuperAdmins()` in the rules = `DEFAULT_SUPER_ADMINS` in the app; the
  `VITE_SUPER_ADMIN_EMAILS` env override was removed because the rules cannot see it).
  Any other super admin must be a `super_admins/{uid}` or `super_admins/{email}`
  record created by a super admin. The app shows a verification screen (send
  verification link / re-check) when the owner's email is not verified yet, and a red
  banner whenever the database refuses a read, instead of empty lists.

### Email relay

- `/api/send-email` used to send any `to` / `subject` / `html` to anyone, with no
  authentication. It now requires the user's Firebase ID token and an outbox
  `eventId`. It reads that event from Firestore **as the caller** (the rules decide),
  only sends to one of the event's recipients, and only while the event is claimed
  (`status: 'sending'`). Subject, body and sender come from the event. The request
  body's content is ignored.
- `outbox` creates must come from a member of the event's org (no more `orgId: ''`).
  The id must be deterministic (`<eventType>__<requestId>[__<opKey>]`), and the event
  must be bound to a request of that org. Each event type is limited to who may raise
  it and whom it may address:
  - `new_request` and `clarification_replied`: org admins and super admins.
  - `request_approved`, `request_rejected`, `clarification_requested` and
    `request_paid`: only the requester, and only when raised by finance or admins.
  - Test emails (org admins only): the org's recipients or the admin themself.
- Outbox updates may only change delivery state, never leave `sent`/`dead`, and each
  claim adds exactly one attempt, so every event is sent a bounded number of times.
- `mail` (Trigger-Email) docs may only mirror one recipient of a claimed
  `firestore_mail` outbox event: same content and sender, deterministic id, and no
  `cc`/`bcc`/attachments.
- Where admin-facing notifications may go: `organizations/{orgId}.notificationRecipients`
  (active org admins, kept up to date by every membership change),
  `system_settings/notification_recipients.emails` (super admins, kept up to date by
  promote/demote), and the built-in super admins. Missing lists are filled once by
  the app when a super admin, or that org's admin, opens it.

### Uniqueness keys

- `uniqueKeys` ids are now `<scope>__<orgId>__<value base64url>` (`uniqueKeyDocId`): the
  company id is in clear, so the rules let only that company's members (and super admins)
  read a key, whether it exists or not. Before, a missing key was readable by anyone and an
  existing one was not, so anyone could probe which emails, provider names and account
  numbers another company has. A key can only be created under its own company's id.
- Keys in the old id format (company base64-encoded) are readable by super admins only.
  The owner moves them once (step 4 below). Until then, a duplicate of a value held by a
  record created before this version is not caught by the in-transaction check.

### Revocation and suspension

- Removing a member now also detaches the profiles that carried that membership:
  `orgId` is cleared and `role` reset. A removed user used to keep full access
  through `users/{uid}`.
- Role and status changes now reach profiles self-linked by `memberId`. The old
  email lookup worked only for super admins and trusted `users.email`. Profiles
  whose primary org is a different company are never rewritten.
- `active: false` is enforced by the rules, on both the profile and the membership.
  The app shows a "suspended account" screen instead of empty pages.
- Org admins may detach a profile from their org, but still never move one to
  another org.

### Attachments live in Firestore (Spark plan, no Cloud Storage)

- The Firebase project is on the free **Spark** plan. Cloud Storage requires the paid
  **Blaze** plan. The previous version made every upload depend on Storage (with no
  fallback), so uploading invoices, visa documents and custody receipts failed on the
  live site.
- Every attachment is now stored **inside Firestore**, in chunks
  (`src/lib/attachments.ts`, `src/lib/attachmentsCore.ts`):
  - `attachments/{id}`: `{ id, orgId, name, mimeType, size, chunkCount, createdBy, createdAt, complete }`.
  - `attachments/{id}/chunks/{index}`: `{ index, data }`, where `data` is a base64 slice of
    at most 700,000 characters. Each document stays far below Firestore's 1 MiB limit.
  - Records (requests, visas, custodies) keep `fsattach://<id>` as the attachment url.
  - Upload order: metadata (`complete: false`), then the chunks in batches of about
    2.1 MB (well under the 10 MiB request limit), then `complete: true`. Readers refuse an
    incomplete attachment with an Arabic message, so a broken upload is never shown as a
    truncated file. A failed upload removes what it wrote.
  - Allowed: PNG, JPG/JPEG and PDF, at most **10 MB** per file after image compression
    (20 chunks).
- Rules (`match /attachments` in `firestore.rules`):
  - **get:** members of the attachment's company, and super admins. A missing id is
    refused exactly like another company's attachment, so nothing leaks.
  - **list:** super admins only.
  - **create:** a member of `orgId`, in their own name (`createdBy`), starting with
    `complete: false`, with an allowed type and size.
  - **chunks:** created only by the uploader, only while incomplete, only ids
    `0 … chunkCount-1`. They are never rewritten, and their reads follow the parent's.
  - **update:** the uploader sets `complete: true`, once, after the last chunk exists.
    Nothing else can ever change.
  - **delete:** the uploader (while still a member of that company), the company's
    admins, and super admins. Chunks are deleted first, in the same batch as the metadata,
    and the same batch writes the tombstone `attachmentTombstones/{id}`
    `{ orgId, deletedBy, deletedAt }`.
  - **Ids are single-use.** No attachment is ever created under an id that has a
    tombstone; tombstones never change and are never removed (super admins read them).
    The metadata cannot be deleted without its tombstone, a tombstone cannot be written
    without deleting the metadata, and a complete attachment never loses single chunks
    (only together with its metadata). So the file behind a saved `fsattach://<id>`
    link (an approved or paid request, a visa, a custody receipt) can be removed, but
    never swapped for other content by deleting and re-creating the same id; after a
    delete the link is refused like any missing attachment.
- **Older records keep working.** `data:` URLs stored inside documents, and https
  Firebase Storage URLs, still display, open and download. No migration is needed.
- **Free quota.** Spark includes 1 GiB of Firestore storage, 50,000 reads and 20,000
  writes per day. A file takes about 1.4 × its size. Uploading it costs `chunkCount + 2`
  writes; opening it costs `chunkCount + 1` reads, and it stays cached for the session.
  - A 300 KB compressed photo: 1 chunk, 3 writes, 2 reads.
  - A 10 MB PDF: 20 chunks, 22 writes, 21 reads.
  - Optional, to save space: exempt the `data` field from indexing (Firebase Console →
    Firestore → Indexes → Single field → Add exemption: collection `chunks`, field `data`).
- **Cloud Storage is optional and off by default.** It is initialized only when
  `VITE_USE_FIREBASE_STORAGE=true` (Blaze only). It is then used only to delete files
  that older versions uploaded to Storage. Nothing else needs it.
  - `firebase.json` no longer deploys `storage.rules` (a plain `firebase deploy` would
    fail on Spark). The file stays in the repo for a future Blaze upgrade: then add
    `"storage": { "rules": "storage.rules" }` back to `firebase.json` and deploy it with
    `--only storage`.

## Before deploying

1. **Super admins who sign in with email/password.** An unverified account that is a
   super admin only by email loses that role. For each such account, create
   `super_admins/{uid}` (UID-keyed records need no verified email). Or the person can
   sign in with Google, or verify their email.
2. **Audit existing profiles.** Rules only check writes, so any escalated profile
   created before this fix still works. For every `users` doc with an `orgId`,
   confirm there is a matching active membership: `members/{uid}_{orgId}`, or a
   member in that org whose `userEmail` equals the profile's email, with the same
   `role`. Remove `role`/`orgId` from any profile without one, including members
   removed in the past. Also review `auditLogs` and `requests` changes made by those
   UIDs.
3. **Rotate the password of the former super-admin test account** (`awadhsaudi2030@gmail.com`).
   Its password was committed in `scripts/*.cjs`. The scripts now read
   `E2E_SUPER_ADMIN_EMAIL` / `E2E_SUPER_ADMIN_PASSWORD` from the environment.
4. **Remove leftover super-admin records.** In Firestore → `super_admins`, delete every
   document that is not the owner (by email id or by UID). Records there still grant
   super admin. The app corrects `system_settings/notification_recipients` to the
   current super admins the next time the owner opens it.

## Checks before a release (CI)

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:
`npm run lint`, `npm run build` (type-check + build), `npm test`, and, in a separate job,
`npm run test:rules` (the `tests-rules/` suites against the Firestore emulator, Java 21).
A green run does not publish anything: Vercel deploys the frontend from `main`, and
`firestore.rules` is published by hand (step 3 below).

## Deploy (order matters)

1. **Deploy the frontend and `api/send-email.ts` (Vercel) first.** They work under
   both the old and the new rules. Optionally set `FIREBASE_PROJECT_ID` on Vercel;
   it defaults to `expenses-project-ce1f9`.
2. **Sign in once as a super admin** and open the app. That fills the missing
   notification recipient lists (every org, plus the platform list). An org admin
   opening the app fills their own org's list.
   Until the lists exist, the new rules reject request notifications to that org's
   admins. That would make creating a request fail.
3. **Publish `firestore.rules`** from this repo: Firebase Console → Firestore → Rules
   → paste → Publish. With the CLI (the repo's `firebase.json` deploys Firestore rules
   only), run
   `npx firebase-tools deploy --only firestore:rules --project expenses-project-ce1f9`.
   **Only Firestore rules are deployed.** Do not deploy `storage.rules`: Storage is not
   available on the Spark plan.
   Between steps 1 and 3, org admins cannot remove members: the old rules refuse to
   detach the profile. Super admins can.
   Never publish these rules before the new frontend is live: they refuse the old-format
   `uniqueKeys` ids that the previous frontend reads, so creating any record with a unique
   value (member, provider, department, service, account) would fail.
4. **Move the old uniqueness keys** (once, as the owner): Settings → الاتصال السحابي وقاعدة
   البيانات → «ترحيل المفاتيح». Running it again is safe (nothing is left to move).
5. The in-app "Firebase config" modal no longer embeds rules to copy. Its old
   snippets (including an `allow read, write: if true` one) must never be published.

### Deploying the attachments change (Firestore instead of Storage)

The `attachments` section only adds a new collection, so it works with the live
frontend as well. Publish the rules **first**, then deploy the frontend:

1. **Publish `firestore.rules`** (step 3 above). The live frontend is unaffected.
2. **Deploy the frontend** (Vercel, from `main`). From then on, uploads go to Firestore.
   If the frontend goes live before the rules, every upload is refused (permission
   denied) until the rules are published.
3. **Check:** upload an invoice to a new request and open it. In Firestore → Data, an
   `attachments/{id}` document with `complete: true` and its `chunks` appear.
4. Leave `VITE_USE_FIREBASE_STORAGE` unset on Vercel. Set it to `true` only after a
   Blaze upgrade (and after deploying `storage.rules` then).

## Security headers (`vercel.json`)

Vercel sends these on every route (`"source": "/(.*)"`), next to the existing
`Cache-Control` and `Cross-Origin-Opener-Policy: same-origin-allow-popups` (the latter is
what lets the Google sign-in popup report back; do not tighten it to `same-origin`).

| Header | Value | Why |
| :--- | :--- | :--- |
| `X-Content-Type-Options` | `nosniff` | Scripts and styles are only run with their declared type. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Other sites (Firebase, Google Fonts, a webhook) see the origin only, never a path. |
| `X-Frame-Options` | `SAMEORIGIN` | Nothing frames the app (no embed, no iframe of the app anywhere in `src/`), so other sites cannot frame it (clickjacking). `SAMEORIGIN` rather than `DENY` keeps the app's own same-origin frames possible. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=(), xr-spatial-tracking=(), browsing-topics=()` | Features the code never uses (no `getUserMedia`, geolocation, Payment Request, WebUSB/Serial/HID/MIDI, sensors, screen capture). Not listed: `clipboard-write`, because the app uses it (copy payment details, `src/utils/requestUi.ts`); other features stay at the browser default. File inputs have no `capture` attribute; picking a photo from the phone's file chooser is not affected by `camera=()`. |
| `Content-Security-Policy-Report-Only` | see below | **Report-only**: the browser only logs violations in the console, it never blocks anything, so it cannot break sign-in. |

### The CSP allowlist (report-only)

Derived from what the built app loads and connects to (`dist/`, `src/lib/firebase.ts`,
`src/lib/attachments.ts`, `src/components/InvoiceViewerModal.tsx`, `index.html`):

- `default-src 'self'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`;
  `manifest-src 'self'`; `worker-src 'self' blob:`; `frame-ancestors 'self'` (same as
  `X-Frame-Options`).
- `script-src 'self' https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/`:
  the Vite build has no inline script and no `eval`. `apis.google.com` is the loader Firebase
  Auth uses for `signInWithPopup`. The reCAPTCHA paths are only used if reCAPTCHA protection
  is turned on for email/password sign-in in the Firebase console.
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`: React `style={...}`
  attributes and Recharts set inline styles; the IBM Plex Sans Arabic stylesheet comes from
  Google Fonts.
- `font-src 'self' https://fonts.gstatic.com`.
- `img-src 'self' data: blob: https://firebasestorage.googleapis.com https://storage.googleapis.com`:
  `blob:` for attachment previews (`fsattach://` files become object URLs), `data:` for the
  payment QR code, image compression and older records that stored `data:` URLs, and the
  Storage hosts for https links of records uploaded by older versions.
- `connect-src 'self' blob: https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebasestorage.googleapis.com https://storage.googleapis.com https://www.google.com/recaptcha/`:
  `'self'` is `/api/send-email`; Firestore; Firebase Auth (sign-in, token refresh); legacy
  Storage downloads; `blob:` because `useAttachmentPreview` reads a loaded file's type from its
  object URL. Email providers (Resend, Brevo, Gmail SMTP) are called by `/api/send-email` on
  the server, never by the browser.
- `frame-src blob: data: https://expenses-project-ce1f9.firebaseapp.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/`:
  PDF previews (`blob:`, and inline `data:` PDFs of older records) and the Firebase Auth
  helper frame on the project's `authDomain`.

**Not covered on purpose (expect reports, not breakage):**

- **Webhook notifications.** When the owner sets the delivery method to Webhook, the outbox
  worker POSTs from the browser (`src/services/emailService.ts`) to the URL the owner typed
  in Settings. It cannot be known in advance, so it is not in `connect-src`; each delivery is
  reported. Before enforcing the policy, add that URL's origin to `connect-src`.
- **A different Firebase project.** If `VITE_FIREBASE_AUTH_DOMAIN` on Vercel, or a custom
  connection saved in the in-app Firebase settings, points to another project, replace
  `https://expenses-project-ce1f9.firebaseapp.com` in `frame-src` with that `authDomain`.
- **Vercel preview toolbar.** Preview deployments (not production) inject the Vercel toolbar
  from `https://vercel.live`; its scripts and frames are reported there.
- There is no `report-uri` / `report-to` endpoint, so violations appear only in the
  browser's DevTools console.

**Enforcing it later:** open the production site with DevTools, sign in with email and with
Google, open requests with image and PDF attachments, upload a file, and let an email /
webhook notification go out. When the console shows no `[Report Only]` CSP messages, rename
the header key to `Content-Security-Policy` (same value) and test sign-in again on a preview
deployment before merging to `main`.
