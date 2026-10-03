/**
 * The platform owner's backup file (Settings → الاتصال السحابي → «تصدير نسخة احتياطية»).
 *
 * The Spark (free) plan has no managed Firestore backups, so the owner downloads every
 * collection as one JSON file. This module is the pure part: it turns Firestore values into
 * plain JSON WITHOUT losing their type, so a restore (docs/06-security-rules-deploy.md →
 * Backups) writes back exactly what was read:
 *
 *   Timestamp          → { __type: 'timestamp', seconds, nanoseconds }
 *   DocumentReference  → { __type: 'reference', path }
 *   Bytes              → { __type: 'bytes', base64 }
 *   GeoPoint           → { __type: 'geopoint', latitude, longitude }
 *   VectorValue        → { __type: 'vector', values }
 *   NaN / ±Infinity    → { __type: 'number', value: 'NaN' | 'Infinity' | '-Infinity' }
 *   a map that itself has a "__type" key → { __type: 'map', value: { ...that map } }
 *   a secret (masked)  → { __type: 'redacted' }   (a restore leaves such a field out)
 *
 * Everything else (strings, numbers, booleans, null, arrays, maps) is kept as is. No Firestore
 * access here: src/lib/backupExport.ts reads the documents.
 */
import { Bytes, DocumentReference, GeoPoint, Timestamp, VectorValue } from 'firebase/firestore';

export const BACKUP_FORMAT = 'masrofy-backup';
export const BACKUP_VERSION = 1;

export type BackupValue = null | boolean | number | string | BackupValue[] | { [key: string]: BackupValue };
export type BackupData = Record<string, BackupValue>;

export interface BackupDoc {
  id: string;
  /** Full document path (e.g. attachments/att-1/chunks/0): where a restore writes it. */
  path: string;
  data: BackupData;
}

export interface BackupSkipped {
  name: string;
  reason: string;
  /** Set when the collection could not be read (an error, not a choice): the file is incomplete. */
  failed?: true;
}

export interface BackupRedaction {
  /** Document path. */
  path: string;
  /** Dotted field path inside the document (array items as their index). */
  field: string;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  projectId: string;
  exportedBy?: string;
  options: { includeAttachments: boolean; includeSecrets: boolean };
  collections: Record<string, BackupDoc[]>;
  skipped: BackupSkipped[];
  /** Fields masked as secrets (empty when the owner chose to include them). */
  redacted: BackupRedaction[];
}

export const REDACTED_VALUE: BackupValue = Object.freeze({ __type: 'redacted' }) as BackupValue;

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------
// A backup file ends up in Downloads folders, e-mails and cloud drives. Field names that hold
// credentials (an email provider's API key or Gmail app password: system_settings/
// email_notifications.directApiKey from older app versions; a webhook URL, which usually
// carries its own token: system_settings + outbox meta.webhookUrl) are masked unless the
// owner explicitly ticks «تضمين المفاتيح السرية». Compared without case, "_" or "-".
const SECRET_NAME_PARTS = [
  'apikey',
  'secret',
  'password',
  'passwd',
  'passphrase',
  'token',
  'privatekey',
  'credential',
  'webhookurl',
  'authorization',
  'accesskey',
  'smtppass',
];

export function isSecretFieldName(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return n !== '' && SECRET_NAME_PARTS.some(part => n.includes(part));
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------
function bytesToBase64(bytes: Uint8Array): string {
  const STEP = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += STEP) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + STEP));
  }
  return btoa(binary);
}

interface SerializeContext {
  includeSecrets: boolean;
  /** Field paths masked so far (dotted). */
  redacted: string[];
}

/** `secret`: the value sits under a secret-named field (e.g. `apiKeys: [...]`, `smtpCredentials: {...}`). */
function serializeAt(value: unknown, field: string, ctx: SerializeContext, secret = false): BackupValue | undefined {
  if (value === undefined) return undefined;
  if (secret && !ctx.includeSecrets && ((typeof value === 'string' && value !== '') || value instanceof Bytes || value instanceof Uint8Array)) {
    ctx.redacted.push(field);
    return { __type: 'redacted' };
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    return { __type: 'number', value: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' };
  }
  if (typeof value === 'bigint') return { __type: 'number', value: value.toString() };
  if (typeof value !== 'object') return String(value); // functions / symbols never come from Firestore

  if (value instanceof Timestamp) return { __type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof Date) {
    const t = Timestamp.fromDate(value);
    return { __type: 'timestamp', seconds: t.seconds, nanoseconds: t.nanoseconds };
  }
  if (value instanceof DocumentReference) return { __type: 'reference', path: value.path };
  if (value instanceof Bytes) return { __type: 'bytes', base64: value.toBase64() };
  if (value instanceof Uint8Array) return { __type: 'bytes', base64: bytesToBase64(value) };
  if (value instanceof GeoPoint) return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value instanceof VectorValue) return { __type: 'vector', values: value.toArray() };

  if (Array.isArray(value)) {
    // Firestore arrays never hold undefined; a hole is kept as null so indexes do not shift.
    return value.map((item, i) => serializeAt(item, `${field}.${i}`, ctx, secret) ?? null);
  }

  // A map (any other object: its own enumerable fields, like Firestore stores it).
  // A stored map that itself has a "__type" key is wrapped, so it is never read back as a type.
  const out = serializeMap(value as Record<string, unknown>, field, ctx, secret);
  return '__type' in out ? { __type: 'map', value: out } : out;
}

// Under a secret-named field every non-empty string (and raw bytes) is masked, however deep (an
// array of keys, a credentials map): flags and numbers (apiKeyConfigured, tokenCount) are kept.
function serializeMap(map: Record<string, unknown>, prefix: string, ctx: SerializeContext, secret = false): BackupData {
  const out: BackupData = {};
  for (const key of Object.keys(map)) {
    const field = prefix ? `${prefix}.${key}` : key;
    const v = serializeAt(map[key], field, ctx, secret || isSecretFieldName(key));
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** One Firestore value as backup JSON (no masking: use serializeDocData for documents). */
export function serializeValue(value: unknown): BackupValue {
  return serializeAt(value, '', { includeSecrets: true, redacted: [] }) ?? null;
}

/**
 * A document's data as backup JSON. Non-empty strings under a field whose name marks a secret
 * are masked (at any depth) unless `includeSecrets`; `redacted` lists their dotted field paths.
 */
export function serializeDocData(
  data: Record<string, unknown>,
  opts: { includeSecrets: boolean },
): { data: BackupData; redacted: string[] } {
  const ctx: SerializeContext = { includeSecrets: opts.includeSecrets, redacted: [] };
  return { data: serializeMap(data, '', ctx), redacted: ctx.redacted };
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------
/** masrofy-backup-YYYY-MM-DD.json (the owner's local date). */
export function backupFileName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `masrofy-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.json`;
}

/**
 * The file as text pieces (one per document) for `new Blob(parts)`: a backup with
 * attachments can be hundreds of MB, more than one JavaScript string can safely hold.
 * JSON.parse(parts.join('')) equals the file; the descriptive fields come first and the
 * collections last, one document per line.
 */
export function backupJsonParts(file: BackupFile): string[] {
  const { collections, ...rest } = file;
  const head = JSON.stringify({ ...rest, collections: {} });
  // head ends with `"collections":{}, ...}`: split there to put the collections inside.
  const marker = '"collections":{}';
  const at = head.lastIndexOf(marker);
  const parts: string[] = [head.slice(0, at), '"collections":{'];
  const names = Object.keys(collections);
  names.forEach((name, i) => {
    parts.push(`${i ? ',' : ''}\n${JSON.stringify(name)}:[`);
    collections[name].forEach((d, j) => parts.push(`${j ? ',' : ''}\n${JSON.stringify(d)}`));
    parts.push(']');
  });
  parts.push('}', head.slice(at + marker.length));
  return parts;
}

export interface BackupSummaryRow {
  name: string;
  count: number;
}

export function summarizeBackup(file: BackupFile): BackupSummaryRow[] {
  return Object.keys(file.collections).map(name => ({ name, count: file.collections[name].length }));
}

export function isBackupFile(value: unknown): value is BackupFile {
  const v = value as Partial<BackupFile> | null;
  return Boolean(
    v && typeof v === 'object' && v.format === BACKUP_FORMAT && v.version === BACKUP_VERSION &&
    v.collections && typeof v.collections === 'object' && Array.isArray(v.skipped),
  );
}
