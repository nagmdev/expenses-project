import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './app.js';
import { initDB, openDatabase } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../database.sqlite');

const db = await openDatabase(dbPath);
console.log('Connected to SQLite database at:', dbPath);
await initDB(db);
console.log('Database tables verified and initialized successfully.');

createApp(db).listen(PORT, () => {
  console.log(`Backend API Server running on http://localhost:${PORT}`);
});
