import { describe, expect, it } from 'vitest';
import { easterSunday, philippineHolidays, withPhilippineHolidays } from './phHolidays';
import { ageOn, birthdayDayIn, birthdaysInMonth } from './birthdays';

describe('Philippine holidays', () => {
  it('computes Easter Sunday', () => {
    expect(easterSunday(2025)).toEqual({ month: 4, day: 20 });
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
  });

  it('lists the 2026 standard holidays with Holy Week and National Heroes Day computed', () => {
    const byName = Object.fromEntries(philippineHolidays(2026).map((h) => [h.name, h]));
    expect(byName['Maundy Thursday']).toMatchObject({ holiday_date: '2026-04-02', holiday_type: 'regular' });
    expect(byName['Good Friday'].holiday_date).toBe('2026-04-03');
    expect(byName['Black Saturday']).toMatchObject({ holiday_date: '2026-04-04', holiday_type: 'special_non_working' });
    expect(byName['National Heroes Day'].holiday_date).toBe('2026-08-31');
    expect(byName['Independence Day'].holiday_date).toBe('2026-06-12');
    expect(byName['Chinese New Year'].holiday_date).toBe('2026-02-17');
    expect(byName['Rizal Day']).toMatchObject({ holiday_date: '2026-12-30', holiday_type: 'regular' });
    expect(philippineHolidays(2025).find((h) => h.name === 'National Heroes Day').holiday_date).toBe('2025-08-25');
    expect(philippineHolidays(2026).every((h) => h.auto)).toBe(true);
  });

  it('lets a recorded holiday replace the standard one on the same date and limits to the range', () => {
    const recorded = [{ id: 'x', holiday_date: '2026-12-24', name: 'Office open', holiday_type: 'special_working' }];
    const merged = withPhilippineHolidays(recorded, '2026-12-01', '2026-12-31');
    expect(merged.filter((h) => h.holiday_date === '2026-12-24')).toEqual(recorded);
    expect(merged.map((h) => h.holiday_date)).toEqual(['2026-12-08', '2026-12-24', '2026-12-25', '2026-12-30', '2026-12-31']);
  });
});

describe('birthdays', () => {
  const staff = [
    { id: 1, full_name: 'B', birth_date: '1990-09-28' },
    { id: 2, full_name: 'A', birth_date: '1985-09-02' },
    { id: 3, full_name: 'C', birth_date: null },
    { id: 4, full_name: 'D', birth_date: '2000-02-29' },
  ];
  it('lists the month’s birthdays by day', () => {
    expect(birthdaysInMonth(staff, 2026, 9).map((s) => [s.id, s.day])).toEqual([[2, 2], [1, 28]]);
  });
  it('shows a Feb 29 birthday on Feb 28 in common years', () => {
    expect(birthdayDayIn('2000-02-29', 2026, 2)).toBe(28);
    expect(birthdayDayIn('2000-02-29', 2028, 2)).toBe(29);
    expect(birthdayDayIn(null, 2026, 2)).toBeNull();
  });
  it('computes the age reached that year', () => {
    expect(ageOn('1990-09-28', 2026)).toBe(36);
  });
});
