import { fetchAll, requireClient, unwrap } from '@/lib/supabase';
import { usesRemarkUndertime } from '@/features/dtr/form48';
import { normalizeName } from '@/features/import/matching';

const EMP_COLUMNS =
  'id, biometric_id, employee_no, nickname, last_name, first_name, middle_name, suffix, full_name, department_id, position, employment_status, date_hired, dtr_format, verifier_name, verifier_title, is_active, deactivated_at, deactivation_reason, created_at, updated_at, departments(id, code, name)';

const escapeLike = (s) => s.replace(/[%_\\,()]/g, (c) => `\\${c}`);

export async function listEmployees({ search = '', departmentId = '', active = 'active', sort = { key: 'last_name', dir: 'asc' }, page = 1, pageSize = 25 } = {}) {
  const sb = requireClient();
  let q = sb.from('employees').select(EMP_COLUMNS, { count: 'exact' });
  const s = search.replace(/[%_\\,()"*:]/g, ' ').trim().slice(0, 60);
  if (s) {
    q = q.or(`biometric_id.ilike.%${s}%,nickname.ilike.%${s}%,last_name.ilike.%${s}%,first_name.ilike.%${s}%,employee_no.ilike.%${s}%,position.ilike.%${s}%`);
  }
  if (departmentId) q = q.eq('department_id', departmentId);
  if (active === 'active') q = q.eq('is_active', true);
  if (active === 'inactive') q = q.eq('is_active', false);
  q = q.order(sort.key, { ascending: sort.dir === 'asc' }).order('id');
  q = q.range((page - 1) * pageSize, page * pageSize - 1);
  return unwrap(await q);
}

export async function listAllEmployees({ activeOnly = false } = {}) {
  const sb = requireClient();
  return fetchAll(() => {
    let q = sb.from('employees').select(EMP_COLUMNS).order('last_name').order('first_name').order('id');
    if (activeOnly) q = q.eq('is_active', true);
    return q;
  });
}

export async function getEmployee(id) {
  return unwrap(await requireClient().from('employees').select(EMP_COLUMNS).eq('id', id).maybeSingle());
}

export async function createEmployee(values) {
  return unwrap(await requireClient().from('employees').insert(values).select(EMP_COLUMNS).single());
}

export async function updateEmployee(id, values) {
  return unwrap(await requireClient().from('employees').update(values).eq('id', id).select(EMP_COLUMNS).single());
}

export async function setEmployeeActive(id, active, reason) {
  return unwrap(await requireClient().rpc('set_employee_active', { p_employee_id: id, p_active: active, p_reason: reason }));
}

/** Super admin only (RLS); fails with a clear message when attendance history exists. */
export async function deleteEmployee(id) {
  const { error } = await requireClient().from('employees').delete().eq('id', id);
  if (error?.code === '23503') throw new Error('This employee has attendance or other history. Deactivate the record instead of deleting it.');
  return unwrap({ error });
}

/** Employees whose name closely matches (possible duplicate person under another ID). */
export async function findNameDuplicates({ last_name, first_name }, excludeId) {
  let q = requireClient()
    .from('employees')
    .select('id, biometric_id, full_name, is_active')
    .ilike('last_name', escapeLike(last_name.trim()));
  q = first_name?.trim() ? q.ilike('first_name', escapeLike(first_name.trim())) : q.is('first_name', null);
  const rows = unwrap(await q);
  return rows.filter((r) => r.id !== excludeId);
}

export async function listDepartments({ includeInactive = false } = {}) {
  let q = requireClient().from('departments').select('id, code, name, is_active').order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  return unwrap(await q);
}

export async function createDepartment(values) {
  return unwrap(await requireClient().from('departments').insert(values).select().single());
}

export async function updateDepartment(id, values) {
  return unwrap(await requireClient().from('departments').update(values).eq('id', id).select().single());
}

/** Validates rows for bulk employee import; returns { valid, problems }. */
export function validateEmployeeRows(rows, existing, departments, schema) {
  const byBio = new Map(existing.map((e) => [e.biometric_id, e]));
  const deptByKey = new Map();
  for (const d of departments) {
    deptByKey.set(d.code.toLowerCase(), d.id);
    deptByKey.set(d.name.toLowerCase(), d.id);
  }
  const seen = new Map();
  const nameKeys = new Map(existing.map((e) => [`${normalizeName(e.last_name).join(' ')}|${normalizeName(e.first_name).join(' ')}`, e]));
  const out = [];
  rows.forEach((raw, i) => {
    const rowNo = i + 2;
    const problems = [];
    const warnings = [];
    const deptText = String(raw.department ?? '').trim();
    const deptId = deptText ? deptByKey.get(deptText.toLowerCase()) : null;
    if (deptText && !deptId) problems.push(`Unknown department "${deptText}"`);
    const parsed = schema.safeParse({
      biometric_id: String(raw.biometric_id ?? '').trim(),
      employee_no: String(raw.employee_no ?? '').trim(),
      nickname: String(raw.nickname ?? ''),
      last_name: String(raw.last_name ?? ''),
      first_name: String(raw.first_name ?? ''),
      middle_name: String(raw.middle_name ?? ''),
      suffix: String(raw.suffix ?? ''),
      department_id: deptId || '',
      position: String(raw.position ?? ''),
      employment_status: String(raw.employment_status ?? 'regular').trim().toLowerCase() || 'regular',
      date_hired: String(raw.date_hired ?? '').trim(),
      dtr_format: String(raw.dtr_format ?? '').trim().toLowerCase() || undefined,
    });
    if (!parsed.success) problems.push(...parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`));
    const bio = String(raw.biometric_id ?? '').trim();
    if (bio && seen.has(bio)) problems.push(`Duplicate biometric ID in file (also row ${seen.get(bio)})`);
    if (bio) seen.set(bio, rowNo);
    const existingEmp = byBio.get(bio);
    if (existingEmp) problems.push(`Biometric ID already used by ${existingEmp.full_name}`);
    if (parsed.success) {
      parsed.data.dtr_format = usesRemarkUndertime(parsed.data) ? 'no_undertime' : 'standard';
      const key = `${normalizeName(parsed.data.last_name).join(' ')}|${normalizeName(parsed.data.first_name).join(' ')}`;
      const dup = nameKeys.get(key);
      if (dup) warnings.push(`Same name as existing employee ${dup.full_name} (ID ${dup.biometric_id})`);
    }
    out.push({ rowNo, raw, data: parsed.success ? parsed.data : null, problems, warnings });
  });
  return out;
}

export async function insertEmployees(rows) {
  return unwrap(await requireClient().from('employees').insert(rows).select('id'));
}

export async function listEmployeeSchedules(employeeId) {
  return unwrap(
    await requireClient()
      .from('employee_schedules')
      .select('id, schedule_id, effective_from, effective_to, work_schedules(name)')
      .eq('employee_id', employeeId)
      .order('effective_from', { ascending: false }),
  );
}

export async function assignSchedule({ employee_id, schedule_id, effective_from, effective_to }) {
  return unwrap(
    await requireClient().from('employee_schedules').insert({ employee_id, schedule_id, effective_from, effective_to: effective_to || null }).select().single(),
  );
}

export async function endScheduleAssignment(id, effective_to) {
  return unwrap(await requireClient().from('employee_schedules').update({ effective_to }).eq('id', id));
}

export async function deleteScheduleAssignment(id) {
  return unwrap(await requireClient().from('employee_schedules').delete().eq('id', id));
}
