-- 'half_day': a day with times in only the morning or only the afternoon; the
-- empty half's IN/OUT cells print merged as "HALF DAY".
alter table public.dtr_day_remarks drop constraint if exists dtr_day_remarks_remark_check;
alter table public.dtr_day_remarks
  add constraint dtr_day_remarks_remark_check
  check (remark in ('day_off', 'ob', 'l', 'sl', 'wl', 'seminar', 'holiday', 'half_day'));
