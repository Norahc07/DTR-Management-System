// Loads raw data for a set of employees/date range, runs the calculation
// engine, and upserts daily_attendance. Half-month periods with a finalized
// DTR are skipped (the database also blocks changes to them).
import { fetchAll, requireClient, unwrap } from '@/lib/supabase';
import { addDays, dateRange } from '@/lib/time';
import { withPhilippineHolidays } from '@/features/schedules/phHolidays';
import { computeEmployeeRange, coverageFromBatches } from './engine/computeRange';

const EMP_CHUNK = 40;
const UPSERT_CHUNK = 500;

export async function loadReferenceData(from, to) {
  const sb = requireClient();
  const [schedules, holidays, policies, batches] = await Promise.all([
    fetchAll(() => sb.from('work_schedules').select('id, name, schedule_type, schedule_days(*)').order('id')),
    fetchAll(() => sb.from('holidays').select('holiday_date, name, holiday_type').gte('holiday_date', from).lte('holiday_date', to).order('holiday_date')),
    fetchAll(() => sb.from('attendance_policies').select('id, status, effective_from, rules').order('effective_from')),
    fetchAll(() => sb.from('import_batches').select('status, period_start, period_end').eq('status', 'completed').lte('period_start', to).gte('period_end', from).order('created_at')),
  ]);
  const schedulesById = new Map(schedules.map((s) => [s.id, { ...s, days: s.schedule_days || [] }]));
  return { schedulesById, holidays: withPhilippineHolidays(holidays, from, to), policies, isCovered: coverageFromBatches(batches) };
}

/**
 * @param {object} args
 * @param {string[]} [args.employeeIds] defaults to all active employees
 * @param {string} args.from yyyy-MM-dd
 * @param {string} args.to yyyy-MM-dd
 */
export async function recomputeAttendance({ employeeIds, from, to, onProgress = () => {} }) {
  const sb = requireClient();
  if (to < from) throw new Error('End date must be on or after start date.');
  if (dateRange(from, to).length > 62) throw new Error('Recompute at most 62 days at a time.');
  const { data: userData } = await sb.auth.getUser();
  const userId = userData?.user?.id ?? null;

  let employees;
  if (employeeIds?.length) {
    employees = [];
    for (let i = 0; i < employeeIds.length; i += 200) {
      employees.push(...unwrap(await sb.from('employees').select('id, rest_days').in('id', employeeIds.slice(i, i + 200))));
    }
  } else {
    employees = await fetchAll(() => sb.from('employees').select('id, rest_days').eq('is_active', true).order('id'));
  }
  const restDaysById = new Map(employees.map((e) => [e.id, e.rest_days ?? null]));

  const ref = await loadReferenceData(from, to);
  const dates = dateRange(from, to);
  const monthStarts = [...new Set(dates.map((d) => `${d.slice(0, 7)}-01`))];
  const finalized = await fetchAll(() =>
    sb.from('dtr_finalizations').select('employee_id, period_month, period_half').eq('status', 'finalized').in('period_month', monthStarts).order('id'),
  );
  // period_half 0 (older rows) locks the whole month.
  const locked = new Set(
    finalized.flatMap((f) => (f.period_half === 0 ? [1, 2] : [f.period_half]).map((h) => `${f.employee_id}|${f.period_month.slice(0, 7)}|${h}`)),
  );
  const halfKey = (id, d) => `${id}|${d.slice(0, 7)}|${Number(d.slice(8, 10)) <= 15 ? 1 : 2}`;
  const voids = await fetchAll(() => sb.from('attendance_event_voids').select('event_id').order('event_id'));
  const voidedIds = new Set(voids.map((v) => v.event_id));

  let saved = 0;
  let skippedLocked = 0;
  const statusCounts = {};
  for (let i = 0; i < employees.length; i += EMP_CHUNK) {
    const ids = employees.slice(i, i + EMP_CHUNK).map((e) => e.id);
    onProgress({ message: `Computing employees ${i + 1}-${Math.min(i + EMP_CHUNK, employees.length)} of ${employees.length}…`, done: i, total: employees.length });
    const [events, assignments, leaves] = await Promise.all([
      fetchAll(() =>
        sb.from('attendance_events').select('id, employee_id, local_date, local_time, source, display_slot').in('employee_id', ids).gte('local_date', addDays(from, -1)).lte('local_date', addDays(to, 1)).order('id'),
      ),
      fetchAll(() => sb.from('employee_schedules').select('employee_id, schedule_id, effective_from, effective_to').in('employee_id', ids).order('id')),
      fetchAll(() => sb.from('leave_records').select('employee_id, start_date, end_date, leave_type, is_cancelled').in('employee_id', ids).lte('start_date', to).gte('end_date', from).order('id')),
    ]);
    const rows = [];
    for (const id of ids) {
      const empDates = dates.filter((d) => {
        const isLocked = locked.has(halfKey(id, d));
        if (isLocked) skippedLocked++;
        return !isLocked;
      });
      if (!empDates.length) continue;
      const computed = computeEmployeeRange({
        employee: { id, rest_days: restDaysById.get(id) },
        dates: empDates,
        events: events.filter((e) => e.employee_id === id),
        voidedIds,
        assignments: assignments.filter((a) => a.employee_id === id),
        schedulesById: ref.schedulesById,
        holidays: ref.holidays,
        leaves: leaves.filter((l) => l.employee_id === id),
        policies: ref.policies,
        isCovered: ref.isCovered,
      });
      for (const r of computed) {
        statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
        rows.push({ ...r, computed_by: userId, computed_at: new Date().toISOString() });
      }
    }
    for (let j = 0; j < rows.length; j += UPSERT_CHUNK) {
      try {
        unwrap(await sb.from('daily_attendance').upsert(rows.slice(j, j + UPSERT_CHUNK), { onConflict: 'employee_id,work_date' }));
      } catch (e) {
        throw new Error(`Saved ${saved} day summaries before an error: ${e.message}. Summaries are derived data; run the recompute again after fixing the cause.`, { cause: e });
      }
      saved += Math.min(UPSERT_CHUNK, rows.length - j);
    }
  }
  return { employees: employees.length, saved, skippedLocked, statusCounts };
}
