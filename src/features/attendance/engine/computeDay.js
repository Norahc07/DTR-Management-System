// Daily attendance computation. Pure function: same inputs -> same outputs.
// Missing punches are flagged, never invented. Zero punches never means
// "absent" automatically.
import { roundMinutes } from './policy';
import { formatDuration, minutesToClock } from '@/lib/time';

export const STATUS = Object.freeze({
  COMPLETE: 'complete',
  MISSING: 'missing_punch',
  REST: 'rest_day',
  LEAVE: 'leave',
  HOLIDAY: 'holiday',
  NO_PUNCHES: 'no_punches',
  NO_DATA: 'no_data',
  REVIEW: 'needs_review',
  CORRECTED: 'approved_correction',
});

export const STATUS_LABELS = {
  complete: 'Complete',
  missing_punch: 'Missing Punch',
  rest_day: 'Rest Day',
  leave: 'Leave',
  holiday: 'Holiday',
  no_punches: 'No Recorded Punches',
  no_data: 'No Data Imported',
  needs_review: 'Needs Review',
  approved_correction: 'Approved Correction',
};

export const FLAG_LABELS = {
  MISSING_PUNCH: 'Missing punch (odd number of punches)',
  DUPLICATE_PUNCH: 'Duplicate punch within the duplicate window (ignored for pairing)',
  EXTRA_PUNCHES: 'More punches than the policy expects',
  NO_SCHEDULE: 'No schedule assigned for this date',
  WORKED_ON_REST_DAY: 'Punches recorded on a rest day',
  WORKED_ON_HOLIDAY: 'Punches recorded on a holiday',
  PUNCHES_ON_LEAVE: 'Punches recorded on an approved leave day',
  SPECIAL_WORKING_HOLIDAY: 'Special working holiday',
  VOIDED_PUNCH: 'One or more punches voided by approved correction',
  CORRECTION_PUNCH: 'Includes a punch added by approved correction',
  OVERTIME_PENDING_APPROVAL: 'Overtime requires approval',
  POLICY_NOT_APPROVED: 'Computed with baseline rules; no approved policy in effect',
  UNUSED_PUNCHES: 'Middle punches not used by first/last pairing',
};

const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/**
 * @param {object} input
 * @param {string} input.date work date 'yyyy-MM-dd'
 * @param {Array<{id?:string, minutes:number, source?:string, voided?:boolean}>} input.punches minutes relative to the work date midnight
 * @param {object|null} input.schedule resolved schedule day (see resolveScheduleDay) or null when unassigned
 * @param {object} input.rules resolved policy rules
 * @param {{name:string, holiday_type:string}|null} [input.holiday]
 * @param {{leave_type:string}|null} [input.leave]
 * @param {boolean} [input.covered] whether attendance data was imported for this date
 * @param {boolean} [input.policyApproved]
 */
export function computeDay({ date, punches = [], schedule, rules, holiday = null, leave = null, covered = true, policyApproved = true }) {
  const flags = new Set();
  const breakdown = [];
  if (!policyApproved) flags.add('POLICY_NOT_APPROVED');

  const voided = punches.filter((p) => p.voided);
  if (voided.length) flags.add('VOIDED_PUNCH');
  const active = punches
    .filter((p) => !p.voided)
    .map((p) => ({ ...p }))
    .sort((a, b) => a.minutes - b.minutes);
  if (active.some((p) => p.source === 'correction')) flags.add('CORRECTION_PUNCH');

  const kept = [];
  const out = [];
  for (const p of active) {
    const prev = kept[kept.length - 1];
    if (prev && p.minutes - prev.minutes < rules.duplicateWindowMinutes) {
      flags.add('DUPLICATE_PUNCH');
      out.push({ ...p, role: 'duplicate' });
    } else {
      kept.push(p);
    }
  }
  for (const v of voided) out.push({ ...v, role: 'voided' });

  const isHoliday = holiday && holiday.holiday_type !== 'special_working';
  if (holiday && holiday.holiday_type === 'special_working') flags.add('SPECIAL_WORKING_HOLIDAY');
  const dayType = isHoliday ? 'holiday' : leave ? 'leave' : !schedule ? 'unscheduled' : schedule.isWorkday ? 'work' : 'rest';
  if (dayType === 'unscheduled') flags.add('NO_SCHEDULE');

  const result = (status, values = {}) => ({
    date,
    status,
    flags: [...flags],
    punches: [...kept.map((p) => ({ ...p })), ...out].sort((a, b) => a.minutes - b.minutes).map(stripPunch),
    pairs: values.pairs ?? [],
    workedMinutes: values.worked ?? 0,
    lateMinutes: values.late ?? 0,
    undertimeMinutes: values.undertime ?? 0,
    overtimeMinutes: values.overtime ?? 0,
    breakDeductedMinutes: values.breakDeducted ?? 0,
    breakdown,
  });

  if (!kept.length) {
    if (dayType === 'holiday') {
      breakdown.push({ label: `Holiday: ${holiday.name}` });
      return result(STATUS.HOLIDAY);
    }
    if (dayType === 'leave') {
      breakdown.push({ label: `Leave: ${leave.leave_type}` });
      return result(STATUS.LEAVE);
    }
    if (dayType === 'rest') {
      breakdown.push({ label: 'Rest day per schedule' });
      return result(STATUS.REST);
    }
    breakdown.push({ label: covered ? 'No punches recorded in imported data' : 'No attendance data imported for this date' });
    return result(covered ? STATUS.NO_PUNCHES : STATUS.NO_DATA);
  }

  // Pairing and rounding
  const { increment, inMode, outMode } = rules.rounding;
  const pairs = [];
  let unpaired = null;
  if (rules.pairingMode === 'first_last') {
    kept.forEach((p, i) => {
      if (i === 0) p.role = 'in';
      else if (i === kept.length - 1) p.role = 'out';
      else p.role = 'unused';
    });
    if (kept.length > 2) flags.add('UNUSED_PUNCHES');
    if (kept.length >= 2) pairs.push([kept[0], kept[kept.length - 1]]);
    else unpaired = kept[0];
  } else {
    for (let i = 0; i < kept.length; i += 2) {
      if (kept[i + 1]) {
        kept[i].role = 'in';
        kept[i + 1].role = 'out';
        pairs.push([kept[i], kept[i + 1]]);
      } else {
        unpaired = kept[i];
      }
    }
  }
  if (unpaired) {
    unpaired.role = 'unpaired';
    flags.add('MISSING_PUNCH');
  }
  if (kept.length > rules.maxPunchesPerDay) flags.add('EXTRA_PUNCHES');

  for (const p of kept) {
    p.rounded = p.role === 'in' || p.role === 'unpaired'
      ? roundMinutes(p.minutes, increment, inMode)
      : p.role === 'out'
        ? roundMinutes(p.minutes, increment, outMode)
        : p.minutes;
  }
  const spans = pairs.map(([a, b]) => ({ in: a.rounded, out: Math.max(a.rounded, b.rounded) }));
  const missing = Boolean(unpaired);
  const firstIn = kept[0].rounded;
  const totalSpan = spans.reduce((n, s) => n + (s.out - s.in), 0);
  const pairsOut = spans.map((s) => ({ in: s.in, out: s.out }));

  // Unpaid break deduction: by window overlap, else by fixed minutes less natural gaps.
  const breakDeduction = (windowStart = -Infinity, windowEnd = Infinity) => {
    if (!schedule?.isWorkday || schedule.breakPaid) return 0;
    if (schedule.breakStart != null && schedule.breakEnd != null) {
      return spans.reduce((n, s) => n + overlap(s.in, s.out, schedule.breakStart, schedule.breakEnd), 0);
    }
    if (schedule.breakMinutes > 0) {
      let gaps = 0;
      for (let i = 1; i < spans.length; i++) gaps += overlap(spans[i - 1].out, spans[i].in, windowStart, windowEnd);
      const inside = spans.reduce((n, s) => n + overlap(s.in, s.out, windowStart, windowEnd), 0);
      return inside > schedule.breakMinutes ? Math.max(0, schedule.breakMinutes - gaps) : 0;
    }
    return 0;
  };

  if (dayType !== 'work') {
    const deducted = dayType === 'unscheduled' ? 0 : breakDeduction();
    const worked = Math.max(0, totalSpan - deducted);
    if (dayType === 'rest') flags.add('WORKED_ON_REST_DAY');
    if (dayType === 'holiday') flags.add('WORKED_ON_HOLIDAY');
    if (dayType === 'leave') flags.add('PUNCHES_ON_LEAVE');
    breakdown.push({ label: 'Time between paired punches', minutes: totalSpan });
    if (deducted) breakdown.push({ label: 'Unpaid break deducted', minutes: -deducted });
    breakdown.push({ label: 'Worked (no regular schedule applies; overtime treatment requires organizational rules)', minutes: worked });
    const status = missing
      ? STATUS.MISSING
      : dayType === 'leave' || dayType === 'unscheduled' || flags.has('EXTRA_PUNCHES')
        ? STATUS.REVIEW
        : correctedStatus(flags);
    return result(status, { pairs: pairsOut, worked, breakDeducted: deducted });
  }

  const g = rules.graceLateMinutes;
  let late = 0;
  let lateShortfall = 0;
  const lateAgainst = (actual, expected, label) => {
    if (actual <= expected) return;
    lateShortfall += actual - expected;
    if (actual > expected + g) {
      const mins = rules.lateComputedFrom === 'grace_end' ? actual - expected - g : actual - expected;
      late += mins;
      breakdown.push({ label: `${label}: arrived ${minutesToClock(actual)} vs ${minutesToClock(expected)} (grace ${g} min)`, minutes: mins });
    } else {
      breakdown.push({ label: `${label}: within ${g}-minute grace period`, minutes: 0 });
    }
  };

  const fixed = schedule.type !== 'flexible' && schedule.start != null && schedule.end != null;
  if (fixed) {
    const S = schedule.start;
    const E = schedule.end;
    const inside = spans.reduce((n, s) => n + overlap(s.in, s.out, S, E), 0);
    const early = spans.reduce((n, s) => n + overlap(s.in, s.out, -Infinity, S), 0);
    const after = spans.reduce((n, s) => n + overlap(s.in, s.out, E, Infinity), 0);
    const deducted = breakDeduction(S, E);
    const regular = Math.max(0, inside - deducted);
    const worked = regular + (rules.countEarlyArrivalAsWork ? early : 0);
    breakdown.push({ label: `Scheduled ${minutesToClock(S)}-${minutesToClock(E)}`, minutes: E - S });
    breakdown.push({ label: 'Paired time within schedule', minutes: inside });
    if (deducted) breakdown.push({ label: 'Unpaid break deducted', minutes: -deducted });
    if (early) breakdown.push({ label: rules.countEarlyArrivalAsWork ? 'Early arrival counted' : 'Early arrival not counted', minutes: rules.countEarlyArrivalAsWork ? early : 0 });

    const { amIn, pmIn } = arrivals(kept.map((p) => p.rounded), schedule);
    if (amIn != null) lateAgainst(amIn, S, 'Late morning IN');
    if (rules.enforceBreakWindow && pmIn != null) lateAgainst(pmIn, schedule.breakEnd, 'Late afternoon IN');

    let undertime = 0;
    if (!missing) {
      const required = E - S - (schedule.breakPaid ? 0 : breakMinutesFor(schedule));
      const shortfall = Math.max(0, required - regular - lateShortfall);
      undertime = shortfall > rules.undertimeGraceMinutes ? shortfall : 0;
      breakdown.push({ label: `Required regular minutes ${formatDuration(required)}; undertime`, minutes: undertime });
    } else {
      breakdown.push({ label: 'Undertime not computed: missing punch must be resolved' });
    }

    let overtime = 0;
    if (after > 0) {
      if (rules.overtime.enabled && !missing && after >= rules.overtime.minimumMinutes) {
        overtime = after;
        if (rules.overtime.requiresApproval) flags.add('OVERTIME_PENDING_APPROVAL');
        breakdown.push({ label: `Overtime after ${minutesToClock(E)}${rules.overtime.requiresApproval ? ' (requires approval)' : ''}`, minutes: overtime });
      } else {
        breakdown.push({ label: 'Time after schedule end not counted as overtime', minutes: 0 });
      }
    }
    const status = missing ? STATUS.MISSING : flags.has('EXTRA_PUNCHES') ? STATUS.REVIEW : correctedStatus(flags);
    return result(status, { pairs: pairsOut, worked, late, undertime, overtime, breakDeducted: deducted });
  }

  // Flexible schedule: required minutes, optional core start.
  const deducted = breakDeduction();
  const worked = Math.max(0, totalSpan - deducted);
  const required = schedule.requiredMinutes ?? 0;
  breakdown.push({ label: 'Flexible schedule: time between paired punches', minutes: totalSpan });
  if (deducted) breakdown.push({ label: 'Unpaid break deducted', minutes: -deducted });
  if (schedule.coreStart != null) lateAgainst(firstIn, schedule.coreStart, 'Late for core hours');
  let undertime = 0;
  let overtime = 0;
  if (!missing) {
    const shortfall = Math.max(0, required - worked);
    undertime = shortfall > rules.undertimeGraceMinutes ? shortfall : 0;
    breakdown.push({ label: `Required ${formatDuration(required)}; undertime`, minutes: undertime });
    const extra = worked - required;
    if (rules.overtime.enabled && extra >= rules.overtime.minimumMinutes && extra > 0) {
      overtime = extra;
      if (rules.overtime.requiresApproval) flags.add('OVERTIME_PENDING_APPROVAL');
      breakdown.push({ label: 'Overtime beyond required minutes', minutes: overtime });
    }
  } else {
    breakdown.push({ label: 'Undertime not computed: missing punch must be resolved' });
  }
  const status = missing ? STATUS.MISSING : flags.has('EXTRA_PUNCHES') ? STATUS.REVIEW : correctedStatus(flags);
  return result(status, { pairs: pairsOut, worked, late, undertime, overtime, breakDeducted: deducted });
}

/**
 * Morning IN and afternoon IN, placed the same way as the DTR slots: four
 * punches are AM IN / AM OUT / PM IN / PM OUT; otherwise punches before the
 * middle of the break are morning, and a lone afternoon punch is an IN only
 * before the middle of the afternoon (a later one is the afternoon OUT).
 */
export function arrivals(minutes, schedule) {
  const sorted = [...minutes].sort((a, b) => a - b);
  if (schedule.breakStart == null || schedule.breakEnd == null) return { amIn: sorted[0] ?? null, pmIn: null };
  if (sorted.length === 4) return { amIn: sorted[0], pmIn: sorted[2] };
  const split = Math.round((schedule.breakStart + schedule.breakEnd) / 2);
  const pmOutFrom = schedule.end > schedule.breakEnd ? Math.round((schedule.breakEnd + schedule.end) / 2) : split + 180;
  const morning = sorted.filter((m) => m < split);
  const afternoon = sorted.filter((m) => m >= split);
  const pmIn = afternoon.length >= 2 || (afternoon.length === 1 && afternoon[0] < pmOutFrom) ? afternoon[0] : null;
  return { amIn: morning[0] ?? null, pmIn };
}

function breakMinutesFor(schedule) {
  if (schedule.breakStart != null && schedule.breakEnd != null) return schedule.breakEnd - schedule.breakStart;
  return schedule.breakMinutes || 0;
}

function correctedStatus(flags) {
  return flags.has('CORRECTION_PUNCH') || flags.has('VOIDED_PUNCH') ? STATUS.CORRECTED : STATUS.COMPLETE;
}

function stripPunch(p) {
  return {
    id: p.id ?? null,
    minutes: p.minutes,
    rounded: p.rounded ?? p.minutes,
    role: p.role ?? 'unused',
    source: p.source ?? 'import',
  };
}
