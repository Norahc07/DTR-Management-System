import { describe, expect, it } from 'vitest';
import { periodDays, periodLabel } from './form48';
import { nextSegment, segmentProblem } from './importSettings';

describe('whole month period', () => {
  it('covers every day of the month', () => {
    expect(periodDays(2026, 10, 'month')).toEqual({ from: 1, to: 31 });
    expect(periodDays(2026, 9, 'first')).toEqual({ from: 1, to: 15 });
    expect(periodLabel(2026, 10, 'month')).toBe('OCTOBER 1-31, 2026');
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
