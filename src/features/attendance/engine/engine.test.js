import { describe, it, expect } from 'vitest';
import { computeDay, STATUS } from './computeDay';
import { DEFAULT_POLICY_RULES, policyForDate, resolvePolicyRules, roundMinutes } from './policy';
import { applyRestDays, resolveScheduleDay, scheduleForDate } from './schedule';
import { assignPunchesToDates } from './assignPunches';
import { computeEmployeeRange, coverageFromBatches } from './computeRange';

const rules = (over = {}) => resolvePolicyRules({ ...DEFAULT_POLICY_RULES, ...over });
const t = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const punches = (...times) => times.map((x, i) => ({ id: `p${i}`, minutes: typeof x === 'number' ? x : t(x), source: 'import' }));

const day8to5 = resolveScheduleDay({
  is_workday: true,
  start_time: '08:00',
  end_time: '17:00',
  break_start: '12:00',
  break_end: '13:00',
  break_minutes: 60,
  break_paid: false,
});

describe('computeDay - fixed schedule', () => {
  it('computes a complete 4-punch day', () => {
    const r = computeDay({ date: '2026-09-01', punches: punches('08:00', '12:00', '13:00', '17:00'), schedule: day8to5, rules: rules() });
    expect(r.status).toBe(STATUS.COMPLETE);
    expect(r).toMatchObject({ workedMinutes: 480, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0, breakDeductedMinutes: 0 });
  });

  it('deducts the unpaid break window when only in/out are punched', () => {
    const r = computeDay({ date: '2026-09-01', punches: punches('08:00', '17:00'), schedule: day8to5, rules: rules() });
    expect(r.workedMinutes).toBe(480);
    expect(r.breakDeductedMinutes).toBe(60);
    expect(r.undertimeMinutes).toBe(0);
  });

  it('does not deduct a paid break', () => {
    const paid = { ...day8to5, breakPaid: true };
    const r = computeDay({ date: '2026-09-01', punches: punches('08:00', '17:00'), schedule: paid, rules: rules() });
    expect(r.workedMinutes).toBe(540);
  });

  it('flags late arrival respecting grace periods', () => {
    const inGrace = computeDay({ date: 'd', punches: punches('08:04', '17:00'), schedule: day8to5, rules: rules({ graceLateMinutes: 5 }) });
    expect(inGrace.lateMinutes).toBe(0);
    const late = computeDay({ date: 'd', punches: punches('08:10', '17:00'), schedule: day8to5, rules: rules({ graceLateMinutes: 5 }) });
    expect(late.lateMinutes).toBe(10);
    const fromGrace = computeDay({ date: 'd', punches: punches('08:10', '17:00'), schedule: day8to5, rules: rules({ graceLateMinutes: 5, lateComputedFrom: 'grace_end' }) });
    expect(fromGrace.lateMinutes).toBe(5);
    expect(late.undertimeMinutes).toBe(0);
  });

  it('counts late return from break', () => {
    const r = computeDay({ date: 'd', punches: punches('08:00', '12:00', '13:20', '17:00'), schedule: day8to5, rules: rules() });
    expect(r.lateMinutes).toBe(20);
    expect(r.undertimeMinutes).toBe(0);
  });

  it('applies the office hours: late from 7:01 AM and from 1:01 PM', () => {
    const office = resolveScheduleDay({ is_workday: true, start_time: '07:00', end_time: '18:00', break_start: '12:00', break_end: '13:00', break_minutes: 60, break_paid: false });
    const onTime = computeDay({ date: 'd', punches: punches('07:00', '12:00', '13:00', '18:00'), schedule: office, rules: rules() });
    expect(onTime).toMatchObject({ status: STATUS.COMPLETE, lateMinutes: 0, undertimeMinutes: 0, workedMinutes: 600 });
    expect(computeDay({ date: 'd', punches: punches('07:01', '12:00', '13:00', '18:00'), schedule: office, rules: rules() }).lateMinutes).toBe(1);
    expect(computeDay({ date: 'd', punches: punches('07:00', '12:00', '13:01', '18:00'), schedule: office, rules: rules() }).lateMinutes).toBe(1);
    const both = computeDay({ date: 'd', punches: punches('07:15', '12:00', '13:10', '18:00'), schedule: office, rules: rules() });
    expect(both.lateMinutes).toBe(25);
  });

  it('computes undertime for early departure and half days', () => {
    const early = computeDay({ date: 'd', punches: punches('08:00', '16:30'), schedule: day8to5, rules: rules() });
    expect(early.undertimeMinutes).toBe(30);
    const half = computeDay({ date: 'd', punches: punches('08:00', '12:00'), schedule: day8to5, rules: rules() });
    expect(half.undertimeMinutes).toBe(240);
    expect(half.workedMinutes).toBe(240);
  });

  it('flags missing punches without inventing values', () => {
    const r = computeDay({ date: 'd', punches: punches('08:00', '12:00', '13:00'), schedule: day8to5, rules: rules() });
    expect(r.status).toBe(STATUS.MISSING);
    expect(r.flags).toContain('MISSING_PUNCH');
    expect(r.workedMinutes).toBe(240);
    expect(r.undertimeMinutes).toBe(0);
    expect(r.punches.find((p) => p.role === 'unpaired').minutes).toBe(t('13:00'));
  });

  it('single punch is a missing punch, not a full day', () => {
    const r = computeDay({ date: 'd', punches: punches('08:00'), schedule: day8to5, rules: rules() });
    expect(r.status).toBe(STATUS.MISSING);
    expect(r.workedMinutes).toBe(0);
  });

  it('ignores duplicates within the window but flags them', () => {
    const r = computeDay({ date: 'd', punches: punches('08:00', '08:01', '17:00'), schedule: day8to5, rules: rules({ duplicateWindowMinutes: 2 }) });
    expect(r.status).toBe(STATUS.COMPLETE);
    expect(r.flags).toContain('DUPLICATE_PUNCH');
    expect(r.punches.filter((p) => p.role === 'duplicate')).toHaveLength(1);
  });

  it('sorts out-of-order input before pairing', () => {
    const r = computeDay({ date: 'd', punches: punches('17:00', '08:00'), schedule: day8to5, rules: rules() });
    expect(r.workedMinutes).toBe(480);
  });

  it('sends extra punches to review', () => {
    const r = computeDay({ date: 'd', punches: punches('08:00', '10:00', '10:30', '12:00', '13:00', '17:00'), schedule: day8to5, rules: rules() });
    expect(r.status).toBe(STATUS.REVIEW);
    expect(r.flags).toContain('EXTRA_PUNCHES');
  });

  it('supports first/last pairing', () => {
    const r = computeDay({ date: 'd', punches: punches('08:00', '12:00', '13:00', '17:00'), schedule: day8to5, rules: rules({ pairingMode: 'first_last' }) });
    expect(r.workedMinutes).toBe(480);
    expect(r.flags).toContain('UNUSED_PUNCHES');
  });

  it('counts overtime only when enabled and above minimum', () => {
    const p = punches('08:00', '18:00');
    expect(computeDay({ date: 'd', punches: p, schedule: day8to5, rules: rules() }).overtimeMinutes).toBe(0);
    const on = computeDay({ date: 'd', punches: p, schedule: day8to5, rules: rules({ overtime: { enabled: true, minimumMinutes: 30, requiresApproval: true } }) });
    expect(on.overtimeMinutes).toBe(60);
    expect(on.flags).toContain('OVERTIME_PENDING_APPROVAL');
    const short = computeDay({ date: 'd', punches: punches('08:00', '17:20'), schedule: day8to5, rules: rules({ overtime: { enabled: true, minimumMinutes: 30, requiresApproval: false } }) });
    expect(short.overtimeMinutes).toBe(0);
  });

  it('does not count early arrival unless configured', () => {
    const p = punches('07:00', '17:00');
    expect(computeDay({ date: 'd', punches: p, schedule: day8to5, rules: rules() }).workedMinutes).toBe(480);
    expect(computeDay({ date: 'd', punches: p, schedule: day8to5, rules: rules({ countEarlyArrivalAsWork: true }) }).workedMinutes).toBe(540);
  });

  it('applies rounding rules per direction', () => {
    expect(roundMinutes(487, 15, 'up')).toBe(495);
    expect(roundMinutes(487, 15, 'down')).toBe(480);
    expect(roundMinutes(487, 15, 'nearest')).toBe(480);
    expect(roundMinutes(487, 15, 'none')).toBe(487);
    const r = computeDay({ date: 'd', punches: punches('08:07', '16:58'), schedule: day8to5, rules: rules({ rounding: { increment: 15, inMode: 'up', outMode: 'down' } }) });
    expect(r.lateMinutes).toBe(15);
    expect(r.punches.find((p) => p.role === 'out').rounded).toBe(t('16:45'));
  });

  it('marks corrected days distinctly', () => {
    const p = [...punches('08:00'), { id: 'c1', minutes: t('17:00'), source: 'correction' }];
    expect(computeDay({ date: 'd', punches: p, schedule: day8to5, rules: rules() }).status).toBe(STATUS.CORRECTED);
    const v = [...punches('08:00', '17:00'), { id: 'v', minutes: t('08:30'), source: 'import', voided: true }];
    const rv = computeDay({ date: 'd', punches: v, schedule: day8to5, rules: rules() });
    expect(rv.status).toBe(STATUS.CORRECTED);
    expect(rv.workedMinutes).toBe(480);
  });
});

describe('lateness by DTR slot (office hours 7:00-12:00 / 1:00-6:00 PM)', () => {
  const office = resolveScheduleDay({ is_workday: true, start_time: '07:00', end_time: '18:00', break_start: '12:00', break_end: '13:00', break_minutes: 60 });
  const r = rules({ graceLateMinutes: 0, enforceBreakWindow: true, pairingMode: 'sequential' });
  const late = (...times) => computeDay({ date: '2026-10-05', punches: punches(...times), schedule: office, rules: r }).lateMinutes;

  it('counts the morning IN after 7:00 and the afternoon IN after 1:00 PM', () => {
    expect(late('07:00', '12:00', '13:00', '18:00')).toBe(0);
    expect(late('07:01', '12:00', '13:01', '18:00')).toBe(2);
  });

  it('counts a late afternoon IN even when an OUT is missing', () => {
    expect(late('07:00', '12:00', '13:20')).toBe(20); // no afternoon OUT
    expect(late('07:10', '13:05')).toBe(15); // no OUTs at all
  });

  it('a lone afternoon punch late in the day is the OUT, not a late IN', () => {
    expect(late('07:00', '18:00')).toBe(0);
    expect(late('13:30', '18:00')).toBe(30); // half day: only the afternoon IN is late
  });
});

describe('computeDay - non-work days and no punches', () => {
  it('distinguishes rest day, holiday, leave, no punches, and no data', () => {
    const rest = resolveScheduleDay({ is_workday: false });
    expect(computeDay({ date: 'd', punches: [], schedule: rest, rules: rules() }).status).toBe(STATUS.REST);
    expect(computeDay({ date: 'd', punches: [], schedule: day8to5, rules: rules(), holiday: { name: 'X', holiday_type: 'regular' } }).status).toBe(STATUS.HOLIDAY);
    expect(computeDay({ date: 'd', punches: [], schedule: day8to5, rules: rules(), leave: { leave_type: 'Vacation' } }).status).toBe(STATUS.LEAVE);
    expect(computeDay({ date: 'd', punches: [], schedule: day8to5, rules: rules(), covered: true }).status).toBe(STATUS.NO_PUNCHES);
    expect(computeDay({ date: 'd', punches: [], schedule: day8to5, rules: rules(), covered: false }).status).toBe(STATUS.NO_DATA);
  });

  it('treats special working holidays as normal workdays', () => {
    const r = computeDay({ date: 'd', punches: punches('08:00', '17:00'), schedule: day8to5, rules: rules(), holiday: { name: 'X', holiday_type: 'special_working' } });
    expect(r.status).toBe(STATUS.COMPLETE);
    expect(r.flags).toContain('SPECIAL_WORKING_HOLIDAY');
  });

  it('flags work on rest days and holidays without late/undertime', () => {
    const rest = resolveScheduleDay({ is_workday: false });
    const r = computeDay({ date: 'd', punches: punches('09:00', '12:00'), schedule: rest, rules: rules() });
    expect(r.flags).toContain('WORKED_ON_REST_DAY');
    expect(r.workedMinutes).toBe(180);
    expect(r.lateMinutes + r.undertimeMinutes).toBe(0);
    const h = computeDay({ date: 'd', punches: punches('08:00', '17:00'), schedule: day8to5, rules: rules(), holiday: { name: 'X', holiday_type: 'regular' } });
    expect(h.flags).toContain('WORKED_ON_HOLIDAY');
  });

  it('sends unscheduled days with punches to review', () => {
    const r = computeDay({ date: 'd', punches: punches('08:00', '17:00'), schedule: null, rules: rules() });
    expect(r.status).toBe(STATUS.REVIEW);
    expect(r.flags).toContain('NO_SCHEDULE');
  });

  it('flags unapproved policy', () => {
    const r = computeDay({ date: 'd', punches: [], schedule: day8to5, rules: rules(), policyApproved: false });
    expect(r.flags).toContain('POLICY_NOT_APPROVED');
  });
});

describe('flexible schedules', () => {
  const flex = resolveScheduleDay({ is_workday: true, required_minutes: 480, break_minutes: 60, break_paid: false, core_start: '10:00' }, 'flexible');

  it('computes required minutes, core-hour lateness, and break deduction', () => {
    const r = computeDay({ date: 'd', punches: punches('09:30', '18:30'), schedule: flex, rules: rules() });
    expect(r.workedMinutes).toBe(480);
    expect(r.lateMinutes).toBe(0);
    const late = computeDay({ date: 'd', punches: punches('10:30', '18:30'), schedule: flex, rules: rules() });
    expect(late.lateMinutes).toBe(30);
    expect(late.undertimeMinutes).toBe(60);
  });

  it('uses natural gaps between pairs toward the break', () => {
    const r = computeDay({ date: 'd', punches: punches('09:00', '12:00', '12:30', '18:00'), schedule: flex, rules: rules() });
    expect(r.breakDeductedMinutes).toBe(30);
    expect(r.workedMinutes).toBe(480);
  });
});

describe('overnight shifts', () => {
  const nightRow = { is_workday: true, start_time: '22:00', end_time: '06:00', break_start: '02:00', break_end: '03:00', break_minutes: 60, break_paid: false };
  const night = resolveScheduleDay(nightRow);

  it('resolves end and break after midnight', () => {
    expect(night).toMatchObject({ start: 1320, end: 1800, breakStart: 1560, breakEnd: 1620, overnight: true });
  });

  it('assigns next-day punches to the shift start date', () => {
    const events = [
      { id: 'a', local_date: '2026-09-01', local_time: '21:55:00', source: 'import' },
      { id: 'b', local_date: '2026-09-02', local_time: '06:05:00', source: 'import' },
      { id: 'c', local_date: '2026-09-02', local_time: '21:58:00', source: 'import' },
      { id: 'd', local_date: '2026-09-03', local_time: '05:30:00', source: 'import' },
    ];
    const map = assignPunchesToDates(events, ['2026-09-01', '2026-09-02'], () => night, DEFAULT_POLICY_RULES.overnight);
    expect(map.get('2026-09-01').map((p) => p.id)).toEqual(['a', 'b']);
    expect(map.get('2026-09-01')[1].minutes).toBe(1440 + 365);
    expect(map.get('2026-09-02').map((p) => p.id)).toEqual(['c', 'd']);
  });

  it('lets the previous day claim early punches at the start of a range', () => {
    const events = [{ id: 'x', local_date: '2026-09-01', local_time: '05:59:00', source: 'import' }];
    const map = assignPunchesToDates(events, ['2026-09-01'], () => night, DEFAULT_POLICY_RULES.overnight);
    expect(map.get('2026-09-01')).toEqual([]);
  });

  it('computes worked time across midnight', () => {
    const r = computeDay({ date: 'd', punches: [{ id: 'a', minutes: t('22:00') }, { id: 'b', minutes: 1440 + t('06:00') }], schedule: night, rules: rules() });
    expect(r).toMatchObject({ workedMinutes: 420, breakDeductedMinutes: 60, lateMinutes: 0, undertimeMinutes: 0, status: STATUS.COMPLETE });
  });
});

describe('policies and schedules lookup', () => {
  it('chooses the approved policy effective on the date', () => {
    const ps = [
      { id: 'a', status: 'approved', effective_from: '2026-01-01' },
      { id: 'b', status: 'approved', effective_from: '2026-09-15' },
      { id: 'c', status: 'draft', effective_from: '2026-09-10' },
    ];
    expect(policyForDate(ps, '2026-09-10').id).toBe('a');
    expect(policyForDate(ps, '2026-09-20').id).toBe('b');
    expect(policyForDate(ps, '2025-12-31')).toBeNull();
  });

  it('rejects invalid policy values', () => {
    expect(() => resolvePolicyRules({ graceLateMinutes: -1 })).toThrow();
    expect(() => resolvePolicyRules({ pairingMode: 'guess' })).toThrow();
  });

  it('respects schedule assignment effective dates', () => {
    const schedules = new Map([['s1', { id: 's1', name: 'S1', schedule_type: 'fixed', days: [{ weekday: 2, is_workday: true, start_time: '08:00', end_time: '17:00', break_minutes: 0 }] }]]);
    const assignments = [{ schedule_id: 's1', effective_from: '2026-09-01', effective_to: '2026-09-30' }];
    expect(scheduleForDate(assignments, schedules, '2026-09-01').day.isWorkday).toBe(true);
    expect(scheduleForDate(assignments, schedules, '2026-09-02').day.isWorkday).toBe(false);
    expect(scheduleForDate(assignments, schedules, '2026-10-06').schedule).toBeNull();
  });

  it("applies an employee's own days off over the office schedule (Mon-Thu office, Sat-Sun off for the employee)", () => {
    const work = (weekday) => ({ weekday, is_workday: true, start_time: '07:00', end_time: '18:00', break_start: '12:00', break_end: '13:00', break_minutes: 60 });
    const days = [1, 2, 3, 4].map(work).concat([5, 6, 0].map((weekday) => ({ weekday, is_workday: false })));
    const schedules = new Map([['s', { id: 's', name: 'Office', schedule_type: 'fixed', days }]]);
    const assignments = [{ schedule_id: 's', effective_from: '2026-10-01', effective_to: null }];
    const at = (date, rest) => applyRestDays(scheduleForDate(assignments, schedules, date), rest, date).day;
    expect(at('2026-10-02', undefined).isWorkday).toBe(false); // Fri, office schedule
    expect(at('2026-10-02', [0, 6])).toMatchObject({ isWorkday: true, start: 420, end: 1080 }); // Fri worked
    expect(at('2026-10-03', [0, 6]).isWorkday).toBe(false); // Sat
    expect(at('2026-10-05', [1]).isWorkday).toBe(false); // Mon chosen as day off
    expect(at('2026-10-06', [1]).isWorkday).toBe(true);
  });
});

describe('computeEmployeeRange', () => {
  it('produces one summary per date with policy, holiday, coverage, and voids applied', () => {
    const schedules = new Map([[
      's1',
      {
        id: 's1',
        name: 'Day',
        schedule_type: 'fixed',
        days: [0, 1, 2, 3, 4, 5, 6].map((wd) => ({ weekday: wd, is_workday: wd >= 1 && wd <= 5, start_time: '08:00', end_time: '17:00', break_start: '12:00', break_end: '13:00', break_minutes: 60, break_paid: false })),
      },
    ]]);
    const rows = computeEmployeeRange({
      employee: { id: 'e1' },
      dates: ['2026-09-01', '2026-09-02', '2026-09-05', '2026-09-07', '2026-10-01'],
      events: [
        { id: 'a', local_date: '2026-09-01', local_time: '08:00:00', source: 'import' },
        { id: 'b', local_date: '2026-09-01', local_time: '17:00:00', source: 'import' },
        { id: 'z', local_date: '2026-09-01', local_time: '09:00:00', source: 'import' },
      ],
      voidedIds: new Set(['z']),
      assignments: [{ schedule_id: 's1', effective_from: '2026-01-01', effective_to: null }],
      schedulesById: schedules,
      holidays: [{ holiday_date: '2026-09-07', name: 'Test Holiday', holiday_type: 'regular' }],
      leaves: [],
      policies: [{ id: 'p1', status: 'approved', effective_from: '2026-01-01', rules: { graceLateMinutes: 5 } }],
      isCovered: coverageFromBatches([{ status: 'completed', period_start: '2026-09-01', period_end: '2026-09-30' }]),
    });
    expect(rows.map((r) => r.status)).toEqual(['approved_correction', 'no_punches', 'rest_day', 'holiday', 'no_data']);
    expect(rows[0]).toMatchObject({ worked_minutes: 480, policy_id: 'p1', schedule_id: 's1' });
  });
});
