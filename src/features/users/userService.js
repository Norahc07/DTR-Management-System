import { requireClient, unwrap } from '@/lib/supabase';

export async function listProfiles() {
  return unwrap(
    await requireClient()
      .from('profiles')
      .select('id, email, full_name, role, status, employee_id, created_at, employees(full_name, biometric_id), supervisor_departments(department_id)')
      .order('email'),
  );
}

/** Super admin only; enforced by RLS and the profiles_guard trigger. */
export async function updateProfile(id, { full_name, role, status, employee_id }) {
  return unwrap(
    await requireClient()
      .from('profiles')
      .update({ full_name: full_name || null, role, status, employee_id: employee_id || null })
      .eq('id', id)
      .select()
      .single(),
  );
}

export async function setSupervisorDepartments(profileId, departmentIds, current) {
  const sb = requireClient();
  const add = departmentIds.filter((d) => !current.includes(d));
  const remove = current.filter((d) => !departmentIds.includes(d));
  if (add.length) unwrap(await sb.from('supervisor_departments').insert(add.map((department_id) => ({ profile_id: profileId, department_id }))));
  if (remove.length) unwrap(await sb.from('supervisor_departments').delete().eq('profile_id', profileId).in('department_id', remove));
}

export async function inviteUser({ email, full_name, role, employee_id }) {
  const { data, error } = await requireClient().functions.invoke('admin-users', {
    body: { action: 'invite', email, full_name, role, employee_id: employee_id || null },
  });
  if (error) {
    let message = 'The invitation service is unavailable. Check that the admin-users Edge Function is deployed and configured.';
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // keep generic message
    }
    throw new Error(message);
  }
  return data;
}

export async function updateOwnName(id, full_name) {
  return unwrap(await requireClient().from('profiles').update({ full_name: full_name || null }).eq('id', id).select().single());
}
