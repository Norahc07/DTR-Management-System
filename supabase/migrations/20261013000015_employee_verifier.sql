-- Optional verifier printed at the bottom of one employee's DTR (under
-- "VERIFIED as to the prescribed office hours:"). Null uses the DTR template's
-- verifier. The CeC Manager (ID 2) is verified by the Municipal Mayor.
alter table public.employees
  add column verifier_name text check (verifier_name is null or length(trim(verifier_name)) between 1 and 120),
  add column verifier_title text check (verifier_title is null or length(trim(verifier_title)) between 1 and 120);

update public.employees
set verifier_name = 'BAUTISTA ERWIN DWIGHT C. PASTRANA', verifier_title = 'Municipal Mayor'
where biometric_id = '2';
