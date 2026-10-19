// Assigns raw punches to work dates. For overnight schedules, punches after
// midnight belong to the previous work date when they fall inside that
// shift's late window. Unclaimed punches stay on their calendar date.
import { addDays, timeToMinutes } from '@/lib/time';

/**
 * @param {Array<{id, local_date, local_time, source, voided}>} events one employee's events
 * @param {string[]} dates work dates to compute (ascending)
 * @param {(date:string)=>object|null} scheduleDayFor resolved schedule day for a date
 * @param {{earlyWindowMinutes:number, lateWindowMinutes:number}} overnight
 * @returns {Map<string, Array<{id, minutes, source, voided}>>}
 */
export function assignPunchesToDates(events, dates, scheduleDayFor, overnight) {
  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.local_date)) byDate.set(e.local_date, []);
    byDate.get(e.local_date).push({ ...e, minutes: timeToMinutes(e.local_time) });
  }
  const claimed = new Set();
  const result = new Map(dates.map((d) => [d, []]));

  // The day before the range may be an overnight shift that claims early punches.
  const candidates = dates.length ? [addDays(dates[0], -1), ...dates] : [];
  for (const d of candidates) {
    const sched = scheduleDayFor(d);
    if (!sched?.isWorkday || !sched.overnight) continue;
    const startWindow = sched.start - overnight.earlyWindowMinutes;
    const endWindow = sched.end - 1440 + overnight.lateWindowMinutes;
    const target = result.get(d);
    for (const p of byDate.get(d) || []) {
      if (claimed.has(p.id) || p.minutes < startWindow) continue;
      claimed.add(p.id);
      target?.push(toPunch(p, 0));
    }
    for (const p of byDate.get(addDays(d, 1)) || []) {
      if (claimed.has(p.id) || p.minutes > endWindow) continue;
      claimed.add(p.id);
      target?.push(toPunch(p, 1440));
    }
  }

  for (const d of dates) {
    for (const p of byDate.get(d) || []) {
      if (claimed.has(p.id)) continue;
      result.get(d).push(toPunch(p, 0));
    }
  }
  for (const list of result.values()) list.sort((a, b) => a.minutes - b.minutes);
  return result;
}

function toPunch(p, offset) {
  return { id: p.id, minutes: p.minutes + offset, source: p.source, voided: Boolean(p.voided), displaySlot: p.display_slot ?? p.displaySlot ?? null };
}
