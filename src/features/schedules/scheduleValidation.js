import { WEEKDAY_SHORT, timeToMinutes } from '@/lib/time';

/** Validates the 7 weekday rows of a schedule form. Returns a list of messages. */
export function validateScheduleDays(days, type) {
  const errors = [];
  for (const d of days) {
    if (!d.is_workday) continue;
    const label = WEEKDAY_SHORT[d.weekday];
    if (type === 'fixed') {
      if (!d.start_time || !d.end_time) errors.push(`${label}: start and end times are required`);
      if (d.start_time && d.start_time === d.end_time) errors.push(`${label}: start and end cannot be equal`);
    } else if (!(Number(d.required_minutes) > 0)) {
      errors.push(`${label}: required minutes must be greater than 0`);
    }
    if (Boolean(d.break_start) !== Boolean(d.break_end)) errors.push(`${label}: set both break start and end, or neither`);
    if (d.break_start && d.break_end && d.start_time && d.end_time && type === 'fixed') {
      const s = timeToMinutes(d.start_time);
      let e = timeToMinutes(d.end_time);
      const overnight = e <= s;
      if (overnight) e += 1440;
      let bs = timeToMinutes(d.break_start);
      let be = timeToMinutes(d.break_end);
      if (overnight && bs < s) bs += 1440;
      if (overnight && be < s) be += 1440;
      if (bs < s || be > e || be <= bs) errors.push(`${label}: break must fall within the shift`);
    }
  }
  return errors;
}
