-- Manual IN/OUT entry by HR / Super Admin for staff who did not use the
-- fingerprint scanner. Device punches are never edited: a manual time is a
-- new 'correction' event, and removing a time records a void. Each change is
-- stored as an approved correction request with the reason, and audited.

create or replace function public.manual_add_punch(p_employee_id uuid, p_date date, p_time time, p_reason text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_emp public.employees;
  v_tz text;
  v_req uuid;
  v_event uuid;
begin
  if not public.is_admin() then
    raise exception 'Only HR / Admin or Super Admin can enter times manually' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Enter a reason (at least 5 characters)' using errcode = '22023';
  end if;
  if public.is_dtr_finalized(p_employee_id, p_date) then
    raise exception 'The DTR for this period is finalized' using errcode = '42501';
  end if;
  select * into v_emp from public.employees where id = p_employee_id;
  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  select timezone into v_tz from public.organization_settings where id = 1;

  perform set_config('app.audit_reason', 'Manual entry: ' || trim(p_reason), true);
  insert into public.correction_requests (employee_id, work_date, correction_type, proposed_date, proposed_time, reason, status, requested_by, reviewed_by, reviewed_at, review_remarks)
  values (p_employee_id, p_date, 'add_punch', p_date, p_time, trim(p_reason), 'approved', auth.uid(), auth.uid(), now(), 'Manual entry')
  returning id into v_req;
  begin
    insert into public.attendance_events (employee_id, biometric_id, event_time, local_date, local_time, source, correction_id, dedupe_key, raw_value, created_by)
    values (
      v_emp.id, v_emp.biometric_id, (p_date + p_time) at time zone v_tz, p_date, p_time, 'correction', v_req,
      v_emp.biometric_id || '|' || to_char(p_date, 'YYYY-MM-DD') || 'T' || to_char(p_time, 'HH24:MI:SS'),
      'manual:' || v_req, auth.uid()
    ) returning id into v_event;
  exception when unique_violation then
    raise exception 'A punch already exists at % %', p_date, p_time using errcode = '23505';
  end;
  update public.correction_requests set created_event_id = v_event where id = v_req;
  return v_event;
end;
$$;

create or replace function public.manual_void_punch(p_event_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ev public.attendance_events;
  v_req uuid;
begin
  if not public.is_admin() then
    raise exception 'Only HR / Admin or Super Admin can change times manually' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Enter a reason (at least 5 characters)' using errcode = '22023';
  end if;
  select * into v_ev from public.attendance_events where id = p_event_id;
  if not found then
    raise exception 'Punch not found' using errcode = 'P0002';
  end if;
  if public.is_dtr_finalized(v_ev.employee_id, v_ev.local_date) then
    raise exception 'The DTR for this period is finalized' using errcode = '42501';
  end if;
  if exists (select 1 from public.attendance_event_voids where event_id = p_event_id) then
    return;
  end if;

  perform set_config('app.audit_reason', 'Manual removal: ' || trim(p_reason), true);
  insert into public.correction_requests (employee_id, work_date, correction_type, target_event_id, reason, status, requested_by, reviewed_by, reviewed_at, review_remarks)
  values (v_ev.employee_id, v_ev.local_date, 'void_punch', p_event_id, trim(p_reason), 'approved', auth.uid(), auth.uid(), now(), 'Manual entry')
  returning id into v_req;
  insert into public.attendance_event_voids (event_id, correction_id, voided_by) values (p_event_id, v_req, auth.uid());
end;
$$;

revoke execute on function public.manual_add_punch(uuid, date, time, text) from public, anon;
revoke execute on function public.manual_void_punch(uuid, text) from public, anon;
grant execute on function public.manual_add_punch(uuid, date, time, text) to authenticated;
grant execute on function public.manual_void_punch(uuid, text) to authenticated;
