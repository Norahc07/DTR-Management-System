import { requireClient, unwrap } from '@/lib/supabase';

export async function listSchedules({ includeInactive = true } = {}) {
  let q = requireClient()
    .from('work_schedules')
    .select('id, name, schedule_type, description, is_active, schedule_days(*)')
    .order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  const rows = unwrap(await q);
  return rows.map((s) => ({ ...s, days: [...(s.schedule_days || [])].sort((a, b) => a.weekday - b.weekday) }));
}

export async function scheduleUsage(scheduleId) {
  const { count } = unwrap(
    await requireClient().from('employee_schedules').select('id', { count: 'exact', head: true }).eq('schedule_id', scheduleId),
  );
  return count ?? 0;
}

/** Saves a schedule and its 7 weekday rows. */
export async function saveSchedule({ id, name, schedule_type, description, is_active, days }) {
  const sb = requireClient();
  const header = { name, schedule_type, description: description || null, is_active };
  const saved = id
    ? unwrap(await sb.from('work_schedules').update(header).eq('id', id).select().single())
    : unwrap(await sb.from('work_schedules').insert(header).select().single());
  const rows = days.map((d) => ({ ...d, schedule_id: saved.id }));
  unwrap(await sb.from('schedule_days').upsert(rows, { onConflict: 'schedule_id,weekday' }));
  return saved;
}

/** Deletes a schedule (Super Admin; refused while any employee assignment uses it). */
export async function deleteSchedule(id) {
  const used = await scheduleUsage(id);
  if (used) throw new Error(`This schedule is assigned to ${used} employee schedule period(s). Remove or change those assignments first, or mark the schedule inactive.`);
  const rows = unwrap(await requireClient().from('work_schedules').delete().eq('id', id).select('id'));
  if (!rows?.length) throw new Error('The schedule was not deleted: only a Super Admin can delete schedules.');
}

/** Assigns office hours (work days and HH:MM times) to the staff for start..end only; returns the schedule id. */
export async function applyPeriodSchedule({ employeeIds, start, end, workdays, amIn, amOut, pmIn, pmOut }) {
  return unwrap(
    await requireClient().rpc('apply_period_schedule', {
      p_employee_ids: employeeIds,
      p_start: start,
      p_end: end,
      p_workdays: workdays,
      p_am_in: amIn,
      p_am_out: amOut,
      p_pm_in: pmIn,
      p_pm_out: pmOut,
    }),
  );
}

export async function listPolicies() {
  return unwrap(
    await requireClient().from('attendance_policies').select('*').order('effective_from', { ascending: false }),
  );
}

export async function createPolicy({ name, effective_from, rules, notes }) {
  return unwrap(
    await requireClient().from('attendance_policies').insert({ name, effective_from, rules, notes: notes || null, status: 'draft' }).select().single(),
  );
}

export async function updateDraftPolicy(id, values) {
  return unwrap(await requireClient().from('attendance_policies').update(values).eq('id', id).eq('status', 'draft').select().single());
}

export async function setPolicyStatus(id, status) {
  return unwrap(await requireClient().from('attendance_policies').update({ status }).eq('id', id).select().single());
}

export async function deleteDraftPolicy(id) {
  return unwrap(await requireClient().from('attendance_policies').delete().eq('id', id).eq('status', 'draft'));
}

export async function listHolidays(year) {
  let q = requireClient().from('holidays').select('*').order('holiday_date');
  if (year) q = q.gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`);
  return unwrap(await q);
}

export async function saveHoliday({ id, ...values }) {
  const sb = requireClient();
  return id
    ? unwrap(await sb.from('holidays').update(values).eq('id', id).select().single())
    : unwrap(await sb.from('holidays').insert(values).select().single());
}

export async function deleteHoliday(id) {
  return unwrap(await requireClient().from('holidays').delete().eq('id', id));
}

export async function listStaffBirthdays() {
  return unwrap(
    await requireClient()
      .from('employees')
      .select('id, full_name, nickname, biometric_id, birth_date')
      .eq('is_active', true)
      .order('last_name')
      .order('first_name'),
  );
}

/** Sets or clears (null) an employee's birth date. */
export async function setBirthday(employeeId, birthDate) {
  const rows = unwrap(await requireClient().from('employees').update({ birth_date: birthDate || null }).eq('id', employeeId).select('id'));
  if (!rows?.length) throw new Error('The birthday was not saved: only HR/Admin can change staff records.');
}

export async function listLeaves({ from, to, employeeId } = {}) {
  let q = requireClient()
    .from('leave_records')
    .select('*, employees(full_name, biometric_id)')
    .order('start_date', { ascending: false })
    .limit(500);
  if (from) q = q.gte('end_date', from);
  if (to) q = q.lte('start_date', to);
  if (employeeId) q = q.eq('employee_id', employeeId);
  return unwrap(await q);
}

export async function createLeave(values) {
  return unwrap(await requireClient().from('leave_records').insert(values).select().single());
}

export async function cancelLeave(id) {
  return unwrap(await requireClient().from('leave_records').update({ is_cancelled: true }).eq('id', id));
}
