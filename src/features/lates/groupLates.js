import { MONTH_NAMES } from '@/lib/time';

/** One DTR per staff member per half-month (1-15, 16-end) that has attendance. */
export function countDtrPeriods(rows) {
  return new Set(rows.map((r) => `${r.employee_id}|${r.work_date.slice(0, 7)}|${Number(r.work_date.slice(8, 10)) <= 15 ? 1 : 2}`)).size;
}

/** Groups late days by staff member, most late days first. */
export function groupLates(rows) {
  const map = new Map();
  for (const r of rows) {
    let g = map.get(r.employee_id);
    if (!g) {
      g = { employeeId: r.employee_id, name: r.employees?.full_name ?? '', biometricId: r.employees?.biometric_id ?? '', days: [], minutes: 0 };
      map.set(r.employee_id, g);
    }
    g.days.push({ date: r.work_date, minutes: r.late_minutes });
    g.minutes += r.late_minutes;
  }
  for (const g of map.values()) g.months = lateMonths(g.days);
  return [...map.values()].sort((a, b) => b.days.length - a.days.length || b.minutes - a.minutes || a.name.localeCompare(b.name));
}

/** Late days per month, e.g. [{ key: '2026-09', label: 'September 2026', days: [2, 9, 28] }]. */
export function lateMonths(days) {
  const byMonth = new Map();
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = d.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(Number(d.date.slice(8, 10)));
  }
  return [...byMonth].map(([key, list]) => ({ key, label: `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, days: list }));
}
