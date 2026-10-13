import { daysInMonth } from '@/lib/time';

/** Day of the birthday within `month` of `year` (Feb 29 falls on Feb 28 in common years), or null. */
export function birthdayDayIn(birthDate, year, month) {
  if (!birthDate) return null;
  const m = Number(birthDate.slice(5, 7));
  const d = Number(birthDate.slice(8, 10));
  if (m !== month) return null;
  return Math.min(d, daysInMonth(year, month));
}

/** Staff whose birthday falls in the month, sorted by day, as { ...employee, day }. */
export function birthdaysInMonth(employees, year, month) {
  return employees
    .map((e) => ({ ...e, day: birthdayDayIn(e.birth_date, year, month) }))
    .filter((e) => e.day)
    .sort((a, b) => a.day - b.day || a.full_name.localeCompare(b.full_name));
}

/** Age reached on the birthday in `year`. */
export function ageOn(birthDate, year) {
  return year - Number(birthDate.slice(0, 4));
}
