import { describe, expect, it } from 'vitest';
import { orderProblem, planDayChanges, slotInputValues } from './dtrEdit';

const row = (slotMinutes, slotIds) => ({ date: '2026-09-17', slotMinutes, slotIds });

describe('manual DTR edits', () => {
  it('adds a missing afternoon IN without touching device punches', () => {
    const r = row([478, 740, null, 1020], ['e1', 'e2', null, 'e3']);
    expect(slotInputValues(r)).toEqual(['07:58', '12:20', '', '17:00']);
    expect(planDayChanges(r, ['07:58', '12:20', '13:00', '17:00'])).toEqual({ adds: [{ date: '2026-09-17', time: '13:00:00' }], voids: [] });
  });

  it('a changed time voids the old punch and adds the new one; clearing voids it', () => {
    const r = row([478, 740, null, 1020], ['e1', 'e2', null, 'e3']);
    expect(planDayChanges(r, ['07:58', '12:00', '', ''])).toEqual({ adds: [{ date: '2026-09-17', time: '12:00:00' }], voids: ['e2', 'e3'] });
  });

  it('rejects times out of order', () => {
    expect(orderProblem(['07:00', '12:00', '11:00', ''])).toMatch(/Afternoon IN must be later than Morning OUT/);
    expect(orderProblem(['07:00', '', '13:00', '18:00'])).toBeNull();
  });
});
