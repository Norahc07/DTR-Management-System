-- Editing a DTR time voids the previous punch. If that punch was already
-- removed (for example the import that created it was deleted), the edit
-- continues and the new time is saved instead of failing with "Punch not found".
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
    return;
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
