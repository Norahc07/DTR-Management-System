-- =============================================================================
-- DEVELOPMENT FIXTURES ONLY. Do NOT run against a production database.
-- Every fixture is prefixed "DEV" so it cannot be mistaken for real records.
-- =============================================================================

insert into public.departments (code, name) values
  ('DEV-ADM', 'DEV Fixture - Administration'),
  ('DEV-OPS', 'DEV Fixture - Operations')
on conflict (code) do nothing;

insert into public.work_schedules (name, schedule_type, description) values
  ('DEV Fixture - Mon-Fri 08:00-17:00', 'fixed', 'Development fixture. 12:00-13:00 unpaid break.'),
  ('DEV Fixture - Night 22:00-06:00', 'fixed', 'Development fixture overnight shift. 02:00-03:00 unpaid break.')
on conflict (name) do nothing;

insert into public.schedule_days (schedule_id, weekday, is_workday, start_time, end_time, break_start, break_end, break_minutes, break_paid)
select s.id, d.wd, d.wd between 1 and 5,
       case when d.wd between 1 and 5 then time '08:00' end,
       case when d.wd between 1 and 5 then time '17:00' end,
       case when d.wd between 1 and 5 then time '12:00' end,
       case when d.wd between 1 and 5 then time '13:00' end,
       case when d.wd between 1 and 5 then 60 else 0 end,
       false
from public.work_schedules s cross join generate_series(0, 6) as d(wd)
where s.name = 'DEV Fixture - Mon-Fri 08:00-17:00'
on conflict do nothing;

insert into public.schedule_days (schedule_id, weekday, is_workday, start_time, end_time, break_start, break_end, break_minutes, break_paid)
select s.id, d.wd, d.wd between 1 and 5,
       case when d.wd between 1 and 5 then time '22:00' end,
       case when d.wd between 1 and 5 then time '06:00' end,
       case when d.wd between 1 and 5 then time '02:00' end,
       case when d.wd between 1 and 5 then time '03:00' end,
       case when d.wd between 1 and 5 then 60 else 0 end,
       false
from public.work_schedules s cross join generate_series(0, 6) as d(wd)
where s.name = 'DEV Fixture - Night 22:00-06:00'
on conflict do nothing;

insert into public.employees (biometric_id, last_name, first_name, department_id, position)
select v.bio, v.last, v.first, d.id, 'DEV Fixture Position'
from (values
  ('0001', 'DEVSAMPLE', 'Alpha', 'DEV-ADM'),
  ('0002', 'DEVSAMPLE', 'Bravo', 'DEV-ADM'),
  ('0003', 'DEVSAMPLE', 'Charlie', 'DEV-OPS')
) as v(bio, last, first, dept)
join public.departments d on d.code = v.dept
on conflict (biometric_id) do nothing;

insert into public.employee_schedules (employee_id, schedule_id, effective_from)
select e.id, s.id, date '2020-01-01'
from public.employees e
cross join public.work_schedules s
where e.last_name = 'DEVSAMPLE' and s.name = 'DEV Fixture - Mon-Fri 08:00-17:00'
  and not exists (select 1 from public.employee_schedules x where x.employee_id = e.id);

insert into public.attendance_policies (name, effective_from, status, rules, notes)
values (
  'DEV Fixture - Baseline policy (requires organizational confirmation)',
  date '2020-01-01', 'draft',
  '{"graceLateMinutes":0,"pairingMode":"sequential","duplicateWindowMinutes":2,"lateAfterBreak":true,
    "rounding":{"increment":1,"inMode":"none","outMode":"none"},
    "overtime":{"enabled":false,"minimumMinutes":30,"requiresApproval":true},
    "countEarlyArrivalAsWork":false,"maxPunchesPerDay":4,
    "overnight":{"earlyWindowMinutes":240,"lateWindowMinutes":360}}'::jsonb,
  'Development fixture. Every value must be confirmed by the organization before approval.'
);
