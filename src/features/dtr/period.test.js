import { describe, expect, it } from 'vitest';
import { buildForm48, displayedMissing, displayedUndertime, periodDays, periodLabel, shownOnHalfPeriod, usesRemarkUndertime } from './form48';
import { nextSegment, segmentProblem } from './importSettings';

describe('whole month period', () => {
  it('covers every day of the month', () => {
    expect(periodDays(2026, 10, 'month')).toEqual({ from: 1, to: 31 });
    expect(periodDays(2026, 9, 'first')).toEqual({ from: 1, to: 15 });
    expect(periodLabel(2026, 10, 'month')).toBe('OCTOBER 1-31, 2026');
  });

  it('keeps the remarks undertime layout on IDs 2, 3 and 12 only, and hides 2 and 12 on a half', () => {
    expect(usesRemarkUndertime({ biometric_id: '2', dtr_format: 'standard' })).toBe(true);
    expect(usesRemarkUndertime({ biometric_id: '3' })).toBe(true);
    expect(usesRemarkUndertime({ biometric_id: '12' })).toBe(true);
    expect(usesRemarkUndertime({ biometric_id: '4', dtr_format: 'no_undertime' })).toBe(false);
    expect(shownOnHalfPeriod({ biometric_id: '2' })).toBe(false);
    expect(shownOnHalfPeriod({ biometric_id: '12' })).toBe(false);
    expect(shownOnHalfPeriod({ biometric_id: '3' })).toBe(true);
    expect(shownOnHalfPeriod({ biometric_id: '4' })).toBe(true);
  });

  it('does not charge the lunch gap when the afternoon return is before 1:00 PM', () => {
    const snap = { isWorkday: true, start: 7 * 60, end: 18 * 60, breakStart: 12 * 60, breakEnd: 13 * 60 };
    const minutes = [6 * 60 + 56, 12 * 60, 12 * 60 + 57, 18 * 60];
    expect(displayedUndertime(minutes, snap)).toBe(0);
    const dtr = { rows: [{ day: 5, weekday: 'Mon', slots: ['06:56', '12:00', '12:57', '18:00'], printSlotMinutes: minutes, schedule: snap, late: 0, undertime: 57, status: 'complete' }] };
    const form = buildForm48({ dtr, year: 2026, month: 10, period: 'first' });
    expect(form.rows.find((r) => r.day === 5).undertime).toBe(0);
  });

  it('flags a missing IN or more than one blank time, not an automatic OUT', () => {
    const full = { status: 'missing_punch', printSlots: ['06:56', '12:00', '12:57', '18:00'], slots: ['06:56', '', '12:57', ''] };
    expect(displayedMissing(full)).toBe(false);
    expect(displayedMissing({ status: 'complete', printSlots: ['', '12:00', '13:00', '18:00'], slots: ['', '12:00', '13:00', '18:00'] })).toBe(true);
    expect(displayedMissing({ status: 'complete', printSlots: ['07:00', '12:00', '', ''], slots: ['07:00', '', '', ''] })).toBe(true);
    expect(displayedMissing({ status: 'complete', printSlots: ['07:00', '12:00', '13:00', ''], slots: ['07:00', '12:00', '13:00', ''] })).toBe(false);
    expect(displayedMissing({ status: 'rest_day', printSlots: ['', '', '', ''], slots: ['', '', '', ''] })).toBe(false);
  });
});

describe('import date ranges', () => {
  const range = { start: '2026-10-01', end: '2026-10-31' };
  const hours = { workdays: [1, 2, 3, 4, 5], amIn: '08:00', amOut: '12:00', pmIn: '13:00', pmOut: '17:00' };
  it('allows a gap and rejects an overlap', () => {
    const early = { from: '2026-10-01', to: '2026-10-02', ...hours };
    const later = { from: '2026-10-05', to: '2026-10-31', ...hours, workdays: [1, 2, 3, 4] };
    expect(segmentProblem([early, later], range)).toBeNull();
    expect(segmentProblem([early, { ...later, from: '2026-10-02' }], range)).toMatch(/overlaps/);
  });
  it('starts the next range the day after the previous one', () => {
    const first = { from: '2026-10-01', to: '2026-10-02', ...hours };
    expect(nextSegment([first], range)).toMatchObject({ from: '2026-10-03', to: '2026-10-31', amIn: '08:00' });
  });
});
