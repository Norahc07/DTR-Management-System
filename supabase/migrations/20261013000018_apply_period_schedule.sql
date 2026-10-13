-- Office hours chosen in the import dialog: work days, morning IN/OUT and
-- afternoon IN/OUT. A schedule with exactly those settings is reused (or
-- created) and assigned to the given staff for [p_start, p_end] only; their
-- other assignments are trimmed or split around that range. Late is judged
-- against the morning IN and afternoon IN. Admin only, audited, and refused
-- while a DTR in the range is finalized.
create or replace function public.apply_period_schedule(
  p_employee_ids uuid[],
  p_start date,
  p_end date,
  p_workdays smallint[],
  p_am_in time,
  p_am_out time,
  p_pm_in time,
  p_pm_out time
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_schedule uuid;
  v_emp uuid;
  v_days text;
  a record;
begin
  if not public.is_admin() then
    raise exception 'Only HR / Admin can set office hours' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 62 then
    raise exception 'Invalid period' using errcode = '22023';
  end if;
  if p_employee_ids is null or cardinality(p_employee_ids) = 0 then
    raise exception 'No staff given' using errcode = '22023';
  end if;
  if p_workdays is null or cardinality(p_workdays) = 0 or not (p_workdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]) then
    raise exception 'Choose at least one work day' using errcode = '22023';
  end if;
  if p_am_in is null or p_am_out is null or p_pm_in is null or p_pm_out is null
     or not (p_am_in < p_am_out and p_am_out <= p_pm_in and p_pm_in < p_pm_out) then
    raise exception 'Times must be in order: morning IN, morning OUT, afternoon IN, afternoon OUT' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_employee_ids) e(id), generate_series(p_start, p_end, interval '1 day') d(day)
    where public.is_dtr_finalized(e.id, d.day::date)
  ) then
    raise exception 'A DTR in this period is finalized; reopen it before changing its office hours' using errcode = '55000';
  end if;

  select string_agg((array['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[w + 1], ',' order by (w + 6) % 7)
    into v_days
    from (select distinct unnest(p_workdays) as w) x;
  v_name := format('Office hours %s-%s, %s-%s (%s)',
    to_char(p_am_in, 'HH24:MI'), to_char(p_am_out, 'HH24:MI'), to_char(p_pm_in, 'HH24:MI'), to_char(p_pm_out, 'HH24:MI'), v_days);

  perform set_config('app.audit_reason', format('Import settings: %s for %s to %s', v_name, p_start, p_end), true);

  select id into v_schedule from public.work_schedules where name = v_name;
  if v_schedule is null then
    insert into public.work_schedules (name, schedule_type, description)
    values (v_name, 'fixed', 'Created from the attendance import settings.')
    returning id into v_schedule;
    insert into public.schedule_days (schedule_id, weekday, is_workday, start_time, end_time, break_start, break_end, break_minutes, break_paid)
    select v_schedule, d::smallint, w, case when w then p_am_in end, case when w then p_pm_out end,
           case when w then p_am_out end, case when w then p_pm_in end,
           case when w then (extract(epoch from p_pm_in - p_am_out) / 60)::int else 0 end, false
    from generate_series(0, 6) d, lateral (select d::smallint = any(p_workdays) as w) x;
  end if;

  foreach v_emp in array p_employee_ids loop
    for a in
      select * from public.employee_schedules
      where employee_id = v_emp and effective_from <= p_end and (effective_to is null or effective_to >= p_start)
      order by effective_from
    loop
      if a.effective_from < p_start and (a.effective_to is null or a.effective_to > p_end) then
        update public.employee_schedules set effective_to = p_start - 1 where id = a.id;
        insert into public.employee_schedules (employee_id, schedule_id, effective_from, effective_to)
        values (v_emp, a.schedule_id, p_end + 1, a.effective_to);
      elsif a.effective_from < p_start then
        update public.employee_schedules set effective_to = p_start - 1 where id = a.id;
      elsif a.effective_to is null or a.effective_to > p_end then
        update public.employee_schedules set effective_from = p_end + 1 where id = a.id;
      else
        delete from public.employee_schedules where id = a.id;
      end if;
    end loop;
    insert into public.employee_schedules (employee_id, schedule_id, effective_from, effective_to)
    values (v_emp, v_schedule, p_start, p_end);
  end loop;

  return v_schedule;
end;
$$;

revoke execute on function public.apply_period_schedule(uuid[], date, date, smallint[], time, time, time, time) from public, anon;
grant execute on function public.apply_period_schedule(uuid[], date, date, smallint[], time, time, time, time) to authenticated;
