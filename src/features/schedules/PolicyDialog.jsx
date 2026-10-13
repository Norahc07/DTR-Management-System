import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { DEFAULT_POLICY_RULES, resolvePolicyRules } from '@/features/attendance/engine/policy';
import { createPolicy, updateDraftPolicy } from './scheduleService';

export function PolicyDialog(props) {
  return props.open ? <PolicyForm {...props} /> : null;
}

function PolicyForm({ open, policy, onClose, onSaved }) {
  const [name, setName] = useState(policy?.name ?? '');
  const [effective, setEffective] = useState(policy?.effective_from ?? '');
  const [notes, setNotes] = useState(policy?.notes ?? '');
  const [r, setR] = useState(() => resolvePolicyRules(policy?.rules ?? DEFAULT_POLICY_RULES));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const num = (v) => (v === '' ? 0 : Number(v));
  const set = (patch) => setR((x) => ({ ...x, ...patch }));
  const setNested = (key, patch) => setR((x) => ({ ...x, [key]: { ...x[key], ...patch } }));

  const save = async () => {
    setError(null);
    if (!name.trim() || !effective) return setError('Name and effective date are required.');
    let rules;
    try {
      rules = resolvePolicyRules(r);
    } catch (e) {
      return setError(`Invalid rule values: ${e.issues?.map((i) => `${i.path.join('.')} ${i.message}`).join('; ') || e.message}`);
    }
    setBusy(true);
    try {
      if (policy?.id) await updateDraftPolicy(policy.id, { name: name.trim(), effective_from: effective, rules, notes: notes || null });
      else await createPolicy({ name: name.trim(), effective_from: effective, rules, notes });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={policy ? 'Edit draft policy' : 'New attendance policy (draft)'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save draft</Button></>}>
      <div className="space-y-4 text-sm">
        <Alert tone="info">
          These settings are organizational rules, not legal defaults. Confirm each value with HR/management (and payroll/labor counsel where relevant) before a Super Admin approves the policy. Approved policies cannot be edited; create a new policy with a later effective date instead.
        </Alert>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Policy name" required>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Office hours policy 2026" />}</Field>
          <Field label="Effective from" required hint="Applies to work dates on/after this date until a later approved policy">{(p) => <Input {...p} type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />}</Field>
        </div>
        <fieldset className="grid gap-3 rounded border border-slate-200 p-3 md:grid-cols-3">
          <legend className="px-1 font-semibold">Punch handling</legend>
          <Field label="Pairing mode" hint="How punches become in/out pairs">
            {(p) => (
              <Select {...p} value={r.pairingMode} onChange={(e) => set({ pairingMode: e.target.value })}>
                <option value="sequential">Sequential (1-2, 3-4 …)</option>
                <option value="first_last">First in / last out only</option>
              </Select>
            )}
          </Field>
          <Field label="Duplicate window (min)" hint="Punches closer than this are treated as duplicate taps">{(p) => <Input {...p} type="number" min={0} max={30} value={r.duplicateWindowMinutes} placeholder="e.g. 2" onChange={(e) => set({ duplicateWindowMinutes: num(e.target.value) })} />}</Field>
          <Field label="Expected max punches/day" hint="More than this flags the day for review">{(p) => <Input {...p} type="number" min={2} max={12} value={r.maxPunchesPerDay} placeholder="e.g. 4" onChange={(e) => set({ maxPunchesPerDay: num(e.target.value) })} />}</Field>
        </fieldset>
        <fieldset className="grid gap-3 rounded border border-slate-200 p-3 md:grid-cols-3">
          <legend className="px-1 font-semibold">Late and undertime</legend>
          <Field label="Late grace (min)">{(p) => <Input {...p} type="number" min={0} max={240} value={r.graceLateMinutes} placeholder="e.g. 0" onChange={(e) => set({ graceLateMinutes: num(e.target.value) })} />}</Field>
          <Field label="Late counted from">
            {(p) => (
              <Select {...p} value={r.lateComputedFrom} onChange={(e) => set({ lateComputedFrom: e.target.value })}>
                <option value="schedule_start">Schedule start (grace only excuses)</option>
                <option value="grace_end">End of grace period</option>
              </Select>
            )}
          </Field>
          <Field label="Undertime grace (min)">{(p) => <Input {...p} type="number" min={0} max={240} value={r.undertimeGraceMinutes} placeholder="e.g. 0" onChange={(e) => set({ undertimeGraceMinutes: num(e.target.value) })} />}</Field>
          <Checkbox className="md:col-span-3" label="Enforce break window (late return from break and early break-out count)" checked={r.enforceBreakWindow} onChange={(e) => set({ enforceBreakWindow: e.target.checked })} />
          <Checkbox className="md:col-span-3" label="Count early arrival before schedule start as worked time" checked={r.countEarlyArrivalAsWork} onChange={(e) => set({ countEarlyArrivalAsWork: e.target.checked })} />
        </fieldset>
        <fieldset className="grid gap-3 rounded border border-slate-200 p-3 md:grid-cols-3">
          <legend className="px-1 font-semibold">Rounding</legend>
          <Field label="Increment (min)">{(p) => <Input {...p} type="number" min={1} max={60} value={r.rounding.increment} placeholder="e.g. 1" onChange={(e) => setNested('rounding', { increment: num(e.target.value) || 1 })} />}</Field>
          {['inMode', 'outMode'].map((k) => (
            <Field key={k} label={k === 'inMode' ? 'Time-in rounding' : 'Time-out rounding'}>
              {(p) => (
                <Select {...p} value={r.rounding[k]} onChange={(e) => setNested('rounding', { [k]: e.target.value })}>
                  <option value="none">None</option>
                  <option value="nearest">Nearest</option>
                  <option value="up">Up</option>
                  <option value="down">Down</option>
                </Select>
              )}
            </Field>
          ))}
        </fieldset>
        <fieldset className="grid gap-3 rounded border border-slate-200 p-3 md:grid-cols-3">
          <legend className="px-1 font-semibold">Overtime and overnight</legend>
          <Checkbox label="Compute overtime after schedule end" checked={r.overtime.enabled} onChange={(e) => setNested('overtime', { enabled: e.target.checked })} />
          <Field label="Minimum overtime (min)">{(p) => <Input {...p} type="number" min={0} max={600} value={r.overtime.minimumMinutes} placeholder="e.g. 30" onChange={(e) => setNested('overtime', { minimumMinutes: num(e.target.value) })} />}</Field>
          <Checkbox label="Overtime requires approval (flagged)" checked={r.overtime.requiresApproval} onChange={(e) => setNested('overtime', { requiresApproval: e.target.checked })} />
          <Field label="Overnight: early window (min)" hint="How early before shift start a punch still belongs to the shift">{(p) => <Input {...p} type="number" min={0} max={720} value={r.overnight.earlyWindowMinutes} placeholder="e.g. 120" onChange={(e) => setNested('overnight', { earlyWindowMinutes: num(e.target.value) })} />}</Field>
          <Field label="Overnight: late window (min)" hint="How long after shift end a next-day punch belongs to the shift">{(p) => <Input {...p} type="number" min={0} max={720} value={r.overnight.lateWindowMinutes} placeholder="e.g. 240" onChange={(e) => setNested('overnight', { lateWindowMinutes: num(e.target.value) })} />}</Field>
        </fieldset>
        <Field label="Notes (who confirmed these rules, references)">{(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Rules confirmed by HR on 2026-10-01 (memo no. …)" />}</Field>
      </div>
    </Dialog>
  );
}
