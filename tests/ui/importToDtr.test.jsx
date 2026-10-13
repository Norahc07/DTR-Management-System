// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { buildMatrixLabelWorkbook, buildZkAttRecordWorkbook, workbookToBytes } from '../fixtures/syntheticWorkbooks';

const employees = [
  { id: 'e3', biometric_id: '3', last_name: 'JM', first_name: null, full_name: 'JM', is_active: true },
  { id: 'e15', biometric_id: '15', last_name: 'DEVSAMPLE', first_name: 'Bravo', full_name: 'DEVSAMPLE, Bravo', is_active: true },
];

const runImport = vi.fn();
const recomputeAttendance = vi.fn();
const applyPeriodSchedule = vi.fn();

vi.mock('@/features/schedules/scheduleService', () => ({ applyPeriodSchedule: (...a) => applyPeriodSchedule(...a) }));

vi.mock('@/features/auth/authContext', () => ({ useAuth: () => ({ settings: { max_import_file_mb: 10 } }) }));
vi.mock('@/features/employees/employeeService', () => ({ listAllEmployees: vi.fn(async () => employees) }));
vi.mock('@/features/attendance/recomputeService', () => ({ recomputeAttendance: (...a) => recomputeAttendance(...a) }));
vi.mock('@/features/import/importService', () => ({
  findBatchesByHash: vi.fn(async () => []),
  runImport: (...a) => runImport(...a),
}));

const { ImportToDtrDialog } = await import('@/features/dtr/ImportToDtrDialog');

const fileFrom = (bytes, name) => new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

describe('import from the DTR page', () => {
  beforeEach(() => {
    runImport.mockReset();
    recomputeAttendance.mockReset();
    applyPeriodSchedule.mockReset();
    applyPeriodSchedule.mockResolvedValue('s1');
    localStorage.clear();
  });

  it('imports a ZKTeco report in one step and returns the DTR period and staff', async () => {
    const user = userEvent.setup();
    runImport.mockResolvedValue({ batch: { id: 'b1' }, result: { inserted: 13, existing: 0, unmatched_ids: 0, unmatched_punches: 0 } });
    recomputeAttendance.mockResolvedValue({ saved: 60, skippedLocked: 0 });
    const onImported = vi.fn();
    render(<MemoryRouter><ImportToDtrDialog open onClose={() => {}} onImported={onImported} /></MemoryRouter>);

    await user.upload(screen.getByLabelText('Attendance file'), fileFrom(workbookToBytes(buildZkAttRecordWorkbook()), 'attlog.xlsx'));
    const button = await screen.findByRole('button', { name: /import 13 punch\(es\) & fill dtrs/i });
    await user.click(button);

    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(onImported.mock.calls[0][0]).toMatchObject({ year: 2026, month: 9, period: 'first', employeeIds: ['e3', 'e15'] });
    expect(runImport.mock.calls[0][0].config).toMatchObject({ preset: 'zkteco_att_record' });
    expect(runImport.mock.calls[0][0].period).toEqual({ start: '2026-09-01', end: '2026-09-15' });
    expect(applyPeriodSchedule).toHaveBeenCalledWith({
      employeeIds: ['e3', 'e15'], start: '2026-09-01', end: '2026-09-15', workdays: [1, 2, 3, 4, 5], amIn: '07:00', amOut: '12:00', pmIn: '13:00', pmOut: '18:00',
    });
    expect(recomputeAttendance).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: ['e3', 'e15'], from: '2026-09-01', to: '2026-09-15' }));
  });

  it('uses the chosen period, work days and office hours', async () => {
    const user = userEvent.setup();
    runImport.mockResolvedValue({ batch: { id: 'b1' }, result: { inserted: 13, existing: 0, unmatched_ids: 0, unmatched_punches: 0 } });
    recomputeAttendance.mockResolvedValue({ saved: 60, skippedLocked: 0 });
    const onImported = vi.fn();
    render(<MemoryRouter><ImportToDtrDialog open onClose={() => {}} onImported={onImported} /></MemoryRouter>);

    await user.upload(screen.getByLabelText('Attendance file'), fileFrom(workbookToBytes(buildZkAttRecordWorkbook()), 'attlog.xlsx'));
    await screen.findByRole('button', { name: /import 13 punch\(es\)/i });
    await user.selectOptions(screen.getByLabelText('Period'), 'month');
    await user.click(screen.getByLabelText('Fri'));
    await user.clear(screen.getByLabelText('Morning IN'));
    await user.type(screen.getByLabelText('Morning IN'), '08:00');
    expect(screen.getByText(/Late from 8:01 AM in the morning and 1:01 PM in the afternoon/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /import 13 punch\(es\)/i }));

    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(applyPeriodSchedule).toHaveBeenCalledWith(expect.objectContaining({ start: '2026-09-01', end: '2026-09-30', workdays: [1, 2, 3, 4], amIn: '08:00' }));
    expect(onImported.mock.calls[0][0]).toMatchObject({ month: 9, period: 'first' });
  });

  it('does not import when the office hours are out of order', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ImportToDtrDialog open onClose={() => {}} onImported={() => {}} /></MemoryRouter>);
    await user.upload(screen.getByLabelText('Attendance file'), fileFrom(workbookToBytes(buildZkAttRecordWorkbook()), 'attlog.xlsx'));
    const button = await screen.findByRole('button', { name: /import 13 punch\(es\)/i });
    await user.clear(screen.getByLabelText('Afternoon IN'));
    await user.type(screen.getByLabelText('Afternoon IN'), '11:00');
    expect(screen.getByText(/Times must be in order/)).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it('sends other layouts to the full Import page instead of guessing the columns', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ImportToDtrDialog open onClose={() => {}} onImported={() => {}} /></MemoryRouter>);
    await user.upload(screen.getByLabelText('Attendance file'), fileFrom(workbookToBytes(buildMatrixLabelWorkbook()), 'matrix.xlsx'));
    expect(await screen.findByText(/needs manual mapping/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import Attendance' })).toHaveAttribute('href', '/import');
    expect(runImport).not.toHaveBeenCalled();
  });
});
