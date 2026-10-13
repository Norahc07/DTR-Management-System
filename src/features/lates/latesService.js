import { fetchAll, requireClient, unwrap } from '@/lib/supabase';
import { countDtrPeriods } from './groupLates';

const yearBounds = (year) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/** The three dashboard figures, counted under the caller's RLS scope. */
export async function loadDashboardCounts(year) {
  const sb = requireClient();
  const { from, to } = yearBounds(year);
  const [staff, lates, attended] = await Promise.all([
    sb.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true),
    sb.from('daily_attendance').select('id', { count: 'exact', head: true }).gte('work_date', from).lte('work_date', to).gt('late_minutes', 0),
    fetchAll(() =>
      sb.from('daily_attendance').select('employee_id, work_date').gte('work_date', from).lte('work_date', to).in('status', ATTENDED_STATUSES).order('employee_id').order('work_date'),
    ),
  ]);
  const count = (res) => {
    unwrap(res);
    return res.count ?? 0;
  };
  return { staff: count(staff), lates: count(lates), dtrs: countDtrPeriods(attended) };
}

const ATTENDED_STATUSES = ['complete', 'missing_punch', 'needs_review', 'approved_correction'];

export async function loadLateDays({ year, month }) {
  const sb = requireClient();
  let { from, to } = yearBounds(year);
  if (month) {
    const mm = String(month).padStart(2, '0');
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    from = `${year}-${mm}-01`;
    to = `${year}-${mm}-${last}`;
  }
  return fetchAll(() =>
    sb
      .from('daily_attendance')
      .select('employee_id, work_date, late_minutes, employees!inner(full_name, biometric_id)')
      .gte('work_date', from)
      .lte('work_date', to)
      .gt('late_minutes', 0)
      .order('work_date')
      .order('employee_id'),
  );
}
