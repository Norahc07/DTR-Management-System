// @vitest-environment jsdom
// Upload -> map -> preview -> confirm, using the real parser and preview code
// and a synthetic workbook. Only network-bound services are mocked.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { buildMatrixLabelWorkbook, buildZkAttRecordWorkbook, workbookToBytes } from '../fixtures/syntheticWorkbooks';

const employees = [
  { id: 'e1', biometric_id: '0001', last_name: 'DEVSAMPLE', first_name: 'Alpha', full_name: 'DEVSAMPLE, Alpha', is_active: true },
  { id: 'e2', biometric_id: '0002', last_name: 'DEVSAMPLE', first_name: 'Bravo', full_name: 'DEVSAMPLE, Bravo', is_active: true },
  { id: 'e3', biometric_id: '3', last_name: 'JM', first_name: 'JM', full_name: 'jm', is_active: true },
  { id: 'e15', biometric_id: '15', last_name: 'DEVSAMPLE', first_name: 'Bravo', full_name: 'DEVSAMPLE, Bravo', is_active: true },
];

const runImport = vi.fn();
const recomputeAttendance = vi.fn();

vi.mock('@/features/auth/authContext', () => ({ useAuth: () => ({ settings: { max_import_file_mb: 10 } }) }));
vi.mock('@/features/employees/employeeService', () => ({ listAllEmployees: vi.fn(async () => employees) }));
vi.mock('@/features/attendance/recomputeService', () => ({ recomputeAttendance: (...a) => recomputeAttendance(...a) }));
vi.mock('@/features/import/importService', () => ({
  findBatchesByHash: vi.fn(async () => []),
  runImport: (...a) => runImport(...a),
}));

const { ImportPage } = await import('@/features/import/ImportPage');

function fileFrom(bytes, name) {
  return new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ImportPage />
    </MemoryRouter>,
  );
}

describe('import wizard', () => {
  beforeEach(() => {
    runImport.mockReset();
    recomputeAttendance.mockReset();
    localStorage.clear();
  });

  it('previews a synthetic matrix workbook and imports after acknowledging issues', async () => {
    const user = userEvent.setup();
    runImport.mockResolvedValue({ batch: { id: 'batch-1' }, result: { inserted: 11, existing: 0, unmatched_ids: 1, unmatched_punches: 2 } });
    recomputeAttendance.mockResolvedValue({ saved: 60, skippedLocked: 0 });
    const { container } = renderPage();

    await user.upload(container.querySelector('input[type=file]'), fileFrom(workbookToBytes(buildMatrixLabelWorkbook()), 'september.xlsx'));
    expect(await screen.findByRole('button', { name: /preview & validate/i })).toBeEnabled();
    expect(screen.getByText('september.xlsx')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /preview & validate/i }));
    const importButton = await screen.findByRole('button', { name: /^import \d+ punch\(es\)$/i });

    // The unmatched ID 0777 is reported, and importing requires acknowledgement.
    expect(screen.getAllByText(/0777/).length).toBeGreaterThan(0);
    expect(importButton).toBeDisabled();
    await user.click(screen.getByLabelText(/i reviewed these issues/i));
    expect(importButton).toBeEnabled();

    await user.click(importButton);
    expect(await screen.findByText(/import completed/i)).toBeInTheDocument();
    expect(screen.getByText(/11 new punch\(es\) saved/)).toBeInTheDocument();
    expect(screen.getByText(/1 unmatched ID\(s\); 2 punch\(es\) not imported/)).toBeInTheDocument();

    expect(runImport).toHaveBeenCalledTimes(1);
    const args = runImport.mock.calls[0][0];
    expect(args.period).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(args.file).toMatchObject({ name: 'september.xlsx' });
    expect(args.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Every staged punch carries an explicit date and time; nothing is invented for empty cells.
    expect(args.preview.stagedRecords.length).toBeGreaterThan(0);
    for (const r of args.preview.stagedRecords) {
      expect(r.date).toMatch(/^2026-09-\d\d$/);
      expect(Number.isInteger(r.seconds)).toBe(true);
    }
    expect(recomputeAttendance).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: ['e1', 'e2'], from: '2026-09-01', to: '2026-09-30' }));
  });

  it('recognizes the ZKTeco Att. record report, skips mapping, and links to the filled DTRs', async () => {
    const user = userEvent.setup();
    runImport.mockResolvedValue({ batch: { id: 'batch-zk' }, result: { inserted: 13, existing: 0, unmatched_ids: 0, unmatched_punches: 0 } });
    recomputeAttendance.mockResolvedValue({ saved: 60, skippedLocked: 0 });
    const { container } = renderPage();

    await user.upload(container.querySelector('input[type=file]'), fileFrom(workbookToBytes(buildZkAttRecordWorkbook()), 'attlog.xlsx'));
    // Lands directly on the preview; no manual mapping step.
    const importButton = await screen.findByRole('button', { name: 'Import 13 punch(es)' });
    expect(screen.getByText(/recognized the zkteco/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview & validate/i })).not.toBeInTheDocument();
    expect(importButton).toBeEnabled();

    await user.click(importButton);
    const link = await screen.findByRole('link', { name: /open dtrs for september 1–15 \(2\)/i });
    expect(link).toHaveAttribute('href', '/?year=2026&month=9&period=first&employee=e3,e15');
    expect(runImport.mock.calls[0][0].config).toMatchObject({ preset: 'zkteco_att_record', sheets: ['Att. record report'] });
  });

  it('rejects a file that is not a spreadsheet, without importing', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.upload(container.querySelector('input[type=file]'), fileFrom(new TextEncoder().encode('just some text, not excel'), 'fake.xlsx'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview & validate/i })).not.toBeInTheDocument();
    expect(runImport).not.toHaveBeenCalled();
  });

  it('shows a failed import clearly and saves nothing', async () => {
    const user = userEvent.setup();
    runImport.mockRejectedValue(Object.assign(new Error('Server rejected the batch'), { batchId: 'b-failed' }));
    const { container } = renderPage();
    await user.upload(container.querySelector('input[type=file]'), fileFrom(workbookToBytes(buildMatrixLabelWorkbook()), 'september.xlsx'));
    await user.click(await screen.findByRole('button', { name: /preview & validate/i }));
    await screen.findByRole('button', { name: /^import \d+ punch\(es\)$/i });
    await user.click(screen.getByLabelText(/i reviewed these issues/i));
    await user.click(screen.getByRole('button', { name: /^import \d+ punch\(es\)$/i }));
    expect(await screen.findByText(/import failed — no punches were saved/i)).toBeInTheDocument();
    expect(screen.getByText('Server rejected the batch')).toBeInTheDocument();
    expect(recomputeAttendance).not.toHaveBeenCalled();
  });
});
