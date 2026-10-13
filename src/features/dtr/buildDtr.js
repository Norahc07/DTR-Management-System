// Builds the printable monthly DTR model from stored daily summaries.
import { STATUS_LABELS } from '@/features/attendance/engine/computeDay';
import { WEEKDAY_SHORT, minutesToClock, monthDates, parseDateKey, weekdayOf } from '@/lib/time';

/** Civil Service Form No. 48 layout; the text fields are editable in Settings. */
export const DEFAULT_DTR_TEMPLATE = Object.freeze({
  formNumber: 'Civil Service Form No. 48',
  title: 'Daily Time Record',
  regularDaysLabel: 'Regular days',
  regularHours: '7:00 - 6:00 PM',
  weekendLabel: 'Sat-Sun',
  weekendHours: 'Day off',
  slotMode: 'split_at_break',
  splitMinute: 720,
  timeFormat: '24h',
  showComputation: true,
  certificationText:
    'I certify on my honor that the above is a true and correct report of the hours of work performed, record of which was made daily at the time of arrival and departure from office.',
  verifiedText: 'VERIFIED as to the prescribed office hours:',
  verifierName: 'MIRABUENO, CONCHITA MARTA B.',
  verifierTitle: 'CeC Manager',
});

export const TEMPLATE_TEXT_KEYS = ['formNumber', 'title', 'regularDaysLabel', 'regularHours', 'weekendLabel', 'weekendHours', 'certificationText', 'verifiedText', 'verifierName', 'verifierTitle'];

export function resolveTemplate(stored) {
  const t = { ...DEFAULT_DTR_TEMPLATE };
  for (const [k, v] of Object.entries(stored || {})) {
    if (k in DEFAULT_DTR_TEMPLATE && typeof v === typeof DEFAULT_DTR_TEMPLATE[k]) t[k] = v;
  }
  return t;
}

/**
 * Places punches into four display slots. Display only; computation uses the
 * pairing engine. 'chronological' fills slots in time order. 'split_at_break'
 * puts punches before the split minute in the first two slots and later
 * punches in the last two, e.g. 08:00 and 17:00 -> slot 1 and slot 4.
 * A lone afternoon punch at or after pmOutFrom is a departure (slot 4),
 * otherwise a return from lunch (slot 3).
 */
export function slotPunches(minutesList, mode = 'chronological', splitMinute = 720, pmOutFrom = splitMinute + 180) {
  const sorted = [...minutesList].sort((a, b) => a - b);
  const slots = [null, null, null, null];
  const extra = [];
  // Four punches are AM in, AM out, PM in, PM out regardless of the split point
  // (a lunch-out at 12:02 must not be read as an afternoon arrival).
  if (mode !== 'split_at_break' || sorted.length === 4) {
    sorted.forEach((m, i) => (i < 4 ? (slots[i] = m) : extra.push(m)));
    return { slots, extra };
  }
  const morning = sorted.filter((m) => m < splitMinute);
  const afternoon = sorted.filter((m) => m >= splitMinute);
  morning.forEach((m, i) => (i < 2 ? (slots[i] = m) : extra.push(m)));
  if (afternoon.length === 1) {
    slots[afternoon[0] >= pmOutFrom ? 3 : 2] = afternoon[0];
  } else {
    afternoon.forEach((m, i) => (i < 2 ? (slots[2 + i] = m) : extra.push(m)));
  }
  return { slots, extra };
}

const COUNTED_ROLES = new Set(['in', 'out', 'unpaired', 'unused']);

/**
 * Printed slots: a missing morning OUT after a morning IN shows the start of
 * the break (12:00), and a missing afternoon OUT after an afternoon IN shows
 * the end of the day (e.g. 18:00). Stored punches and computations are unchanged.
 */
export function fillMissingOuts(slots, snap) {
  const out = [...slots];
  if (!snap?.isWorkday) return out;
  if (out[0] != null && out[1] == null && snap.breakStart != null) out[1] = snap.breakStart;
  if (out[2] != null && out[3] == null && snap.end != null) out[3] = snap.end;
  return out;
}

/**
 * @param {object} args
 * @param {number} args.year
 * @param {number} args.month 1-12
 * @param {Array} args.summaries daily_attendance rows for the employee/month
 * @param {object} args.template resolved template
 */
export function buildMonthlyDtr({ year, month, summaries, template, remarks: dayRemarks = [] }) {
  const byDate = new Map(summaries.map((s) => [s.work_date, s]));
  const remarkByDate = new Map(dayRemarks.map((r) => [r.work_date, r.remark]));
  const twelve = template.timeFormat !== '24h';
  const totals = { worked: 0, late: 0, undertime: 0, overtime: 0, lateCount: 0, undertimeCount: 0 };
  const counts = {};
  const rows = monthDates(year, month).map((date) => {
    const s = byDate.get(date);
    const weekday = WEEKDAY_SHORT[weekdayOf(date)];
    const day = parseDateKey(date).day;
    const remark = remarkByDate.get(date) ?? null;
    if (!s) {
      counts.not_computed = (counts.not_computed || 0) + 1;
      return { date, day, weekday, status: 'not_computed', statusLabel: 'Not computed', slots: ['', '', '', ''], slotMinutes: [null, null, null, null], slotIds: [null, null, null, null], extra: [], worked: 0, late: 0, undertime: 0, overtime: 0, remarks: 'Not computed', remark, flags: [] };
    }
    counts[s.status] = (counts[s.status] || 0) + 1;
    const usablePunches = (s.punches || []).filter((p) => COUNTED_ROLES.has(p.role));
    const usable = usablePunches.map((p) => p.minutes);
    const snap = s.schedule_snapshot;
    const hasBreak = snap?.breakStart != null && snap?.breakEnd != null;
    const split = hasBreak ? Math.round((snap.breakStart + snap.breakEnd) / 2) : template.splitMinute;
    const pmOutFrom = hasBreak && snap.end != null && snap.end > snap.breakEnd ? Math.round((snap.breakEnd + snap.end) / 2) : undefined;
    const { slots, extra } = slotPunches(usable, template.slotMode, split, pmOutFrom);
    const taken = new Set();
    const slotIds = slots.map((m) => {
      if (m == null) return null;
      const idx = usablePunches.findIndex((x, i) => x.minutes === m && !taken.has(i));
      if (idx < 0) return null;
      taken.add(idx);
      return usablePunches[idx].id ?? null;
    });
    const printMinutes = fillMissingOuts(slots, snap);
    totals.worked += s.worked_minutes;
    totals.late += s.late_minutes;
    totals.undertime += s.undertime_minutes;
    totals.overtime += s.overtime_minutes;
    if (s.late_minutes > 0) totals.lateCount++;
    if (s.undertime_minutes > 0) totals.undertimeCount++;
    const remarks = [];
    if (!['complete'].includes(s.status)) remarks.push(STATUS_LABELS[s.status] ?? s.status);
    if (extra.length) remarks.push(`Also: ${extra.map((m) => minutesToClock(m, { twelveHour: twelve })).join(', ')}`);
    if (slots.some((m) => m != null && m >= 1440)) remarks.push('Includes next-day punch');
    return {
      date,
      day,
      weekday,
      status: s.status,
      statusLabel: STATUS_LABELS[s.status] ?? s.status,
      slots: slots.map((m) => (m == null ? '' : minutesToClock(m, { twelveHour: twelve }))),
      slotMinutes: slots,
      printSlots: printMinutes.map((m) => (m == null ? '' : minutesToClock(m, { twelveHour: twelve }))),
      slotIds,
      extra,
      worked: s.worked_minutes,
      late: s.late_minutes,
      undertime: s.undertime_minutes,
      overtime: s.overtime_minutes,
      remarks: remarks.join('; '),
      remark,
      flags: s.flags || [],
    };
  });
  const unresolved = (counts.missing_punch || 0) + (counts.needs_review || 0);
  const policyMissing = summaries.some((s) => !s.policy_id);
  return { rows, totals, counts, unresolved, notComputed: counts.not_computed || 0, policyMissing, official: officialHours(summaries) };
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "Mon-Thu"-style label for a set of weekdays (0 = Sunday), listed Monday first. */
export function weekdayRangeLabel(weekdays) {
  const idx = WEEK_ORDER.map((d, i) => (weekdays.has(d) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return '';
  const runs = [];
  for (const i of idx) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  const name = (i) => WEEKDAY_SHORT[WEEK_ORDER[i]];
  return runs.map(([a, b]) => (a === b ? name(a) : `${name(a)}-${name(b)}`)).join(', ');
}

/**
 * Official hours printed on the form, from the schedules used that month:
 * e.g. { regularHours: '7:00 - 6:00 PM', regularDays: 'Mon-Thu', restDays: 'Fri-Sun' }.
 */
export function officialHours(summaries) {
  const hours = new Map();
  const work = new Set();
  const rest = new Set();
  for (const s of summaries) {
    const snap = s.schedule_snapshot;
    if (!snap) continue;
    const wd = weekdayOf(s.work_date);
    if (snap.isWorkday === false) rest.add(wd);
    else if (snap.start != null && snap.end != null) {
      work.add(wd);
      const key = `${snap.start}|${snap.end}`;
      hours.set(key, (hours.get(key) || 0) + 1);
    }
  }
  if (!hours.size) return null;
  const [start, end] = [...hours.entries()].sort((a, b) => b[1] - a[1])[0][0].split('|').map(Number);
  const clock = (m) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')}`;
  return {
    regularHours: `${clock(start)} - ${clock(end)} ${end % 1440 >= 720 ? 'PM' : 'AM'}`,
    regularDays: weekdayRangeLabel(work),
    restDays: weekdayRangeLabel(rest),
  };
}
