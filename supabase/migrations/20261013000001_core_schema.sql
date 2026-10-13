-- =============================================================================
-- DTR Management System - core schema
-- Timestamps are stored as timestamptz (UTC). Local wall-clock date/time of each
-- punch is also stored, interpreted in organization_settings.timezone.
-- =============================================================================

create type public.app_role as enum ('super_admin', 'hr_admin', 'supervisor', 'employee');
create type public.account_status as enum ('active', 'suspended');
create type public.employment_status as enum (
  'regular', 'probationary', 'contractual', 'casual', 'job_order',
  'resigned', 'terminated', 'retired', 'other'
);
create type public.import_status as enum ('staging', 'completed', 'failed', 'cancelled');
create type public.event_source as enum ('import', 'correction');
create type public.correction_type as enum ('add_punch', 'void_punch', 'note');
create type public.request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.holiday_type as enum ('regular', 'special_non_working', 'special_working', 'company');
create type public.policy_status as enum ('draft', 'approved', 'retired');

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Organization settings (singleton row)
-- -----------------------------------------------------------------------------
create table public.organization_settings (
  id smallint primary key default 1 check (id = 1),
  org_name text not null default 'Your Organization' check (length(org_name) between 1 and 200),
  org_address text,
  logo_url text check (logo_url is null or logo_url ~* '^https://'),
  timezone text not null default 'Asia/Manila',
  date_format text not null default 'yyyy-MM-dd'
    check (date_format in ('yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'MMM d, yyyy')),
  print_paper text not null default 'A4' check (print_paper in ('A4', 'Letter')),
  dtr_template jsonb not null default '{}'::jsonb,
  import_config jsonb not null default '{}'::jsonb,
  max_import_file_mb integer not null default 10 check (max_import_file_mb between 1 and 50),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create or replace function public.validate_timezone()
returns trigger language plpgsql as $$
begin
  perform now() at time zone new.timezone;
  return new;
exception when others then
  raise exception 'Invalid timezone: %', new.timezone using errcode = '22023';
end;
$$;

create trigger organization_settings_tz before insert or update on public.organization_settings
  for each row execute function public.validate_timezone();
create trigger organization_settings_touch before update on public.organization_settings
  for each row execute function public.touch_updated_at();

insert into public.organization_settings (id) values (1);

-- -----------------------------------------------------------------------------
-- Departments
-- -----------------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9_-]{1,20}$'),
  name text not null unique check (length(trim(name)) between 1 and 150),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger departments_touch before update on public.departments
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Work schedules (per-weekday rules)
-- -----------------------------------------------------------------------------
create table public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 100),
  schedule_type text not null default 'fixed' check (schedule_type in ('fixed', 'flexible')),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger work_schedules_touch before update on public.work_schedules
  for each row execute function public.touch_updated_at();

-- weekday: 0 = Sunday ... 6 = Saturday
create table public.schedule_days (
  schedule_id uuid not null references public.work_schedules (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  is_workday boolean not null default true,
  start_time time,
  end_time time,
  break_start time,
  break_end time,
  break_minutes integer not null default 0 check (break_minutes between 0 and 480),
  break_paid boolean not null default false,
  required_minutes integer check (required_minutes is null or required_minutes between 1 and 1440),
  core_start time,
  core_end time,
  primary key (schedule_id, weekday),
  check (not is_workday or (start_time is not null and end_time is not null) or required_minutes is not null),
  check ((break_start is null) = (break_end is null))
);

-- -----------------------------------------------------------------------------
-- Employees
-- -----------------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  biometric_id text not null unique check (biometric_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  employee_no text unique check (employee_no is null or length(employee_no) <= 40),
  last_name text not null check (length(trim(last_name)) between 1 and 100),
  first_name text not null check (length(trim(first_name)) between 1 and 100),
  middle_name text check (middle_name is null or length(middle_name) <= 100),
  suffix text check (suffix is null or length(suffix) <= 20),
  full_name text generated always as (
    last_name || ', ' || first_name
      || coalesce(' ' || nullif(middle_name, ''), '')
      || coalesce(' ' || nullif(suffix, ''), '')
  ) stored,
  department_id uuid references public.departments (id) on delete restrict,
  position text check (position is null or length(position) <= 150),
  employment_status public.employment_status not null default 'regular',
  date_hired date,
  is_active boolean not null default true,
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (is_active or deactivation_reason is not null)
);
create index employees_department_idx on public.employees (department_id);
create index employees_name_idx on public.employees (lower(last_name), lower(first_name));
create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();

create table public.employee_schedules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  schedule_id uuid not null references public.work_schedules (id) on delete restrict,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (effective_to is null or effective_to >= effective_from)
);
create index employee_schedules_lookup on public.employee_schedules (employee_id, effective_from);

create or replace function public.check_schedule_overlap()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.employee_schedules s
    where s.employee_id = new.employee_id
      and s.id <> new.id
      and daterange(s.effective_from, s.effective_to, '[]')
          && daterange(new.effective_from, new.effective_to, '[]')
  ) then
    raise exception 'Schedule assignment overlaps an existing assignment for this employee'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;
create trigger employee_schedules_overlap before insert or update on public.employee_schedules
  for each row execute function public.check_schedule_overlap();

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users) and supervisor scope
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text check (full_name is null or length(full_name) <= 200),
  role public.app_role not null default 'employee',
  status public.account_status not null default 'active',
  employee_id uuid unique references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create table public.supervisor_departments (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, department_id)
);

-- -----------------------------------------------------------------------------
-- Attendance policies (effective-dated, approval required)
-- -----------------------------------------------------------------------------
create table public.attendance_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 150),
  effective_from date not null,
  status public.policy_status not null default 'draft',
  rules jsonb not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz
);
create unique index attendance_policies_effective_unique
  on public.attendance_policies (effective_from) where status = 'approved';

-- -----------------------------------------------------------------------------
-- Holidays and leave
-- -----------------------------------------------------------------------------
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null check (length(trim(name)) between 1 and 150),
  holiday_type public.holiday_type not null default 'regular',
  created_at timestamptz not null default now(),
  unique (holiday_date, name)
);
create index holidays_date_idx on public.holidays (holiday_date);

create table public.leave_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  start_date date not null,
  end_date date not null,
  leave_type text not null check (length(trim(leave_type)) between 1 and 60),
  is_cancelled boolean not null default false,
  remarks text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index leave_records_employee_idx on public.leave_records (employee_id, start_date);

-- -----------------------------------------------------------------------------
-- Imports
-- -----------------------------------------------------------------------------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null check (length(file_name) between 1 and 255),
  file_size integer not null check (file_size > 0),
  file_sha256 text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  adapter text not null check (adapter in ('matrix', 'rows')),
  mapping jsonb not null default '{}'::jsonb,
  period_start date not null,
  period_end date not null,
  status public.import_status not null default 'staging',
  summary jsonb not null default '{}'::jsonb,
  events_staged integer not null default 0,
  events_inserted integer,
  events_existing integer,
  error_message text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (period_end >= period_start and period_end - period_start <= 62)
);
create index import_batches_created_idx on public.import_batches (created_at desc);
create index import_batches_hash_idx on public.import_batches (file_sha256);

create table public.import_errors (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  severity text not null check (severity in ('error', 'warning')),
  code text not null check (length(code) <= 60),
  message text not null check (length(message) <= 1000),
  sheet_name text,
  cell_ref text,
  biometric_id text,
  raw_value text check (raw_value is null or length(raw_value) <= 500),
  created_at timestamptz not null default now()
);
create index import_errors_batch_idx on public.import_errors (batch_id);

create table public.import_staging_events (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  biometric_id text not null check (biometric_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  source_name text,
  local_date date not null,
  local_time time not null,
  device_event_id text check (device_event_id is null or length(device_event_id) <= 64),
  sheet_name text,
  cell_ref text,
  raw_value text check (raw_value is null or length(raw_value) <= 500)
);
create index import_staging_batch_idx on public.import_staging_events (batch_id);

-- -----------------------------------------------------------------------------
-- Raw attendance events (immutable biometric evidence)
-- -----------------------------------------------------------------------------
create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  work_date date not null,
  correction_type public.correction_type not null,
  proposed_date date,
  proposed_time time,
  target_event_id uuid,
  reason text not null check (length(trim(reason)) between 5 and 1000),
  status public.request_status not null default 'pending',
  requested_by uuid not null default auth.uid(),
  requested_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_remarks text check (review_remarks is null or length(review_remarks) <= 1000),
  created_event_id uuid,
  check (correction_type <> 'add_punch' or proposed_time is not null),
  check (correction_type <> 'void_punch' or target_event_id is not null),
  check (proposed_date is null or proposed_date between work_date and work_date + 1)
);
create index correction_requests_employee_idx on public.correction_requests (employee_id, work_date);
create index correction_requests_status_idx on public.correction_requests (status);

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  biometric_id text not null,
  event_time timestamptz not null,
  local_date date not null,
  local_time time not null,
  source public.event_source not null,
  import_batch_id uuid references public.import_batches (id) on delete restrict,
  correction_id uuid references public.correction_requests (id) on delete restrict,
  device_event_id text,
  dedupe_key text not null unique,
  source_file text,
  source_sheet text,
  source_cell text,
  raw_value text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((source = 'import') = (import_batch_id is not null)),
  check ((source = 'correction') = (correction_id is not null))
);
create index attendance_events_employee_date_idx on public.attendance_events (employee_id, local_date);
create index attendance_events_batch_idx on public.attendance_events (import_batch_id);
create unique index attendance_events_device_unique
  on public.attendance_events (biometric_id, device_event_id) where device_event_id is not null;

alter table public.correction_requests
  add constraint correction_requests_target_fk
  foreign key (target_event_id) references public.attendance_events (id) on delete restrict;
alter table public.correction_requests
  add constraint correction_requests_created_event_fk
  foreign key (created_event_id) references public.attendance_events (id) on delete restrict;

-- Voiding an event never deletes it; it records an approved correction.
create table public.attendance_event_voids (
  event_id uuid primary key references public.attendance_events (id) on delete restrict,
  correction_id uuid not null references public.correction_requests (id) on delete restrict,
  voided_by uuid,
  voided_at timestamptz not null default now()
);

create or replace function public.prevent_event_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Attendance events are immutable' using errcode = '42501';
  end if;
  -- Deletion only for trusted maintenance roles (retention purges), never API users.
  if current_user in ('authenticated', 'anon') then
    raise exception 'Attendance events cannot be deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger attendance_events_immutable before update or delete on public.attendance_events
  for each row execute function public.prevent_event_mutation();

-- -----------------------------------------------------------------------------
-- Derived daily summaries
-- -----------------------------------------------------------------------------
create table public.daily_attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  work_date date not null,
  status text not null check (status in (
    'complete', 'missing_punch', 'rest_day', 'leave', 'holiday',
    'no_punches', 'no_data', 'needs_review', 'approved_correction'
  )),
  flags text[] not null default '{}',
  punches jsonb not null default '[]'::jsonb,
  worked_minutes integer not null default 0 check (worked_minutes >= 0),
  late_minutes integer not null default 0 check (late_minutes >= 0),
  undertime_minutes integer not null default 0 check (undertime_minutes >= 0),
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  break_deducted_minutes integer not null default 0 check (break_deducted_minutes >= 0),
  schedule_id uuid references public.work_schedules (id) on delete set null,
  schedule_snapshot jsonb,
  policy_id uuid references public.attendance_policies (id) on delete restrict,
  breakdown jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now(),
  computed_by uuid,
  unique (employee_id, work_date)
);
create index daily_attendance_date_idx on public.daily_attendance (work_date);
create index daily_attendance_status_idx on public.daily_attendance (status, work_date);

-- -----------------------------------------------------------------------------
-- Finalized DTRs
-- -----------------------------------------------------------------------------
create table public.dtr_finalizations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  period_month date not null check (extract(day from period_month) = 1),
  status text not null default 'finalized' check (status in ('finalized', 'revoked')),
  snapshot jsonb not null,
  finalized_by uuid not null,
  finalized_at timestamptz not null default now(),
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text
);
create unique index dtr_finalizations_active_unique
  on public.dtr_finalizations (employee_id, period_month) where status = 'finalized';

create or replace function public.prevent_finalized_summary_change()
returns trigger language plpgsql as $$
declare
  v_emp uuid := coalesce(new.employee_id, old.employee_id);
  v_date date := coalesce(new.work_date, old.work_date);
begin
  if exists (
    select 1 from public.dtr_finalizations f
    where f.employee_id = v_emp
      and f.period_month = date_trunc('month', v_date)::date
      and f.status = 'finalized'
  ) then
    raise exception 'DTR for % is finalized; revoke the finalization before recomputing', to_char(v_date, 'YYYY-MM')
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger daily_attendance_finalized_lock before insert or update or delete on public.daily_attendance
  for each row execute function public.prevent_finalized_summary_change();

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  action text not null,
  table_name text,
  record_id text,
  reason text,
  old_values jsonb,
  new_values jsonb
);
create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);
create index audit_logs_table_idx on public.audit_logs (table_name, record_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

create or replace function public.prevent_audit_mutation()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'Audit logs are append-only' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_mutation();
