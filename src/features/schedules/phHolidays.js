// Philippine nationwide holidays whose dates follow fixed rules (RA 9492 as
// amended, RA 10966 and the yearly proclamations' recurring entries). Eid'l Fitr
// and Eid'l Adha depend on the Islamic calendar and are proclaimed each year, so
// they are not generated; add them (and any one-off proclamation days) manually.
import { daysInMonth, toDateKey, weekdayOf } from '@/lib/time';

/** Lunar New Year dates (special non-working day); years outside the table are skipped. */
const CHINESE_NEW_YEAR = {
  2024: '02-10', 2025: '01-29', 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03',
};

/** Gregorian Easter Sunday (anonymous Gregorian algorithm). */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function shiftKey(year, month, day, delta) {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function lastMonday(year, month) {
  const last = daysInMonth(year, month);
  const back = (weekdayOf(toDateKey(year, month, last)) + 6) % 7;
  return toDateKey(year, month, last - back);
}

/** Standard nationwide holidays for a year, sorted by date. */
export function philippineHolidays(year) {
  const e = easterSunday(year);
  const fixed = (mmdd) => `${year}-${mmdd}`;
  const list = [
    [fixed('01-01'), "New Year's Day", 'regular'],
    [shiftKey(year, e.month, e.day, -3), 'Maundy Thursday', 'regular'],
    [shiftKey(year, e.month, e.day, -2), 'Good Friday', 'regular'],
    [shiftKey(year, e.month, e.day, -1), 'Black Saturday', 'special_non_working'],
    [fixed('04-09'), 'Araw ng Kagitingan', 'regular'],
    [fixed('05-01'), 'Labor Day', 'regular'],
    [fixed('06-12'), 'Independence Day', 'regular'],
    [fixed('08-21'), 'Ninoy Aquino Day', 'special_non_working'],
    [lastMonday(year, 8), 'National Heroes Day', 'regular'],
    [fixed('11-01'), "All Saints' Day", 'special_non_working'],
    [fixed('11-30'), 'Bonifacio Day', 'regular'],
    [fixed('12-08'), 'Feast of the Immaculate Conception of Mary', 'special_non_working'],
    [fixed('12-24'), 'Christmas Eve', 'special_non_working'],
    [fixed('12-25'), 'Christmas Day', 'regular'],
    [fixed('12-30'), 'Rizal Day', 'regular'],
    [fixed('12-31'), 'Last Day of the Year', 'special_non_working'],
  ];
  if (CHINESE_NEW_YEAR[year]) list.push([fixed(CHINESE_NEW_YEAR[year]), 'Chinese New Year', 'special_non_working']);
  return list
    .map(([holiday_date, name, holiday_type]) => ({ id: `ph-${holiday_date}-${name}`, holiday_date, name, holiday_type, auto: true }))
    .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
}

/**
 * Recorded holidays plus the standard Philippine ones for the years in
 * [from, to]. A recorded holiday on a date replaces the standard one, so an
 * admin can rename it, change its type, or mark it a special working day.
 */
export function withPhilippineHolidays(recorded, from, to) {
  const taken = new Set(recorded.map((h) => h.holiday_date));
  const auto = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const h of philippineHolidays(y)) if (h.holiday_date >= from && h.holiday_date <= to && !taken.has(h.holiday_date)) auto.push(h);
  }
  return [...recorded, ...auto].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
}
