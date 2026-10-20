import fs from 'node:fs/promises';
import { Pool } from 'pg';
import { ensureProjectSchema, importProject, validateProjectImport } from '../src/projects.js';

const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith('--'));
if (!file || !process.env.DATABASE_URL) throw new Error('Usar DATABASE_URL y un archivo JSON de importación.');
const payload = validateProjectImport(JSON.parse(await fs.readFile(file, 'utf8')));
const pool = new Pool({ connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
const db = await pool.connect();
try {
  await db.query('BEGIN');
  await db.query("SELECT pg_advisory_xact_lock(8192026)");
  await ensureProjectSchema(db);
  const result = await importProject(db, payload);
  await db.query(args.includes('--apply') ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({ ...result, applied: args.includes('--apply') }));
} catch (error) {
  await db.query('ROLLBACK');
  console.error('No se aplicó la importación:', error.message);
  process.exitCode = 1;
} finally {
  db.release();
  await pool.end();
}
