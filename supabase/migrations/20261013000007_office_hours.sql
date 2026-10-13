-- e-LearningVille office hours:
--   Morning IN 07:00 (07:01 or later is late), morning OUT 12:00 (lunch),
--   afternoon IN 13:00 (13:01 or later is late), afternoon OUT 18:00.
--   Monday-Friday; Saturday and Sunday are days off.
-- Every employee is assigned this schedule unless another one is set.

insert into public.work_schedules (name, schedule_type, description)
values ('e-LearningVille Office Hours', 'fixed', 'Mon-Fri 07:00-12:00 and 13:00-18:00; 12:00-13:00 unpaid lunch break. Sat-Sun day off.')
on conflict (name) do nothing;

insert into public.schedule_days (schedule_id, weekday, is_workday, start_time, end_time, break_start, break_end, break_minutes, break_paid)
select s.id, d.wd, d.wd between 1 and 5,
       case when d.wd between 1 and 5 then time '07:00' end,
       case when d.wd between 1 and 5 then time '18:00' end,
       case when d.wd between 1 and 5 then time '12:00' end,
       case when d.wd between 1 and 5 then time '13:00' end,
       case when d.wd between 1 and 5 then 60 else 0 end,
       false
from public.work_schedules s
cross join generate_series(0, 6) as d(wd)
where s.name = 'e-LearningVille Office Hours'
on conflict (schedule_id, weekday) do nothing;

-- Lateness: no grace period, so 07:01 / 13:01 count as late; the afternoon
-- arrival is checked against the end of lunch (enforceBreakWindow).
insert into public.attendance_policies (name, effective_from, status, rules, notes, approved_at)
values (
  'e-LearningVille office rules',
  date '2000-01-01',
  'approved',
  '{"graceLateMinutes":0,"undertimeGraceMinutes":0,"pairingMode":"sequential","enforceBreakWindow":true,
    "duplicateWindowMinutes":2,"maxPunchesPerDay":4,"countEarlyArrivalAsWork":false,"lateComputedFrom":"schedule_start",
    "rounding":{"increment":1,"inMode":"none","outMode":"none"},
    "overtime":{"enabled":false,"minimumMinutes":30,"requiresApproval":true},
    "overnight":{"earlyWindowMinutes":240,"lateWindowMinutes":360}}'::jsonb,
  'Late from 07:01 (morning) and 13:01 (after lunch). Set by the office.',
  now()
)
on conflict (effective_from) where status = 'approved' do nothing;

alter table public.organization_settings
  add column default_schedule_id uuid references public.work_schedules (id) on delete set null;
update public.organization_settings
   set default_schedule_id = (select id from public.work_schedules where name = 'e-LearningVille Office Hours')
 where id = 1 and default_schedule_id is null;

insert into public.employee_schedules (employee_id, schedule_id, effective_from)
select e.id, o.default_schedule_id, date '2000-01-01'
from public.employees e
cross join public.organization_settings o
where o.id = 1 and o.default_schedule_id is not null
  and not exists (select 1 from public.employee_schedules x where x.employee_id = e.id);

create or replace function public.assign_default_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_schedule uuid;
begin
  select default_schedule_id into v_schedule from public.organization_settings where id = 1;
  if v_schedule is not null then
    insert into public.employee_schedules (employee_id, schedule_id, effective_from)
    values (new.id, v_schedule, date '2000-01-01');
  end if;
  return new;
end;
$$;
revoke execute on function public.assign_default_schedule() from public, anon, authenticated;

create trigger employees_default_schedule after insert on public.employees
  for each row execute function public.assign_default_schedule();
