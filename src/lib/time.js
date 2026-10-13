// Pure date/time helpers. Dates are 'yyyy-MM-dd' strings, times are seconds
// or minutes from local midnight. Nothing here depends on the browser timezone.

export const pad2 = (n) => String(n).padStart(2, '0');

export function isValidDateParts(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toDateKey(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return isValidDateParts(y, mo, d) ? { year: y, month: mo, day: d } : null;
}

export function addDays(key, n) {
  const p = parseDateKey(key);
  const dt = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return toDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(key) {
  const p = parseDateKey(key);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

export function monthDates(year, month) {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => toDateKey(year, month, i + 1));
}

export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthBounds(year, month) {
  return { start: toDateKey(year, month, 1), end: toDateKey(year, month, daysInMonth(year, month)) };
}

export function secondsToTime(sec) {
  const s = Math.round(sec);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

/** 'HH:mm' or 'HH:mm:ss' -> minutes (fractional seconds dropped). null-safe. */
export function timeToMinutes(t) {
  if (t == null || t === '') return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(t));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes (may exceed 1440 for next-day times) -> 'HH:mm' display. */
export function minutesToClock(min, { twelveHour = false } = {}) {
  if (min == null) return '';
  const total = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!twelveHour) return `${pad2(h)}:${pad2(m)}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatDuration(minutes) {
  if (!minutes) return '0:00';
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${pad2(abs % 60)}`;
}

/**
 * Converts a wall-clock date+time in an IANA timezone to a UTC Date.
 * Uses Intl to find the zone offset (handles DST zones too).
 */
export function zonedToUtc(dateKey, seconds, timeZone) {
  const p = parseDateKey(dateKey);
  const guess = Date.UTC(p.year, p.month - 1, p.day) + seconds * 1000;
  const offset = tzOffsetMs(new Date(guess), timeZone);
  const first = guess - offset;
  const offset2 = tzOffsetMs(new Date(first), timeZone);
  return new Date(guess - offset2);
}

function tzOffsetMs(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Today's date key in the organization timezone. */
export function todayInZone(timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Formats a YYYY-MM-DD key using one of the organization date formats. */
export function formatDateKey(key, format = 'yyyy-MM-dd') {
  if (!key) return '';
  const [y, m, d] = key.slice(0, 10).split('-');
  switch (format) {
    case 'MM/dd/yyyy':
      return `${m}/${d}/${y}`;
    case 'dd/MM/yyyy':
      return `${d}/${m}/${y}`;
    case 'MMM d, yyyy':
      return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${Number(d)}, ${y}`;
    default:
      return `${y}-${m}-${d}`;
  }
}

/** Date key of an instant in a timezone. */
export function instantToDateKey(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}
