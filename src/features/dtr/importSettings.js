import { addDays } from '@/lib/time';

export const DEFAULT_HOURS = { workdays: [1, 2, 3, 4, 5], amIn: '07:00', amOut: '12:00', pmIn: '13:00', pmOut: '18:00' };

export function newSegment(from, to, hours = DEFAULT_HOURS) {
  return {
    id: `${from}|${to}|${Math.random().toString(36).slice(2, 8)}`,
    from,
    to,
    workdays: [...hours.workdays],
    amIn: hours.amIn,
    amOut: hours.amOut,
    pmIn: hours.pmIn,
    pmOut: hours.pmOut,
  };
}

/** null when the ranges can be saved; otherwise the message to show. */
export function segmentProblem(segments, range) {
  if (!segments?.length) return 'Add at least one date range.';
  const sorted = [...segments].sort((a, b) => a.from.localeCompare(b.from));
  for (const s of sorted) {
    if (!s.from || !s.to || s.to < s.from) return 'Each date range needs a start on or before its end.';
    if (range && (s.from < range.start || s.to > range.end)) return `Date ranges must stay inside ${range.start} to ${range.end}.`;
    if (!s.workdays.length) return 'Each date range needs at least one work day.';
    if (!(s.amIn && s.amOut && s.pmIn && s.pmOut) || !(s.amIn < s.amOut && s.amOut <= s.pmIn && s.pmIn < s.pmOut)) {
      return 'Times must be in order: morning IN, morning OUT, afternoon IN, afternoon OUT.';
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from <= sorted[i - 1].to) return `${sorted[i - 1].from}–${sorted[i - 1].to} overlaps ${sorted[i].from}–${sorted[i].to}.`;
  }
  return null;
}

/** A further range starts the day after the latest one and runs to the period end. */
export function nextSegment(segments, range) {
  const last = [...segments].sort((a, b) => a.to.localeCompare(b.to)).at(-1);
  const from = last?.to && last.to < range.end ? addDays(last.to, 1) : range.start;
  return newSegment(from, range.end, last ?? DEFAULT_HOURS);
}
