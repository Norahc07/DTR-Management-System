-- =============================================================================
-- Server-side operations (SECURITY DEFINER RPCs) and audit triggers
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audit trigger: records actor, action, record, reason, before/after values.
-- A reason can be supplied for the current transaction via
--   select set_config('app.audit_reason', '...', true);
-- -----------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_record text;
  v_email text;
begin
  -- Large or derived payloads are summarized rather than duplicated.
  if tg_table_name = 'dtr_finalizations' then
    v_old := v_old - 'snapshot';
    v_new := v_new - 'snapshot';
  end if;
  if tg_table_name = 'import_batches' then
    v_old := v_old - 'mapping';
    v_new := v_new - 'mapping';
  end if;

  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;

  v_record := coalesce(v_new ->> 'id', v_old ->> 'id',
                       v_new ->> 'event_id', v_old ->> 'event_id',
                       concat_ws(':', v_new ->> 'schedule_id', v_new ->> 'weekday',
                                      v_old ->> 'schedule_id', v_old ->> 'weekday'),
                       concat_ws(':', v_new ->> 'profile_id', v_new ->> 'department_id',
                                      v_old ->> 'profile_id', v_old ->> 'department_id'));

  select email into v_email from public.profiles where id = auth.uid();

  insert into public.audit_logs (actor_id, actor_email, action, table_name, record_id, reason, old_values, new_values)
  values (
    auth.uid(),
    v_email,
    lower(tg_op),
    tg_table_name,
    v_record,
    nullif(current_setting('app.audit_reason', true), ''),
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'organization_settings', 'departments', 'work_schedules', 'schedule_days',
    'employees', 'employee_schedules', 'profiles', 'supervisor_departments',
    'attendance_policies', 'holidays', 'leave_records', 'import_batches',
    'correction_requests', 'attendance_event_voids', 'dtr_finalizations'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_row_change()',
      t || '_audit', t);
  end loop;
end;
$$;

-- Client-reported events (login, logout, print, export). Actor is always auth.uid().
create or replace function public.log_client_event(p_action text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_action not in ('login', 'logout', 'password_reset_requested', 'dtr_printed', 'report_exported') then
    raise exception 'Unsupported audit action' using errcode = '22023';
  end if;
  if pg_column_size(p_details) > 4000 then
    raise exception 'Audit details too large' using errcode = '22023';
  end if;
  insert into public.audit_logs (actor_id, actor_email, action, table_name, new_values)
  select auth.uid(), p.email, 'client:' || p_action, null, p_details
  from public.profiles p where p.id = auth.uid();
end;
$$;

-- -----------------------------------------------------------------------------
-- Correction request validation (runs for every insert)
-- -----------------------------------------------------------------------------
create or replace function public.validate_correction_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.correction_type = 'void_punch' and not exists (
    select 1 from public.attendance_events e
    where e.id = new.target_event_id and e.employee_id = new.employee_id
  ) then
    raise exception 'Target punch does not belong to this employee' using errcode = '22023';
  end if;
  if new.correction_type = 'add_punch' and new.proposed_date is null then
    new.proposed_date := new.work_date;
  end if;
  if new.work_date > (now() at time zone 'utc')::date + 1 then
    raise exception 'Corrections cannot be filed for future dates' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger correction_requests_validate before insert on public.correction_requests
  for each row execute function public.validate_correction_request();

-- -----------------------------------------------------------------------------
-- commit_import: atomically moves staged punches into attendance_events.
-- Idempotency: dedupe_key = biometric_id | local date | local time (to the second).
-- Re-importing identical punches is counted as "existing" and never duplicated.
-- -----------------------------------------------------------------------------
create or replace function public.commit_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_batch public.import_batches;
  v_tz text;
  v_staged integer;
  v_matched integer;
  v_inserted integer;
  v_unmatched integer;
  v_out_of_period integer;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to import attendance' using errcode = '42501';
  end if;

  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Import batch not found' using errcode = 'P0002';
  end if;
  if v_batch.status <> 'staging' then
    raise exception 'Import batch is already %', v_batch.status using errcode = '22023';
  end if;
  if v_batch.created_by is distinct from auth.uid() then
    raise exception 'Only the user who staged this batch can commit it' using errcode = '42501';
  end if;

  select timezone into v_tz from public.organization_settings where id = 1;

  select count(*) into v_staged from public.import_staging_events where batch_id = p_batch_id;
  if v_staged = 0 then
    raise exception 'No punches were staged for this batch' using errcode = '22023';
  end if;

  -- Overnight shifts may legitimately produce punches on the day after period_end.
  select count(*) into v_out_of_period
  from public.import_staging_events s
  where s.batch_id = p_batch_id
    and (s.local_date < v_batch.period_start or s.local_date > v_batch.period_end + 1);
  if v_out_of_period > 0 then
    raise exception '% staged punch(es) fall outside the declared import period % to %',
      v_out_of_period, v_batch.period_start, v_batch.period_end using errcode = '22023';
  end if;

  select count(*) into v_matched
  from public.import_staging_events s
  join public.employees e on e.biometric_id = s.biometric_id
  where s.batch_id = p_batch_id;

  -- Record unmatched biometric IDs (server-authoritative).
  insert into public.import_errors (batch_id, severity, code, message, biometric_id, sheet_name, raw_value)
  select p_batch_id, 'warning', 'UNMATCHED_ID',
         format('Biometric ID %s is not linked to any employee; %s punch(es) were not imported',
                u.biometric_id, u.cnt),
         u.biometric_id, u.sheet_name, left(u.source_name, 500)
  from (
    select s.biometric_id, count(*) as cnt, min(s.sheet_name) as sheet_name, min(s.source_name) as source_name
    from public.import_staging_events s
    where s.batch_id = p_batch_id
      and not exists (select 1 from public.employees e where e.biometric_id = s.biometric_id)
    group by s.biometric_id
  ) u;
  get diagnostics v_unmatched = row_count;

  with ins as (
    insert into public.attendance_events (
      employee_id, biometric_id, event_time, local_date, local_time, source,
      import_batch_id, device_event_id, dedupe_key, source_file, source_sheet,
      source_cell, raw_value, created_by
    )
    select
      e.id, s.biometric_id,
      (s.local_date + s.local_time) at time zone v_tz,
      s.local_date, s.local_time, 'import',
      p_batch_id, s.device_event_id,
      s.biometric_id || '|' || to_char(s.local_date, 'YYYY-MM-DD') || 'T' || to_char(s.local_time, 'HH24:MI:SS'),
      v_batch.file_name, s.sheet_name, s.cell_ref, s.raw_value, auth.uid()
    from public.import_staging_events s
    join public.employees e on e.biometric_id = s.biometric_id
    where s.batch_id = p_batch_id
    order by s.id
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  delete from public.import_staging_events where batch_id = p_batch_id;

  v_result := jsonb_build_object(
    'staged', v_staged,
    'matched', v_matched,
    'inserted', v_inserted,
    'existing', v_matched - v_inserted,
    'unmatched_ids', v_unmatched,
    'unmatched_punches', v_staged - v_matched
  );

  update public.import_batches
     set status = 'completed',
         events_staged = v_staged,
         events_inserted = v_inserted,
         events_existing = v_matched - v_inserted,
         summary = summary || jsonb_build_object('server', v_result),
         completed_at = now()
   where id = p_batch_id;

  return v_result;
end;
$$;

create or replace function public.fail_import(p_batch_id uuid, p_message text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.import_batches
     set status = 'failed', error_message = left(p_message, 1000), completed_at = now()
   where id = p_batch_id and status = 'staging' and created_by = auth.uid();
  delete from public.import_staging_events where batch_id = p_batch_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Corrections
-- -----------------------------------------------------------------------------
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
    if exists (
      select 1 from public.dtr_finalizations f
      where f.employee_id = v_req.employee_id
        and f.period_month = date_trunc('month', v_req.work_date)::date
        and f.status = 'finalized'
    ) then
      raise exception 'The DTR for this month is finalized; revoke it before approving corrections'
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

create or replace function public.cancel_correction(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.correction_requests
     set status = 'cancelled'
   where id = p_id and status = 'pending' and requested_by = auth.uid();
  if not found then
    raise exception 'Only your own pending requests can be cancelled' using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- DTR finalization
-- -----------------------------------------------------------------------------
create or replace function public.finalize_dtr(p_employee_id uuid, p_period_month date, p_snapshot jsonb)
returns public.dtr_finalizations
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.dtr_finalizations;
  v_month date := date_trunc('month', p_period_month)::date;
  v_pending integer;
  v_unresolved integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to finalize DTRs' using errcode = '42501';
  end if;
  if pg_column_size(p_snapshot) > 500000 then
    raise exception 'Snapshot too large' using errcode = '22023';
  end if;

  select count(*) into v_pending from public.correction_requests
   where employee_id = p_employee_id and status = 'pending'
     and work_date >= v_month and work_date < (v_month + interval '1 month');
  if v_pending > 0 then
    raise exception '% pending correction request(s) must be resolved first', v_pending using errcode = '22023';
  end if;

  select count(*) into v_unresolved from public.daily_attendance
   where employee_id = p_employee_id
     and work_date >= v_month and work_date < (v_month + interval '1 month')
     and status in ('missing_punch', 'needs_review');
  if v_unresolved > 0 then
    raise exception '% day(s) still have missing punches or need review', v_unresolved using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.daily_attendance
     where employee_id = p_employee_id
       and work_date >= v_month and work_date < (v_month + interval '1 month')
  ) then
    raise exception 'Attendance has not been computed for this month' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.daily_attendance
     where employee_id = p_employee_id
       and work_date >= v_month and work_date < (v_month + interval '1 month')
       and policy_id is null
  ) then
    raise exception 'Some days were computed without an approved attendance policy' using errcode = '22023';
  end if;

  insert into public.dtr_finalizations (employee_id, period_month, snapshot, finalized_by)
  values (p_employee_id, v_month, p_snapshot, auth.uid())
  returning * into v_row;
  return v_row;
exception when unique_violation then
  raise exception 'This DTR is already finalized' using errcode = '23505';
end;
$$;

create or replace function public.revoke_dtr(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can revoke a finalized DTR' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', p_reason, true);
  update public.dtr_finalizations
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = p_reason
   where id = p_id and status = 'finalized';
  if not found then
    raise exception 'Finalized DTR not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Employee deactivation with a mandatory reason (captured in the audit log).
create or replace function public.set_employee_active(p_employee_id uuid, p_active boolean, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', p_reason, true);
  update public.employees
     set is_active = p_active,
         deactivated_at = case when p_active then null else now() end,
         deactivation_reason = case when p_active then null else p_reason end,
         updated_by = auth.uid()
   where id = p_employee_id;
  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Aggregated dashboard figures computed under the caller's RLS scope.
create or replace function public.dashboard_summary(p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'active_employees', (select count(*) from public.employees where is_active),
    'days_computed', (select count(*) from public.daily_attendance where work_date between p_from and p_to),
    'status_counts', coalesce((
      select jsonb_object_agg(status, cnt) from (
        select status, count(*) as cnt from public.daily_attendance
        where work_date between p_from and p_to group by status
      ) s), '{}'::jsonb),
    'late_days', (select count(*) from public.daily_attendance
                  where work_date between p_from and p_to and late_minutes > 0),
    'raw_punches', (select count(*) from public.attendance_events
                    where local_date between p_from and p_to),
    'pending_corrections', (select count(*) from public.correction_requests where status = 'pending'),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object('date', work_date, 'complete', complete, 'issues', issues) order by work_date)
      from (
        select work_date,
               count(*) filter (where status in ('complete', 'approved_correction')) as complete,
               count(*) filter (where status in ('missing_punch', 'needs_review')) as issues
        from public.daily_attendance
        where work_date between p_from and p_to
        group by work_date
      ) t), '[]'::jsonb)
  )
$$;

revoke execute on all functions in schema public from public, anon;

grant execute on function
  public.log_client_event(text, jsonb),
  public.commit_import(uuid),
  public.fail_import(uuid, text),
  public.review_correction(uuid, text, text),
  public.cancel_correction(uuid),
  public.finalize_dtr(uuid, date, jsonb),
  public.revoke_dtr(uuid, text),
  public.set_employee_active(uuid, boolean, text),
  public.dashboard_summary(date, date)
to authenticated;
revoke execute on function public.audit_row_change() from public, anon, authenticated;
