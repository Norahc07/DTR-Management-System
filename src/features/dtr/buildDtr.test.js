import { describe, it, expect } from 'vitest';
import { buildMonthlyDtr, fillMissingOuts, placeSlots, resolveTemplate, slotPunches } from './buildDtr';
import { emptyHalf, remarkFits } from './form48';

describe('slotPunches', () => {
  it('fills chronologically', () => {
    expect(slotPunches([480, 1020], 'chronological').slots).toEqual([480, 1020, null, null]);
  });

  it('splits at break: two punches become arrival and departure', () => {
    expect(slotPunches([480, 1020], 'split_at_break', 750).slots).toEqual([480, null, null, 1020]);
    expect(slotPunches([480, 720, 780, 1020], 'split_at_break', 750).slots).toEqual([480, 720, 780, 1020]);
    // A lone afternoon punch near the end of the day is the departure; near lunch it is the return.
    expect(slotPunches([480, 720, 1020], 'split_at_break', 750).slots).toEqual([480, 720, null, 1020]);
    expect(slotPunches([478, 1020], 'split_at_break', 750, 930).slots).toEqual([478, null, null, 1020]);
    expect(slotPunches([480, 766, 1020], 'split_at_break', 750, 930).slots).toEqual([480, null, 766, 1020]);
    expect(slotPunches([480, 720, 766], 'split_at_break', 750, 930).slots).toEqual([480, 720, 766, null]);
    expect(slotPunches([780, 1020], 'split_at_break', 750).slots).toEqual([null, null, 780, 1020]);
  });

  it('reads a punch just after the split as the morning OUT when the morning has only an IN', () => {
    expect(slotPunches([465, 720], 'split_at_break', 720).slots).toEqual([465, 720, null, null]);
    expect(slotPunches([465, 722, 1080], 'split_at_break', 720).slots).toEqual([465, 722, null, 1080]);
    expect(slotPunches([740, 1080], 'split_at_break', 720).slots).toEqual([null, null, 740, 1080]);
  });

  it('places four punches as AM in/out, PM in/out even when lunch-out is after the split', () => {
    // 07:56, 12:02, 12:46, 17:00 with a 12:00 split
    expect(slotPunches([476, 722, 766, 1020], 'split_at_break', 720)).toEqual({ slots: [476, 722, 766, 1020], extra: [] });
  });

  it('keeps a time in the column it was typed into', () => {
    const placed = placeSlots(
      [
        { id: 'in', minutes: 467, displaySlot: null },
        { id: 'pm', minutes: 811, displaySlot: 2 },
      ],
      'chronological',
      720,
    );
    expect(placed.slots).toEqual([467, null, 811, null]);
    expect(placed.ids).toEqual(['in', null, 'pm', null]);
  });

  it('reports extras rather than dropping them', () => {
    expect(slotPunches([480, 500, 520, 800, 900, 1000], 'chronological').extra).toEqual([900, 1000]);
  });
});

describe('fillMissingOuts', () => {
  const snap = { isWorkday: true, start: 420, end: 1080, breakStart: 720, breakEnd: 780 };
  it('keeps an afternoon arrival out of the morning OUT column', () => {
    // 07:47 and 12:31, with the scheduled morning OUT at 12:00.
    expect(slotPunches([467, 751], 'split_at_break', 720).slots).toEqual([467, null, 751, null]);
    // 12:02 is still the lunch-out.
    expect(slotPunches([467, 722], 'split_at_break', 720).slots).toEqual([467, 722, null, null]);
  });

  it('prints the morning OUT and afternoon OUT from that date’s schedule', () => {
    const punches = [467, null, 751, null];
    const oct12 = { isWorkday: true, breakStart: 720, end: 1020 };
    const oct5 = { isWorkday: true, breakStart: 720, end: 1080 };
    expect(fillMissingOuts(punches, oct12)).toEqual([467, 720, 751, 1020]);
    expect(fillMissingOuts(punches, oct5)).toEqual([467, 720, 751, 1080]);
    expect(fillMissingOuts([425, null, 790, null], snap)).toEqual([425, 720, 790, 1080]);
    expect(fillMissingOuts([425, null, null, 1080], snap)).toEqual([425, 720, null, 1080]);
  });
  it('leaves recorded times, days without an IN, and rest days alone', () => {
    expect(fillMissingOuts([425, 722, 778, 1085], snap)).toEqual([425, 722, 778, 1085]);
    expect(fillMissingOuts([null, null, null, null], snap)).toEqual([null, null, null, null]);
    expect(fillMissingOuts([425, null, null, null], { isWorkday: false })).toEqual([425, null, null, null]);
  });
});

describe('buildMonthlyDtr', () => {
  const template = resolveTemplate({ timeFormat: '24h' });

  it('includes every calendar date and totals only computed values', () => {
    const summaries = [
      { work_date: '2026-09-01', status: 'complete', punches: [{ minutes: 480, role: 'in' }, { minutes: 1020, role: 'out' }], worked_minutes: 480, late_minutes: 0, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: [] },
      { work_date: '2026-09-02', status: 'missing_punch', punches: [{ minutes: 490, role: 'unpaired' }, { minutes: 491, role: 'duplicate' }], worked_minutes: 0, late_minutes: 10, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: ['MISSING_PUNCH'] },
      { work_date: '2026-09-06', status: 'rest_day', punches: [], worked_minutes: 0, late_minutes: 0, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: [] },
    ];
    const dtr = buildMonthlyDtr({ year: 2026, month: 9, summaries, template });
    expect(dtr.rows).toHaveLength(30);
    expect(dtr.rows[0].slots).toEqual(['08:00', '', '', '17:00']);
    const withReturn = buildMonthlyDtr({
      year: 2026,
      month: 10,
      summaries: [{
        work_date: '2026-10-05',
        status: 'missing_punch',
        punches: [{ minutes: 467, role: 'in' }, { minutes: 751, role: 'in' }],
        worked_minutes: 0,
        late_minutes: 0,
        undertime_minutes: 0,
        overtime_minutes: 0,
        policy_id: 'p',
        flags: [],
        schedule_snapshot: { isWorkday: true, breakStart: 720, breakEnd: 780, end: 1080 },
      }],
      template,
    });
    expect(withReturn.rows[4].slots).toEqual(['07:47', '', '12:31', '']);
    expect(withReturn.rows[4].printSlots).toEqual(['07:47', '12:00', '12:31', '18:00']);
    expect(dtr.rows[1].slots[0]).toBe('08:10');
    expect(dtr.rows[1].remarks).toContain('Missing Punch');
    expect(dtr.rows[5].statusLabel).toBe('Rest Day');
    expect(dtr.rows[10].status).toBe('not_computed');
    expect(dtr.totals).toMatchObject({ worked: 480, late: 10, lateCount: 1 });
    expect(dtr.unresolved).toBe(1);
    expect(dtr.notComputed).toBe(27);
    expect(dtr.policyMissing).toBe(false);
  });
});

describe('half-day remark rules', () => {
  it('finds the empty half only when the other half has times', () => {
    expect(emptyHalf(['07:45', '12:00', '', ''])).toBe('pm');
    expect(emptyHalf(['', '', '13:00', '18:00'])).toBe('am');
    expect(emptyHalf(['07:45', '', '', '18:00'])).toBeNull();
    expect(emptyHalf(['', '', '', ''])).toBeNull();
  });
  it('keeps full-day remarks only on days without times and Half day only with one empty half', () => {
    expect(remarkFits('sl', ['', '', '', ''])).toBe(true);
    expect(remarkFits('sl', ['07:45', '', '', ''])).toBe(false);
    expect(remarkFits('half_day', ['07:45', '12:00', '', ''])).toBe(true);
    expect(remarkFits('half_day', ['', '', '', ''])).toBe(false);
    expect(remarkFits('', ['07:45', '', '', ''])).toBe(true);
  });
});
