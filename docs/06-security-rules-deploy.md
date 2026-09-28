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
- Email-based super-admin checks (hard-coded list, `super_admins/{email}`,
  `*@tieapps-verify.com`) now require `email_verified`. Anyone could previously
  register an unverified email/password account at `anything@tieapps-verify.com` and
  become super admin.

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
3. **Rotate the password of the super-admin test account** (`awadhsaudi2030@gmail.com`).
   Its password was committed in `scripts/*.cjs`. The scripts now read
   `E2E_SUPER_ADMIN_EMAIL` / `E2E_SUPER_ADMIN_PASSWORD` from the environment.

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
   → paste → Publish. With the CLI, add a `firebase.json` containing
   `{ "firestore": { "rules": "firestore.rules" } }`, then run
   `npx firebase-tools deploy --only firestore:rules --project expenses-project-ce1f9`.
   Between steps 1 and 3, org admins cannot remove members: the old rules refuse to
   detach the profile. Super admins can.
4. The in-app "Firebase config" modal no longer embeds rules to copy. Its old
   snippets (including an `allow read, write: if true` one) must never be published.
