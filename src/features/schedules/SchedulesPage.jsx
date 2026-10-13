import { useState } from 'react';
import { CalendarClock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Table, Td, Th } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { WEEKDAY_SHORT } from '@/lib/time';
import { useAuth } from '@/features/auth/authContext';
import { resolvePolicyRules } from '@/features/attendance/engine/policy';
import { deleteDraftPolicy, deleteSchedule, listPolicies, listSchedules, setPolicyStatus } from './scheduleService';
import { ScheduleDialog } from './ScheduleDialog';
import { PolicyDialog } from './PolicyDialog';

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const POLICY_TONE = { draft: 'amber', approved: 'green', retired: 'gray' };

function describeRules(rules) {
  const r = resolvePolicyRules(rules);
  return [
    `Pairing: ${r.pairingMode === 'sequential' ? 'sequential' : 'first/last'}`,
    `Grace ${r.graceLateMinutes} min (late from ${r.lateComputedFrom === 'grace_end' ? 'grace end' : 'schedule start'})`,
    `Duplicates < ${r.duplicateWindowMinutes} min`,
    r.rounding.inMode === 'none' && r.rounding.outMode === 'none' ? 'No rounding' : `Rounding ${r.rounding.increment} min (in ${r.rounding.inMode}, out ${r.rounding.outMode})`,
    r.overtime.enabled ? `OT ≥ ${r.overtime.minimumMinutes} min${r.overtime.requiresApproval ? ', needs approval' : ''}` : 'Overtime not computed',
  ].join(' · ');
}

export function SchedulesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const schedules = useAsync(() => listSchedules(), [], { cacheKey: 'schedules' });
  const policies = useAsync(() => listPolicies(), [], { cacheKey: 'policies' });
  const [scheduleDialog, setScheduleDialog] = useState(null);
  const [policyDialog, setPolicyDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);

  return (
    <>
      <PageHeader
        title="Schedules & attendance policies"
        description="Schedules define expected hours per weekday. Policies define how punches are interpreted; they are effective-dated and must be approved by a Super Admin."
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Schedules & Policies' }]}
      />
      <Card title="Work schedules" actions={<Button size="sm" icon={Plus} onClick={() => setScheduleDialog({ schedule: null })}>New schedule</Button>} bodyClassName="">
        {schedules.error ? (
          <div className="p-4"><ErrorState error={schedules.error} onRetry={schedules.reload} /></div>
        ) : schedules.loading && !schedules.data ? (
          <div className="p-4"><Skeleton /></div>
        ) : !schedules.data.length ? (
          <EmptyState icon={CalendarClock} title="No schedules yet">Create a schedule, then assign it to employees from their profile page.</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Type</Th><Th>Week</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {schedules.data.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium">{s.name}{s.description && <span className="block text-xs font-normal text-slate-500">{s.description}</span>}</Td>
                  <Td>{s.schedule_type}</Td>
                  <Td className="text-xs">
                    {s.days.filter((d) => d.is_workday).map((d) => (
                      <span key={d.weekday} className="mr-2 inline-block whitespace-nowrap">
                        <strong>{WEEKDAY_SHORT[d.weekday]}</strong> {d.start_time ? `${hhmm(d.start_time)}–${hhmm(d.end_time)}` : `${d.required_minutes} min`}
                      </span>
                    ))}
                    {!s.days.some((d) => d.is_workday) && <span className="text-slate-400">No workdays</span>}
                  </Td>
                  <Td>{s.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setScheduleDialog({ schedule: s })}>Edit</Button>
                    {can('schedules.delete') && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirm({ type: 'delete-schedule', schedule: s })}>Delete</Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Attendance policies" className="mt-4" actions={<Button size="sm" icon={Plus} onClick={() => setPolicyDialog({ policy: null })}>New draft policy</Button>} bodyClassName="">
        {policies.error ? (
          <div className="p-4"><ErrorState error={policies.error} onRetry={policies.reload} /></div>
        ) : policies.loading && !policies.data ? (
          <div className="p-4"><Skeleton /></div>
        ) : !policies.data.length ? (
          <EmptyState icon={ShieldCheck} title="No policies">Until a policy is approved, attendance is computed with baseline rules and flagged “policy not approved”. DTRs cannot be finalized.</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Effective from</Th><Th>Name</Th><Th>Rules</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {policies.data.map((p) => (
                <tr key={p.id}>
                  <Td className="font-mono">{p.effective_from}</Td>
                  <Td className="font-medium">{p.name}{p.notes && <span className="block text-xs font-normal text-slate-500">{p.notes}</span>}</Td>
                  <Td className="max-w-md text-xs">{describeRules(p.rules)}</Td>
                  <Td>
                    <Badge tone={POLICY_TONE[p.status]}>{p.status}</Badge>
                    {p.approved_at && <span className="block text-xs text-slate-500">{new Date(p.approved_at).toLocaleDateString()}</span>}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {p.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => setPolicyDialog({ policy: p })}>Edit</Button>}
                    {p.status === 'draft' && can('policies.approve') && <Button size="sm" variant="success" onClick={() => setConfirm({ type: 'approve', policy: p })}>Approve</Button>}
                    {p.status === 'approved' && can('policies.approve') && <Button size="sm" variant="ghost" onClick={() => setConfirm({ type: 'retire', policy: p })}>Retire</Button>}
                    {p.status === 'draft' && can('policies.approve') && <Button size="sm" variant="ghost" onClick={() => setConfirm({ type: 'delete', policy: p })}>Delete</Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ScheduleDialog open={Boolean(scheduleDialog)} schedule={scheduleDialog?.schedule} onClose={() => setScheduleDialog(null)} onSaved={() => { toast.success('Schedule saved'); schedules.reload(); }} />
      <PolicyDialog open={Boolean(policyDialog)} policy={policyDialog?.policy} onClose={() => setPolicyDialog(null)} onSaved={() => { toast.success('Draft policy saved'); policies.reload(); }} />
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm?.type === 'approve' ? 'Approve policy' : confirm?.type === 'retire' ? 'Retire policy' : confirm?.type === 'delete-schedule' ? 'Delete work schedule' : 'Delete draft policy'}
        tone={confirm?.type === 'approve' ? 'success' : 'danger'}
        confirmLabel={confirm?.type === 'approve' ? 'Approve' : confirm?.type === 'retire' ? 'Retire' : 'Delete'}
        onConfirm={async () => {
          if (confirm.type === 'delete-schedule') {
            await deleteSchedule(confirm.schedule.id);
            toast.success('Schedule deleted');
            schedules.reload();
            return;
          }
          const p = confirm.policy;
          if (confirm.type === 'approve') await setPolicyStatus(p.id, 'approved');
          if (confirm.type === 'retire') await setPolicyStatus(p.id, 'retired');
          if (confirm.type === 'delete') await deleteDraftPolicy(p.id);
          toast.success('Policy updated');
          policies.reload();
        }}
      >
        {confirm?.type === 'approve' && <p>Approving makes this policy apply to work dates from {confirm.policy.effective_from} (until a later approved policy). Approved rules cannot be edited. Existing summaries change only when recomputed; finalized DTR periods never change.</p>}
        {confirm?.type === 'retire' && <p>Retired policies no longer apply to any date. Dates it covered will fall back to an earlier approved policy (or baseline rules) on recompute.</p>}
        {confirm?.type === 'delete' && <p>The draft will be removed. This is audited.</p>}
        {confirm?.type === 'delete-schedule' && (
          <p>
            <strong>{confirm.schedule.name}</strong> and its weekday hours will be removed. This is only possible when no employee is assigned to it (past or present); otherwise mark it inactive instead. Computed days keep their stored hours. This is audited.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
