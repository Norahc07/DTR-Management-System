// Maps the monthly DTR model onto the 31 fixed rows of CS Form No. 48.
// DTRs are semi-monthly: days 1-15 ('first') and 16-end of month ('second').
import { MONTH_NAMES, daysInMonth, toDateKey } from '@/lib/time';

export const PERIODS = [
  { value: 'first', label: '1–15', half: 1 },
  { value: 'second', label: '16–end of month', half: 2 },
  { value: 'month', label: 'Whole month', half: 0 },
];

export const isPeriod = (v) => PERIODS.some((p) => p.value === v);
export const periodHalf = (period) => PERIODS.find((p) => p.value === period)?.half ?? 1;
export const periodOfDay = (day) => (day <= 15 ? 'first' : 'second');

export function periodDays(year, month, period) {
  const last = daysInMonth(year, month);
  if (period === 'month') return { from: 1, to: last };
  return period === 'second' ? { from: 16, to: last } : { from: 1, to: 15 };
}

export function periodRange(year, month, period) {
  const { from, to } = periodDays(year, month, period);
  return { start: toDateKey(year, month, from), end: toDateKey(year, month, to) };
}

/** e.g. "SEPTEMBER 16-30, 2026" */
export function periodLabel(year, month, period) {
  const { from, to } = periodDays(year, month, period);
  return `${MONTH_NAMES[month - 1].toUpperCase()} ${from}-${to}, ${year}`;
}

/** Editable header lines; "For the month of" always follows the selected month and period. */
export const HEADER_FIELDS = [
  ['regular_days', 'Regular days'],
  ['regular_hours', 'Regular hours'],
  ['rest_days', 'Rest days'],
  ['rest_hours', 'Rest days text'],
];

/** Header text of one form: edited values (dtr_period_headers row) over the computed ones. */
export function dtrHeader({ year, month, period, official, template, override }) {
  const computed = {
    regular_days: official?.regularDays || template.regularDaysLabel,
    regular_hours: official?.regularHours || template.regularHours,
    rest_days: official?.restDays || template.weekendLabel,
    rest_hours: template.weekendHours,
  };
  return {
    month_label: periodLabel(year, month, period),
    ...Object.fromEntries(HEADER_FIELDS.map(([k]) => [k, override?.[k] || computed[k]])),
  };
}

const DAY_LABELS = {
  rest_day: { text: 'DAYOFF' },
  holiday: { text: 'HOLIDAY' },
  leave: { text: 'ON LEAVE' },
};
/** Remarks chosen for days without times; printed in the merged Undertime cell. */
export const DAY_REMARKS = [
  ['day_off', 'Day Off', 'DAYOFF'],
  ['ob', 'OB', 'OB'],
  ['l', 'L', 'L'],
  ['sl', 'SL', 'SL'],
  ['wl', 'WL', 'WL'],
  ['seminar', 'Seminar', 'SEMINAR'],
  ['holiday', 'Holiday', 'HOLIDAY'],
];
/** For a day with times in only one half; the empty half's IN/OUT cells print merged. */
export const HALF_DAY_REMARK = ['half_day', 'Half day', 'HALF DAY'];
const REMARK_PRINT = Object.fromEntries(DAY_REMARKS.map(([v, , p]) => [v, p]));

/** 'am' or 'pm' when only that half of the day is empty (the other half has times), else null. */
export function emptyHalf(times) {
  const am = Boolean(times[0] || times[1]);
  const pm = Boolean(times[2] || times[3]);
  if (am && !pm) return 'pm';
  if (pm && !am) return 'am';
  return null;
}

/** Whether a remark can stay with these times: full-day remarks need no times, Half day needs one empty half. */
export function remarkFits(remark, times) {
  if (!remark) return true;
  if (remark === HALF_DAY_REMARK[0]) return emptyHalf(times) !== null;
  return !times.some(Boolean);
}
const BLANK_STATUSES = new Set(['not_computed', 'no_data']);

/** Readiness and totals for the days of one half-month period. */
export function periodSummary({ dtr, summaries, year, month, period }) {
  const { from, to } = periodDays(year, month, period);
  const { start, end } = periodRange(year, month, period);
  const rows = dtr.rows.filter((r) => r.day >= from && r.day <= to);
  const totals = { worked: 0, late: 0, undertime: 0, overtime: 0 };
  for (const r of rows) for (const k of Object.keys(totals)) totals[k] += r[k] || 0;
  return {
    rows,
    totals,
    notComputed: rows.filter((r) => r.status === 'not_computed').length,
    unresolved: rows.filter((r) => r.status === 'missing_punch' || r.status === 'needs_review').length,
    policyMissing: summaries.some((s) => s.work_date >= start && s.work_date <= end && !s.policy_id),
    extraPunches: rows.some((r) => r.extra?.length),
  };
}

/** Splits minutes into the Hours / Min undertime columns (blank when zero). */
export function hoursAndMinutes(minutes) {
  if (!minutes) return { hours: '', min: '' };
  return { hours: Math.floor(minutes / 60) || '', min: minutes % 60 || '' };
}

/**
 * Undertime per day is tardiness plus early departure. Days outside the period,
 * and days without imported data, stay blank; no times are inferred.
 */
export function buildForm48({ dtr, year, month, period, showUndertime = true, format = 'standard' }) {
  const { from, to } = periodDays(year, month, period);
  const byDay = new Map(dtr.rows.map((r) => [r.day, r]));
  const noUndertime = format === 'no_undertime';
  const countUndertime = showUndertime && !noUndertime;
  let totalUndertime = 0;
  const rows = Array.from({ length: 31 }, (_, i) => {
    const day = i + 1;
    const r = day >= from && day <= to ? byDay.get(day) : null;
    if (!r) return { day, kind: 'blank' };
    const hasTimes = r.slots.some(Boolean);
    const weekdayName = r.weekday.toUpperCase();
    const printRemark = (v) => (noUndertime && v === 'day_off' ? weekdayName : REMARK_PRINT[v] ?? null);
    const remark = !hasTimes && r.remark ? printRemark(r.remark) : null;
    if (BLANK_STATUSES.has(r.status)) return { day, kind: 'blank', remark };
    const label = DAY_LABELS[r.status];
    if (label && !hasTimes) {
      if (noUndertime && r.status === 'rest_day') return { day, kind: 'blank', remark: remark ?? weekdayName };
      return { day, kind: 'label', ...label, remark };
    }
    if (!hasTimes) return { day, kind: 'blank', remark };
    const undertime = countUndertime ? (r.late || 0) + (r.undertime || 0) : 0;
    totalUndertime += undertime;
    const halfDay = r.remark === HALF_DAY_REMARK[0] ? emptyHalf(r.slots) : null;
    if (halfDay && noUndertime) return { day, kind: 'times', slots: r.printSlots ?? r.slots, undertime, remark: HALF_DAY_REMARK[2] };
    return { day, kind: 'times', slots: r.printSlots ?? r.slots, undertime, ...(halfDay && { halfDay, halfDayText: HALF_DAY_REMARK[2] }) };
  });
  return { rows, totalUndertime };
}
