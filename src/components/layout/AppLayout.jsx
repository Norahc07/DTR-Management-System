import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  AlarmClock, CalendarClock, FileSpreadsheet, FileText, LayoutDashboard,
  LogOut, Menu, ScrollText, Settings, ShieldCheck, UserCircle, Users, X, CalendarDays,
} from 'lucide-react';
import { useAuth } from '@/features/auth/authContext';
import { ROLE_LABELS } from '@/features/auth/permissions';
import { BRAND_LOGO, BRAND_NAME } from '@/lib/brand';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view', end: true },
  { to: '/employees', label: 'Employees', icon: Users, perm: 'employees.view' },
  { to: '/import', label: 'Import Attendance', icon: FileSpreadsheet, perm: 'import.run' },
  { to: '/lates', label: 'Lates', icon: AlarmClock, perm: 'lates.view' },
  { to: '/schedules', label: 'Schedules & Policies', icon: CalendarClock, perm: 'schedules.manage' },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, perm: 'schedules.view' },
  { to: '/users', label: 'Users & Roles', icon: ShieldCheck, perm: 'users.manage' },
  { to: '/audit', label: 'Audit Log', icon: ScrollText, perm: 'audit.view' },
  { to: '/settings', label: 'Settings', icon: Settings, perm: 'settings.manage' },
];

export function AppLayout() {
  const { profile, role, can, signOut, settings } = useAuth();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => can(n.perm));

  const nav = (
    <nav aria-label="Main navigation" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-100'}`
          }
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <Brand name={settings?.org_name} />
        {nav}
      </aside>

      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            <div className="flex items-start justify-between bg-slate-900 pr-2">
              <div className="min-w-0 flex-1">
                <Brand name={settings?.org_name} />
              </div>
              <button type="button" onClick={() => setOpen(false)} className="mt-2 rounded p-2 text-slate-200 hover:bg-slate-800" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-header no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
          <button type="button" className="rounded p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <NavLink to="/account" className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-100">
            <UserCircle className="h-5 w-5 text-slate-500" aria-hidden />
            <span className="hidden text-left sm:block">
              <span className="block font-medium leading-tight text-slate-800">{profile?.full_name || profile?.email}</span>
              <span className="block text-xs leading-tight text-slate-500">{ROLE_LABELS[role]}</span>
            </span>
          </NavLink>
          <button type="button" onClick={signOut} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            <LogOut className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Brand({ name }) {
  return (
    <div className="bg-slate-900 px-4 py-3">
      <img src={BRAND_LOGO} alt={name || BRAND_NAME} className="h-auto w-full max-w-[13rem] object-contain" />
      <p className="mt-1 text-xs font-medium tracking-wide text-slate-300 uppercase">Daily Time Records</p>
    </div>
  );
}
