/**
 * The owner's backup export (src/lib/backupExport.ts) against the published rules: the exact
 * queries it sends (unfiltered, ordered by document id, paged) must be allowed for the platform
 * owner on every collection it lists, and refused for everyone else. Read-only: the export
 * never writes, so nothing here is written outside the seed.
 */
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, setDoc, type Firestore } from 'firebase/firestore';
import { BACKUP_COLLECTIONS, exportBackup, type BackupStep } from '../src/lib/backupExport';
import { backupJsonParts, isBackupFile } from '../src/utils/backupFormat';

const ORG = 'org-acme';
let env: RulesTestEnvironment;

const OWNER = { uid: 'uidOwner000000000000000001', email: 'mahmoud@tieapps.com' };
const ADMIN = { uid: 'uidAdmin000000000000000001', email: 'admin@acme.test' };
const FIN = { uid: 'uidFinance00000000000000001', email: 'fin@acme.test' };

const db = (u: { uid: string; email: string }, verified = true): Firestore =>
  env.authenticatedContext(u.uid, { email: u.email, email_verified: verified }).firestore() as unknown as Firestore;
const seed = (fn: (f: Firestore) => Promise<unknown>) => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore() as unknown as Firestore));

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');
  env = await initializeTestEnvironment({ projectId: 'demo-expenses-rules', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } });
});
afterAll(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await seed(async f => {
    await setDoc(doc(f, 'organizations', ORG), { id: ORG, name: 'Acme', code: 'ACME', currency: 'EGP', notificationRecipients: [], createdAt: new Timestamp(1_700_000_000, 123_456_000) });
    await setDoc(doc(f, 'organizations', 'org-other'), { id: 'org-other', name: 'Other', code: 'OTH', currency: 'EGP', notificationRecipients: [] });
    await setDoc(doc(f, 'organizations', 'org-third'), { id: 'org-third', name: 'Third', code: 'TRD', currency: 'EGP', notificationRecipients: [] });
    await setDoc(doc(f, 'super_admins', 'second@tieapps.test'), { email: 'second@tieapps.test' });
    await setDoc(doc(f, 'users', ADMIN.uid), { orgId: ORG, role: 'org_admin', active: true });
    await setDoc(doc(f, 'members', `${ADMIN.uid}_${ORG}`), { orgId: ORG, userId: ADMIN.uid, userEmail: ADMIN.email, role: 'org_admin', active: true });
    await setDoc(doc(f, 'users', FIN.uid), { orgId: ORG, role: 'finance', active: true });
    await setDoc(doc(f, 'members', `${FIN.uid}_${ORG}`), { orgId: ORG, userId: FIN.uid, userEmail: FIN.email, role: 'finance', active: true });
    await setDoc(doc(f, 'system_settings', 'email_notifications'), { enabled: true, deliveryMethod: 'direct_api', directApiKey: 'xkeysib-live-secret', senderName: 'نظام مصروفي' });
    await setDoc(doc(f, 'system_settings', 'notification_recipients'), { emails: ['mahmoud@tieapps.com'] });
    await setDoc(doc(f, 'services', 'srv-1'), { orgId: ORG, name: 'Cloud', code: 'CLD', spentAmount: 0 });
    await setDoc(doc(f, 'providers', 'prov-1'), { orgId: ORG, name: 'Vendor' });
    await setDoc(doc(f, 'departments', 'dep-1'), { orgId: ORG, name: 'Ops' });
    await setDoc(doc(f, 'requests', 'req-1'), { orgId: ORG, status: 'pending', requesterId: FIN.uid, requesterEmail: FIN.email, amount: 10 });
    await setDoc(doc(f, 'visaRequests', 'visa-1'), { orgId: ORG, status: 'pending', requesterId: FIN.uid });
    await setDoc(doc(f, 'paymentAccounts', 'acc-1'), { orgId: ORG, name: 'Cash', balance: 0 });
    await setDoc(doc(f, 'accountTransactions', 'tx-1'), { orgId: ORG, accountId: 'acc-1', amount: 1 });
    await setDoc(doc(f, 'custodies', 'cus-1'), { orgId: ORG, employeeId: FIN.uid, status: 'active' });
    await setDoc(doc(f, 'pettyCashCustodies', 'pc-1'), { orgId: ORG, employeeId: FIN.uid });
    await setDoc(doc(f, 'custodySettlements', 'set-1'), { orgId: ORG, employeeId: FIN.uid, custodyId: 'cus-1', amount: 1 });
    await setDoc(doc(f, 'outbox', 'ev-1'), { orgId: ORG, status: 'sent', meta: { webhookUrl: 'https://hooks.example.test/abc' } });
    await setDoc(doc(f, 'email_logs', 'log-1'), { subject: 's' });
    await setDoc(doc(f, 'auditLogs', 'audit-1'), { orgId: ORG, actorId: ADMIN.uid });
    await setDoc(doc(f, 'attachments', 'att-1'), { id: 'att-1', orgId: ORG, name: 'a.pdf', mimeType: 'application/pdf', size: 3, chunkCount: 2, complete: true });
    await setDoc(doc(f, 'attachments', 'att-1', 'chunks', '0'), { index: 0, data: 'QU' });
    await setDoc(doc(f, 'attachments', 'att-1', 'chunks', '1'), { index: 1, data: 'JD' });
    await setDoc(doc(f, 'attachmentTombstones', 'att-0'), { orgId: ORG, deletedBy: ADMIN.uid, deletedAt: '2026-10-01' });
    await setDoc(doc(f, 'counters', 'requests-2026'), { value: 42 });
    await setDoc(doc(f, 'counters', 'custodies-2025'), { value: 7 });
    await setDoc(doc(f, 'uniqueKeys', `service_code__${ORG}__Q0xE`), { entityId: 'srv-1' });
    await setDoc(doc(f, 'legacyRestores', 'requests__req-1'), { orgId: ORG });
  });
});

const NOW = new Date(2026, 9, 3);

describe('backup export as the platform owner', () => {
  it('reads every listable collection (paged), the attachment files and the counters, masking secrets', async () => {
    const steps: BackupStep[] = [];
    const file = await exportBackup(db(OWNER), { includeAttachments: true, includeSecrets: false, now: NOW, pageSize: 2 }, s => steps.push(s));

    expect(file.skipped.filter(s => s.failed)).toEqual([]);
    expect(isBackupFile(JSON.parse(backupJsonParts(file).join('')))).toBe(true);
    for (const c of BACKUP_COLLECTIONS) expect(file.collections[c.name], c.name).toBeDefined();

    // Pages of 2: three companies need two reads, and the third one is not lost.
    expect(file.collections.organizations.map(d => d.id)).toEqual([ORG, 'org-other', 'org-third']);
    expect(file.collections.organizations[0].data.createdAt).toEqual({ __type: 'timestamp', seconds: 1_700_000_000, nanoseconds: 123_456_000 });
    expect(file.collections.members).toHaveLength(2);
    expect(file.collections.super_admins.map(d => d.id)).toEqual(['second@tieapps.test']);
    for (const c of ['requests', 'visaRequests', 'paymentAccounts', 'accountTransactions', 'custodies', 'pettyCashCustodies', 'custodySettlements', 'outbox', 'email_logs', 'auditLogs', 'attachments', 'attachmentTombstones']) {
      expect(file.collections[c], c).toHaveLength(1);
    }

    expect(file.collections.attachmentChunks.map(d => d.path)).toEqual(['attachments/att-1/chunks/0', 'attachments/att-1/chunks/1']);
    expect(file.collections.counters.map(d => [d.id, d.data.value])).toEqual([['custodies-2025', 7], ['requests-2026', 42]]);

    const settings = file.collections.system_settings.find(d => d.id === 'email_notifications')!;
    expect(settings.data.directApiKey).toEqual({ __type: 'redacted' });
    expect(file.collections.outbox[0].data.meta).toEqual({ webhookUrl: { __type: 'redacted' } });
    expect(file.redacted).toEqual([
      { path: 'system_settings/email_notifications', field: 'directApiKey' },
      { path: 'outbox/ev-1', field: 'meta.webhookUrl' },
    ]);
    expect(backupJsonParts(file).join('')).not.toContain('xkeysib-live-secret');

    // Get-only collections are reported, never read.
    expect(file.collections.uniqueKeys).toBeUndefined();
    expect(file.collections.legacyRestores).toBeUndefined();
    expect(file.skipped.map(s => s.name).sort()).toEqual(['legacyRestores', 'mail', 'uniqueKeys']);

    expect(steps.filter(s => s.state === 'done').map(s => s.name)).toEqual([...BACKUP_COLLECTIONS.map(c => c.name), 'attachmentChunks', 'counters']);
    expect(file.exportedAt).toBe(NOW.toISOString());
  });

  it('without the options: no attachment files, secrets kept only when asked for', async () => {
    const plain = await exportBackup(db(OWNER), { includeAttachments: false, includeSecrets: false, now: NOW });
    expect(plain.collections.attachmentChunks).toBeUndefined();
    expect(plain.skipped.map(s => s.name)).toContain('attachmentChunks');

    const withSecrets = await exportBackup(db(OWNER), { includeAttachments: false, includeSecrets: true, now: NOW });
    expect(withSecrets.collections.system_settings.find(d => d.id === 'email_notifications')!.data.directApiKey).toBe('xkeysib-live-secret');
    expect(withSecrets.redacted).toEqual([]);
    expect(withSecrets.options).toEqual({ includeAttachments: false, includeSecrets: true });
  });
});

describe('nobody else can take a backup', () => {
  it('an org admin is refused the platform-wide lists (each listed as failed, nothing leaks)', async () => {
    const file = await exportBackup(db(ADMIN), { includeAttachments: true, includeSecrets: true, now: NOW });
    const failed = file.skipped.filter(s => s.failed).map(s => s.name);
    for (const c of BACKUP_COLLECTIONS) expect(failed, c.name).toContain(c.name);
    for (const c of BACKUP_COLLECTIONS) expect(file.collections[c.name]).toBeUndefined();
  });

  it('the owner with an unverified email is not a super admin either', async () => {
    const file = await exportBackup(db(OWNER, false), { includeAttachments: false, includeSecrets: false, now: NOW });
    expect(file.skipped.filter(s => s.failed).map(s => s.name)).toContain('system_settings');
    expect(file.collections.organizations).toBeUndefined();
  });
});
