// UI-level permission map. This only controls what is shown; the database
// enforces the same rules via RLS and SECURITY DEFINER functions.
export const ROLES = ['super_admin', 'hr_admin', 'supervisor', 'employee'];

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  hr_admin: 'HR / Admin',
  supervisor: 'Supervisor',
  employee: 'Employee',
};

const ADMINS = ['super_admin', 'hr_admin'];
const STAFF = [...ADMINS, 'supervisor'];

export const PERMISSIONS = {
  'dashboard.view': ROLES,
  'employees.view': STAFF,
  'employees.manage': ADMINS,
  'import.run': ADMINS,
  'attendance.review': STAFF,
  'attendance.recompute': ADMINS,
  'lates.view': ROLES,
  'dtr.view': ROLES,
  'dtr.edit': ADMINS,
  'dtr.finalize': ADMINS,
  'dtr.revoke': ['super_admin'],
  'reports.view': STAFF,
  'schedules.view': ROLES,
  'schedules.manage': ADMINS,
  'schedules.delete': ['super_admin'],
  'policies.approve': ['super_admin'],
  'users.manage': ['super_admin'],
  'settings.manage': ['super_admin'],
  'audit.view': ADMINS,
};

export function can(role, permission) {
  return Boolean(role && PERMISSIONS[permission]?.includes(role));
}
