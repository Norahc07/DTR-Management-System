import { describe, expect, it } from 'vitest';
import { countDtrPeriods, groupLates } from './groupLates';

describe('countDtrPeriods', () => {
  it('counts 1 DTR per staff member per half-month', () => {
    const r = (id, d) => ({ employee_id: id, work_date: d });
    expect(countDtrPeriods([r('a', '2026-09-01'), r('a', '2026-09-15'), r('a', '2026-09-16'), r('b', '2026-09-03'), r('a', '2026-10-01')])).toBe(4);
  });
});

const row = (id, name, date, minutes) => ({ employee_id: id, work_date: date, late_minutes: minutes, employees: { full_name: name, biometric_id: id } });

describe('groupLates', () => {
  it('counts each late day once per staff member, most lates first', () => {
    const groups = groupLates([
      row('3', 'jm', '2026-09-01', 1),
      row('10', 'erika', '2026-09-01', 15),
      row('3', 'jm', '2026-09-02', 10),
    ]);
    expect(groups.map((g) => [g.name, g.days.length, g.minutes])).toEqual([['jm', 2, 11], ['erika', 1, 15]]);
    expect(groups[0].days).toEqual([{ date: '2026-09-01', minutes: 1 }, { date: '2026-09-02', minutes: 10 }]);
  });

  it('lists the late days of each month for the card, e.g. September 2026 (2, 9, 28)', () => {
    const [g] = groupLates([
      row('3', 'jm', '2026-09-28', 5),
      row('3', 'jm', '2026-09-02', 3),
      row('3', 'jm', '2026-10-05', 1),
      row('3', 'jm', '2026-09-09', 2),
    ]);
    expect(g.months).toEqual([
      { key: '2026-09', label: 'September 2026', days: [2, 9, 28] },
      { key: '2026-10', label: 'October 2026', days: [5] },
    ]);
  });

  it('returns nothing when there are no lates', () => {
    expect(groupLates([])).toEqual([]);
  });
});
