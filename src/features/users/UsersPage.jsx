import { useMemo, useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/Form';
import { Table, Td, Th } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/features/auth/authContext';
import { ROLES, ROLE_LABELS } from '@/features/auth/permissions';
import { listAllEmployees, listDepartments } from '@/features/employees/employeeService';
import { inviteUser, listProfiles, setSupervisorDepartments, updateProfile } from './userService';

const ROLE_TONE = { super_admin: 'purple', hr_admin: 'blue', supervisor: 'amber', employee: 'gray' };

function EmployeeSelect({ employees, value, onChange, takenIds, id, ...rest }) {
  return (
    <Select id={id} {...rest} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not linked</option>
      {employees.map((e) => (
        <option key={e.id} value={e.id} disabled={takenIds.has(e.id) && e.id !== value}>
          {e.full_name} ({e.biometric_id}){takenIds.has(e.id) && e.id !== value ? ' — linked to another account' : ''}
        </option>
      ))}
    </Select>
  );
}

function UserDialog({ open, user, employees, departments, takenIds, onClose, onSaved }) {
  const { user: me } = useAuth();
  const [form, setForm] = useState(null);
  const [deps, setDeps] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState(null);
  const key = open ? user?.id ?? 'new' : null;
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      setForm({ email: user?.email ?? '', full_name: user?.full_name ?? '', role: user?.role ?? 'employee', status: user?.status ?? 'active', employee_id: user?.employee_id ?? '' });
      setDeps((user?.supervisor_departments ?? []).map((d) => d.department_id));
      setError(null);
    }
  }
  if (!form) return null;
  const isNew = !user;
  const isSelf = user?.id === me?.id;

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (isNew) {
        await inviteUser(form);
      } else {
        await updateProfile(user.id, form);
        const current = (user.supervisor_departments ?? []).map((d) => d.department_id);
        await setSupervisorDepartments(user.id, form.role === 'supervisor' ? deps : [], current);
      }
      onSaved(isNew ? `Invitation sent to ${form.email}` : 'User updated');
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={isNew ? 'Invite user' : `Edit ${user.email}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{isNew ? 'Send invitation' : 'Save'}</Button></>}>
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        {isNew && <Alert tone="info">An invitation email is sent by Supabase Auth. The person sets their own password from the link. Requires the <code>admin-users</code> Edge Function to be deployed.</Alert>}
        {isSelf && <Alert tone="warning">You are editing your own account. The system will not allow removing the last active Super Admin.</Alert>}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Email" required>{(p) => <Input {...p} type="email" value={form.email} placeholder="name@example.com" disabled={!isNew} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
          <Field label="Display name">{(p) => <Input {...p} value={form.full_name} maxLength={200} placeholder="e.g. Juan Dela Cruz" onChange={(e) => setForm({ ...form, full_name: e.target.value })} />}</Field>
          <Field label="Role" required>
            {(p) => (
              <Select {...p} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
            )}
          </Field>
          {!isNew && (
            <Field label="Account status">
              {(p) => (
                <Select {...p} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </Select>
              )}
            </Field>
          )}
          <Field label="Linked employee record" hint="Lets the user see their own attendance and DTR" className="md:col-span-2">
            {(p) => <EmployeeSelect {...p} employees={employees} takenIds={takenIds} value={form.employee_id} onChange={(v) => setForm({ ...form, employee_id: v })} />}
          </Field>
        </div>
        {!isNew && form.role === 'supervisor' && (
          <fieldset className="rounded border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium">Supervised departments</legend>
            {!departments.length && <p className="text-sm text-slate-500">No departments exist yet.</p>}
            <div className="grid gap-1 md:grid-cols-2">
              {departments.map((d) => (
                <Checkbox key={d.id} label={`${d.name} (${d.code})`} checked={deps.includes(d.id)} onChange={(e) => setDeps(e.target.checked ? [...deps, d.id] : deps.filter((x) => x !== d.id))} />
              ))}
            </div>
          </fieldset>
        )}
        {isNew && form.role === 'supervisor' && <p className="text-xs text-slate-500">Assign supervised departments by editing the user after the invitation is sent.</p>}
      </div>
    </Dialog>
  );
}

export function UsersPage() {
  const toast = useToast();
  const profiles = useAsync(() => listProfiles(), [], { cacheKey: 'users' });
  const employees = useAsync(() => listAllEmployees(), [], { cacheKey: 'users-employees' });
  const departments = useAsync(() => listDepartments(), [], { cacheKey: 'users-departments' });
  const [dialog, setDialog] = useState(null);
  const [search, setSearch] = useState('');

  const takenIds = useMemo(() => new Set((profiles.data ?? []).map((p) => p.employee_id).filter(Boolean)), [profiles.data]);
  const deptName = useMemo(() => new Map((departments.data ?? []).map((d) => [d.id, d.name])), [departments.data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (profiles.data ?? []).filter((p) => !q || `${p.email} ${p.full_name ?? ''} ${p.employees?.full_name ?? ''}`.toLowerCase().includes(q));
  }, [profiles.data, search]);

  const loadError = profiles.error || employees.error || departments.error;
  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Accounts are created by invitation only. Public sign-up must be disabled in Supabase Auth. Roles are enforced by the database, not only by this screen."
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Users & Roles' }]}
        actions={<Button icon={UserPlus} onClick={() => setDialog({ user: null })} disabled={!employees.data || !departments.data}>Invite user</Button>}
      />
      <Card bodyClassName="">
        <div className="border-b border-slate-200 p-3">
          <Input type="search" aria-label="Search users" placeholder="Search email or name" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        </div>
        {loadError ? (
          <div className="p-4"><ErrorState error={loadError} onRetry={() => { profiles.reload(); employees.reload(); departments.reload(); }} /></div>
        ) : profiles.loading && !profiles.data ? (
          <div className="p-4"><Skeleton /></div>
        ) : !rows.length ? (
          <EmptyState icon={Users} title={search ? 'No users match the search' : 'No users'} />
        ) : (
          <Table>
            <thead><tr><Th>Email</Th><Th>Name</Th><Th>Role</Th><Th>Status</Th><Th>Employee record</Th><Th>Supervises</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.email}</Td>
                  <Td>{p.full_name ?? '—'}</Td>
                  <Td><Badge tone={ROLE_TONE[p.role]}>{ROLE_LABELS[p.role]}</Badge></Td>
                  <Td>{p.status === 'active' ? <Badge tone="green">Active</Badge> : <Badge tone="red">Suspended</Badge>}</Td>
                  <Td>{p.employees ? `${p.employees.full_name} (${p.employees.biometric_id})` : <span className="text-slate-400">Not linked</span>}</Td>
                  <Td className="text-xs">{p.role === 'supervisor' ? (p.supervisor_departments ?? []).map((d) => deptName.get(d.department_id) ?? '—').join(', ') || <span className="text-amber-700">None assigned</span> : ''}</Td>
                  <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setDialog({ user: p })} disabled={!employees.data || !departments.data}>Edit</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <UserDialog
        open={Boolean(dialog)}
        user={dialog?.user}
        employees={employees.data ?? []}
        departments={departments.data ?? []}
        takenIds={takenIds}
        onClose={() => setDialog(null)}
        onSaved={(msg) => { toast.success(msg); profiles.reload(); }}
      />
    </>
  );
}
