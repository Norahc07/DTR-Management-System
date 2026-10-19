-- Absent is a full-day remark, printed in the merged Undertime cell on a day with no punches.
alter table public.dtr_day_remarks drop constraint if exists dtr_day_remarks_remark_check;
alter table public.dtr_day_remarks
  add constraint dtr_day_remarks_remark_check
  check (remark in ('day_off', 'ob', 'l', 'sl', 'wl', 'seminar', 'holiday', 'half_day', 'absent'));
