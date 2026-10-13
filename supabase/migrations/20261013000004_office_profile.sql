-- Single-office installation: e-LearningVille, Mauban, Quezon.
-- Only fills values that are still at their generic defaults, so edits made
-- on the Settings page are never overwritten.
update public.organization_settings
set org_name = 'e-LearningVille',
    org_address = coalesce(org_address, 'Mauban, Quezon')
where id = 1 and org_name = 'Your Organization';

alter table public.organization_settings alter column org_name set default 'e-LearningVille';

-- Department name used by the biometric device report ("Dept.Name: eLearning").
insert into public.departments (code, name)
values ('ELEARNING', 'eLearning')
on conflict do nothing;
