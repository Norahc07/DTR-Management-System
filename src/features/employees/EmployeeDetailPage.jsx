import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarPlus, FileText, Pencil, Power, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, LinkButton } from '@/components/ui/Button';
import { Alert, Badge, Card, EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Form';
import { Table, Td, Th } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/features/auth/authContext';
import { listSchedules } from '@/features/schedules/scheduleService';
import { EMPLOYMENT_STATUSES } from './employeeSchema';
import {
  assignSchedule, deleteEmployee, deleteScheduleAssignment, endScheduleAssignment, getEmployee,
  listDepartments, listEmployeeSchedules, setEmployeeActive,
} from './employeeService';
import { EmployeeFormDialog } from './EmployeeFormDialog';

const STATUS_LABEL = Object.fromEntries(EMPLOYMENT_STATUSES);

export function EmployeeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can, role } = useAuth();
  const manage = can('employees.manage');
  const emp = useAsync(() => getEmployee(id), [id], { cacheKey: 'employee' });
  const assignments = useAsync(() => listEmployeeSchedules(id), [id], { cacheKey: 'employee-schedules' });
  const depts = useAsync(() => (manage ? listDepartments() : Promise.resolve([])), [manage]);
  const [dialog, setDialog] = useState(null);

  if (emp.loading && !emp.data) return <Spinner />;
  if (emp.error) return <ErrorState error={emp.error} onRetry={emp.reload} />;
  if (!emp.data) return <EmptyState title="Employee not found">It may not exist or you may not have access to it.</EmptyState>;
  const e = emp.data;

  return (
    <>
      <PageHeader
        title={e.full_name}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Employees', to: '/employees' }, { label: e.full_name }]}
        actions={
          <>
            <LinkButton to={`/?employee=${e.id}`} icon={FileText}>
              View DTR
            </LinkButton>
            {manage && (
              <>
                <Button variant="secondary" icon={Pencil} onClick={() => setDialog('edit')}>
                  Edit
                </Button>
                <Button variant={e.is_active ? 'danger' : 'success'} icon={Power} onClick={() => setDialog('active')}>
                  {e.is_active ? 'Deactivate' : 'Reactivate'}
                </Button>
              </>
            )}
            {role === 'super_admin' && (
              <Button variant="ghost" icon={Trash2} onClick={() => setDialog('delete')}>
                Delete
              </Button>
            )}
          </>
        }
      />
      {!e.is_active && (
        <Alert tone="warning" className="mb-4" title="Inactive employee">
          Deactivated {e.deactivated_at ? new Date(e.deactivated_at).toLocaleDateString() : ''}. Reason: {e.deactivation_reason}
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-1">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Biometric ID</dt>
            <dd className="font-mono">{e.biometric_id}</dd>
            <dt className="text-slate-500">Employee no.</dt>
            <dd>{e.employee_no || '—'}</dd>
            <dt className="text-slate-500">Department</dt>
            <dd>{e.departments?.name || '—'}</dd>
            <dt className="text-slate-500">Position</dt>
            <dd>{e.position || '—'}</dd>
            <dt className="text-slate-500">Employment</dt>
            <dd>{STATUS_LABEL[e.employment_status]}</dd>
            <dt className="text-slate-500">Date hired</dt>
            <dd>{e.date_hired || '—'}</dd>
            <dt className="text-slate-500">Status</dt>
            <dd>{e.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</dd>
          </dl>
        </Card>
        <Card
          title="Schedule assignments"
          className="lg:col-span-2"
          actions={manage && <Button size="sm" icon={CalendarPlus} onClick={() => setDialog('assign')}>Assign schedule</Button>}
          bodyClassName=""
        >
          {assignments.error ? (
            <div className="p-4"><ErrorState error={assignments.error} onRetry={assignments.reload} /></div>
          ) : !assignments.data?.length ? (
            <EmptyState title="No schedule assigned">Without a schedule, days with punches are flagged for review and late/undertime cannot be computed.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Schedule</Th>
                  <Th>Effective from</Th>
                  <Th>Effective to</Th>
                  {manage && <Th />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assignments.data.map((a) => (
                  <tr key={a.id}>
                    <Td>{a.work_schedules?.name}</Td>
                    <Td>{a.effective_from}</Td>
                    <Td>{a.effective_to || <span className="text-slate-400">Open-ended</span>}</Td>
                    {manage && (
                      <Td className="text-right">
                        {!a.effective_to && (
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'end', assignment: a })}>
                            End
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'remove', assignment: a })}>
                          Remove
                        </Button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <EmployeeFormDialog
        open={dialog === 'edit'}
        employee={e}
        departments={depts.data ?? []}
        onClose={() => setDialog(null)}
        onSaved={() => {
          toast.success('Employee updated');
          emp.reload();
        }}
      />
      <ConfirmDialog
        open={dialog === 'active'}
        onClose={() => setDialog(null)}
        title={e.is_active ? 'Deactivate employee' : 'Reactivate employee'}
        tone={e.is_active ? 'danger' : 'success'}
        confirmLabel={e.is_active ? 'Deactivate' : 'Reactivate'}
        requireReason
        onConfirm={async (reason) => {
          await setEmployeeActive(e.id, !e.is_active, reason);
          toast.success(e.is_active ? 'Employee deactivated' : 'Employee reactivated');
          emp.reload();
        }}
      >
        {e.is_active ? 'Attendance history is kept. The employee will no longer appear in active lists.' : 'The employee will appear in active lists again.'}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title="Delete employee permanently"
        tone="danger"
        confirmLabel="Delete"
        onConfirm={async () => {
          await deleteEmployee(e.id);
          toast.success('Employee deleted');
          navigate('/employees');
        }}
      >
        Permanent deletion is only possible when no attendance, correction, or leave history exists. Use deactivation otherwise. This action is audited.
      </ConfirmDialog>
      <AssignScheduleDialog
        open={dialog === 'assign'}
        employeeId={e.id}
        onClose={() => setDialog(null)}
        onSaved={() => {
          toast.success('Schedule assigned');
          assignments.reload();
        }}
      />
      <EndAssignmentDialog
        assignment={dialog?.type === 'end' ? dialog.assignment : null}
        onClose={() => setDialog(null)}
        onSaved={() => {
          toast.success('Assignment ended');
          assignments.reload();
        }}
      />
      <ConfirmDialog
        open={dialog?.type === 'remove'}
        onClose={() => setDialog(null)}
        title="Remove schedule assignment"
        tone="danger"
        confirmLabel="Remove"
        onConfirm={async () => {
          await deleteScheduleAssignment(dialog.assignment.id);
          toast.success('Assignment removed');
          assignments.reload();
        }}
      >
        Remove this assignment only if it was entered by mistake. To change schedules going forward, end the current assignment and add a new one. Existing computed summaries are not changed until recomputed.
      </ConfirmDialog>
      <p className="mt-6 text-sm text-slate-500">
        Attendance for this employee: <Link className="text-blue-700 hover:underline" to={`/?employee=${e.id}`}>open the DTR</Link>.
      </p>
    </>
  );
}

function AssignScheduleDialog({ open, employeeId, onClose, onSaved }) {
  const schedules = useAsync(() => listSchedules({ includeInactive: false }), [open], { enabled: open });
  const [form, setForm] = useState({ schedule_id: '', effective_from: '', effective_to: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(null);
    if (!form.schedule_id || !form.effective_from) return setError('Choose a schedule and an effective-from date.');
    if (form.effective_to && form.effective_to < form.effective_from) return setError('Effective-to must be on or after effective-from.');
    setBusy(true);
    try {
      await assignSchedule({ employee_id: employeeId, ...form });
      onSaved();
      onClose();
      setForm({ schedule_id: '', effective_from: '', effective_to: '' });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Assign schedule" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Assign</Button></>}>
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        {schedules.data?.length === 0 && <Alert tone="warning">No active schedules exist. Create one under Schedules & Policies.</Alert>}
        <Field label="Schedule" required>
          {(p) => (
            <Select {...p} value={form.schedule_id} onChange={(e) => setForm({ ...form, schedule_id: e.target.value })}>
              <option value="">Select…</option>
              {(schedules.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Effective from" required>
          {(p) => <Input {...p} type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />}
        </Field>
        <Field label="Effective to" hint="Leave blank for open-ended. Assignments may not overlap.">
          {(p) => <Input {...p} type="date" value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} />}
        </Field>
      </div>
    </Dialog>
  );
}

function EndAssignmentDialog({ assignment, onClose, onSaved }) {
  const [date, setDate] = useState('');
  const [error, setError] = useState(null);
  return (
    <Dialog
      open={Boolean(assignment)}
      onClose={onClose}
      title="End schedule assignment"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              setError(null);
              if (!date || date < assignment.effective_from) return setError('Pick a date on or after the start date.');
              try {
                await endScheduleAssignment(assignment.id, date);
                onSaved();
                onClose();
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      {error && <Alert tone="error" className="mb-3">{error}</Alert>}
      <Field label="Last effective date" required>
        {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
    </Dialog>
  );
}
