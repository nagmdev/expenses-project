import { createRequire } from 'module';

const req = createRequire(import.meta.url);
let sqlite3: any = null;
try {
  sqlite3 = req('sqlite3');
} catch {
  // Native addon unavailable on current platform/Node ABI
}

export function isSqliteAvailable(): boolean {
  return sqlite3 != null;
}

export interface Queryable {
  run(sql: string, params?: any[]): Promise<{ lastID: number; changes: number }>;
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  get<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
}

export interface Database extends Queryable {
  /**
   * Runs `fn` inside `BEGIN IMMEDIATE … COMMIT` (ROLLBACK on error).
   *
   * node-sqlite3 uses ONE connection: without serialization, statements from a
   * concurrent HTTP request would silently execute inside another request's open
   * transaction. Every transaction therefore holds an in-process mutex.
   */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Serialized read (never interleaves with an open transaction). */
  read<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function openDatabase(filename: string): Promise<Database> {
  if (!sqlite3) {
    return Promise.reject(new Error('SQLite3 native binding is not available in this environment.'));
  }
  return new Promise((resolve, reject) => {
    const raw = new sqlite3.Database(filename, (err: any) => {
      if (err) return reject(err);

      const q: Queryable = {
        run: (sql, params = []) =>
          new Promise((res, rej) => {
            raw.run(sql, params, function (e) {
              if (e) rej(e);
              else res({ lastID: this.lastID, changes: this.changes });
            });
          }),
        all: (sql, params = []) =>
          new Promise((res, rej) => raw.all(sql, params, (e, rows) => (e ? rej(e) : res(rows as any)))),
        get: (sql, params = []) =>
          new Promise((res, rej) => raw.get(sql, params, (e, row) => (e ? rej(e) : res(row as any)))),
      };

      let chain: Promise<unknown> = Promise.resolve();
      const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
        const next = chain.then(fn, fn);
        chain = next.catch(() => undefined);
        return next;
      };

      resolve({
        ...q,
        read: fn => exclusive(() => fn(q)),
        transaction: fn =>
          exclusive(async () => {
            await q.run('BEGIN IMMEDIATE');
            try {
              const result = await fn(q);
              await q.run('COMMIT');
              return result;
            } catch (e) {
              await q.run('ROLLBACK').catch(() => undefined);
              throw e;
            }
          }),
        close: () => new Promise((res, rej) => raw.close(e => (e ? rej(e) : res()))),
      });
    });
  });
}

const UNIQUE_INDEXES: Array<[string, string]> = [
  ['ux_requests_number', 'CREATE UNIQUE INDEX IF NOT EXISTS ux_requests_number ON requests(requestNumber)'],
  ['ux_org_code', 'CREATE UNIQUE INDEX IF NOT EXISTS ux_org_code ON organizations(code COLLATE NOCASE)'],
  ['ux_member_org_email', 'CREATE UNIQUE INDEX IF NOT EXISTS ux_member_org_email ON members(orgId, userEmail COLLATE NOCASE)'],
  ['ux_service_org_code', 'CREATE UNIQUE INDEX IF NOT EXISTS ux_service_org_code ON services(orgId, code COLLATE NOCASE)'],
  ['ux_provider_org_name', 'CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_org_name ON providers(orgId, name COLLATE NOCASE)'],
];

export const initDB = async (db: Database) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      currency TEXT NOT NULL,
      budget REAL NOT NULL,
      description TEXT,
      createdAt TEXT NOT NULL
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      orgId TEXT NOT NULL,
      userId TEXT NOT NULL,
      userName TEXT NOT NULL,
      userEmail TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT,
      jobTitle TEXT,
      joinedAt TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      orgId TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT,
      budgetLimit REAL NOT NULL,
      spentAmount REAL NOT NULL DEFAULT 0,
      color TEXT NOT NULL,
      iconName TEXT NOT NULL
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      orgId TEXT NOT NULL,
      name TEXT NOT NULL,
      serviceCategoryIds TEXT NOT NULL,
      serviceCategoryNames TEXT NOT NULL,
      contactPerson TEXT,
      phone TEXT,
      email TEXT,
      taxNumber TEXT,
      crNumber TEXT,
      bankName TEXT,
      iban TEXT,
      address TEXT,
      rating REAL DEFAULT 5.0,
      totalPaid REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      requestNumber TEXT NOT NULL,
      orgId TEXT NOT NULL,
      requesterId TEXT NOT NULL,
      requesterName TEXT NOT NULL,
      requesterDepartment TEXT,
      serviceCategoryId TEXT NOT NULL,
      serviceCategoryName TEXT NOT NULL,
      providerId TEXT NOT NULL,
      providerName TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      justification TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      urgency TEXT NOT NULL,
      attachments TEXT NOT NULL,
      comments TEXT NOT NULL,
      timeline TEXT NOT NULL,
      disbursement TEXT,
      rejectionReason TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  // Atomic, transactional sequences (replaces SELECT COUNT(*) + 1).
  await db.run(`
    CREATE TABLE IF NOT EXISTS sequences (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    )
  `);

  // Stored responses for Idempotency-Key replays.
  await db.run(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      requestHash TEXT NOT NULL,
      statusCode INTEGER NOT NULL,
      responseBody TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);

  for (const [name, sql] of UNIQUE_INDEXES) {
    try {
      await db.run(sql);
    } catch (err: any) {
      // Existing duplicate rows prevent the index; report instead of refusing to start.
      console.warn(`[DB] Could not create unique index ${name} (existing duplicates must be cleaned first): ${err.message}`);
    }
  }
};
