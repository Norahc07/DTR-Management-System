import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Alert, Badge } from '@/components/ui/Feedback';
import { Table, Td, Th } from '@/components/ui/Table';
import { downloadXlsx } from '@/lib/exporters';
import { readWorkbook, validateWorkbookFile } from '@/features/import/parser/workbook';
import { employeeSchema } from './employeeSchema';
import { insertEmployees, listAllEmployees, validateEmployeeRows } from './employeeService';

const COLUMNS = ['biometric_id', 'employee_no', 'nickname', 'last_name', 'first_name', 'middle_name', 'suffix', 'department', 'position', 'employment_status', 'date_hired', 'dtr_format'];

export function EmployeeImportDialog({ open, onClose, departments, onImported }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setRows(null);
    setFileName('');
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (file) => {
    reset();
    if (!file) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      validateWorkbookFile({ name: file.name, size: file.size, bytes }, { maxMb: 5 });
      const wb = readWorkbook(bytes);
      const ws = wb.Sheets[wb.SheetNames[0]];
      // raw: false keeps displayed text, so IDs typed as text keep leading zeros.
      const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      if (!data.length) throw new Error('The first worksheet has no data rows.');
      const missing = ['biometric_id', 'last_name'].filter((c) => !(c in data[0]));
      if (missing.length) throw new Error(`Missing required column(s): ${missing.join(', ')}. Download the template for the expected headers.`);
      if (data.length > 5000) throw new Error('Import at most 5,000 employees per file.');
      const existing = await listAllEmployees();
      setRows(validateEmployeeRows(data, existing, departments, employeeSchema));
      setFileName(file.name);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const valid = rows?.filter((r) => !r.problems.length) ?? [];
  const invalid = rows?.filter((r) => r.problems.length) ?? [];

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      // A single insert statement is atomic: either every valid row is saved or none.
      await insertEmployees(valid.map((r) => r.data));
      onImported(valid.length);
      close();
    } catch (e) {
      setError(`Nothing was imported: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import employees"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!valid.length} loading={busy} onClick={confirm}>
            Import {valid.length} valid row(s)
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          Upload an .xlsx or .xls file whose first sheet has the headers <code className="rounded bg-slate-100 px-1">{COLUMNS.join(', ')}</code>. Format the biometric ID column as Text in Excel to keep leading zeros. Department may be a code or name.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            onClick={() => downloadXlsx([{ name: 'Employees', rows: [Object.fromEntries(COLUMNS.map((c) => [c, '']))] }], 'employee-import-template.xlsx')}
          >
            Download template
          </Button>
          <input type="file" accept=".xlsx,.xls" aria-label="Employee spreadsheet" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {rows && (
          <>
            <p>
              <strong>{fileName}</strong>: {rows.length} rows — <Badge tone="green">{valid.length} valid</Badge> <Badge tone="red">{invalid.length} with errors</Badge>
            </p>
            <div className="max-h-80 overflow-y-auto rounded border border-slate-200">
              <Table>
                <thead className="sticky top-0">
                  <tr>
                    <Th>Row</Th>
                    <Th>Biometric ID</Th>
                    <Th>Name</Th>
                    <Th>Result</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.rowNo} className={r.problems.length ? 'bg-red-50/50' : ''}>
                      <Td>{r.rowNo}</Td>
                      <Td className="font-mono">{String(r.raw.biometric_id ?? '')}</Td>
                      <Td>
                        {[r.raw.last_name, r.raw.first_name].map((v) => String(v ?? '').trim()).filter(Boolean).join(', ')}
                      </Td>
                      <Td>
                        {r.problems.length ? (
                          <ul className="list-disc pl-4 text-red-700">{r.problems.map((p) => <li key={p}>{p}</li>)}</ul>
                        ) : (
                          <span className="text-emerald-700">Ready</span>
                        )}
                        {r.warnings.map((w) => (
                          <p key={w} className="text-amber-700">⚠ {w}</p>
                        ))}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
