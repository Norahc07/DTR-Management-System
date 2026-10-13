import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { Alert, Badge, Spinner } from '@/components/ui/Feedback';
import { Table, Td, Th } from '@/components/ui/Table';
import { useAsync } from '@/hooks/useAsync';
import { createDepartment, listDepartments, updateDepartment } from './employeeService';

export function DepartmentsDialog({ open, onClose }) {
  const list = useAsync(() => listDepartments({ includeInactive: true }), [open], { enabled: open });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    setError(null);
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(code)) return setError('Code: 1-20 letters, numbers, dash or underscore.');
    if (!name.trim()) return setError('Name is required.');
    setBusy(true);
    try {
      await createDepartment({ code: code.trim(), name: name.trim() });
      setCode('');
      setName('');
      list.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (d) => {
    try {
      await updateDepartment(d.id, { is_active: !d.is_active });
      list.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Departments" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <form onSubmit={add} className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="Code" className="w-32">
          {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} placeholder="e.g. ELV" />}
        </Field>
        <Field label="Name" className="min-w-48 flex-1">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder="e.g. e-LearningVille" />}
        </Field>
        <Button type="submit" loading={busy}>
          Add
        </Button>
      </form>
      {error && <Alert tone="error" className="mb-3">{error}</Alert>}
      {list.loading && !list.data ? (
        <Spinner />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(list.data ?? []).map((d) => (
              <tr key={d.id}>
                <Td className="font-mono">{d.code}</Td>
                <Td>{d.name}</Td>
                <Td>{d.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => toggle(d)}>
                    {d.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Dialog>
  );
}
