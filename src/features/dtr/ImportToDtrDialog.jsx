import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/Form';
import { MONTH_NAMES, WEEKDAY_SHORT, daysInMonth, toDateKey } from '@/lib/time';
import { useAuth } from '@/features/auth/authContext';
import { listAllEmployees } from '@/features/employees/employeeService';
import { recomputeAttendance } from '@/features/attendance/recomputeService';
import { applyPeriodSchedule } from '@/features/schedules/scheduleService';
import { inspectWorkbook, readWorkbook, sha256Hex, validateWorkbookFile, DEFAULT_MAX_FILE_MB } from '@/features/import/parser/workbook';
import { buildImportPreview, parseWorkbook } from '@/features/import/preview';
import { ignoredBiometricIds, initialConfig, loadSavedMapping, saveMapping } from '@/features/import/importConfig';
import { findBatchesByHash, runImport } from '@/features/import/importService';
import { DEFAULT_HOURS, newSegment, nextSegment, segmentProblem } from './importSettings';

const IMPORT_PERIODS = [
  { value: 'first', label: '1–15' },
  { value: 'second', label: '16–end of month' },
  { value: 'month', label: 'Whole month' },
];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

function rangeOf(year, month, period) {
  const last = daysInMonth(year, month);
  const [from, to] = period === 'first' ? [1, 15] : period === 'second' ? [16, last] : [1, last];
  return { start: toDateKey(year, month, from), end: toDateKey(year, month, to) };
}

/** Period that holds the file's punches: one half when they all fall in it, otherwise the whole month. */
function periodOfDates(dates) {
  if (!dates.length) return 'month';
  const days = dates.map((d) => Number(d.slice(8, 10)));
  if (Math.max(...days) <= 15) return 'first';
  if (Math.min(...days) >= 16) return 'second';
  return 'month';
}

const clock12 = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const plusMinute = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + 1;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * One-step import of a ZKTeco "Att. record report" from the dashboard. The
 * month, year and half-month to import, the work days and the office hours
 * are chosen here; those hours are assigned to the imported staff for that
 * period, the punches saved, the days recomputed and the DTRs opened. Other
 * layouts need the full Import page, where columns are mapped by hand.
 */
export function ImportToDtrDialog(props) {
  return props.open ? <ImportToDtr {...props} /> : null;
}

function ImportToDtr({ open, onClose, onImported }) {
  const { settings } = useAuth();
  const maxMb = settings?.max_import_file_mb || DEFAULT_MAX_FILE_MB;
  const [state, setState] = useState({ phase: 'pick' });
  const [opts, setOpts] = useState(null);
  const [ack, setAck] = useState(false);
  const busy = state.phase === 'reading' || state.phase === 'importing';
  const setOpt = (patch) => {
    setAck(false);
    setOpts((o) => {
      const next = { ...o, ...patch };
      if (o && ('year' in patch || 'month' in patch || 'period' in patch) && o.segments?.length === 1) {
        const r = rangeOf(next.year, next.month, next.period);
        next.segments = [{ ...o.segments[0], from: r.start, to: r.end }];
      }
      return next;
    });
  };
  const setSegment = (id, patch) => setOpt({ segments: opts.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const onFile = async (f) => {
    if (!f) return;
    setAck(false);
    setState({ phase: 'reading' });
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const { warnings } = validateWorkbookFile({ name: f.name, size: f.size, bytes }, { maxMb });
      const book = readWorkbook(bytes);
      if (!book.SheetNames.length) throw new Error('The workbook has no worksheets.');
      const config = initialConfig(book, inspectWorkbook(book), loadSavedMapping(settings?.import_config?.defaultMapping));
      if (config.preset !== 'zkteco_att_record' || !config.periodDetected) {
        setState({ phase: 'manual', fileName: f.name });
        return;
      }
      const parsed = parseWorkbook(book, config);
      const employees = await listAllEmployees();
      const sha256 = await sha256Hex(bytes);
      const previous = await findBatchesByHash(sha256).catch(() => []);
      const period = periodOfDates(parsed.records.map((r) => r.date));
      const year = Number(config.year);
      const month = Number(config.month);
      const span = rangeOf(year, month, period);
      setOpts({ year, month, period, segments: [newSegment(span.start, span.end)] });
      setState({ phase: 'preview', file: { name: f.name, size: f.size, sha256 }, book, config, employees, warnings, previous });
    } catch (e) {
      setState({ phase: 'pick', error: e.message });
    }
  };

  const { book, config: fileConfig, employees } = state;
  const config = useMemo(() => (fileConfig && opts ? { ...fileConfig, year: opts.year, month: opts.month } : null), [fileConfig, opts]);
  const range = opts ? rangeOf(opts.year, opts.month, opts.period) : null;
  const computed = useMemo(() => {
    if (!book || !config || !range) return null;
    const parsed = parseWorkbook(book, config);
    const inRange = parsed.records.filter((r) => r.date >= range.start && r.date <= range.end);
    const preview = buildImportPreview({ ...parsed, records: inRange, employees, period: range, ignoredIds: ignoredBiometricIds(settings) });
    return { preview: { ...preview, period: range }, skipped: parsed.records.length - inRange.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, config, employees, range?.start, range?.end, settings]);

  const hoursError = !opts
    ? null
    : !(opts.year >= 2000 && opts.year <= 2100)
      ? 'Enter a year between 2000 and 2100.'
      : segmentProblem(opts.segments, range);

  const commit = async () => {
    const { file } = state;
    const { preview } = computed;
    setState({ ...state, phase: 'importing', progress: null, error: null });
    try {
      const employeeIds = preview.employees.filter((e) => e.matched).map((e) => e.employee.id);
      if (employeeIds.length) {
        setState((s) => ({ ...s, progress: { message: 'Saving office hours for the period…' } }));
        for (const s of opts.segments) {
          await applyPeriodSchedule({ employeeIds, start: s.from, end: s.to, workdays: s.workdays, amIn: s.amIn, amOut: s.amOut, pmIn: s.pmIn, pmOut: s.pmOut });
        }
      }
      const { batch, result } = await runImport({ file, config, period: range, preview, onProgress: (progress) => setState((s) => ({ ...s, progress })) });
      saveMapping(config);
      let recompute = null;
      let recomputeError = null;
      if (employeeIds.length) {
        try {
          recompute = await recomputeAttendance({ employeeIds, from: range.start, to: range.end, onProgress: (progress) => setState((s) => ({ ...s, progress })) });
        } catch (e) {
          recomputeError = e.message;
        }
      }
      onImported({
        year: opts.year,
        month: opts.month,
        period: opts.period,
        employeeIds,
        batch: { id: batch.id, fileName: batch.file_name },
        result,
        recompute,
        recomputeError,
      });
    } catch (e) {
      setState((s) => ({ ...s, phase: 'preview', error: e.message }));
    }
  };

  const preview = computed?.preview;
  const t = preview?.totals;
  const needsAck = t ? t.errors > 0 || t.unmatchedIds > 0 : false;
  const nothing = t ? t.validPunches === 0 : true;
  const toggleDay = (id, wd, on) => {
    const seg = opts.segments.find((s) => s.id === id);
    setSegment(id, { workdays: on ? [...new Set([...seg.workdays, wd])] : seg.workdays.filter((d) => d !== wd) });
  };
  const showPreview = (state.phase === 'preview' || state.phase === 'importing') && opts && preview;

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      size="lg"
      title="Import attendance file"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          {showPreview && (
            <Button onClick={commit} loading={state.phase === 'importing'} disabled={nothing || Boolean(hoursError) || (needsAck && !ack)}>
              Import {t.validPunches} punch(es) &amp; fill DTRs
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          Choose the “Att. record report” Excel file exported from the biometric device. Then confirm the month, period, work days and office hours below: the punches of that period are placed in the DTR as morning IN, morning OUT, afternoon IN and afternoon OUT, and lateness is computed from those hours.
        </p>
        {state.error && <Alert tone="error">{state.error}</Alert>}

        {(state.phase === 'pick' || state.phase === 'reading' || state.phase === 'manual') && (
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-6 py-10 text-center hover:border-blue-500 hover:bg-blue-50/30">
            {state.phase === 'reading' ? <Loader2 className="mb-2 h-8 w-8 animate-spin text-blue-600" aria-hidden /> : <Upload className="mb-2 h-8 w-8 text-slate-400" aria-hidden />}
            <span className="font-medium text-slate-800">{state.phase === 'reading' ? 'Reading workbook…' : 'Choose an Excel file'}</span>
            <span className="mt-1 text-xs text-slate-500">.xlsx or .xls, up to {maxMb} MB</span>
            <input type="file" accept=".xlsx,.xls" className="sr-only" aria-label="Attendance file" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        )}

        {state.phase === 'manual' && (
          <Alert tone="warning" title="This file needs manual mapping">
            “{state.fileName}” is not a ZKTeco “Att. record report” with a readable period, so it cannot be imported automatically. Use the{' '}
            <Link to="/import" className="underline">Import Attendance</Link> page to map its columns.
          </Alert>
        )}

        {showPreview && (
          <>
            <p>
              <strong>{state.file.name}</strong> · importing {MONTH_NAMES[opts.month - 1]} {opts.year} ({range.start} to {range.end})
            </p>

            <fieldset className="space-y-3 rounded-md border border-slate-200 p-3" disabled={busy}>
              <legend className="px-1 font-medium text-slate-700">Import settings</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Month">
                  {(p) => (
                    <Select {...p} value={opts.month} onChange={(e) => setOpt({ month: Number(e.target.value) })}>
                      {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Year">{(p) => <Input {...p} type="number" min={2000} max={2100} value={opts.year} placeholder="e.g. 2026" onChange={(e) => setOpt({ year: Number(e.target.value) })} />}</Field>
                <Field label="Period">
                  {(p) => (
                    <Select {...p} value={opts.period} onChange={(e) => setOpt({ period: e.target.value })}>
                      {IMPORT_PERIODS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                    </Select>
                  )}
                </Field>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-700">Office hours by date</p>
                  <Button size="sm" variant="secondary" icon={Plus} onClick={() => setOpt({ segments: [...opts.segments, nextSegment(opts.segments, range)] })}>Add date range</Button>
                </div>
                <p className="text-xs text-slate-500">Use more than one range when the hours change during the month. For example October 1–2 at 8:00–5:00, Monday to Friday, then October 5 to the end at 7:00–6:00, Monday to Thursday. Days between ranges keep the schedule they already had.</p>
                {opts.segments.map((seg, index) => (
                  <div key={seg.id} className="space-y-2 rounded-md border border-slate-200 p-3">
                    <div className="flex items-end gap-3">
                      <Field label={index === 0 ? 'From' : `From ${index + 1}`} className="flex-1">
                        {(p) => <Input {...p} type="date" min={range.start} max={range.end} value={seg.from} onChange={(e) => setSegment(seg.id, { from: e.target.value })} />}
                      </Field>
                      <Field label={index === 0 ? 'To' : `To ${index + 1}`} className="flex-1">
                        {(p) => <Input {...p} type="date" min={range.start} max={range.end} value={seg.to} onChange={(e) => setSegment(seg.id, { to: e.target.value })} />}
                      </Field>
                      {opts.segments.length > 1 && (
                        <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove date range ${index + 1}`} onClick={() => setOpt({ segments: opts.segments.filter((s) => s.id !== seg.id) })}>Remove</Button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {MONDAY_FIRST.map((wd) => (
                        <Checkbox key={wd} label={index === 0 ? WEEKDAY_SHORT[wd] : `${WEEKDAY_SHORT[wd]} ${index + 1}`} checked={seg.workdays.includes(wd)} onChange={(e) => toggleDay(seg.id, wd, e.target.checked)} />
                      ))}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <Field label={index === 0 ? 'Morning IN' : `Morning IN ${index + 1}`}>{(p) => <Input {...p} type="time" value={seg.amIn} onChange={(e) => setSegment(seg.id, { amIn: e.target.value })} />}</Field>
                      <Field label={index === 0 ? 'Morning OUT' : `Morning OUT ${index + 1}`}>{(p) => <Input {...p} type="time" value={seg.amOut} onChange={(e) => setSegment(seg.id, { amOut: e.target.value })} />}</Field>
                      <Field label={index === 0 ? 'Afternoon IN' : `Afternoon IN ${index + 1}`}>{(p) => <Input {...p} type="time" value={seg.pmIn} onChange={(e) => setSegment(seg.id, { pmIn: e.target.value })} />}</Field>
                      <Field label={index === 0 ? 'Afternoon OUT' : `Afternoon OUT ${index + 1}`}>{(p) => <Input {...p} type="time" value={seg.pmOut} onChange={(e) => setSegment(seg.id, { pmOut: e.target.value })} />}</Field>
                    </div>
                    <p className="text-xs text-slate-500">
                      Late from {clock12(plusMinute(seg.amIn || '00:00'))} in the morning and {clock12(plusMinute(seg.pmIn || '00:00'))} in the afternoon. A missing OUT prints {clock12(seg.amOut || '00:00')} or {clock12(seg.pmOut || '00:00')}.
                    </p>
                  </div>
                ))}
              </div>
              {hoursError && <Alert tone="error">{hoursError}</Alert>}
            </fieldset>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Staff recognized', t.employeesRecognized],
                ['Punches to import', t.validPunches],
                ['Unmatched IDs', t.unmatchedIds],
                ['Errors', t.errors],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-slate-200 p-2">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="text-lg font-semibold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
            {computed.skipped > 0 && <Alert tone="info">{computed.skipped} punch(es) in the file are outside {range.start} to {range.end} and will not be imported.</Alert>}
            {state.warnings.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
            {state.previous.length > 0 && <Alert tone="info">This exact file was imported before. Importing again is safe: existing punches are skipped.</Alert>}
            {t.unmatchedIds > 0 && (
              <Alert tone="warning">
                Not in the employee list (will not be imported): {preview.employees.filter((e) => !e.matched).map((e) => `ID ${e.biometricId}${e.workbookNames.length ? ` ${e.workbookNames[0]}` : ''}`).join(', ')}.
              </Alert>
            )}
            {nothing && <Alert tone="warning">There are no punches for recognized staff in this period. Check the month and period above.</Alert>}
            {needsAck && !nothing && (
              <Checkbox label="I reviewed these issues and want to import the valid punches only." checked={ack} onChange={(e) => setAck(e.target.checked)} />
            )}
            {state.phase === 'importing' && (
              <p className="flex items-center gap-2 text-slate-700" role="status">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden /> {state.progress?.message || 'Starting…'}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
