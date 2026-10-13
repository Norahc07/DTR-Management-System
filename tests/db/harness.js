// Runs the real migrations inside PGlite (embedded PostgreSQL) with a minimal
// stand-in for Supabase's auth schema and API roles, so RLS can be exercised.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export function migrationFiles() {
  const dir = join(root, 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(dir, f), 'utf8') }));
}

export async function createTestDb({ seed = false, beforeMigration } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    if (beforeMigration) await beforeMigration(file.name, db);
    try {
      await db.exec(file.sql);
    } catch (error) {
      throw new Error(`Migration ${file.name} failed: ${error.message}`, { cause: error });
    }
  }
  if (seed) {
    await db.exec(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8'));
  }
  return db;
}

/** Creates an auth user (profile is created by trigger) and optionally sets role/employee. */
export async function createUser(db, { id, email, role = 'employee', employeeId = null }) {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  await db.query('update public.profiles set role = $2, employee_id = $3 where id = $1', [id, role, employeeId]);
}

/** Runs fn with the session acting as the given authenticated user (RLS enforced). */
export async function asUser(db, userId, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
  await db.exec(userId ? 'set role authenticated' : 'set role anon');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
