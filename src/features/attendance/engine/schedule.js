import { timeToMinutes, weekdayOf } from '@/lib/time';

/**
 * Converts a schedule_days row into minute offsets relative to the work date's
 * midnight. Overnight shifts (end <= start) get end + 1440; break times that
 * fall before the start are moved to the next day as well.
 */
export function resolveScheduleDay(dayRow, scheduleType = 'fixed') {
  if (!dayRow) return null;
  if (!dayRow.is_workday) return { isWorkday: false, type: scheduleType };
  const start = timeToMinutes(dayRow.start_time);
  let end = timeToMinutes(dayRow.end_time);
  const overnight = start != null && end != null && end <= start;
  if (overnight) end += 1440;
  const shift = (t) => {
    const m = timeToMinutes(t);
    if (m == null) return null;
    return overnight && m < start ? m + 1440 : m;
  };
  let breakStart = shift(dayRow.break_start);
  let breakEnd = shift(dayRow.break_end);
  if (breakStart != null && breakEnd != null && breakEnd <= breakStart) breakEnd += 1440;
  return {
    isWorkday: true,
    type: scheduleType,
    start,
    end,
    overnight,
    breakStart,
    breakEnd,
    breakMinutes: dayRow.break_minutes ?? 0,
    breakPaid: Boolean(dayRow.break_paid),
    requiredMinutes: dayRow.required_minutes ?? (start != null && end != null ? end - start - (dayRow.break_paid ? 0 : dayRow.break_minutes ?? 0) : null),
    coreStart: timeToMinutes(dayRow.core_start),
    coreEnd: timeToMinutes(dayRow.core_end),
  };
}

/** Finds the schedule assignment covering a date. */
export function assignmentForDate(assignments, date) {
  return (
    assignments.find((a) => a.effective_from <= date && (a.effective_to == null || a.effective_to >= date)) || null
  );
}

/**
 * @param {Array} assignments employee_schedules rows for one employee
 * @param {Map<string, {id, name, schedule_type, days: Array}>} schedulesById
 */
export function scheduleForDate(assignments, schedulesById, date) {
  const a = assignmentForDate(assignments, date);
  if (!a) return { schedule: null, day: null };
  const schedule = schedulesById.get(a.schedule_id);
  if (!schedule) return { schedule: null, day: null };
  const row = schedule.days.find((d) => d.weekday === weekdayOf(date));
  return {
    schedule,
    day: row ? resolveScheduleDay(row, schedule.schedule_type) : { isWorkday: false, type: schedule.schedule_type },
  };
}

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/**
 * Applies an employee's own days off (employees.rest_days) to a scheduleForDate
 * result. Listed weekdays become rest days; an unlisted weekday that the office
 * schedule treats as rest uses the hours of the schedule's first workday.
 * Null / undefined rest days leave the office schedule unchanged.
 */
export function applyRestDays(result, restDays, date) {
  if (!Array.isArray(restDays) || !result.schedule) return result;
  const { schedule } = result;
  if (restDays.includes(weekdayOf(date))) return { schedule, day: { isWorkday: false, type: schedule.schedule_type } };
  if (result.day?.isWorkday) return result;
  const template = MONDAY_FIRST.map((wd) => schedule.days.find((d) => d.weekday === wd && d.is_workday)).find(Boolean);
  return template ? { schedule, day: resolveScheduleDay(template, schedule.schedule_type) } : result;
}
