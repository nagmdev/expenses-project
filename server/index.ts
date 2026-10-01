import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './app.js';
import { initDB, openDatabase } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../database.sqlite');

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_STANDALONE_SERVER !== 'true') {
  console.error('[SECURITY CRITICAL] Standalone Express/SQLite API is strictly prohibited in production. Cloud Firestore is the sole production source of truth.');
  process.exit(1);
}

const db = await openDatabase(dbPath);
console.log('Connected to SQLite database at:', dbPath);
await initDB(db);
console.log('Database tables verified and initialized successfully.');

createApp(db).listen(PORT, () => {
  console.log(`[TEST/DEV ONLY] Backend API Server running on http://localhost:${PORT}`);
});
