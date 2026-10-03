/**
 * The owner's backup file (src/utils/backupFormat.ts): Firestore values serialized without
 * losing their type, secrets masked by default, and the file assembled in pieces that parse
 * back to the same object. The export against real rules is in tests-rules/backup.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { initializeApp } from 'firebase/app';
import { Bytes, GeoPoint, Timestamp, doc, getFirestore, vector } from 'firebase/firestore';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  backupJsonParts,
  isBackupFile,
  isSecretFieldName,
  serializeDocData,
  serializeValue,
  summarizeBackup,
  type BackupFile,
} from '../src/utils/backupFormat';
import { BACKUP_COLLECTIONS, NOT_EXPORTABLE, backupSteps, counterIds } from '../src/lib/backupExport';

// A Firestore instance only to build a DocumentReference: nothing connects.
const db = getFirestore(initializeApp({ projectId: 'demo-backup-unit', apiKey: 'demo' }, 'backup-unit'));

describe('serializeValue: Firestore types', () => {
  it('keeps plain JSON values as they are', () => {
    expect(serializeValue(null)).toBe(null);
    expect(serializeValue(true)).toBe(true);
    expect(serializeValue(0)).toBe(0);
    expect(serializeValue(-12.5)).toBe(-12.5);
    expect(serializeValue('نص عربي')).toBe('نص عربي');
    expect(serializeValue('')).toBe('');
  });

  it('Timestamp → seconds + nanoseconds (no precision lost)', () => {
    const t = new Timestamp(1_760_000_000, 123_456_789);
    expect(serializeValue(t)).toEqual({ __type: 'timestamp', seconds: 1_760_000_000, nanoseconds: 123_456_789 });
  });

  it('a JS Date is a timestamp too (what Firestore stores it as)', () => {
    expect(serializeValue(new Date(Date.UTC(2026, 9, 3, 10, 0, 0, 250)))).toEqual({
      __type: 'timestamp',
      seconds: Date.UTC(2026, 9, 3, 10, 0, 0) / 1000,
      nanoseconds: 250_000_000,
    });
  });

  it('DocumentReference → its path', () => {
    expect(serializeValue(doc(db, 'organizations', 'org-acme'))).toEqual({ __type: 'reference', path: 'organizations/org-acme' });
    expect(serializeValue(doc(db, 'attachments/att-1/chunks/0'))).toEqual({ __type: 'reference', path: 'attachments/att-1/chunks/0' });
  });

  it('Bytes (and a raw Uint8Array) → base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(serializeValue(Bytes.fromUint8Array(bytes))).toEqual({ __type: 'bytes', base64: 'AAEC+v8=' });
    expect(serializeValue(bytes)).toEqual({ __type: 'bytes', base64: 'AAEC+v8=' });
    expect(serializeValue(Bytes.fromUint8Array(new Uint8Array()))).toEqual({ __type: 'bytes', base64: '' });
  });

  it('GeoPoint and vectors', () => {
    expect(serializeValue(new GeoPoint(30.0444, 31.2357))).toEqual({ __type: 'geopoint', latitude: 30.0444, longitude: 31.2357 });
    expect(serializeValue(vector([0.5, -1, 2]))).toEqual({ __type: 'vector', values: [0.5, -1, 2] });
  });

  it('numbers JSON cannot hold are tagged', () => {
    expect(serializeValue(NaN)).toEqual({ __type: 'number', value: 'NaN' });
    expect(serializeValue(Infinity)).toEqual({ __type: 'number', value: 'Infinity' });
    expect(serializeValue(-Infinity)).toEqual({ __type: 'number', value: '-Infinity' });
  });

  it('nested maps and arrays, typed values at any depth', () => {
    const t = new Timestamp(10, 20);
    expect(
      serializeValue({
        amount: 1500,
        disbursement: { at: t, refs: [doc(db, 'paymentAccounts', 'acc-1'), null, 'x'], nested: { deeper: [[t]] } },
        tags: [],
        empty: {},
      }),
    ).toEqual({
      amount: 1500,
      disbursement: {
        at: { __type: 'timestamp', seconds: 10, nanoseconds: 20 },
        refs: [{ __type: 'reference', path: 'paymentAccounts/acc-1' }, null, 'x'],
        nested: { deeper: [[{ __type: 'timestamp', seconds: 10, nanoseconds: 20 }]] },
      },
      tags: [],
      empty: {},
    });
  });

  it('a stored map with its own "__type" key is wrapped, never mistaken for a typed value', () => {
    expect(serializeValue({ __type: 'timestamp', seconds: 1 })).toEqual({ __type: 'map', value: { __type: 'timestamp', seconds: 1 } });
    expect(serializeValue({ outer: { __type: 'x' } })).toEqual({ outer: { __type: 'map', value: { __type: 'x' } } });
  });

  it('undefined fields are left out; an undefined array item stays in place as null', () => {
    expect(serializeValue({ a: undefined, b: 1 })).toEqual({ b: 1 });
    expect(serializeValue([1, undefined, 3])).toEqual([1, null, 3]);
  });
});

describe('secrets are masked by default', () => {
  it('recognises credential field names (case, "_" and "-" ignored)', () => {
    for (const name of ['directApiKey', 'apiKey', 'API_KEY', 'clientSecret', 'password', 'smtp_password', 'gmailAppPassword', 'accessToken', 'refresh-token', 'privateKey', 'credentials', 'webhookUrl', 'Authorization']) {
      expect(isSecretFieldName(name), name).toBe(true);
    }
    for (const name of ['emailJsPublicKey', 'senderEmail', 'replyToEmail', 'deliveryMethod', 'directProvider', 'iban', 'amount', 'name', 'id']) {
      expect(isSecretFieldName(name), name).toBe(false);
    }
  });

  it('system_settings/email_notifications from an older version: the API key and webhook URL are masked', () => {
    const { data, redacted } = serializeDocData(
      {
        enabled: true,
        senderEmail: 'awadhsaudi2030@gmail.com',
        deliveryMethod: 'direct_api',
        directProvider: 'brevo',
        directApiKey: 'xkeysib-123456',
        webhookUrl: 'https://hooks.zapier.com/hooks/catch/1/secret/',
        emailJsPublicKey: 'public-key',
        updatedAt: new Timestamp(5, 0),
      },
      { includeSecrets: false },
    );
    expect(data.directApiKey).toEqual({ __type: 'redacted' });
    expect(data.webhookUrl).toEqual({ __type: 'redacted' });
    expect(data.emailJsPublicKey).toBe('public-key');
    expect(data.senderEmail).toBe('awadhsaudi2030@gmail.com');
    expect(data.updatedAt).toEqual({ __type: 'timestamp', seconds: 5, nanoseconds: 0 });
    expect(redacted.sort()).toEqual(['directApiKey', 'webhookUrl']);
    expect(JSON.stringify(data)).not.toContain('xkeysib');
    expect(JSON.stringify(data)).not.toContain('zapier');
  });

  it('an empty key (what the current app stores) is kept as it is: nothing to hide', () => {
    const { data, redacted } = serializeDocData({ directApiKey: '', webhookUrl: '' }, { includeSecrets: false });
    expect(data).toEqual({ directApiKey: '', webhookUrl: '' });
    expect(redacted).toEqual([]);
  });

  it('masks at any depth (outbox meta.webhookUrl, arrays of maps) and reports dotted paths', () => {
    const { data, redacted } = serializeDocData(
      { meta: { senderName: 'نظام مصروفي', webhookUrl: 'https://example.test/hook?token=abc' }, list: [{ password: 'p1' }, { name: 'ok' }] },
      { includeSecrets: false },
    );
    expect(data).toEqual({
      meta: { senderName: 'نظام مصروفي', webhookUrl: { __type: 'redacted' } },
      list: [{ password: { __type: 'redacted' } }, { name: 'ok' }],
    });
    expect(redacted).toEqual(['meta.webhookUrl', 'list.0.password']);
  });

  it('only strings are masked: a secret-named map is searched, a flag or number is kept', () => {
    const { data, redacted } = serializeDocData(
      { credentials: { email: 'a@b.test', password: 'pw' }, apiKeyConfigured: true, tokenCount: 3 },
      { includeSecrets: false },
    );
    expect(data).toEqual({ credentials: { email: 'a@b.test', password: { __type: 'redacted' } }, apiKeyConfigured: true, tokenCount: 3 });
    expect(redacted).toEqual(['credentials.password']);
  });

  it('includeSecrets (the owner opted in) keeps every value', () => {
    const raw = { directApiKey: 'xkeysib-123456', meta: { webhookUrl: 'https://x.test/h' } };
    const { data, redacted } = serializeDocData(raw, { includeSecrets: true });
    expect(data).toEqual(raw);
    expect(redacted).toEqual([]);
  });
});

const sampleFile = (): BackupFile => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: '2026-10-03T08:00:00.000Z',
  projectId: 'expenses-project-ce1f9',
  exportedBy: 'mahmoud@tieapps.com',
  options: { includeAttachments: true, includeSecrets: false },
  collections: {
    organizations: [
      { id: 'org-acme', path: 'organizations/org-acme', data: { name: 'شركة "أكمي"\n', code: 'ACME' } },
      { id: 'org-b', path: 'organizations/org-b', data: { name: 'B', createdAt: { __type: 'timestamp', seconds: 1, nanoseconds: 2 } } },
    ],
    users: [],
    attachmentChunks: [{ id: '0', path: 'attachments/att-1/chunks/0', data: { index: 0, data: 'QUJD' } }],
  },
  skipped: [{ name: 'uniqueKeys', reason: 'collections":{} inside a reason' }, { name: 'requests', reason: 'تعذرت القراءة (permission-denied)', failed: true }],
  redacted: [{ path: 'system_settings/email_notifications', field: 'directApiKey' }],
});

describe('backup file', () => {
  it('the pieces parse back to the same file', () => {
    const file = sampleFile();
    const parts = backupJsonParts(file);
    expect(parts.length).toBeGreaterThan(3);
    expect(JSON.parse(parts.join(''))).toEqual(file);
  });

  it('descriptive fields come before the collections', () => {
    const text = backupJsonParts(sampleFile()).join('');
    expect(text.startsWith(`{"format":"${BACKUP_FORMAT}","version":1,`)).toBe(true);
    expect(text.indexOf('"skipped"')).toBeLessThan(text.indexOf('"collections"'));
  });

  it('works with no collections at all', () => {
    const file = { ...sampleFile(), collections: {}, skipped: [], redacted: [] };
    expect(JSON.parse(backupJsonParts(file).join(''))).toEqual(file);
  });

  it('file name: masrofy-backup-YYYY-MM-DD.json (local date)', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe('masrofy-backup-2026-01-05.json');
    expect(backupFileName(new Date(2026, 11, 31))).toBe('masrofy-backup-2026-12-31.json');
  });

  it('summary: documents per collection', () => {
    expect(summarizeBackup(sampleFile())).toEqual([
      { name: 'organizations', count: 2 },
      { name: 'users', count: 0 },
      { name: 'attachmentChunks', count: 1 },
    ]);
  });

  it('isBackupFile recognises the format and version only', () => {
    expect(isBackupFile(sampleFile())).toBe(true);
    expect(isBackupFile(JSON.parse(backupJsonParts(sampleFile()).join('')))).toBe(true);
    expect(isBackupFile({ ...sampleFile(), version: 2 })).toBe(false);
    expect(isBackupFile({ format: 'masrofy-local-backup' })).toBe(false);
    expect(isBackupFile(null)).toBe(false);
  });
});

describe('what an export reads', () => {
  it('every listable collection of firestore.rules, each once; never the get-only ones', () => {
    const names = BACKUP_COLLECTIONS.map(c => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ['organizations', 'users', 'members', 'super_admins', 'services', 'providers', 'departments', 'requests',
      'visaRequests', 'paymentAccounts', 'accountTransactions', 'custodies', 'pettyCashCustodies', 'custodySettlements',
      'auditLogs', 'email_logs', 'outbox', 'system_settings', 'attachments', 'attachmentTombstones']) {
      expect(names, n).toContain(n);
    }
    for (const s of NOT_EXPORTABLE) expect(names).not.toContain(s.name);
    expect(NOT_EXPORTABLE.map(s => s.name).sort()).toEqual(['legacyRestores', 'mail', 'uniqueKeys']);
  });

  it('counters are read by id: every numbered sequence from 2020 to next year', () => {
    const ids = counterIds(new Date(2026, 5, 1));
    expect(ids).toContain('requests-2020');
    expect(ids).toContain('visa-2026');
    expect(ids).toContain('custodies-2027');
    expect(ids).toContain('transfers-2027');
    expect(ids).not.toContain('requests-2028');
    expect(ids.length).toBe(4 * 8);
  });

  it('attachment files are a step only when asked for', () => {
    expect(backupSteps(false).map(s => s.name)).not.toContain('attachmentChunks');
    expect(backupSteps(true).map(s => s.name)).toContain('attachmentChunks');
    expect(backupSteps(true).every(s => s.state === 'waiting' && s.count === 0)).toBe(true);
    expect(backupSteps(false).at(-1)?.name).toBe('counters');
  });
});
