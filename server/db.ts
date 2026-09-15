import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../database.sqlite');

export const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
  }
});

export const dbRun = (sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

export const dbAll = <T = any>(sql: string, params: any[] = []): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
};

export const dbGet = <T = any>(sql: string, params: any[] = []): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T);
    });
  });
};

export const initDB = async () => {
  await dbRun(`
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

  await dbRun(`
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

  await dbRun(`
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

  await dbRun(`
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

  await dbRun(`
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

  console.log('Database tables verified and initialized successfully.');
};
