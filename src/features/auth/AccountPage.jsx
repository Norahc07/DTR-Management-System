import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, Card } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { updateOwnName } from '@/features/users/userService';
import { useAuth } from './authContext';
import { ROLE_LABELS } from './permissions';
import { SetPasswordForm } from './AuthPages';

export function AccountPage() {
  const { profile, user, refreshProfile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const saveName = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateOwnName(user.id, name.trim().slice(0, 200));
      await refreshProfile();
      toast.success('Name updated');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="My account" breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Account' }]} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profile">
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Email</dt>
            <dd>{profile?.email ?? user?.email}</dd>
            <dt className="text-slate-500">Role</dt>
            <dd><Badge>{ROLE_LABELS[profile?.role] ?? '—'}</Badge></dd>
            <dt className="text-slate-500">Employee record</dt>
            <dd>{profile?.employee_id ? 'Linked' : 'Not linked — ask an administrator if you need to see your own DTR'}</dd>
          </dl>
          <form onSubmit={saveName} className="space-y-3">
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Display name">{(p) => <Input {...p} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="e.g. Juan Dela Cruz" />}</Field>
            <Button type="submit" loading={busy}>Save name</Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">Role, email, and employee link can only be changed by a Super Admin.</p>
        </Card>
        <Card title="Change password">
          <SetPasswordForm onDone={() => toast.success('Password changed')} />
        </Card>
      </div>
    </>
  );
}
