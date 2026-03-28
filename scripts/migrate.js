/**
 * EMBook Database Migration Runner
 * Runs all SQL migration files in order against DATABASE_URL.
 * Safe to re-run — all migrations use IF NOT EXISTS / ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   node scripts/migrate.js
 *   DATABASE_URL=postgres://... node scripts/migrate.js
 */

// Do NOT load dotenv here — when running via `railway run`, Railway injects
// the correct env vars. Loading dotenv could override them with stale local
// values (which caused the "role user does not exist" error).

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  console.error('');
  console.error('  If running locally:   DATABASE_URL=postgres://... node scripts/migrate.js');
  console.error('  If running on Railway: railway run npm run db:migrate');
  process.exit(1);
}

// Migration files in order — do not reorder
const MIGRATIONS = [
  'schema.sql',
  'migrate-auth.sql',
  'migrate-messages.sql',
  'migrate-task4-registration.sql',
];

async function runMigrations() {
  // Determine SSL: enable for any non-localhost connection (Railway, Supabase, etc.)
  const isRemote = !DATABASE_URL.includes('localhost') && !DATABASE_URL.includes('127.0.0.1');
  const sslConfig = isRemote ? { rejectUnauthorized: false } : false;

  console.log('EMBook Migration Runner');
  console.log('=======================');
  console.log(`Database:   ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);  // mask password
  console.log(`SSL:        ${isRemote ? 'enabled' : 'disabled (localhost)'}`);
  console.log(`Migrations: ${MIGRATIONS.length}`);
  console.log('');

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: sslConfig,
  });

  const client = await pool.connect();

  try {
    for (const filename of MIGRATIONS) {
      const filepath = path.join(__dirname, filename);

      if (!fs.existsSync(filepath)) {
        console.warn(`  SKIP  ${filename} — file not found`);
        continue;
      }

      const sql = fs.readFileSync(filepath, 'utf8');
      console.log(`  RUN   ${filename}`);

      try {
        await client.query(sql);
        console.log(`  OK    ${filename}`);
      } catch (err) {
        console.error(`  FAIL  ${filename}`);
        console.error(`        ${err.message}`);
        throw err;
      }
    }

    console.log('');
    console.log('All migrations completed successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
