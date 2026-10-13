-- Edited header text of one staff member's DTR for one half-month ("For the
-- month of" and the official hours lines). Null columns use the computed text.
create table public.dtr_period_headers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  period_month date not null check (extract(day from period_month) = 1),
  period_half smallint not null check (period_half in (1, 2)),
  month_label text check (month_label is null or length(month_label) <= 60),
  regular_days text check (regular_days is null or length(regular_days) <= 40),
  regular_hours text check (regular_hours is null or length(regular_hours) <= 40),
  rest_days text check (rest_days is null or length(rest_days) <= 40),
  rest_hours text check (rest_hours is null or length(rest_hours) <= 40),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (employee_id, period_month, period_half)
);
alter table public.dtr_period_headers enable row level security;
create policy dtr_period_headers_select on public.dtr_period_headers
  for select to authenticated using (public.can_view_employee(employee_id));
create policy dtr_period_headers_insert on public.dtr_period_headers
  for insert to authenticated with check (public.is_admin());
create policy dtr_period_headers_update on public.dtr_period_headers
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy dtr_period_headers_delete on public.dtr_period_headers
  for delete to authenticated using (public.is_admin());
grant select, insert, update, delete on public.dtr_period_headers to authenticated;
create trigger dtr_period_headers_audit after insert or update or delete on public.dtr_period_headers
  for each row execute function public.audit_row_change();
