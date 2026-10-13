import { requireClient, unwrap } from '@/lib/supabase';

export const DATE_FORMATS = ['yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'MMM d, yyyy'];

export async function loadSettings() {
  return unwrap(await requireClient().from('organization_settings').select('*').eq('id', 1).single());
}

/** Super admin only (RLS). */
export async function saveSettings(values) {
  return unwrap(await requireClient().from('organization_settings').update(values).eq('id', 1).select().single());
}

export function validateSettings(f) {
  const errors = {};
  if (!f.org_name.trim()) errors.org_name = 'Organization name is required';
  if (f.logo_url && !/^https:\/\/\S+$/i.test(f.logo_url)) errors.logo_url = 'Logo URL must start with https://';
  const mb = Number(f.max_import_file_mb);
  if (!Number.isInteger(mb) || mb < 1 || mb > 50) errors.max_import_file_mb = 'Enter a whole number from 1 to 50';
  const split = Number(f.template.splitMinute);
  if (!Number.isInteger(split) || split < 0 || split >= 1440) errors.splitMinute = 'Enter minutes after midnight (0–1439)';
  return errors;
}
