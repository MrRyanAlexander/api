/**
 * EMBook Database Migration Runner
 * Runs all SQL migration files in order against DATABASE_URL.
 * Safe to re-run — all migrations use IF NOT EXISTS / ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   node scripts/migrate.js
 *   DATABASE_URL=postgres://... node scripts/migrate.js
 */

require('dotenv').config();

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
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
  const isProduction = process.env.NODE_ENV === 'production';

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
  });

  console.log('EMBook Migration Runner');
  console.log('=======================');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Migrations to run: ${MIGRATIONS.length}`);
  console.log('');

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
