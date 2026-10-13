-- Staff may be registered with only the single name used on the biometric
-- device (e.g. "jm"); the full legal name can be added later.
-- last_name holds that name; first_name becomes optional.
alter table public.employees drop column full_name;

alter table public.employees alter column first_name drop not null;
alter table public.employees drop constraint employees_first_name_check;
alter table public.employees add constraint employees_first_name_check
  check (first_name is null or length(trim(first_name)) between 1 and 100);

alter table public.employees add column full_name text generated always as (
  last_name
    || coalesce(', ' || nullif(first_name, ''), '')
    || coalesce(' ' || nullif(middle_name, ''), '')
    || coalesce(' ' || nullif(suffix, ''), '')
) stored;
