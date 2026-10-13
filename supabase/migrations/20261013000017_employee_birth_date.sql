-- Staff birthdays shown on the calendar. Visibility follows employees RLS
-- (admins all, supervisors their departments, employees themselves); only
-- admins can set it, and changes are audited with the employee row.
alter table public.employees
  add column birth_date date check (birth_date is null or birth_date >= date '1900-01-01');
