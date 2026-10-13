-- The 12:00-13:00 lunch break is 60 unpaid minutes; without it the required
-- day was 11 hours and every day showed 60 minutes of undertime.
update public.schedule_days d
   set break_minutes = 60
  from public.work_schedules w
 where w.id = d.schedule_id
   and w.name = 'e-LearningVille Office Hours'
   and d.is_workday
   and d.break_minutes = 0;
