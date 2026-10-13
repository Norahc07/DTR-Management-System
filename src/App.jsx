import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { RequireAuth, RequirePermission } from '@/features/auth/RequireAuth';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage } from '@/features/auth/AuthPages';

const page = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));

const DashboardPage = page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage');
const EmployeesPage = page(() => import('@/features/employees/EmployeesPage'), 'EmployeesPage');
const EmployeeDetailPage = page(() => import('@/features/employees/EmployeeDetailPage'), 'EmployeeDetailPage');
const ImportPage = page(() => import('@/features/import/ImportPage'), 'ImportPage');
const ImportHistoryPage = page(() => import('@/features/import/ImportHistoryPages'), 'ImportHistoryPage');
const ImportBatchPage = page(() => import('@/features/import/ImportHistoryPages'), 'ImportBatchPage');
const LatesPage = page(() => import('@/features/lates/LatesPage'), 'LatesPage');
const SchedulesPage = page(() => import('@/features/schedules/SchedulesPage'), 'SchedulesPage');
const CalendarPage = page(() => import('@/features/schedules/CalendarPage'), 'CalendarPage');
const UsersPage = page(() => import('@/features/users/UsersPage'), 'UsersPage');
const AuditPage = page(() => import('@/features/audit/AuditPage'), 'AuditPage');
const SettingsPage = page(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const AccountPage = page(() => import('@/features/auth/AccountPage'), 'AccountPage');

const guarded = (permission, element) => <RequirePermission permission={permission}>{element}</RequirePermission>;

function DtrRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/${search}`} replace />;
}

function NotFound() {
  return (
    <EmptyState title="Page not found" action={<Link className="text-blue-700 hover:underline" to="/">Go to dashboard</Link>}>
      The page you requested does not exist.
    </EmptyState>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={guarded('dashboard.view', <DashboardPage />)} />
            <Route path="employees" element={guarded('employees.view', <EmployeesPage />)} />
            <Route path="employees/:id" element={guarded('employees.view', <EmployeeDetailPage />)} />
            <Route path="import" element={guarded('import.run', <ImportPage />)} />
            <Route path="import/history" element={guarded('import.run', <ImportHistoryPage />)} />
            <Route path="import/history/:id" element={guarded('import.run', <ImportBatchPage />)} />
            <Route path="lates" element={guarded('lates.view', <LatesPage />)} />
            <Route path="dtr" element={<DtrRedirect />} />
            <Route path="schedules" element={guarded('schedules.manage', <SchedulesPage />)} />
            <Route path="calendar" element={guarded('schedules.view', <CalendarPage />)} />
            <Route path="users" element={guarded('users.manage', <UsersPage />)} />
            <Route path="audit" element={guarded('audit.view', <AuditPage />)} />
            <Route path="settings" element={guarded('settings.manage', <SettingsPage />)} />
            <Route path="account" element={<AccountPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
