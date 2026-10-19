-- A time typed into a DTR column stays in that column (0 morning IN … 3
-- afternoon OUT). Imported punches have no slot and are placed automatically.
-- Whole-month DTR headers use period_half 0 (1 = days 1-15, 2 = days 16-end).
alter table public.attendance_events
  add column display_slot smallint check (display_slot is null or display_slot between 0 and 3);

alter table public.dtr_period_headers drop constraint dtr_period_headers_period_half_check;
alter table public.dtr_period_headers
  add constraint dtr_period_headers_period_half_check check (period_half in (0, 1, 2));

drop function public.manual_add_punch(uuid, date, time, text);

create function public.manual_add_punch(p_employee_id uuid, p_date date, p_time time, p_reason text, p_slot smallint default null)
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
  if p_slot is not null and p_slot not between 0 and 3 then
    raise exception 'Time column must be morning or afternoon IN or OUT' using errcode = '22023';
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
    insert into public.attendance_events (employee_id, biometric_id, event_time, local_date, local_time, source, correction_id, dedupe_key, raw_value, created_by, display_slot)
    values (
      v_emp.id, v_emp.biometric_id, (p_date + p_time) at time zone v_tz, p_date, p_time, 'correction', v_req,
      v_emp.biometric_id || '|' || to_char(p_date, 'YYYY-MM-DD') || 'T' || to_char(p_time, 'HH24:MI:SS'),
      'manual:' || v_req, auth.uid(), p_slot
    ) returning id into v_event;
  exception when unique_violation then
    raise exception 'A punch already exists at % %', p_date, p_time using errcode = '23505';
  end;
  update public.correction_requests set created_event_id = v_event where id = v_req;
  return v_event;
end;
$$;

revoke execute on function public.manual_add_punch(uuid, date, time, text, smallint) from public, anon;
grant execute on function public.manual_add_punch(uuid, date, time, text, smallint) to authenticated;
