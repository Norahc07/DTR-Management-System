-- Editing a time to a clock time that is already stored (for example 18:00)
-- reuses that punch instead of failing with "A punch already exists".
-- A previously removed punch at that time is restored. The column it was
-- typed into is recorded on display_slot.

create or replace function public.prevent_event_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if current_setting('app.allow_display_slot', true) = 'on'
       and old.display_slot is distinct from new.display_slot
       and (to_jsonb(old) - 'display_slot') = (to_jsonb(new) - 'display_slot')
    then
      return new;
    end if;
    raise exception 'Attendance events are immutable' using errcode = '42501';
  end if;
  if current_user in ('authenticated', 'anon') then
    raise exception 'Attendance events cannot be deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;

create or replace function public.manual_add_punch(p_employee_id uuid, p_date date, p_time time, p_reason text, p_slot smallint default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_emp public.employees;
  v_tz text;
  v_req uuid;
  v_event uuid;
  v_key text;
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
  v_key := v_emp.biometric_id || '|' || to_char(p_date, 'YYYY-MM-DD') || 'T' || to_char(p_time, 'HH24:MI:SS');

  perform set_config('app.audit_reason', 'Manual entry: ' || trim(p_reason), true);
  insert into public.correction_requests (employee_id, work_date, correction_type, proposed_date, proposed_time, reason, status, requested_by, reviewed_by, reviewed_at, review_remarks)
  values (p_employee_id, p_date, 'add_punch', p_date, p_time, trim(p_reason), 'approved', auth.uid(), auth.uid(), now(), 'Manual entry')
  returning id into v_req;
  begin
    insert into public.attendance_events (employee_id, biometric_id, event_time, local_date, local_time, source, correction_id, dedupe_key, raw_value, created_by, display_slot)
    values (
      v_emp.id, v_emp.biometric_id, (p_date + p_time) at time zone v_tz, p_date, p_time, 'correction', v_req,
      v_key, 'manual:' || v_req, auth.uid(), p_slot
    ) returning id into v_event;
  exception when unique_violation then
    select id into v_event from public.attendance_events where dedupe_key = v_key;
    delete from public.attendance_event_voids where event_id = v_event;
    if p_slot is not null then
      perform set_config('app.allow_display_slot', 'on', true);
      update public.attendance_events set display_slot = p_slot where id = v_event and display_slot is distinct from p_slot;
      perform set_config('app.allow_display_slot', 'off', true);
    end if;
  end;
  update public.correction_requests set created_event_id = v_event where id = v_req;
  return v_event;
end;
$$;
