import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { recomputeAttendance } from '@/features/attendance/recomputeService';
import { WEEKDAY_SHORT } from '@/lib/time';
import { HEADER_FIELDS, dtrHeader, periodRange } from './form48';
import { saveDtrHeader, saveRestDays } from './dtrService';

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
const HEADER_PLACEHOLDERS = { regular_days: 'e.g. Mon-Fri', regular_hours: 'e.g. 8:00 - 5:00 PM', rest_days: 'e.g. Sat-Sun', rest_hours: 'e.g. Day off' };
const restKey = (v) => (Array.isArray(v) ? [...v].sort().join(',') : 'office');

/**
 * Settings applied to every DTR on the dashboard at once: the form header text
 * for this half-month and the staff's days off.
 */
export function DtrBulkEditDialog(props) {
  return props.open && props.docs.length ? <DtrBulkEdit {...props} /> : null;
}

function DtrBulkEdit({ docs, year, month, period, template, onClose, onSaved }) {
  const args = (d) => ({ year, month, period, official: d.dtr.official, template });
  const originalHeader = dtrHeader({ ...args(docs[0]), override: docs[0].header });
  const [header, setHeader] = useState(originalHeader);
  const headerChanged = HEADER_FIELDS.some(([k]) => header[k] !== originalHeader[k]);

  const restKeys = new Set(docs.map((d) => restKey(d.emp.rest_days)));
  const mixedRest = restKeys.size > 1;
  const originalRest = mixedRest || !Array.isArray(docs[0].emp.rest_days) ? null : [...docs[0].emp.rest_days].sort();
  const [restDays, setRestDays] = useState(originalRest);
  const [restTouched, setRestTouched] = useState(false);
  const restChanged = restTouched && (mixedRest || restKey(restDays) !== restKey(originalRest));
  const changeRest = (v) => {
    setRestTouched(true);
    setRestDays(v);
  };
  const toggleRestDay = (wd) => changeRest(restDays.includes(wd) ? restDays.filter((x) => x !== wd) : [...restDays, wd].sort());

  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      for (const d of docs) {
        if (headerChanged) {
          const computed = dtrHeader({ ...args(d), override: null });
          const edited = {
            month_label: null,
            ...Object.fromEntries(HEADER_FIELDS.map(([k]) => {
              const v = header[k].trim();
              return [k, v && v !== computed[k] ? v : null];
            })),
          };
          await saveDtrHeader(d.emp.id, year, month, period, edited);
        }
        if (restChanged) await saveRestDays(d.emp.id, restDays);
      }
      if (restChanged) {
        const { start, end } = periodRange(year, month, period);
        await recomputeAttendance({ employeeIds: docs.map((d) => d.emp.id), from: start, to: end });
      }
      onSaved(docs.length);
    } catch (e) {
      setError(`${e.message} Changes made before the error were saved; reopen to check.`);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      size="lg"
      title={`Edit all DTRs (${docs.length} staff)`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!headerChanged && !restChanged}>Apply to all {docs.length} staff</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error && <Alert tone="error">{error}</Alert>}
        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 font-medium text-slate-700">Official hours (this half-month)</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {HEADER_FIELDS.map(([k, label]) => (
              <label key={k} className="flex flex-col gap-0.5 text-xs text-slate-600">
                {label}
                <input
                  className="rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-900"
                  value={header[k]} placeholder={HEADER_PLACEHOLDERS[k]}
                  maxLength={40}
                  disabled={busy}
                  onChange={(e) => setHeader((h) => ({ ...h, [k]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Printed under “Official hours for arrival and departure” on every DTR shown. “For the month of” follows the Month, Year and Period selected.{' '}
            <button
              type="button"
              className="text-blue-700 hover:underline disabled:text-slate-400"
              disabled={busy}
              onClick={() => setHeader(dtrHeader({ ...args(docs[0]), override: null }))}
            >
              Reset to the schedule
            </button>
          </p>
        </fieldset>
        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 font-medium text-slate-700">Days off</legend>
          {mixedRest && !restTouched && <p className="mb-1 text-xs text-amber-700">The staff shown have different days off; choosing here sets the same days for all.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="rest-mode" checked={restDays === null} disabled={busy} onChange={() => changeRest(null)} />
              Office schedule
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="rest-mode" checked={restDays !== null} disabled={busy} onChange={() => changeRest(originalRest ?? [0, 6])} />
              Choose days:
            </label>
            {MONDAY_FIRST.map((wd) => (
              <label key={wd} className={`flex items-center gap-1 rounded border px-2 py-0.5 ${restDays === null ? 'border-slate-100 text-slate-300' : 'border-slate-300'}`}>
                <input type="checkbox" checked={restDays?.includes(wd) ?? false} disabled={restDays === null || busy} onChange={() => toggleRestDay(wd)} />
                {WEEKDAY_SHORT[wd]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {restDays === null ? 'Follows the office schedule (Fri–Sun off from October 2026).' : 'Checked days are the days off; other days use the office hours.'} Saving recomputes this half-month for all staff shown.
          </p>
        </fieldset>
      </div>
    </Dialog>
  );
}
