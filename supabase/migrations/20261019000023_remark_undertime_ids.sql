-- The remarks-only Undertime layout belongs to biometric IDs 2, 3 and 12.
-- A person who replaced one of those IDs keeps the standard late/undertime figures.
update public.employees
set dtr_format = case when biometric_id in ('2', '3', '12') then 'no_undertime' else 'standard' end
where dtr_format is distinct from case when biometric_id in ('2', '3', '12') then 'no_undertime' else 'standard' end;
