import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey && !String(url).includes('your-project-ref'));

// Only the public anon/publishable key is used in the browser. Authorization
// is enforced by RLS and SECURITY DEFINER functions in the database.
export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/** Converts Supabase/PostgREST errors into readable messages without leaking internals. */
export function friendlyError(error) {
  if (!error) return 'Unknown error';
  const msg = error.message || String(error);
  if (error.code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return /row-level security|permission denied/i.test(msg) ? 'You do not have permission to perform this action.' : msg;
  }
  if (error.code === '23505') return /already/i.test(msg) ? msg : 'A record with the same unique value already exists.';
  if (error.code === '23503') return 'This record is referenced by other records and cannot be removed.';
  if (error.code === '23514') return 'One or more values are not allowed. Please check the form.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Network error: could not reach the server.';
  return msg;
}

/** Throws a friendly Error when a Supabase response has an error. */
export function unwrap({ data, error, count }) {
  if (error) {
    const e = new Error(friendlyError(error));
    e.cause = error;
    throw e;
  }
  return count !== undefined && count !== null ? { data, count } : data;
}

/** Fetches every row of a query in pages (PostgREST caps rows per request). */
export async function fetchAll(buildQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) unwrap({ error });
    out.push(...data);
    if (data.length < pageSize) break;
    if (out.length > 200000) throw new Error('Result too large; narrow the filters.');
  }
  return out;
}

export function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  return supabase;
}
