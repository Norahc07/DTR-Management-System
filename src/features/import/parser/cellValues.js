// Interprets individual worksheet cells. Works on SheetJS cell objects
// ({ t, v, w, z }) read with cellDates: false so date/time cells stay as
// Excel serial numbers and can be decoded deterministically (no browser TZ).
import { isValidDateParts, toDateKey } from '@/lib/time';

const SECONDS_PER_DAY = 86400;

/** Recognises number formats that represent dates/times (e.g. 'h:mm', 'yyyy-mm-dd'). */
export function isDateFormat(fmt) {
  if (!fmt || typeof fmt !== 'string' || fmt === 'General') return false;
  const cleaned = fmt
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?:\$|Color|Red|Black|Blue|Green|White|Yellow|Magenta|Cyan)[^\]]*\]/gi, '');
  return /[dmyhs]/i.test(cleaned) && !/^[#0.,%E+\-\s]*$/.test(cleaned);
}

/**
 * Excel serial -> { date: 'yyyy-MM-dd' | null, seconds: number | null }.
 * Serial < 1 is a pure time. Integer serial is a pure date.
 * The 1900 system treats 1900 as a leap year (Excel bug), hence epoch 1899-12-30.
 */
export function excelSerialToParts(serial, { date1904 = false } = {}) {
  if (typeof serial !== 'number' || !Number.isFinite(serial) || serial < 0) return null;
  let days = Math.floor(serial);
  let seconds = Math.round((serial - days) * SECONDS_PER_DAY);
  if (seconds >= SECONDS_PER_DAY) {
    days += 1;
    seconds -= SECONDS_PER_DAY;
  }
  const hasTime = serial !== Math.floor(serial);
  if (days === 0 && !date1904) {
    return { date: null, seconds };
  }
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const dt = new Date(epoch + days * SECONDS_PER_DAY * 1000);
  const date = toDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  return { date, seconds: hasTime ? seconds : null };
}

const TIME_TOKEN = /(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?(?:\s*([AaPp])\.?\s*[Mm]\.?)?/g;

/**
 * Extracts every time token from a string, in source order. Handles separators
 * (spaces, newlines, commas, semicolons) and back-to-back values such as
 * "08:0112:0513:0017:02". Returns { times: [{ seconds, raw }], leftover }.
 */
export function parseTimeTokens(input) {
  const text = String(input ?? '');
  const times = [];
  const invalid = [];
  let leftover = text;
  for (const m of text.matchAll(TIME_TOKEN)) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const sec = m[3] ? Number(m[3]) : 0;
    const ampm = m[4]?.toUpperCase();
    let ok = min < 60 && sec < 60;
    if (ampm) {
      ok = ok && h >= 1 && h <= 12;
      if (ampm === 'A' && h === 12) h = 0;
      if (ampm === 'P' && h !== 12) h += 12;
    } else {
      ok = ok && h < 24;
    }
    if (ok) times.push({ seconds: h * 3600 + min * 60 + sec, raw: m[0].trim() });
    else invalid.push(m[0].trim());
    leftover = leftover.replace(m[0], ' ');
  }
  leftover = leftover.replace(/[\s,;|/\\\-–]+/g, ' ').trim();
  return { times, leftover, invalid };
}

/**
 * Parses date strings. order: 'YMD' | 'MDY' | 'DMY' (applies to numeric
 * slash/dash/dot forms that are not year-first). Optional trailing time.
 */
export function parseDateString(input, order = 'MDY') {
  const text = String(input ?? '').trim();
  if (!text) return null;
  let y;
  let m;
  let d;
  let rest;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/.exec(text);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    rest = match[4];
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(.*)$/.exec(text))) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    y = Number(match[3]);
    if (y < 100) y += 2000;
    if (order === 'DMY') [d, m] = [a, b];
    else [m, d] = [a, b];
    rest = match[4];
  } else {
    return null;
  }
  if (!isValidDateParts(y, m, d)) return null;
  const { times } = parseTimeTokens(rest);
  return { date: toDateKey(y, m, d), seconds: times[0]?.seconds ?? null };
}

/** Normalised view of a SheetJS cell. */
export function readCell(cell) {
  if (!cell || cell.t === 'z' || (cell.v == null && cell.w == null)) return { kind: 'empty', text: '' };
  const text = cell.w != null ? String(cell.w) : String(cell.v ?? '');
  switch (cell.t) {
    case 'n':
      return isDateFormat(cell.z) ? { kind: 'serial', value: cell.v, text } : { kind: 'number', value: cell.v, text };
    case 'd':
      return { kind: 'date', value: cell.v instanceof Date ? cell.v : new Date(cell.v), text };
    case 's':
      return String(cell.v).trim() === '' ? { kind: 'empty', text: '' } : { kind: 'string', value: String(cell.v), text };
    case 'b':
      return { kind: 'bool', value: cell.v, text };
    case 'e':
      return { kind: 'error', value: cell.v, text };
    default:
      return { kind: 'string', value: String(cell.v), text };
  }
}

/**
 * Extracts punch times from one cell.
 * Returns { times: [seconds], date: 'yyyy-MM-dd' | null, issues: [{code, message}] }.
 */
export function extractTimesFromCell(cell, { date1904 = false } = {}) {
  const c = readCell(cell);
  const issues = [];
  if (c.kind === 'empty') return { times: [], date: null, issues, raw: '' };
  const raw = c.text;

  if (c.kind === 'serial' || (c.kind === 'number' && c.value > 0 && c.value < 1)) {
    const parts = excelSerialToParts(c.value, { date1904 });
    if (!parts) return { times: [], date: null, issues: [{ code: 'INVALID_TIME', message: `Invalid time value "${raw}"` }], raw };
    if (c.kind === 'number') {
      issues.push({ code: 'NUMERIC_TIME_ASSUMED', message: `Unformatted number ${c.value} interpreted as a time of day` });
    }
    if (parts.seconds == null) {
      issues.push({ code: 'DATE_WITHOUT_TIME', message: `Cell contains a date (${parts.date}) but no time` });
      return { times: [], date: parts.date, issues, raw };
    }
    return { times: [parts.seconds], date: parts.date, issues, raw };
  }

  if (c.kind === 'date') {
    const dt = c.value;
    if (Number.isNaN(dt.getTime())) return { times: [], date: null, issues: [{ code: 'INVALID_TIME', message: 'Invalid date cell' }], raw };
    // Date objects from SheetJS are produced in UTC when cellDates is used.
    return {
      times: [dt.getUTCHours() * 3600 + dt.getUTCMinutes() * 60 + dt.getUTCSeconds()],
      date: toDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()),
      issues,
      raw,
    };
  }

  if (c.kind === 'string') {
    const { times, leftover, invalid } = parseTimeTokens(c.value);
    for (const bad of invalid) issues.push({ code: 'INVALID_TIME', message: `Unrecognised time "${bad}"` });
    if (leftover) {
      issues.push({
        code: times.length ? 'EXTRA_TEXT' : 'UNRECOGNIZED_VALUE',
        message: times.length
          ? `Cell contains text besides times: "${leftover.slice(0, 60)}"`
          : `Value "${leftover.slice(0, 60)}" is not a recognised time`,
      });
    }
    return { times: times.map((t) => t.seconds), date: null, issues, raw };
  }

  return {
    times: [],
    date: null,
    issues: [{ code: 'UNRECOGNIZED_VALUE', message: `Value "${raw}" is not a recognised time` }],
    raw,
  };
}

/** Reads a date from a cell (serial date, date string, or Date). */
export function extractDateFromCell(cell, { date1904 = false, dateOrder = 'MDY' } = {}) {
  const c = readCell(cell);
  if (c.kind === 'serial' || (c.kind === 'number' && c.value > 59 && c.value < 80000)) {
    const parts = excelSerialToParts(c.value, { date1904 });
    return parts?.date ? { date: parts.date, seconds: parts.seconds } : null;
  }
  if (c.kind === 'date' && !Number.isNaN(c.value.getTime())) {
    const dt = c.value;
    return {
      date: toDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()),
      seconds: dt.getUTCHours() * 3600 + dt.getUTCMinutes() * 60 + dt.getUTCSeconds(),
    };
  }
  if (c.kind === 'string') return parseDateString(c.value, dateOrder);
  return null;
}

export const BIOMETRIC_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Biometric IDs are always strings. Numeric cells may already have lost leading
 * zeros in Excel; optional zero-padding restores a known fixed width.
 */
export function normalizeBiometricId(cell, { padLength = 0 } = {}) {
  const c = typeof cell === 'object' && cell !== null && 't' in cell ? readCell(cell) : { kind: 'string', value: cell };
  const issues = [];
  let id;
  if (c.kind === 'empty' || c.value == null) return { id: null, issues };
  if (c.kind === 'number' || c.kind === 'serial') {
    if (!Number.isInteger(c.value)) return { id: null, issues: [{ code: 'INVALID_ID', message: `ID "${c.text}" is not a whole number` }] };
    id = String(c.value);
    issues.push({ code: 'NUMERIC_ID', message: 'ID stored as a number in Excel; leading zeros may have been lost' });
  } else {
    id = String(c.value).trim().replace(/^(?:id|no|user\s*id|ac-?no)\.?\s*[:：]?\s*/i, '');
  }
  if (padLength > 0 && /^\d+$/.test(id) && id.length < padLength) id = id.padStart(padLength, '0');
  if (!BIOMETRIC_ID_PATTERN.test(id)) {
    return { id: null, issues: [{ code: 'INVALID_ID', message: `"${String(c.value).slice(0, 40)}" is not a valid biometric ID` }] };
  }
  return { id, issues };
}

export function cellText(cell) {
  return readCell(cell).text.trim();
}
