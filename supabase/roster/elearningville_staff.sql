-- e-LearningVille active staff with their full names; nickname is the name
-- registered on the biometric device.
-- Run once in the Supabase SQL editor AFTER all migrations, as an alternative
-- to Employees -> Import with data/elearningville-staff.xlsx.
-- Existing biometric IDs are left unchanged. Device ID 1 is the device
-- administrator, not staff, and is not imported.
-- dtr_format 'no_undertime': the DTR Undertime columns hold remarks only.
insert into public.employees (biometric_id, nickname, last_name, first_name, department_id, employment_status, dtr_format)
select v.biometric_id, v.nickname, v.last_name, v.first_name, d.id, 'regular', v.dtr_format
from (values
  ('2', 'bal', 'MIRABUENO', 'CONCHITA MARTA B.', 'no_undertime'),
  ('3', 'jm', 'ALMARIEGO', 'JONATHAN MENGGE', 'no_undertime'),
  ('4', 'manel', 'PEÑASCOSAS', 'MARINYL MEDINA', 'standard'),
  ('5', 'jc', 'ABOGA', 'JONATHAN CECILLANO', 'standard'),
  ('6', 'irma', 'BEDIA', 'IRMA EBREO', 'standard'),
  ('7', 'liza', 'VILLAMAYOR', 'ANNALIZA S.', 'standard'),
  ('8', 'jv', 'VILLAMENA', 'JAYVEE VALLERAS', 'standard'),
  ('9', 'joy', 'RAMIREZ', 'ROSECA JOY T.', 'standard'),
  ('10', 'erika', 'ALQUIROS', 'ERIKA MAE PRIOLO', 'standard'),
  ('12', 'rio', 'MAMORE', 'RIO ASTOVEZA', 'no_undertime'),
  ('18', 'igi', 'AMARILLO', 'LUIGI D.', 'standard')
) as v (biometric_id, nickname, last_name, first_name, dtr_format)
cross join (select id from public.departments where name = 'eLearning') d
on conflict (biometric_id) do nothing;

-- The CeC Manager's DTR is verified by the Municipal Mayor.
update public.employees
set verifier_name = 'BAUTISTA ERWIN DWIGHT C. PASTRANA', verifier_title = 'Municipal Mayor'
where biometric_id = '2' and verifier_name is null;
