import { describe, it, expect } from 'vitest';
import { addDays, daysInMonth, formatDuration, minutesToClock, monthDates, weekdayOf, zonedToUtc } from './time';

describe('time utilities', () => {
  it('handles month lengths and leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(monthDates(2026, 9)).toHaveLength(30);
  });

  it('adds days across month/year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('computes weekdays independent of local timezone', () => {
    expect(weekdayOf('2026-09-01')).toBe(2);
  });

  it('formats clocks and durations', () => {
    expect(minutesToClock(1445)).toBe('00:05');
    expect(minutesToClock(780, { twelveHour: true })).toBe('1:00 PM');
    expect(minutesToClock(0, { twelveHour: true })).toBe('12:00 AM');
    expect(formatDuration(125)).toBe('2:05');
  });

  it('converts Manila wall-clock time to UTC', () => {
    expect(zonedToUtc('2026-09-01', 8 * 3600, 'Asia/Manila').toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(zonedToUtc('2026-07-01', 12 * 3600, 'America/New_York').toISOString()).toBe('2026-07-01T16:00:00.000Z');
  });
});
