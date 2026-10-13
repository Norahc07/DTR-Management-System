import { z } from 'zod';

export const EMPLOYMENT_STATUSES = [
  ['regular', 'Regular'],
  ['probationary', 'Probationary'],
  ['contractual', 'Contractual'],
  ['casual', 'Casual'],
  ['job_order', 'Job Order'],
  ['resigned', 'Resigned'],
  ['terminated', 'Terminated'],
  ['retired', 'Retired'],
  ['other', 'Other'],
];

export const DTR_FORMATS = [
  ['standard', 'Standard (count late / undertime)'],
  ['no_undertime', 'No undertime (remarks only; rest days show the weekday)'],
];

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, `Maximum ${max} characters`)
    .optional()
    .transform((v) => (v ? v : null));

export const employeeSchema = z.object({
  biometric_id: z
    .string()
    .trim()
    .min(1, 'Biometric ID is required')
    .max(32, 'Maximum 32 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dash or underscore only (leading zeros are kept)'),
  employee_no: optionalText(40),
  nickname: optionalText(50),
  last_name: z.string().trim().min(1, 'Name is required').max(100),
  first_name: optionalText(100),
  middle_name: optionalText(100),
  suffix: optionalText(20),
  department_id: z
    .string()
    .optional()
    .transform((v) => (v ? v : null)),
  position: optionalText(150),
  employment_status: z.enum(EMPLOYMENT_STATUSES.map(([v]) => v)),
  verifier_name: optionalText(120),
  verifier_title: optionalText(120),
  dtr_format: z.enum(DTR_FORMATS.map(([v]) => v)).optional().transform((v) => v || 'standard'),
  date_hired: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date')
    .transform((v) => (v ? v : null)),
});
