import { requireClient, unwrap } from '@/lib/supabase';

export const AUDIT_PAGE_SIZE = 25;
export const AUDIT_PAGE_SIZES = [25, 50, 100];

const clean = (s) => s.replace(/[%_\\,()"*:]/g, '');

export async function listAuditLogs({ from, to, table, action, actor, page, pageSize = AUDIT_PAGE_SIZE }) {
  let q = requireClient()
    .from('audit_logs')
    .select('id, occurred_at, actor_email, action, table_name, record_id, reason, old_values, new_values', { count: 'exact' })
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false });
  if (from) q = q.gte('occurred_at', `${from}T00:00:00Z`);
  if (to) q = q.lte('occurred_at', `${to}T23:59:59.999Z`);
  if (table) q = q.eq('table_name', table);
  if (action) q = q.ilike('action', `%${clean(action)}%`);
  if (actor) q = q.ilike('actor_email', `%${clean(actor)}%`);
  q = q.range((page - 1) * pageSize, page * pageSize - 1);
  return unwrap(await q);
}

/** Lists keys whose values differ between two row snapshots (ignores updated_at). */
export function changedKeys(oldValues, newValues) {
  const keys = new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})]);
  return [...keys].filter((k) => k !== 'updated_at' && JSON.stringify(oldValues?.[k]) !== JSON.stringify(newValues?.[k])).sort();
}
