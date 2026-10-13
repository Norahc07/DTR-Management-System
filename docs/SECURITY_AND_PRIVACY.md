# Security and privacy

## Security model

The browser uses only the Supabase **anon/publishable key**. All authorization is enforced inside Postgres:

- **Row Level Security (RLS) is enabled on every table** in `public` (checked by `scripts/check-migrations.mjs`). `anon` has no table privileges at all.
- The user's role comes from `public.profiles`, looked up from the authenticated user id (`auth.uid()`). Roles or employee IDs sent by the browser are never trusted.
- Operations that must be atomic or need elevated checks run as `SECURITY DEFINER` functions that re-check the caller's role: `commit_import`, `fail_import`, `review_correction`, `cancel_correction`, `finalize_dtr`, `revoke_dtr`, `set_employee_active`, `log_client_event`. `dashboard_summary` runs with the caller's own permissions.
- Hiding buttons in the UI is only a convenience. Each page is also guarded by route permissions, and the database rejects anything the role may not do.
- The **service-role key** is used only inside the `admin-users` Edge Function on Supabase infrastructure. It is not in the repository, in Vite variables, or in Vercel.

### What each role can do (enforced in the database)

| Capability | Super Admin | HR/Admin | Supervisor | Employee |
| --- | --- | --- | --- | --- |
| See employees and attendance | all | all | assigned departments | own record only |
| Create/edit employees, departments, schedules, holidays, leave | ✓ | ✓ | – | – |
| Delete an employee (only if no history) | ✓ | – | – | – |
| Import attendance, recompute summaries | ✓ | ✓ | – | – |
| Request corrections | ✓ | ✓ | for visible employees | own record |
| Review corrections | ✓ (incl. own requests) | ✓ (not own) | assigned departments (not own) | – |
| Create/edit draft policies | ✓ | ✓ | – | – |
| Approve/retire policies | ✓ | – | – | – |
| Finalize DTRs | ✓ | ✓ | – | – |
| Revoke a finalized DTR | ✓ | – | – | – |
| Manage users, roles, settings | ✓ | – | – | – |
| Read the audit log | ✓ | ✓ | – | – |

### Integrity protections

- `attendance_events` (raw punches) cannot be updated by anyone and cannot be deleted by API users; there are no insert grants for API users either — punches enter only through `commit_import` and approved corrections.
- `audit_logs` is append-only (update/delete blocked by trigger; no write grants for API users). Changes to 15 tables are audited automatically with before/after values and actor.
- Profiles: only a Super Admin can change role, status, email, or employee link, and the last active Super Admin cannot be demoted or suspended.
- New accounts are always created as `employee` with no employee link, regardless of sign-up metadata.
- Approved policies are immutable; finalized DTR months lock their daily summaries.

### Upload safety

Workbooks are parsed in the browser and are **not stored** (no Supabase Storage bucket is used). Only the file name, size, SHA-256 fingerprint, mapping, validated punches, and issues are saved. Files are treated as untrusted: size limit, signature check, no macro or formula execution, value-length limits, ID format validation, and the server re-validates IDs, dates, and the period.

### Exports

CSV and XLSX exports neutralize values that spreadsheet programs could execute as formulas (cells starting with `=`, `+`, `-`, `@`). Exports run with the user's own permissions, so they contain only rows the user may see.

### Rate limiting and abuse

- Supabase Auth applies its own rate limits to sign-in, password reset, and email sending. Configure custom SMTP and review **Authentication → Rate Limits** before go-live.
- The `admin-users` function allows a Super Admin at most 10 invitations per minute per function instance.
- PostgREST requests are limited by RLS, row caps (1,000 per request), and the 62-day maximum per recompute/import. If you need stronger request limiting, put the app behind Supabase network restrictions or a gateway; it is not configured here.

## Verifying RLS on your project

Automated checks (no account needed): `npm run test:db` runs the real migrations on embedded Postgres and tests each role. To spot-check your hosted project:

1. In the app, create test accounts for each role (or use staff accounts), link the Employee account to an employee, and assign the Supervisor one department.
2. Sign in as each one and confirm: the Employee sees only their own DTR and corrections; the Supervisor sees only their department's employees on the dashboard and Lates page; neither can open Import, Users, or Settings.
3. In **SQL Editor**, impersonate a user inside a transaction that is rolled back (replace the UUID with a real `profiles.id`):

   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
   select count(*) from public.employees;          -- employee: 1 (or 0 if unlinked)
   select count(*) from public.audit_logs;         -- employee/supervisor: 0
   update public.attendance_events set local_time = '00:00' where true;  -- must fail
   rollback;
   ```

4. Confirm in **Database → Tables** that every table shows RLS enabled.

## Philippine Data Privacy Act (RA 10173) considerations

This section is guidance for planning, not legal advice. Consult your Data Protection Officer (DPO) and the current issuances of the National Privacy Commission (NPC).

- **Personal information processed:** employee names, employee/biometric numbers (device user IDs), department and position, employment status and hire date, optional birth dates (for the calendar's birthday list; only admins can set them), attendance timestamps, leave and holiday records, correction reasons, and user account emails. The system does **not** process fingerprint images or templates; those stay on the device. If your device or software stores biometric templates, that processing is separate and involves sensitive data under your own controls.
- **Lawful basis and purpose:** attendance processing is normally tied to the employment relationship and legal obligations on timekeeping and pay. Define and document the purpose (timekeeping, payroll support, compliance) and do not reuse the data for unrelated purposes.
- **Transparency:** give employees a privacy notice covering what is collected, why, who can see it (roles above), retention, and how to exercise their rights.
- **Proportionality:** only fields needed for timekeeping are stored. Avoid putting unnecessary personal details in correction reasons or remarks.
- **Data subject rights:** employees can view their own attendance and DTR, and request corrections through the app. Handle access, rectification, and objection requests through your DPO process.
- **Retention:** decide how long attendance, audit, and import records are kept (consider labor, audit, and government records rules that apply to you). The application deliberately does not delete raw punches; scheduled purges must be done by a trusted database role, documented, and audited.
- **Security measures:** RLS and role-based access, audit trail, TLS in transit, encryption at rest by Supabase, least-privilege accounts, no secrets in the frontend. Add organizational measures: account reviews, prompt suspension of departing staff, MFA for administrators if available on your plan, and secure handling of exported files and USB media.
- **Third-party processors and cross-border transfer:** Supabase and Vercel are service providers. Execute their data processing agreements, record the hosting region, and assess the cross-border transfer.
- **Breach management:** have an incident procedure. The NPC requires notification of qualifying personal data breaches within 72 hours of knowledge; check current NPC rules for criteria and format.
- **Registration and DPO:** determine whether your organization must register its data processing systems with the NPC, and designate a DPO.

## Secrets checklist

- `.env.local` and other `.env*` files are git-ignored (except `.env.example`, which holds placeholders only).
- Never put the service-role key, database password, or SMTP credentials in the repository, in `VITE_` variables, screenshots, tickets, or chat.
- Rotate the anon key and service-role key from Supabase if either is exposed; the anon key is public by design but should still be rotated if the project is abused.
