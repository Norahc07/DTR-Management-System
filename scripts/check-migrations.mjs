// Applies all migrations (and the dev seed) to an in-memory PostgreSQL to catch SQL errors.
import { createTestDb } from '../tests/db/harness.js';

const db = await createTestDb({ seed: true });
const { rows } = await db.query(`select count(*)::int as n from pg_tables where schemaname = 'public'`);
const { rows: noRls } = await db.query(
  `select tablename from pg_tables where schemaname = 'public' and not rowsecurity`,
);
console.log(`Migrations applied. Public tables: ${rows[0].n}`);
if (noRls.length) {
  console.error('Tables without RLS:', noRls.map((r) => r.tablename).join(', '));
  process.exit(1);
}
console.log('RLS enabled on every public table.');
await db.close();
