-- Device ID 1 is the biometric device's administrator account, not staff.
-- Deactivate it so it is left out of the staff count, DTR lists and exports.
-- Its records (if any) are kept.
update public.employees
   set is_active = false
 where biometric_id = '1'
   and lower(last_name) = 'admin'
   and is_active;
