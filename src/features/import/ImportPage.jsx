import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FileSpreadsheet, FileText, History, Loader2, Upload } from 'lucide-react';
import { MONTH_NAMES } from '@/lib/time';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { Alert, Card } from '@/components/ui/Feedback';
import { useAuth } from '@/features/auth/authContext';
import { listAllEmployees } from '@/features/employees/employeeService';
import { recomputeAttendance } from '@/features/attendance/recomputeService';
import { inspectWorkbook, readWorkbook, sha256Hex, validateWorkbookFile, DEFAULT_MAX_FILE_MB } from './parser/workbook';
import { buildImportPreview, parseWorkbook } from './preview';
import { ignoredBiometricIds, initialConfig, loadSavedMapping, periodOf, saveMapping } from './importConfig';
import { findBatchesByHash, runImport } from './importService';
import { ConfigureStep } from './ConfigureStep';
import { PreviewStep } from './PreviewStep';
import { periodOfDay } from '@/features/dtr/form48';

const STEPS = ['Upload', 'Map fields', 'Preview', 'Import'];

export function ImportPage() {
  const { settings } = useAuth();
  const maxMb = settings?.max_import_file_mb || DEFAULT_MAX_FILE_MB;
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [wb, setWb] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [config, setConfig] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileWarnings, setFileWarnings] = useState([]);
  const [previousImports, setPreviousImports] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const inputRef = useRef(null);

  const reset = () => {
    setStep(0);
    setFile(null);
    setWb(null);
    setInspection(null);
    setConfig(null);
    setPreview(null);
    setFileWarnings([]);
    setPreviousImports([]);
    setError(null);
    setProgress(null);
    setOutcome(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onFile = async (f) => {
    reset();
    if (!f) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const { warnings } = validateWorkbookFile({ name: f.name, size: f.size, bytes }, { maxMb });
      const book = readWorkbook(bytes);
      if (!book.SheetNames.length) throw new Error('The workbook has no worksheets.');
      const info = inspectWorkbook(book);
      const sha256 = await sha256Hex(bytes);
      setFile({ name: f.name, size: f.size, sha256 });
      setWb(book);
      setInspection(info);
      setFileWarnings(warnings);
      const cfg = initialConfig(book, info, loadSavedMapping(settings?.import_config?.defaultMapping));
      setConfig(cfg);
      setPreviousImports(await findBatchesByHash(sha256).catch(() => []));
      setStep(1);
      if (cfg.preset === 'zkteco_att_record' && cfg.periodDetected) await previewWith(cfg, book);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const previewWith = async (cfg, book) => {
    const period = periodOf(cfg);
    if (!period) throw new Error('Set a valid import period (month/year or start and end dates).');
    const parsed = parseWorkbook(book, cfg);
    const employees = await listAllEmployees();
    setPreview({ ...buildImportPreview({ ...parsed, employees, period, ignoredIds: ignoredBiometricIds(settings) }), period });
    setStep(2);
  };

  const buildPreview = async () => {
    setError(null);
    setBusy(true);
    try {
      await previewWith(config, wb);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const importedIds = preview ? preview.employees.filter((e) => e.matched).map((e) => e.employee.id) : [];
  const lastPunchDate = preview ? preview.records.reduce((max, r) => (r.date > max ? r.date : max), '') || preview.period.end : '';
  const dtrLink = preview
    ? `/?year=${lastPunchDate.slice(0, 4)}&month=${Number(lastPunchDate.slice(5, 7))}&period=${periodOfDay(Number(lastPunchDate.slice(8, 10)))}&employee=${importedIds.join(',')}`
    : '/';

  const commit = async () => {
    setStep(3);
    setError(null);
    setOutcome(null);
    try {
      const { batch, result } = await runImport({ file, config, period: preview.period, preview, onProgress: setProgress });
      saveMapping(config);
      let recompute = null;
      let recomputeError = null;
      const employeeIds = preview.employees.filter((e) => e.matched).map((e) => e.employee.id);
      if (employeeIds.length) {
        try {
          recompute = await recomputeAttendance({ employeeIds, from: preview.period.start, to: preview.period.end, onProgress: setProgress });
        } catch (e) {
          recomputeError = e.message;
        }
      }
      setOutcome({ batch, result, recompute, recomputeError });
    } catch (e) {
      setOutcome({ failed: true, message: e.message, batchId: e.batchId });
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Import attendance"
        description="Upload a monthly Excel attendance report exported from the biometric device (USB/SD card). The file is read in your browser; only validated punches are sent to the database."
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Import Attendance' }]}
        actions={<LinkButton to="/import/history" icon={History}>Import history</LinkButton>}
      />
      <ol className="no-print mb-5 flex flex-wrap gap-2 text-sm" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className={`rounded-full px-3 py-1 ${i === step ? 'bg-blue-700 text-white' : i < step ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-600'}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      {step === 0 && (
        <Card>
          <label
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-6 py-12 text-center hover:border-blue-500 hover:bg-blue-50/30"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files?.[0]);
            }}
          >
            {busy ? <Loader2 className="mb-3 h-10 w-10 animate-spin text-blue-600" aria-hidden /> : <Upload className="mb-3 h-10 w-10 text-slate-400" aria-hidden />}
            <span className="font-medium text-slate-800">{busy ? 'Reading workbook…' : 'Choose an Excel file or drop it here'}</span>
            <span className="mt-1 text-sm text-slate-500">.xlsx or .xls, up to {maxMb} MB. Macros and formulas are never executed.</span>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
          </label>
        </Card>
      )}

      {step >= 1 && file && step < 3 && (
        <div className="mb-4 space-y-2">
          <p className="flex items-center gap-2 text-sm text-slate-700">
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> <strong>{file.name}</strong> · {(file.size / 1024).toFixed(0)} KB · {inspection.sheets.length} sheet(s){inspection.date1904 ? ' · 1904 date system' : ''}
            <button type="button" className="ml-2 text-blue-700 hover:underline" onClick={reset}>Choose another file</button>
          </p>
          {fileWarnings.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
          {previousImports.length > 0 && (
            <Alert tone="info" title="This exact file was uploaded before">
              {previousImports.slice(0, 3).map((e) => (
                <p key={e.id}>
                  {new Date(e.created_at).toLocaleString()} — {e.status}
                  {e.status === 'completed' ? `, ${e.events_inserted} new punches` : ''} (<Link className="underline" to={`/import/history/${e.id}`}>view</Link>)
                </p>
              ))}
              <p className="mt-1">Importing again is safe: existing punches are skipped.</p>
            </Alert>
          )}
        </div>
      )}

      {step === 1 && config?.preset === 'zkteco_att_record' && !config.periodDetected && (
        <Alert tone="warning" className="mb-4" title="Recognized the ZKTeco “Att. record report” sheet">
          The report period was not found in the sheet. Select the month and year below, then choose Preview &amp; validate.
        </Alert>
      )}
      {step === 1 && config && (
        <ConfigureStep wb={wb} inspection={inspection} config={config} setConfig={setConfig} onBack={reset} onPreview={buildPreview} />
      )}
      {step === 1 && busy && <p className="mt-2 text-sm text-slate-500">Parsing…</p>}

      {step === 2 && preview && config?.preset === 'zkteco_att_record' && (
        <Alert tone="info" className="mb-4" title="Recognized the ZKTeco “Att. record report” layout">
          Sheet “{config.sheets[0]}”, {MONTH_NAMES[config.month - 1]} {config.year}. Days were read from row {config.dayHeaderRow}, and each “ID / Name / Dept.” row is followed by that employee’s punches. Check the preview, then import.{' '}
          <button type="button" className="underline" onClick={() => setStep(1)}>Adjust mapping</button>
        </Alert>
      )}
      {step === 2 && preview && (
        <PreviewStep preview={preview} period={preview.period} fileName={file.name} onBack={() => setStep(1)} onRefresh={buildPreview} refreshing={busy} onConfirm={commit} />
      )}

      {step === 3 && (
        <Card>
          {!outcome ? (
            <div className="flex items-center gap-3 py-6 text-sm text-slate-700" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" aria-hidden />
              {progress?.message || 'Starting…'}
            </div>
          ) : outcome.failed ? (
            <div className="space-y-3">
              <Alert tone="error" title="Import failed — no punches were saved">
                <p>{outcome.message}</p>
                <p className="mt-1">The batch was marked as failed. Fix the cause and import again.</p>
              </Alert>
              <div className="flex gap-2">
                {outcome.batchId && <LinkButton to={`/import/history/${outcome.batchId}`}>View batch</LinkButton>}
                <Button variant="secondary" onClick={() => setStep(2)}>Back to preview</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Alert tone="success" title="Import completed">
                <ul className="mt-1 list-disc pl-5">
                  <li>{outcome.result.inserted} new punch(es) saved</li>
                  <li>{outcome.result.existing} punch(es) already existed and were skipped</li>
                  {outcome.result.unmatched_ids > 0 && <li>{outcome.result.unmatched_ids} unmatched ID(s); {outcome.result.unmatched_punches} punch(es) not imported</li>}
                </ul>
              </Alert>
              {outcome.recompute && (
                <Alert tone="info" title="Daily summaries recomputed">
                  {outcome.recompute.saved} employee-day summaries updated
                  {outcome.recompute.skippedLocked > 0 && `; ${outcome.recompute.skippedLocked} day(s) skipped because their DTR period is finalized`}.
                </Alert>
              )}
              {outcome.recomputeError && (
                <Alert tone="warning" title="Punches were imported, but summaries were not fully recomputed">
                  {outcome.recomputeError} Import the same file again to retry; punches already saved are not duplicated.
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                {importedIds.length > 0 && outcome.recompute && (
                  <LinkButton to={dtrLink} variant="primary" icon={FileText}>
                    Open DTRs for {MONTH_NAMES[Number(lastPunchDate.slice(5, 7)) - 1]} {Number(lastPunchDate.slice(8, 10)) <= 15 ? '1–15' : '16–end'} ({importedIds.length})
                  </LinkButton>
                )}
                <LinkButton to={`/import/history/${outcome.batch.id}`} icon={CheckCircle2}>Batch report</LinkButton>
                <Button variant="secondary" onClick={reset}>Import another file</Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
