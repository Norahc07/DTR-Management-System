-- Per-employee days off (0 = Sunday ... 6 = Saturday). Null follows the office
-- schedule; otherwise these weekdays are rest days and the other weekdays use
-- the office hours of the schedule in effect.
alter table public.employees
  add column rest_days smallint[]
  check (rest_days is null or rest_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);
