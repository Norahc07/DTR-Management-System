// Computes daily summaries for one employee over a date range from raw data.
import { DEFAULT_POLICY_RULES, policyForDate, resolvePolicyRules } from './policy';
import { applyRestDays, scheduleForDate } from './schedule';
import { assignPunchesToDates } from './assignPunches';
import { computeDay } from './computeDay';

/**
 * @param {object} input
 * @param {object} input.employee employees row
 * @param {string[]} input.dates ascending work dates
 * @param {Array} input.events attendance_events rows (local_date, local_time, id, source) incl. the day after the range
 * @param {Set<string>} input.voidedIds event ids voided by approved corrections
 * @param {Array} input.assignments employee_schedules rows for this employee
 * @param {Map} input.schedulesById work_schedules with .days
 * @param {Array} input.holidays holidays rows
 * @param {Array} input.leaves leave_records rows for this employee
 * @param {Array} input.policies attendance_policies rows
 * @param {(date:string)=>boolean} input.isCovered whether imported data covers a date
 */
export function computeEmployeeRange({ employee, dates, events, voidedIds = new Set(), assignments, schedulesById, holidays, leaves, policies, isCovered }) {
  const holidayByDate = new Map();
  for (const h of holidays) if (!holidayByDate.has(h.holiday_date)) holidayByDate.set(h.holiday_date, h);
  const leaveFor = (d) => leaves.find((l) => !l.is_cancelled && l.start_date <= d && l.end_date >= d) || null;

  const schedCache = new Map();
  const sched = (d) => {
    if (!schedCache.has(d)) schedCache.set(d, applyRestDays(scheduleForDate(assignments, schedulesById, d), employee.rest_days, d));
    return schedCache.get(d);
  };
  const rulesFor = (d) => {
    const policy = policyForDate(policies, d);
    return { policy, rules: resolvePolicyRules(policy?.rules ?? DEFAULT_POLICY_RULES) };
  };

  const overnightRules = rulesFor(dates[dates.length - 1] ?? '1900-01-01').rules.overnight;
  const marked = events.map((e) => ({ ...e, voided: voidedIds.has(e.id) }));
  const byDate = assignPunchesToDates(marked, dates, (d) => sched(d).day, overnightRules);

  return dates.map((date) => {
    const { schedule, day } = sched(date);
    const { policy, rules } = rulesFor(date);
    const r = computeDay({
      date,
      punches: byDate.get(date) || [],
      schedule: day,
      rules,
      holiday: holidayByDate.get(date) || null,
      leave: leaveFor(date),
      covered: isCovered(date),
      policyApproved: Boolean(policy),
    });
    return {
      employee_id: employee.id,
      work_date: date,
      status: r.status,
      flags: r.flags,
      punches: r.punches,
      worked_minutes: r.workedMinutes,
      late_minutes: r.lateMinutes,
      undertime_minutes: r.undertimeMinutes,
      overtime_minutes: r.overtimeMinutes,
      break_deducted_minutes: r.breakDeductedMinutes,
      schedule_id: schedule?.id ?? null,
      schedule_snapshot: day ? { name: schedule?.name ?? null, ...day } : null,
      policy_id: policy?.id ?? null,
      breakdown: r.breakdown,
    };
  });
}

/** Coverage predicate from completed import batches. */
export function coverageFromBatches(batches) {
  const ranges = batches.filter((b) => b.status === 'completed').map((b) => [b.period_start, b.period_end]);
  return (date) => ranges.some(([s, e]) => date >= s && date <= e);
}
