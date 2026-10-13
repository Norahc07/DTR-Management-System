-- =============================================================================
-- Authorization helpers, profile guards, and Row Level Security
-- =============================================================================

create or replace function public.app_current_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.status = 'active'
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.app_current_role() = 'super_admin', false)
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.app_current_role() in ('super_admin', 'hr_admin'), false)
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.app_current_role() is not null
$$;

create or replace function public.current_employee_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.employee_id from public.profiles p
  where p.id = auth.uid() and p.status = 'active'
$$;

create or replace function public.supervises_employee(p_employee_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.app_current_role() = 'supervisor' and exists (
    select 1
    from public.employees e
    join public.supervisor_departments sd on sd.department_id = e.department_id
    where e.id = p_employee_id and sd.profile_id = auth.uid()
  )
$$;

create or replace function public.can_view_employee(p_employee_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case public.app_current_role()
    when 'super_admin' then true
    when 'hr_admin' then true
    when 'supervisor' then
      public.supervises_employee(p_employee_id) or p_employee_id = public.current_employee_id()
    when 'employee' then p_employee_id = public.current_employee_id()
    else false
  end
$$;

-- Admins, or supervisors for employees in their departments (never themselves).
create or replace function public.can_review_employee(p_employee_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
    or (public.supervises_employee(p_employee_id)
        and p_employee_id is distinct from public.current_employee_id())
$$;

-- -----------------------------------------------------------------------------
-- Profile creation: every new auth user gets the least-privileged role.
-- Role/metadata supplied at sign-up is intentionally ignored.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    new.email,
    left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 200),
    'employee',
    'active'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Only super admins (or trusted server roles with no JWT) may change role,
-- status, employee link, or email of a profile.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.role, new.status, new.employee_id, new.email, new.id)
     is distinct from (old.role, old.status, old.employee_id, old.email, old.id)
     and not public.is_super_admin() then
    raise exception 'Only a super admin can change role, status, email, or employee link'
      using errcode = '42501';
  end if;

  if old.role = 'super_admin'
     and (new.role <> 'super_admin' or new.status <> 'active')
     and not exists (
       select 1 from public.profiles
       where role = 'super_admin' and status = 'active' and id <> old.id
     ) then
    raise exception 'Cannot remove or suspend the last active super admin'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- -----------------------------------------------------------------------------
-- Policy approval guard
-- -----------------------------------------------------------------------------
create or replace function public.guard_policy_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' and auth.uid() is not null then
      raise exception 'New policies must start as draft' using errcode = '42501';
    end if;
    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;

  if old.status in ('approved', 'retired')
     and (new.rules is distinct from old.rules
          or new.effective_from is distinct from old.effective_from) then
    raise exception 'Approved policies are immutable; create a new effective-dated policy'
      using errcode = '42501';
  end if;

  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'Retired policies cannot be reactivated' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and new.status in ('approved', 'retired')
     and auth.uid() is not null
     and not public.is_super_admin() then
    raise exception 'Only a super admin can approve or retire a policy' using errcode = '42501';
  end if;

  if new.status = 'approved' and old.status = 'draft' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end;
$$;

create trigger attendance_policies_guard before insert or update on public.attendance_policies
  for each row execute function public.guard_policy_change();

-- =============================================================================
-- Privileges: anon gets nothing; authenticated is constrained by RLS.
-- =============================================================================
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function
  public.app_current_role(), public.is_super_admin(), public.is_admin(),
  public.is_active_user(), public.current_employee_id(),
  public.supervises_employee(uuid), public.can_view_employee(uuid),
  public.can_review_employee(uuid)
to authenticated;

-- Raw events and audit logs are written only by SECURITY DEFINER functions.
revoke insert, update, delete on public.attendance_events from authenticated;
revoke insert, update, delete on public.attendance_event_voids from authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;
revoke insert, update, delete on public.dtr_finalizations from authenticated;
revoke update, delete on public.correction_requests from authenticated;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.organization_settings enable row level security;
alter table public.departments enable row level security;
alter table public.work_schedules enable row level security;
alter table public.schedule_days enable row level security;
alter table public.employees enable row level security;
alter table public.employee_schedules enable row level security;
alter table public.profiles enable row level security;
alter table public.supervisor_departments enable row level security;
alter table public.attendance_policies enable row level security;
alter table public.holidays enable row level security;
alter table public.leave_records enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_errors enable row level security;
alter table public.import_staging_events enable row level security;
alter table public.correction_requests enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_event_voids enable row level security;
alter table public.daily_attendance enable row level security;
alter table public.dtr_finalizations enable row level security;
alter table public.audit_logs enable row level security;

-- Organization settings
create policy org_settings_select on public.organization_settings
  for select to authenticated using (public.is_active_user());
create policy org_settings_update on public.organization_settings
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- Reference data readable by any active user, writable by admins
create policy departments_select on public.departments
  for select to authenticated using (public.is_active_user());
create policy departments_insert on public.departments
  for insert to authenticated with check (public.is_admin());
create policy departments_update on public.departments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy departments_delete on public.departments
  for delete to authenticated using (public.is_super_admin());

create policy work_schedules_select on public.work_schedules
  for select to authenticated using (public.is_active_user());
create policy work_schedules_insert on public.work_schedules
  for insert to authenticated with check (public.is_admin());
create policy work_schedules_update on public.work_schedules
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy work_schedules_delete on public.work_schedules
  for delete to authenticated using (public.is_super_admin());

create policy schedule_days_select on public.schedule_days
  for select to authenticated using (public.is_active_user());
create policy schedule_days_insert on public.schedule_days
  for insert to authenticated with check (public.is_admin());
create policy schedule_days_update on public.schedule_days
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy schedule_days_delete on public.schedule_days
  for delete to authenticated using (public.is_admin());

create policy holidays_select on public.holidays
  for select to authenticated using (public.is_active_user());
create policy holidays_insert on public.holidays
  for insert to authenticated with check (public.is_admin());
create policy holidays_update on public.holidays
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy holidays_delete on public.holidays
  for delete to authenticated using (public.is_admin());

create policy policies_select on public.attendance_policies
  for select to authenticated using (public.is_active_user());
create policy policies_insert on public.attendance_policies
  for insert to authenticated with check (public.is_admin());
create policy policies_update on public.attendance_policies
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy policies_delete on public.attendance_policies
  for delete to authenticated using (public.is_super_admin() and status = 'draft');

-- Employees: scoped visibility; no hard delete through the API except super admin
-- (foreign keys still block deletion when attendance history exists).
create policy employees_select on public.employees
  for select to authenticated using (public.can_view_employee(id));
create policy employees_insert on public.employees
  for insert to authenticated with check (public.is_admin());
create policy employees_update on public.employees
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy employees_delete on public.employees
  for delete to authenticated using (public.is_super_admin());

create policy employee_schedules_select on public.employee_schedules
  for select to authenticated using (public.can_view_employee(employee_id));
create policy employee_schedules_insert on public.employee_schedules
  for insert to authenticated with check (public.is_admin());
create policy employee_schedules_update on public.employee_schedules
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy employee_schedules_delete on public.employee_schedules
  for delete to authenticated using (public.is_admin());

create policy leave_select on public.leave_records
  for select to authenticated using (public.can_view_employee(employee_id));
create policy leave_insert on public.leave_records
  for insert to authenticated with check (public.is_admin());
create policy leave_update on public.leave_records
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profiles
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

create policy supervisor_departments_select on public.supervisor_departments
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());
create policy supervisor_departments_insert on public.supervisor_departments
  for insert to authenticated with check (public.is_super_admin());
create policy supervisor_departments_delete on public.supervisor_departments
  for delete to authenticated using (public.is_super_admin());

-- Imports: admins only
create policy import_batches_select on public.import_batches
  for select to authenticated using (public.is_admin());
create policy import_batches_insert on public.import_batches
  for insert to authenticated
  with check (public.is_admin() and status = 'staging' and created_by = auth.uid());

create policy import_errors_select on public.import_errors
  for select to authenticated using (public.is_admin());
create policy import_errors_insert on public.import_errors
  for insert to authenticated with check (
    public.is_admin() and exists (
      select 1 from public.import_batches b
      where b.id = batch_id and b.status = 'staging' and b.created_by = auth.uid()
    )
  );

create policy import_staging_select on public.import_staging_events
  for select to authenticated using (public.is_admin());
create policy import_staging_insert on public.import_staging_events
  for insert to authenticated with check (
    public.is_admin() and exists (
      select 1 from public.import_batches b
      where b.id = batch_id and b.status = 'staging' and b.created_by = auth.uid()
    )
  );
revoke update, delete on public.import_batches, public.import_errors, public.import_staging_events
  from authenticated;

-- Raw events (read-only through the API)
create policy attendance_events_select on public.attendance_events
  for select to authenticated using (public.can_view_employee(employee_id));
create policy attendance_event_voids_select on public.attendance_event_voids
  for select to authenticated using (
    exists (select 1 from public.attendance_events e
            where e.id = event_id and public.can_view_employee(e.employee_id))
  );

-- Daily summaries
create policy daily_attendance_select on public.daily_attendance
  for select to authenticated using (public.can_view_employee(employee_id));
create policy daily_attendance_insert on public.daily_attendance
  for insert to authenticated with check (public.is_admin());
create policy daily_attendance_update on public.daily_attendance
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy daily_attendance_delete on public.daily_attendance
  for delete to authenticated using (public.is_admin());

-- Correction requests: employees for themselves, supervisors for their scope,
-- admins for anyone. Reviews happen only through review_correction().
create policy corrections_select on public.correction_requests
  for select to authenticated using (public.can_view_employee(employee_id));
create policy corrections_insert on public.correction_requests
  for insert to authenticated with check (
    status = 'pending'
    and requested_by = auth.uid()
    and reviewed_by is null
    and created_event_id is null
    and public.can_view_employee(employee_id)
  );

-- Finalized DTRs
create policy dtr_finalizations_select on public.dtr_finalizations
  for select to authenticated using (public.can_view_employee(employee_id));

-- Audit logs: super admins can read everything; HR admins can read for review.
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (public.is_admin());
