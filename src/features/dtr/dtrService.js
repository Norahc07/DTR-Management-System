import { fetchAll, requireClient, unwrap } from '@/lib/supabase';
import { monthBounds } from '@/lib/time';
import { periodHalf } from './form48';

/** Loads the whole month; the page shows one half. Finalizations cover that half (or, for older rows, the whole month). */
/** Latest date (yyyy-MM-dd) with a punch the user can see, or null when nothing is imported. */
export async function latestAttendanceDate() {
  const row = unwrap(await requireClient().from('attendance_events').select('local_date').order('local_date', { ascending: false }).limit(1).maybeSingle());
  return row?.local_date ?? null;
}

/** Whether any of the employees has a punch (device or manual) between start and end. */
export async function periodHasAttendance(employeeIds, start, end) {
  let q = requireClient().from('attendance_events').select('id').gte('local_date', start).lte('local_date', end).limit(1);
  if (employeeIds.length <= 200) q = q.in('employee_id', employeeIds);
  return unwrap(await q).length > 0;
}

export async function loadDtrData(employeeIds, year, month, period) {
  const sb = requireClient();
  const { start, end } = monthBounds(year, month);
  const [employees, summaries, finalizations, remarks, headers] = await Promise.all([
    fetchAll(() => sb.from('employees').select('id, biometric_id, full_name, position, dtr_format, rest_days, verifier_name, verifier_title, departments(name)').in('id', employeeIds).order('last_name').order('first_name')),
    fetchAll(() => sb.from('daily_attendance').select('*').in('employee_id', employeeIds).gte('work_date', start).lte('work_date', end).order('work_date')),
    fetchAll(() =>
      sb.from('dtr_finalizations').select('id, employee_id, period_half, status, finalized_at, finalized_by, snapshot').in('employee_id', employeeIds).eq('period_month', start).in('period_half', [0, periodHalf(period)]).eq('status', 'finalized').order('id'),
    ),
    fetchAll(() => sb.from('dtr_day_remarks').select('employee_id, work_date, remark').in('employee_id', employeeIds).gte('work_date', start).lte('work_date', end).order('work_date')),
    fetchAll(() => sb.from('dtr_period_headers').select('*').in('employee_id', employeeIds).eq('period_month', start).eq('period_half', periodHalf(period)).order('id')),
  ]);
  return { employees, summaries, finalizations, remarks, headers };
}

/** Saves the edited header text of one DTR (null fields use the computed text); all-null removes the row. */
export async function saveDtrHeader(employeeId, year, month, period, values) {
  const sb = requireClient();
  const { start } = monthBounds(year, month);
  const key = { employee_id: employeeId, period_month: start, period_half: periodHalf(period) };
  if (!Object.values(values).some(Boolean)) {
    unwrap(await sb.from('dtr_period_headers').delete().match(key));
    return;
  }
  unwrap(await sb.from('dtr_period_headers').upsert({ ...key, ...values, updated_at: new Date().toISOString() }, { onConflict: 'employee_id,period_month,period_half' }));
}

/** Sets (or clears, when remark is null) the Undertime-column remark of days. */
export async function saveDayRemarks(employeeId, changes) {
  const sb = requireClient();
  const set = changes.filter((c) => c.remark).map((c) => ({ employee_id: employeeId, work_date: c.date, remark: c.remark, updated_at: new Date().toISOString() }));
  const cleared = changes.filter((c) => !c.remark).map((c) => c.date);
  if (set.length) unwrap(await sb.from('dtr_day_remarks').upsert(set, { onConflict: 'employee_id,work_date' }));
  if (cleared.length) unwrap(await sb.from('dtr_day_remarks').delete().eq('employee_id', employeeId).in('work_date', cleared));
}

/** Sets an employee's own days off (weekday numbers, 0 = Sunday), or null to follow the office schedule. */
export async function saveRestDays(employeeId, restDays) {
  const rows = unwrap(await requireClient().from('employees').update({ rest_days: restDays }).eq('id', employeeId).select('id'));
  if (!rows?.length) throw new Error('Days off were not saved: your account is not allowed to edit this employee.');
}

/** Applies manual DTR edits for one employee: voids first, then new punches. */
export async function saveManualPunches({ voids, adds, reason }) {
  const sb = requireClient();
  for (const id of voids) unwrap(await sb.rpc('manual_void_punch', { p_event_id: id, p_reason: reason }));
  for (const a of adds) unwrap(await sb.rpc('manual_add_punch', { p_employee_id: a.employeeId, p_date: a.date, p_time: a.time, p_reason: reason, p_slot: a.slot ?? null }));
}

export async function finalizeDtr(employeeId, year, month, period, snapshot) {
  const { start } = monthBounds(year, month);
  return unwrap(await requireClient().rpc('finalize_dtr', { p_employee_id: employeeId, p_period_month: start, p_period_half: periodHalf(period), p_snapshot: snapshot }));
}

export async function revokeDtr(id, reason) {
  return unwrap(await requireClient().rpc('revoke_dtr', { p_id: id, p_reason: reason }));
}

export function logPrint(details) {
  return requireClient().rpc('log_client_event', { p_action: 'dtr_printed', p_details: details }).then(() => {}, () => {});
}
