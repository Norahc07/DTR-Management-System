import { describe, expect, it } from 'vitest';
import { editedHalves, planDayChanges, slotInputValues } from './dtrEdit';

const row = (slotMinutes, slotIds, extra = {}) => ({ date: '2026-09-17', slotMinutes, slotIds, ...extra });

describe('manual DTR edits', () => {
  it('adds a missing afternoon IN without touching device punches', () => {
    const r = row([478, 740, null, 1020], ['e1', 'e2', null, 'e3']);
    expect(slotInputValues(r)).toEqual(['07:58', '12:20', '', '17:00']);
    expect(planDayChanges(r, ['07:58', '12:20', '13:00', '17:00'])).toEqual({ adds: [{ date: '2026-09-17', time: '13:00:00', slot: 2 }], voids: [] });
  });

  it('a changed time voids the old punch and adds the new one; clearing voids it', () => {
    const r = row([478, 740, null, 1020], ['e1', 'e2', null, 'e3']);
    expect(planDayChanges(r, ['07:58', '12:00', '', ''])).toEqual({ adds: [{ date: '2026-09-17', time: '12:00:00', slot: 1 }], voids: ['e2', 'e3'] });
  });

  it('replaces an automatic morning OUT and a punch whose record is gone', () => {
    const r = row([467, null, 751, null], ['e1', null, null, null], { printSlotMinutes: [467, 720, 751, null] });
    expect(slotInputValues(r)).toEqual(['07:47', '12:00', '12:31', '']);
    expect(planDayChanges(r, ['08:00', '11:50', '13:00', '18:00'])).toEqual({
      adds: [
        { date: '2026-09-17', time: '08:00:00', slot: 0 },
        { date: '2026-09-17', time: '11:50:00', slot: 1 },
        { date: '2026-09-17', time: '13:00:00', slot: 2 },
        { date: '2026-09-17', time: '18:00:00', slot: 3 },
      ],
      voids: ['e1'],
    });
  });

  it('does not treat a day with no punches in either half as a half day', () => {
    const empty = row([null, null, null, null], [null, null, null, null], { printSlotMinutes: [null, null, null, null] });
    expect(editedHalves(empty, ['', '', '', ''])).toEqual({ am: false, pm: false });
    const morning = row([467, null, null, null], ['e1', null, null, null], { printSlotMinutes: [467, 720, null, null] });
    expect(editedHalves(morning, ['07:47', '12:00', '', ''])).toEqual({ am: true, pm: false });
  });
});
