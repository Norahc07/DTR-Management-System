import { z } from 'zod';

// Baseline rules. None of these values is a legal or payroll standard; each
// must be confirmed by the organization before a policy is approved.
export const DEFAULT_POLICY_RULES = Object.freeze({
  graceLateMinutes: 0,
  undertimeGraceMinutes: 0,
  pairingMode: 'sequential',
  enforceBreakWindow: true,
  duplicateWindowMinutes: 2,
  maxPunchesPerDay: 4,
  countEarlyArrivalAsWork: false,
  lateComputedFrom: 'schedule_start',
  rounding: { increment: 1, inMode: 'none', outMode: 'none' },
  overtime: { enabled: false, minimumMinutes: 30, requiresApproval: true },
  overnight: { earlyWindowMinutes: 240, lateWindowMinutes: 360 },
});

const roundingMode = z.enum(['none', 'nearest', 'up', 'down']);

export const policyRulesSchema = z.object({
  graceLateMinutes: z.number().int().min(0).max(240),
  undertimeGraceMinutes: z.number().int().min(0).max(240),
  pairingMode: z.enum(['sequential', 'first_last']),
  enforceBreakWindow: z.boolean(),
  duplicateWindowMinutes: z.number().int().min(0).max(30),
  maxPunchesPerDay: z.number().int().min(2).max(12),
  countEarlyArrivalAsWork: z.boolean(),
  lateComputedFrom: z.enum(['schedule_start', 'grace_end']),
  rounding: z.object({
    increment: z.number().int().min(1).max(60),
    inMode: roundingMode,
    outMode: roundingMode,
  }),
  overtime: z.object({
    enabled: z.boolean(),
    minimumMinutes: z.number().int().min(0).max(600),
    requiresApproval: z.boolean(),
  }),
  overnight: z.object({
    earlyWindowMinutes: z.number().int().min(0).max(720),
    lateWindowMinutes: z.number().int().min(0).max(720),
  }),
});

/** Deep-merges stored (possibly partial) rules over defaults and validates. */
export function resolvePolicyRules(rules) {
  const r = rules || {};
  const merged = {
    ...DEFAULT_POLICY_RULES,
    ...r,
    rounding: { ...DEFAULT_POLICY_RULES.rounding, ...(r.rounding || {}) },
    overtime: { ...DEFAULT_POLICY_RULES.overtime, ...(r.overtime || {}) },
    overnight: { ...DEFAULT_POLICY_RULES.overnight, ...(r.overnight || {}) },
  };
  return policyRulesSchema.parse(merged);
}

/** Picks the approved policy in effect on a date (latest effective_from <= date). */
export function policyForDate(policies, date) {
  let best = null;
  for (const p of policies) {
    if (p.status !== 'approved' || p.effective_from > date) continue;
    if (!best || p.effective_from > best.effective_from) best = p;
  }
  return best;
}

export function roundMinutes(min, increment, mode) {
  if (mode === 'none' || increment <= 1) return min;
  if (mode === 'up') return Math.ceil(min / increment) * increment;
  if (mode === 'down') return Math.floor(min / increment) * increment;
  return Math.round(min / increment) * increment;
}
