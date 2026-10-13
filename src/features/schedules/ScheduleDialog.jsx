import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { useAsync } from '@/hooks/useAsync';
import { WEEKDAY_SHORT } from '@/lib/time';
import { saveSchedule, scheduleUsage } from './scheduleService';
import { validateScheduleDays } from './scheduleValidation';

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const blankDay = (weekday) => ({
  weekday,
  is_workday: weekday >= 1 && weekday <= 5,
  start_time: '08:00',
  end_time: '17:00',
  break_start: '12:00',
  break_end: '13:00',
  break_minutes: 60,
  break_paid: false,
  required_minutes: '',
  core_start: '',
  core_end: '',
});

const toForm = (schedule) => ({
  id: schedule?.id,
  name: schedule?.name ?? '',
  schedule_type: schedule?.schedule_type ?? 'fixed',
  description: schedule?.description ?? '',
  is_active: schedule?.is_active ?? true,
  days: [0, 1, 2, 3, 4, 5, 6].map((wd) => {
    const d = schedule?.days?.find((x) => x.weekday === wd);
    return d
      ? { ...d, start_time: hhmm(d.start_time), end_time: hhmm(d.end_time), break_start: hhmm(d.break_start), break_end: hhmm(d.break_end), core_start: hhmm(d.core_start), core_end: hhmm(d.core_end), required_minutes: d.required_minutes ?? '' }
      : blankDay(wd);
  }),
});

export function ScheduleDialog(props) {
  return props.open ? <ScheduleForm {...props} /> : null;
}

function ScheduleForm({ open, schedule, onClose, onSaved }) {
  const [form, setForm] = useState(() => toForm(schedule));
  const usageState = useAsync(() => (schedule?.id ? scheduleUsage(schedule.id) : Promise.resolve(0)), [schedule?.id]);
  const usage = usageState.data ?? 0;
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  const setDay = (wd, patch) => setForm((f) => ({ ...f, days: f.days.map((d) => (d.weekday === wd ? { ...d, ...patch } : d)) }));

  const save = async () => {
    const errs = [];
    if (!form.name.trim()) errs.push('Name is required');
    errs.push(...validateScheduleDays(form.days, form.schedule_type));
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    try {
      const nul = (v) => (v === '' || v == null ? null : v);
      await saveSchedule({
        ...form,
        name: form.name.trim(),
        days: form.days.map((d) => ({
          weekday: d.weekday,
          is_workday: d.is_workday,
          start_time: d.is_workday ? nul(d.start_time) : null,
          end_time: d.is_workday ? nul(d.end_time) : null,
          break_start: d.is_workday ? nul(d.break_start) : null,
          break_end: d.is_workday ? nul(d.break_end) : null,
          break_minutes: d.is_workday ? Number(d.break_minutes) || 0 : 0,
          break_paid: d.is_workday && Boolean(d.break_paid),
          required_minutes: d.is_workday && form.schedule_type === 'flexible' ? Number(d.required_minutes) || null : null,
          core_start: d.is_workday ? nul(d.core_start) : null,
          core_end: d.is_workday ? nul(d.core_end) : null,
        })),
      });
      onSaved();
      onClose();
    } catch (e) {
      setErrors([e.message]);
    } finally {
      setBusy(false);
    }
  };

  const flex = form.schedule_type === 'flexible';
  return (
    <Dialog open={open} onClose={onClose} size="xl" title={schedule ? `Edit schedule: ${schedule.name}` : 'New schedule'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save schedule</Button></>}>
      <div className="space-y-4">
        {usage > 0 && (
          <Alert tone="warning" title={`Assigned to ${usage} employee assignment(s)`}>
            Saved summaries keep a snapshot of the schedule used. Changes apply only when attendance is recomputed, and finalized DTR periods are never changed. To change a schedule from a specific date, create a new schedule and assign it with an effective date instead.
          </Alert>
        )}
        {errors.length > 0 && <Alert tone="error"><ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Name" required>{(p) => <Input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} placeholder="e.g. Office hours 8:00-5:00" />}</Field>
          <Field label="Type">
            {(p) => (
              <Select {...p} value={form.schedule_type} onChange={(e) => setForm({ ...form, schedule_type: e.target.value })}>
                <option value="fixed">Fixed hours</option>
                <option value="flexible">Flexible (required hours)</option>
              </Select>
            )}
          </Field>
          <div className="flex items-end pb-2"><Checkbox label="Active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /></div>
        </div>
        <Field label="Description">{(p) => <Textarea {...p} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional, e.g. Mon-Fri with a 12:00-1:00 lunch break" className="min-h-12" />}</Field>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-600">
                <th className="p-1">Day</th><th className="p-1">Workday</th>
                {!flex && <><th className="p-1">Start</th><th className="p-1">End</th></>}
                {flex && <><th className="p-1">Required min</th><th className="p-1">Core start</th><th className="p-1">Core end</th></>}
                <th className="p-1">Break start</th><th className="p-1">Break end</th><th className="p-1">Break min</th><th className="p-1">Paid break</th>
              </tr>
            </thead>
            <tbody>
              {form.days.map((d) => (
                <tr key={d.weekday} className={d.is_workday ? '' : 'text-slate-400'}>
                  <td className="p-1 font-medium">{WEEKDAY_SHORT[d.weekday]}</td>
                  <td className="p-1"><input type="checkbox" aria-label={`${WEEKDAY_SHORT[d.weekday]} is a workday`} checked={d.is_workday} onChange={(e) => setDay(d.weekday, { is_workday: e.target.checked })} /></td>
                  {!flex && (
                    <>
                      <td className="p-1"><Input type="time" aria-label="Start" value={d.start_time} disabled={!d.is_workday} onChange={(e) => setDay(d.weekday, { start_time: e.target.value })} /></td>
                      <td className="p-1"><Input type="time" aria-label="End" value={d.end_time} disabled={!d.is_workday} onChange={(e) => setDay(d.weekday, { end_time: e.target.value })} /></td>
                    </>
                  )}
                  {flex && (
                    <>
                      <td className="p-1"><Input type="number" min={1} aria-label="Required minutes" value={d.required_minutes} placeholder="480" disabled={!d.is_workday} onChange={(e) => setDay(d.weekday, { required_minutes: e.target.value })} /></td>
                      <td className="p-1"><Input type="time" aria-label="Core start" value={d.core_start} disabled={!d.is_workday} onChange={(e) => setDay(d.weekday, { core_start: e.target.value })} /></td>
                      <td className="p-1"><Input type="time" aria-label="Core end" value={d.core_end} disabled={!d.is_workday} onChange={(e) => setDay(d.weekday, { core_end: e.target.value })} /></td>
                    </>
                  )}
                  <td className="p-1"><Input type="time" aria-label="Break start" value={d.break_start} disabled={!d.is_workday} onChange={(e) => setDay(d.weekday, { break_start: e.target.value })} /></td>
                  <td className="p-1"><Input type="time" aria-label="Break end" value={d.break_end} disabled={!d.is_workday} onChange={(e) => setDay(d.weekday, { break_end: e.target.value })} /></td>
                  <td className="p-1"><Input type="number" min={0} max={480} aria-label="Break minutes" value={d.break_minutes} placeholder="60" disabled={!d.is_workday} onChange={(e) => setDay(d.weekday, { break_minutes: e.target.value })} /></td>
                  <td className="p-1"><input type="checkbox" aria-label="Paid break" checked={d.break_paid} disabled={!d.is_workday} onChange={(e) => setDay(d.weekday, { break_paid: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">An end time earlier than the start time means the shift crosses midnight. If break start/end are blank, the break minutes are deducted from the day when the employee did not punch out for a break.</p>
      </div>
    </Dialog>
  );
}
