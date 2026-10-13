export const HOLIDAY_TYPES = {
  regular: 'Regular holiday',
  special_non_working: 'Special non-working day',
  special_working: 'Special working day',
  company: 'Company holiday',
};

/** Calendar cell chip, list accent and badge tone per holiday type. */
export const HOLIDAY_STYLES = {
  regular: { chip: 'bg-red-50 text-red-800 ring-red-200', dot: 'bg-red-500', tone: 'red' },
  special_non_working: { chip: 'bg-amber-50 text-amber-900 ring-amber-200', dot: 'bg-amber-500', tone: 'amber' },
  special_working: { chip: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400', tone: 'gray' },
  company: { chip: 'bg-violet-50 text-violet-800 ring-violet-200', dot: 'bg-violet-500', tone: 'purple' },
};
