// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DtrDocument } from '@/features/dtr/DtrDocument';
import { buildMonthlyDtr, resolveTemplate } from '@/features/dtr/buildDtr';
import { periodSummary } from '@/features/dtr/form48';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { AuthContext } from '@/features/auth/authContext';
import { RequirePermission } from '@/features/auth/RequireAuth';
import { can } from '@/features/auth/permissions';

const summaries = [
  { work_date: '2026-09-01', status: 'complete', punches: [{ minutes: 480, role: 'in' }, { minutes: 1020, role: 'out' }], worked_minutes: 480, late_minutes: 0, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: [] },
  { work_date: '2026-09-02', status: 'missing_punch', punches: [{ minutes: 495, role: 'unpaired' }], worked_minutes: 0, late_minutes: 15, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: ['MISSING_PUNCH'] },
];
const employee = { full_name: 'DEVSAMPLE, Alpha', biometric_id: '0001', position: 'Clerk', departments: { name: 'DEV Admin' } };
const org = { org_name: 'Test Org', timezone: 'Asia/Manila', date_format: 'MM/dd/yyyy' };

function renderDtr({ finalization = null, template = resolveTemplate(), period = 'first', rows = summaries, remarks = [], emp = employee } = {}) {
  const dtr = buildMonthlyDtr({ year: 2026, month: 9, summaries: rows, template, remarks });
  return render(<DtrDocument org={org} employee={emp} year={2026} month={9} period={period} dtr={dtr} template={template} finalization={finalization} />);
}
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').filter((r) => r.closest('tbody'));
const cellTexts = (row) => within(row).getAllByRole('cell').map((c) => c.textContent);

describe('DTR print document (CS Form No. 48)', () => {
  it('renders the form header, 31 day rows and recorded times only, marked as draft', () => {
    renderDtr();
    expect(screen.getByText('Civil Service Form No. 48')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'DAILY TIME RECORD' })).toBeInTheDocument();
    expect(screen.getAllByText('DEVSAMPLE, ALPHA')).toHaveLength(2);
    expect(screen.getByText('SEPTEMBER 1-15, 2026')).toBeInTheDocument();
    expect(screen.getByText('7:00 - 6:00 PM')).toBeInTheDocument();
    expect(screen.getByText('MIRABUENO, CONCHITA MARTA B.')).toBeInTheDocument();
    const rows = bodyRows();
    expect(rows).toHaveLength(31);
    expect(cellTexts(rows[0])).toEqual(['1', '08:00', '', '', '17:00', '', '']);
    // Missing punch: only the one recorded time, no invented time-out; 15 min late.
    expect(cellTexts(rows[1])).toEqual(['2', '08:15', '', '', '', '', '15']);
    expect(cellTexts(rows[30])).toEqual(['31', '', '', '', '', '', '']);
    expect(screen.getByText(/draft — not finalized/i)).toBeInTheDocument();
  });

  it('readiness and totals count only the selected half', () => {
    const rows = [
      ...summaries,
      { work_date: '2026-09-20', status: 'complete', punches: [{ minutes: 480, role: 'in' }, { minutes: 1000, role: 'out' }], worked_minutes: 460, late_minutes: 0, undertime_minutes: 20, overtime_minutes: 0, policy_id: null, flags: [] },
    ];
    const dtr = buildMonthlyDtr({ year: 2026, month: 9, summaries: rows, template: resolveTemplate() });
    const first = periodSummary({ dtr, summaries: rows, year: 2026, month: 9, period: 'first' });
    expect(first.rows).toHaveLength(15);
    expect(first.unresolved).toBe(1);
    expect(first.notComputed).toBe(13);
    expect(first.policyMissing).toBe(false);
    expect(first.totals).toEqual({ worked: 480, late: 15, undertime: 0, overtime: 0 });
    const second = periodSummary({ dtr, summaries: rows, year: 2026, month: 9, period: 'second' });
    expect(second.rows.map((r) => r.day)).toEqual(Array.from({ length: 15 }, (_, i) => i + 16));
    expect(second.unresolved).toBe(0);
    expect(second.policyMissing).toBe(true);
    expect(second.totals.undertime).toBe(20);
  });

  it('Half day merges the empty half’s IN/OUT cells and keeps the other half’s times and the undertime', () => {
    const day = (d, extra) => ({ work_date: `2026-09-${d}`, punches: [], worked_minutes: 0, late_minutes: 0, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: [], ...extra });
    renderDtr({
      rows: [
        ...summaries,
        day('10', { status: 'complete', punches: [{ minutes: 465, role: 'in' }, { minutes: 720, role: 'out' }], undertime_minutes: 300 }),
        day('11', { status: 'complete', punches: [{ minutes: 780, role: 'in' }, { minutes: 1080, role: 'out' }] }),
        day('14', { status: 'complete', punches: [{ minutes: 465, role: 'in' }, { minutes: 720, role: 'out' }] }),
        day('15', { status: 'no_punches' }),
      ],
      remarks: ['10', '11', '15'].map((d) => ({ work_date: `2026-09-${d}`, remark: 'half_day' })),
    });
    const rows = bodyRows();
    expect(cellTexts(rows[9])).toEqual(['10', '07:45', '12:00', 'HALF DAY', '5', '']);
    expect(within(rows[9]).getByText('HALF DAY')).toHaveAttribute('colspan', '2');
    expect(cellTexts(rows[10])).toEqual(['11', 'HALF DAY', '13:00', '18:00', '', '']);
    expect(cellTexts(rows[13])).toEqual(['14', '07:45', '12:00', '', '', '', '']);
    expect(cellTexts(rows[14])).toEqual(['15', '', '', '', '', '', '']);
  });

  it('no-undertime staff: Half day prints in the merged Undertime cell, morning or afternoon', () => {
    const day = (d, extra) => ({ work_date: `2026-09-${d}`, punches: [], worked_minutes: 0, late_minutes: 0, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: [], ...extra });
    renderDtr({
      emp: { ...employee, biometric_id: '3', dtr_format: 'standard' },
      rows: [
        ...summaries,
        day('10', { status: 'complete', punches: [{ minutes: 465, role: 'in' }, { minutes: 720, role: 'out' }], undertime_minutes: 300 }),
        day('11', { status: 'complete', punches: [{ minutes: 780, role: 'in' }, { minutes: 1080, role: 'out' }] }),
      ],
      remarks: ['10', '11'].map((d) => ({ work_date: `2026-09-${d}`, remark: 'half_day' })),
    });
    const rows = bodyRows();
    expect(cellTexts(rows[9])).toEqual(['10', '07:45', '12:00', '', '', 'HALF DAY']);
    expect(within(rows[9]).getByText('HALF DAY')).toHaveAttribute('colspan', '2');
    expect(cellTexts(rows[10])).toEqual(['11', '', '', '13:00', '18:00', 'HALF DAY']);
  });

  it('a replacement who is not ID 2, 3 or 12 still shows undertime figures', () => {
    const day = (d, extra) => ({ work_date: `2026-09-${d}`, punches: [], worked_minutes: 0, late_minutes: 0, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: [], ...extra });
    renderDtr({
      emp: { ...employee, biometric_id: '4', dtr_format: 'no_undertime' },
      rows: [
        ...summaries,
        day('10', { status: 'complete', punches: [{ minutes: 465, role: 'in' }, { minutes: 720, role: 'out' }], undertime_minutes: 300 }),
      ],
      remarks: [{ work_date: '2026-09-10', remark: 'half_day' }],
    });
    expect(cellTexts(bodyRows()[9])).toEqual(['10', '07:45', '12:00', 'HALF DAY', '5', '']);
  });

  it('no-undertime staff: rest days show the weekday, remarks fill the merged Undertime cell, nothing is counted', () => {
    const day = (d, extra) => ({ work_date: `2026-09-${d}`, punches: [], worked_minutes: 0, late_minutes: 0, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: [], ...extra });
    renderDtr({
      emp: { ...employee, biometric_id: '3', dtr_format: 'standard' },
      rows: [
        ...summaries,
        day('05', { status: 'rest_day' }),
        day('06', { status: 'rest_day' }),
        day('07', { status: 'no_punches' }),
        day('08', { status: 'complete', punches: [{ minutes: 470, role: 'in' }, { minutes: 976, role: 'out' }], undertime_minutes: 64 }),
        day('09', { status: 'no_punches' }),
      ],
      remarks: [{ work_date: '2026-09-07', remark: 'sl' }, { work_date: '2026-09-09', remark: 'day_off' }],
    });
    const rows = bodyRows();
    expect(cellTexts(rows[4])).toEqual(['5', '', '', '', '', 'SAT']);
    expect(within(rows[4]).getByText('SAT')).toHaveAttribute('colspan', '2');
    expect(cellTexts(rows[5])).toEqual(['6', '', '', '', '', 'SUN']);
    expect(cellTexts(rows[8])).toEqual(['9', '', '', '', '', 'WED']);
    expect(cellTexts(rows[6])).toEqual(['7', '', '', '', '', 'SL']);
    expect(within(rows[6]).getByText('SL')).toHaveAttribute('colspan', '2');
    expect(cellTexts(rows[7])).toEqual(['8', '07:50', '', '', '16:16', '', '']);
    expect(cellTexts(rows[1])).toEqual(['2', '08:15', '', '', '', '', '']);
    const total = within(screen.getByRole('table')).getByText('Total').closest('tr');
    expect(cellTexts(total)).toEqual(['Total', '', '']);
  });

  it("prints the employee's own verifier when set (ID 2: Municipal Mayor)", () => {
    renderDtr({ emp: { ...employee, verifier_name: 'BAUTISTA ERWIN DWIGHT C. PASTRANA', verifier_title: 'Municipal Mayor' } });
    expect(screen.getByText('BAUTISTA ERWIN DWIGHT C. PASTRANA')).toBeInTheDocument();
    expect(screen.getByText('Municipal Mayor')).toBeInTheDocument();
    expect(screen.queryByText('MIRABUENO, CONCHITA MARTA B.')).toBeNull();
    expect(screen.queryByText('CeC Manager')).toBeNull();
  });

  it('prints edited official hours over the computed text; "For the month of" always follows the period', () => {
    const template = resolveTemplate();
    const dtr = buildMonthlyDtr({ year: 2026, month: 9, summaries, template });
    render(
      <DtrDocument org={org} employee={employee} year={2026} month={9} period="second" dtr={dtr} template={template}
        header={{ month_label: 'SEPT. 16-30, 2026', regular_days: null, regular_hours: '8:00 - 5:00 PM', rest_days: 'Sat-Sun', rest_hours: 'Rest day' }} />,
    );
    expect(screen.getByText('SEPTEMBER 16-30, 2026')).toBeInTheDocument();
    expect(screen.queryByText('SEPT. 16-30, 2026')).toBeNull();
    expect(screen.getByText('8:00 - 5:00 PM')).toBeInTheDocument();
    expect(screen.getByText('Sat-Sun')).toBeInTheDocument();
    expect(screen.getByText('Rest day')).toBeInTheDocument();
    expect(screen.getByText(template.regularDaysLabel)).toBeInTheDocument();
  });

  it('prints the official hours of the schedule in effect (Mon-Thu 7-6 from October)', () => {
    const snap = (wd) => (wd >= 1 && wd <= 4 ? { isWorkday: true, start: 420, end: 1080, breakStart: 720, breakEnd: 780 } : { isWorkday: false });
    const rows = ['01', '02', '03', '04', '05', '06', '07'].map((n) => `2026-10-${n}`).map((d) => ({
      work_date: d, status: 'no_data', punches: [], worked_minutes: 0, late_minutes: 0, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: [],
      schedule_snapshot: snap(new Date(`${d}T00:00:00Z`).getUTCDay()),
    }));
    const dtr = buildMonthlyDtr({ year: 2026, month: 10, summaries: rows, template: resolveTemplate() });
    expect(dtr.official).toEqual({ regularHours: '7:00 - 6:00 PM', regularDays: 'Mon-Thu', restDays: 'Fri-Sun' });
  });

  it('prints Absent across the undertime cell on a day with no punches', () => {
    const day = (d, extra) => ({ work_date: `2026-09-${d}`, punches: [], worked_minutes: 0, late_minutes: 0, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: [], ...extra });
    renderDtr({
      rows: [...summaries, day('03', { status: 'no_punches' })],
      remarks: [{ work_date: '2026-09-03', remark: 'absent' }],
    });
    const rows = bodyRows();
    expect(cellTexts(rows[2])).toEqual(['3', '', '', '', '', 'ABSENT']);
    expect(within(rows[2]).getByText('ABSENT')).toHaveAttribute('colspan', '2');
  });

  it('prints weekend DAYOFF across the times, leaves a weekday with no punches and no remark blank, and totals undertime', () => {
    renderDtr({
      rows: [
        ...summaries,
        { work_date: '2026-09-05', status: 'rest_day', punches: [], worked_minutes: 0, late_minutes: 0, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: [] },
        { work_date: '2026-09-07', status: 'no_punches', punches: [], worked_minutes: 0, late_minutes: 0, undertime_minutes: 0, overtime_minutes: 0, policy_id: 'p', flags: [] },
        { work_date: '2026-09-08', status: 'complete', punches: [{ minutes: 470, role: 'in' }, { minutes: 976, role: 'out' }], worked_minutes: 420, late_minutes: 0, undertime_minutes: 64, overtime_minutes: 0, policy_id: 'p', flags: [] },
      ],
    });
    const rows = bodyRows();
    expect(cellTexts(rows[4])).toEqual(['5', 'DAYOFF', '', '']);
    expect(cellTexts(rows[6])).toEqual(['7', '', '', '', '', '', '']);
    expect(cellTexts(rows[7])).toEqual(['8', '07:50', '', '', '16:16', '1', '4']);
    const total = within(screen.getByRole('table')).getByText('Total').closest('tr');
    expect(cellTexts(total)).toEqual(['Total', '1', '19']);
  });

  it('shows only the selected half of the month', () => {
    renderDtr({ period: 'second' });
    expect(screen.getByText('SEPTEMBER 16-30, 2026')).toBeInTheDocument();
    expect(cellTexts(bodyRows()[0])).toEqual(['1', '', '', '', '', '', '']);
  });

  it('shows the finalization date in the organization format', () => {
    renderDtr({ finalization: { finalized_at: '2026-10-05T02:00:00Z' } });
    expect(screen.getByText('Finalized 10/05/2026')).toBeInTheDocument();
  });

  it('uses the configured verifier and leaves undertime blank when disabled', () => {
    renderDtr({ template: resolveTemplate({ verifierName: 'Dela Cruz, Ana', verifierTitle: 'HR Officer', showComputation: false }) });
    expect(screen.getByText('DELA CRUZ, ANA')).toBeInTheDocument();
    expect(screen.getByText('HR Officer')).toBeInTheDocument();
    expect(cellTexts(bodyRows()[1])).toEqual(['2', '08:15', '', '', '', '', '']);
  });
});

describe('ConfirmDialog with required reason', () => {
  it('keeps the action disabled until a reason is entered and passes the reason', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => {});
    render(<ConfirmDialog open title="Revoke DTR" requireReason minReason={5} onClose={() => {}} onConfirm={onConfirm} confirmLabel="Revoke" />);
    const button = screen.getByRole('button', { name: 'Revoke' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/reason/i), 'abc');
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/reason/i), ' wrong month');
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onConfirm).toHaveBeenCalledWith('abc wrong month');
  });
});

describe('RequirePermission', () => {
  const withRole = (role, ui) => render(<AuthContext.Provider value={{ can: (p) => can(role, p) }}>{ui}</AuthContext.Provider>);

  it('denies employees access to admin pages', () => {
    withRole('employee', <RequirePermission permission="import.run"><p>import page</p></RequirePermission>);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('import page')).not.toBeInTheDocument();
  });

  it('allows HR admins to import but not to manage users', () => {
    withRole('hr_admin', <RequirePermission permission="import.run"><p>import page</p></RequirePermission>);
    expect(screen.getByText('import page')).toBeInTheDocument();
    expect(can('hr_admin', 'users.manage')).toBe(false);
    expect(can('supervisor', 'attendance.review')).toBe(true);
    expect(can(null, 'dashboard.view')).toBe(false);
  });
});
