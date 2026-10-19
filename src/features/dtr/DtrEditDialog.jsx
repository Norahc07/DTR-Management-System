import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { Table, Td, Th } from '@/components/ui/Table';
import { recomputeAttendance } from '@/features/attendance/recomputeService';
import { DAY_REMARKS, HALF_DAY_REMARK, emptyHalf, periodDays, periodRange, remarkFits } from './form48';
import { SLOT_LABELS, orderProblem, planDayChanges, slotInputValues } from './dtrEdit';
import { saveDayRemarks, saveManualPunches } from './dtrService';

/**
 * Manual IN/OUT entry for one staff member and one half-month, for days the
 * fingerprint was not scanned, plus a remark (Day Off, OB, SL, ...) for days
 * without times. Original device punches are kept; time changes are recorded
 * as audited manual entries and the days are recomputed.
 */
export function DtrEditDialog(props) {
  return props.doc ? <DtrEdit {...props} /> : null;
}

function DtrEdit({ doc, year, month, period, onClose, onSaved }) {
  const { from, to } = periodDays(year, month, period);
  const rows = doc.dtr.rows.filter((r) => r.day >= from && r.day <= to);
  const original = Object.fromEntries(rows.map((r) => [r.date, { times: slotInputValues(r), remark: r.remark ?? '' }]));
  const [values, setValues] = useState(original);
  const [reason, setReason] = useState('No fingerprint scan — entered manually');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const setTime = (date, i, v) =>
    setValues((s) => {
      const times = s[date].times.map((x, k) => (k === i ? v : x));
      return { ...s, [date]: { times, remark: remarkFits(s[date].remark, times) ? s[date].remark : '' } };
    });
  const setRemark = (date, remark) => setValues((s) => ({ ...s, [date]: { ...s[date], remark } }));

  const timesChanged = rows.filter((r) => values[r.date].times.some((v, i) => v !== original[r.date].times[i]));
  const remarkChanged = rows.filter((r) => values[r.date].remark !== original[r.date].remark);
  const changedDays = new Set([...timesChanged, ...remarkChanged].map((r) => r.date)).size;

  const save = async () => {
    setError(null);
    if (timesChanged.length && reason.trim().length < 5) return setError('Enter a reason for the time changes (at least 5 characters).');
    const adds = [];
    const voids = [];
    try {
      for (const r of timesChanged) {
        const problem = orderProblem(values[r.date].times);
        if (problem) throw new Error(`${r.date}: ${problem}`);
        const plan = planDayChanges(r, values[r.date].times);
        voids.push(...plan.voids);
        adds.push(...plan.adds.map((a) => ({ ...a, employeeId: doc.emp.id })));
      }
    } catch (e) {
      return setError(e.message);
    }
    setBusy(true);
    try {
      if (remarkChanged.length) await saveDayRemarks(doc.emp.id, remarkChanged.map((r) => ({ date: r.date, remark: values[r.date].remark || null })));
      if (adds.length || voids.length) {
        await saveManualPunches({ voids, adds, reason: reason.trim() });
        const { start, end } = periodRange(year, month, period);
        await recomputeAttendance({ employeeIds: [doc.emp.id], from: start, to: end });
      }
      onSaved(changedDays);
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
      title={`Edit times — ${doc.emp.full_name} (ID ${doc.emp.biometric_id})`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!changedDays}>Save {changedDays ? `${changedDays} day(s)` : ''}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          Every time cell can be changed, including days off and holidays. A time stays in the column you type it in, so an afternoon arrival is not moved to the morning OUT. For a day with no times, choose a remark (Day Off, OB, L, SL, WL, Seminar, Holiday); it prints in the Undertime column. For a day with times in only the morning or only the afternoon, choose “Half day”; the empty half’s IN and OUT print as one merged “HALF DAY” cell. Original fingerprint records are kept and every change is recorded in the audit log.
        </p>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Reason for time changes">{(p) => <Input {...p} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to punch out; confirmed by supervisor" />}</Field>
        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-slate-200">
          <Table>
            <thead className="sticky top-0">
              <tr>
                <Th>Date</Th>
                {SLOT_LABELS.map((l) => <Th key={l}>{l}</Th>)}
                <Th>Remark</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const v = values[r.date];
                const empty = !v.times.some(Boolean);
                const half = emptyHalf(v.times);
                const choices = empty ? DAY_REMARKS : half ? [HALF_DAY_REMARK] : [];
                const missing = r.status === 'missing_punch' || r.status === 'needs_review' || (r.status === 'no_punches' && !v.remark);
                return (
                  <tr key={r.date} className={missing ? 'bg-amber-50' : ''}>
                    <Td className="whitespace-nowrap font-mono text-xs">{r.date.slice(5)} {r.weekday}</Td>
                    {v.times.map((t, i) => (
                      <Td key={i} className="py-1">
                        <input
                          type="time"
                          aria-label={`${SLOT_LABELS[i]} ${r.date}`}
                          className="w-28 rounded border border-slate-300 px-1 py-0.5 font-mono text-xs disabled:bg-transparent disabled:text-slate-300"
                          value={t}
                          disabled={busy}
                          onChange={(e) => setTime(r.date, i, e.target.value)}
                        />
                      </Td>
                    ))}
                    <Td className="py-1">
                      <select
                        aria-label={`Remark ${r.date}`}
                        className="w-28 rounded border border-slate-300 px-1 py-0.5 text-xs disabled:bg-transparent disabled:text-slate-300"
                        value={v.remark}
                        disabled={!choices.length || busy}
                        title={half ? `Only the ${half === 'am' ? 'morning' : 'afternoon'} is empty: “Half day” prints across its IN/OUT cells` : undefined}
                        onChange={(e) => setRemark(r.date, e.target.value)}
                      >
                        <option value="">{choices.length ? '—' : ''}</option>
                        {choices.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                      </select>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </div>
    </Dialog>
  );
}
