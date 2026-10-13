-- 1) DTR format per staff member. 'no_undertime': the Undertime columns only
--    hold day remarks (Day Off, OB, L, ...) and rest days print the weekday name.
alter table public.employees
  add column dtr_format text not null default 'standard'
  check (dtr_format in ('standard', 'no_undertime'));
update public.employees set dtr_format = 'no_undertime' where biometric_id in ('2', '3', '12');

-- 2) Remarks for days without times, printed in the merged Undertime cell.
create table public.dtr_day_remarks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  work_date date not null,
  remark text not null check (remark in ('day_off', 'ob', 'l', 'sl', 'wl', 'seminar', 'holiday')),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
alter table public.dtr_day_remarks enable row level security;
create policy dtr_day_remarks_select on public.dtr_day_remarks
  for select to authenticated using (public.can_view_employee(employee_id));
create policy dtr_day_remarks_insert on public.dtr_day_remarks
  for insert to authenticated with check (public.is_admin());
create policy dtr_day_remarks_update on public.dtr_day_remarks
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy dtr_day_remarks_delete on public.dtr_day_remarks
  for delete to authenticated using (public.is_admin());
grant select, insert, update, delete on public.dtr_day_remarks to authenticated;
create trigger dtr_day_remarks_audit after insert or update or delete on public.dtr_day_remarks
  for each row execute function public.audit_row_change();

-- 3) Office hours by period:
--    until 2026-09-30: Mon-Fri 08:00-12:00 / 13:00-17:00 (late from 08:01, 13:01)
--    from  2026-10-01: Mon-Thu 07:00-12:00 / 13:00-18:00 (late from 07:01, 13:01); Fri-Sun off
insert into public.work_schedules (name, schedule_type, description)
values ('e-LearningVille Office Hours (until Sep 2026)', 'fixed', 'Mon-Fri 08:00-12:00 and 13:00-17:00; 12:00-13:00 unpaid lunch. Sat-Sun day off.')
on conflict (name) do nothing;

insert into public.schedule_days (schedule_id, weekday, is_workday, start_time, end_time, break_start, break_end, break_minutes, break_paid)
select s.id, d.wd, d.wd between 1 and 5,
       case when d.wd between 1 and 5 then time '08:00' end,
       case when d.wd between 1 and 5 then time '17:00' end,
       case when d.wd between 1 and 5 then time '12:00' end,
       case when d.wd between 1 and 5 then time '13:00' end,
       case when d.wd between 1 and 5 then 60 else 0 end,
       false
from public.work_schedules s
cross join generate_series(0, 6) as d(wd)
where s.name = 'e-LearningVille Office Hours (until Sep 2026)'
on conflict (schedule_id, weekday) do nothing;

update public.schedule_days d
   set is_workday = false, start_time = null, end_time = null, break_start = null, break_end = null, break_minutes = 0
  from public.work_schedules w
 where w.id = d.schedule_id and w.name = 'e-LearningVille Office Hours' and d.weekday = 5;
update public.work_schedules
   set description = 'From October 2026: Mon-Thu 07:00-12:00 and 13:00-18:00; 12:00-13:00 unpaid lunch. Fri-Sun day off.'
 where name = 'e-LearningVille Office Hours';

-- Staff on the open-ended office-hours assignment: the Mon-Thu schedule
-- starts 2026-10-01 and the Mon-Fri schedule covers everything before it.
update public.employee_schedules es
   set effective_from = date '2026-10-01'
  from public.work_schedules w
 where w.id = es.schedule_id and w.name = 'e-LearningVille Office Hours'
   and es.effective_from < date '2026-10-01' and es.effective_to is null;

insert into public.employee_schedules (employee_id, schedule_id, effective_from, effective_to)
select es.employee_id, old.id, date '2000-01-01', date '2026-09-30'
from public.employee_schedules es
join public.work_schedules w on w.id = es.schedule_id and w.name = 'e-LearningVille Office Hours'
cross join (select id from public.work_schedules where name = 'e-LearningVille Office Hours (until Sep 2026)') old
where es.effective_from = date '2026-10-01'
  and not exists (
    select 1 from public.employee_schedules x
    where x.employee_id = es.employee_id and x.effective_from < date '2026-10-01'
  );

-- New employees get the same two periods.
create or replace function public.assign_default_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_schedule uuid;
  v_before uuid;
begin
  select default_schedule_id into v_schedule from public.organization_settings where id = 1;
  if v_schedule is null then
    return new;
  end if;
  select id into v_before from public.work_schedules where name = 'e-LearningVille Office Hours (until Sep 2026)';
  if v_before is not null and v_schedule = (select id from public.work_schedules where name = 'e-LearningVille Office Hours') then
    insert into public.employee_schedules (employee_id, schedule_id, effective_from, effective_to)
    values (new.id, v_before, date '2000-01-01', date '2026-09-30');
    insert into public.employee_schedules (employee_id, schedule_id, effective_from)
    values (new.id, v_schedule, date '2026-10-01');
  else
    insert into public.employee_schedules (employee_id, schedule_id, effective_from)
    values (new.id, v_schedule, date '2000-01-01');
  end if;
  return new;
end;
$$;
