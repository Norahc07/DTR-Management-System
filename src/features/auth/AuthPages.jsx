import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BRAND_LOGO, BRAND_NAME } from '@/lib/brand';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Feedback';
import { useAuth } from './authContext';
import { passwordSchema } from './passwordSchema';

function AuthShell({ title, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-900 px-6 py-5 text-center">
          <img src={BRAND_LOGO} alt={BRAND_NAME} className="mx-auto h-auto w-full max-w-[16rem]" />
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-300">Daily Time Record System</p>
        </div>
        <div className="p-6">
          <h1 className="mb-4 text-lg font-semibold text-slate-900">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export function LoginPage() {
  const { session, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState(null);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(loginSchema) });
  if (session) return <Navigate to={location.state?.from || '/'} replace />;
  return (
    <AuthShell title="Sign in">
      <form
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit(async (v) => {
          setError(null);
          try {
            await signIn(v.email, v.password);
            navigate(location.state?.from || '/', { replace: true });
          } catch (e) {
            setError(e.message);
          }
        })}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Email" error={formState.errors.email?.message} required>
          {(p) => <Input {...p} type="email" autoComplete="username" placeholder="you@example.com" {...register('email')} />}
        </Field>
        <Field label="Password" error={formState.errors.password?.message} required>
          {(p) => <Input {...p} type="password" autoComplete="current-password" placeholder="Enter your password" {...register('password')} />}
        </Field>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="text-blue-700 hover:underline">
            Forgot your password?
          </Link>
        </p>
        <p className="text-center text-xs text-slate-500">Accounts are created by an administrator. There is no public sign-up.</p>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(loginSchema.pick({ email: true })) });
  return (
    <AuthShell title="Reset password">
      {sent ? (
        <Alert tone="success" title="Check your email">
          If an account exists for that address, a reset link has been sent.
        </Alert>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={handleSubmit(async ({ email }) => {
            setError(null);
            const redirectTo = `${import.meta.env.VITE_SITE_URL || window.location.origin}/reset-password`;
            const { error: e } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
            if (e && !/rate limit/i.test(e.message)) setError(e.message);
            else if (e) setError('Too many requests. Please wait a few minutes and try again.');
            else setSent(true);
          })}
        >
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email" error={formState.errors.email?.message} required>
            {(p) => <Input {...p} type="email" autoComplete="username" placeholder="you@example.com" {...register('email')} />}
          </Field>
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="text-blue-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export function SetPasswordForm({ onDone }) {
  const [error, setError] = useState(null);
  const { register, handleSubmit, formState, reset } = useForm({ resolver: zodResolver(passwordSchema) });
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit(async ({ password }) => {
        setError(null);
        const { error: e } = await supabase.auth.updateUser({ password });
        if (e) setError(e.message);
        else {
          reset();
          onDone?.();
        }
      })}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="New password" error={formState.errors.password?.message} required>
        {(p) => <Input {...p} type="password" autoComplete="new-password" placeholder="Enter a new password" {...register('password')} />}
      </Field>
      <Field label="Confirm password" error={formState.errors.confirm?.message} required>
        {(p) => <Input {...p} type="password" autoComplete="new-password" placeholder="Re-enter the new password" {...register('confirm')} />}
      </Field>
      <Button type="submit" loading={formState.isSubmitting}>
        Save password
      </Button>
    </form>
  );
}

export function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  return (
    <AuthShell title="Choose a new password">
      {loading ? null : session ? (
        <SetPasswordForm onDone={() => navigate('/', { replace: true })} />
      ) : (
        <Alert tone="warning">This reset link is invalid or has expired. Request a new one from the sign-in page.</Alert>
      )}
    </AuthShell>
  );
}
