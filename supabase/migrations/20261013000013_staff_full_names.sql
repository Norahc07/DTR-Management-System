-- Full names of the e-LearningVille staff (printed as the (Name) and signature
-- on the DTR). The short name registered on the biometric device is kept in
-- nickname, which import name checks also accept.
alter table public.employees
  add column nickname text check (nickname is null or length(trim(nickname)) between 1 and 50);

update public.employees e
set nickname = v.nickname, last_name = v.last_name, first_name = v.first_name, middle_name = null, suffix = null
from (values
  ('2', 'bal', 'MIRABUENO', 'CONCHITA MARTA B.'),
  ('3', 'jm', 'ALMARIEGO', 'JONATHAN MENGGE'),
  ('4', 'manel', 'PEÑASCOSAS', 'MARINYL MEDINA'),
  ('5', 'jc', 'ABOGA', 'JONATHAN CECILLANO'),
  ('6', 'irma', 'BEDIA', 'IRMA EBREO'),
  ('7', 'liza', 'VILLAMAYOR', 'ANNALIZA S.'),
  ('8', 'jv', 'VILLAMENA', 'JAYVEE VALLERAS'),
  ('9', 'joy', 'RAMIREZ', 'ROSECA JOY T.'),
  ('10', 'erika', 'ALQUIROS', 'ERIKA MAE PRIOLO'),
  ('12', 'rio', 'MAMORE', 'RIO ASTOVEZA'),
  ('18', 'igi', 'AMARILLO', 'LUIGI D.')
) as v (biometric_id, nickname, last_name, first_name)
where e.biometric_id = v.biometric_id;

-- Only these 11 are active staff.
update public.employees
set is_active = false, deactivated_at = now(), deactivation_reason = 'Not in the e-LearningVille active staff list'
where is_active
  and biometric_id not in ('2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '18');
