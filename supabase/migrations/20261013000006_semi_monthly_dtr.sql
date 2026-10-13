-- DTRs are produced twice a month: days 1-15 and days 16-end of month.
-- Finalization (and its lock on daily summaries and correction approvals)
-- now applies to one half. period_half: 1 = days 1-15, 2 = days 16-end,
-- 0 = whole month (only rows finalized before this migration).
alter table public.dtr_finalizations
  add column period_half smallint not null default 0 check (period_half in (0, 1, 2));
alter table public.dtr_finalizations alter column period_half drop default;

drop index public.dtr_finalizations_active_unique;
create unique index dtr_finalizations_active_unique
  on public.dtr_finalizations (employee_id, period_month, period_half) where status = 'finalized';

create or replace function public.dtr_half_of(p_date date)
returns smallint language sql immutable set search_path = public as $$
  select (case when extract(day from p_date) <= 15 then 1 else 2 end)::smallint
$$;

create or replace function public.is_dtr_finalized(p_employee_id uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dtr_finalizations f
     where f.employee_id = p_employee_id
       and f.period_month = date_trunc('month', p_date)::date
       and f.period_half in (0, public.dtr_half_of(p_date))
       and f.status = 'finalized'
  )
$$;

create or replace function public.prevent_finalized_summary_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := coalesce(new.employee_id, old.employee_id);
  v_date date := coalesce(new.work_date, old.work_date);
begin
  if public.is_dtr_finalized(v_emp, v_date) then
    raise exception 'DTR covering % is finalized; revoke the finalization before recomputing', v_date
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.review_correction(p_id uuid, p_decision text, p_remarks text default null)
returns public.correction_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_req public.correction_requests;
  v_emp public.employees;
  v_tz text;
  v_event_id uuid;
  v_date date;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;

  select * into v_req from public.correction_requests where id = p_id for update;
  if not found then
    raise exception 'Correction request not found' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Correction request is already %', v_req.status using errcode = '22023';
  end if;
  if not public.can_review_employee(v_req.employee_id) then
    raise exception 'Not authorized to review corrections for this employee' using errcode = '42501';
  end if;
  if v_req.requested_by = auth.uid() and not public.is_super_admin() then
    raise exception 'You cannot review your own correction request' using errcode = '42501';
  end if;
  if p_decision = 'rejected' and coalesce(length(trim(p_remarks)), 0) < 3 then
    raise exception 'Remarks are required when rejecting' using errcode = '22023';
  end if;

  if p_decision = 'approved' then
    if public.is_dtr_finalized(v_req.employee_id, v_req.work_date)
       or (v_req.proposed_date is not null and public.is_dtr_finalized(v_req.employee_id, v_req.proposed_date)) then
      raise exception 'The DTR for this period is finalized; revoke it before approving corrections'
        using errcode = '42501';
    end if;

    perform set_config('app.audit_reason', 'Correction approved: ' || v_req.reason, true);

    if v_req.correction_type = 'add_punch' then
      select * into v_emp from public.employees where id = v_req.employee_id;
      select timezone into v_tz from public.organization_settings where id = 1;
      v_date := coalesce(v_req.proposed_date, v_req.work_date);
      begin
        insert into public.attendance_events (
          employee_id, biometric_id, event_time, local_date, local_time, source,
          correction_id, dedupe_key, raw_value, created_by
        ) values (
          v_emp.id, v_emp.biometric_id,
          (v_date + v_req.proposed_time) at time zone v_tz,
          v_date, v_req.proposed_time, 'correction', v_req.id,
          v_emp.biometric_id || '|' || to_char(v_date, 'YYYY-MM-DD') || 'T' || to_char(v_req.proposed_time, 'HH24:MI:SS'),
          'correction:' || v_req.id, auth.uid()
        ) returning id into v_event_id;
      exception when unique_violation then
        raise exception 'A punch already exists at % %', v_date, v_req.proposed_time using errcode = '23505';
      end;
    elsif v_req.correction_type = 'void_punch' then
      insert into public.attendance_event_voids (event_id, correction_id, voided_by)
      values (v_req.target_event_id, v_req.id, auth.uid())
      on conflict (event_id) do nothing;
    end if;
  end if;

  update public.correction_requests
     set status = p_decision::public.request_status,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_remarks = nullif(trim(p_remarks), ''),
         created_event_id = v_event_id
   where id = p_id
   returning * into v_req;
  return v_req;
end;
$$;

drop function public.finalize_dtr(uuid, date, jsonb);

create function public.finalize_dtr(p_employee_id uuid, p_period_month date, p_period_half integer, p_snapshot jsonb)
returns public.dtr_finalizations
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.dtr_finalizations;
  v_month date := date_trunc('month', p_period_month)::date;
  v_from date;
  v_to date;
  v_pending integer;
  v_unresolved integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to finalize DTRs' using errcode = '42501';
  end if;
  if p_period_half not in (1, 2) then
    raise exception 'Period must be 1 (days 1-15) or 2 (days 16-end)' using errcode = '22023';
  end if;
  if pg_column_size(p_snapshot) > 500000 then
    raise exception 'Snapshot too large' using errcode = '22023';
  end if;
  v_from := case when p_period_half = 1 then v_month else v_month + 15 end;
  v_to := case when p_period_half = 1 then v_month + 14 else (v_month + interval '1 month')::date - 1 end;

  if public.is_dtr_finalized(p_employee_id, v_from) then
    raise exception 'This DTR is already finalized' using errcode = '23505';
  end if;

  select count(*) into v_pending from public.correction_requests
   where employee_id = p_employee_id and status = 'pending'
     and work_date between v_from and v_to;
  if v_pending > 0 then
    raise exception '% pending correction request(s) must be resolved first', v_pending using errcode = '22023';
  end if;

  select count(*) into v_unresolved from public.daily_attendance
   where employee_id = p_employee_id
     and work_date between v_from and v_to
     and status in ('missing_punch', 'needs_review');
  if v_unresolved > 0 then
    raise exception '% day(s) still have missing punches or need review', v_unresolved using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.daily_attendance
     where employee_id = p_employee_id and work_date between v_from and v_to
  ) then
    raise exception 'Attendance has not been computed for this period' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.daily_attendance
     where employee_id = p_employee_id and work_date between v_from and v_to and policy_id is null
  ) then
    raise exception 'Some days were computed without an approved attendance policy' using errcode = '22023';
  end if;

  insert into public.dtr_finalizations (employee_id, period_month, period_half, snapshot, finalized_by)
  values (p_employee_id, v_month, p_period_half, p_snapshot, auth.uid())
  returning * into v_row;
  return v_row;
exception when unique_violation then
  raise exception 'This DTR is already finalized' using errcode = '23505';
end;
$$;

revoke execute on function public.finalize_dtr(uuid, date, integer, jsonb) from public, anon;
grant execute on function public.finalize_dtr(uuid, date, integer, jsonb) to authenticated;
revoke execute on function public.is_dtr_finalized(uuid, date) from public, anon, authenticated;
revoke execute on function public.prevent_finalized_summary_change() from public, anon, authenticated;
revoke execute on function public.dtr_half_of(date) from anon;
