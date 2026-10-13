import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from './authContext';
import { Spinner, EmptyState } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';

export function RequireAuth() {
  const { session, profile, loading, error, signOut } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (error) {
    return (
      <EmptyState icon={ShieldAlert} title="Could not load your account" action={<Button onClick={signOut}>Sign out</Button>}>
        {error.message}
      </EmptyState>
    );
  }
  if (!profile) {
    return (
      <EmptyState icon={ShieldAlert} title="Account profile not found" action={<Button onClick={signOut}>Sign out</Button>}>
        Your login exists but has no profile. Ask a Super Admin to check your account.
      </EmptyState>
    );
  }
  if (profile.status !== 'active') {
    return (
      <EmptyState icon={ShieldAlert} title="Account suspended" action={<Button onClick={signOut}>Sign out</Button>}>
        Your account is not active. Contact your administrator.
      </EmptyState>
    );
  }
  return <Outlet />;
}

/** Route guard for a permission. The database enforces the same rule independently. */
export function RequirePermission({ permission, children }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <EmptyState icon={ShieldAlert} title="Access denied">
        Your role does not have access to this page.
      </EmptyState>
    );
  }
  return children;
}
