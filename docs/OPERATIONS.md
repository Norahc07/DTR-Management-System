# Operations

## Cut-off workflow (twice a month: days 1–15, then days 16–end of month)

1. **Import** the device export (Import Attendance). Re-importing is safe if you are unsure whether a file was already loaded.
2. **Resolve unmatched IDs**: add or fix employees, then import the same file again.
   **Wrong file imported?** Use **Delete this import** in the dashboard's "Attendance imported" message, or **Delete** in Import history. Enter a reason; the file's punches are deleted (manual entries are kept), the affected DTRs are recomputed, and the deletion is audited (migration `20261013000016_delete_import_batch.sql`). Refused while a DTR covering the file is finalized.
3. **Check the DTRs** on the dashboard: days missing an IN are listed above each DTR. A missing morning OUT prints 12:00 and a missing afternoon OUT prints the end of office hours (6:00 PM; 5:00 PM until September 2026) on the DTR and in the Excel export; the stored punches are unchanged. Lates count the morning IN after the start of office hours and the afternoon IN after 1:00 PM, judged by the slot each punch prints in; the **Lates** page shows one card per staff member with the late days of each month.
   Staff names: the DTR prints the full name (LAST NAME, First names) in (Name) and on the signature line; the short name on the biometric device is kept as the employee's **Nickname** (migration `20261013000013_staff_full_names.sql` sets the 11 active staff and deactivates anyone else).
4. **Import from the dashboard** (the DTRs are on the dashboard; there is no separate DTR page): choose **Import attendance** and select the device's "Att. record report". Confirm the **Import settings**: Month, Year and Period (1-15, 16-end, or whole month; punches outside it are not imported), the **work days** (unticked days are days off) and the office hours (default morning 7:00-12:00, afternoon 1:00-6:00 PM; late from a minute after morning IN and afternoon IN; a missing OUT prints the morning OUT / afternoon OUT time). Those hours are saved as a schedule and assigned to the imported staff for that period only (function `apply_period_schedule`, migration `20261013000018_apply_period_schedule.sql`); staff with their own days off keep them. The punches are saved, the days are computed against the office hours (until 30 Sep 2026: Mon–Fri 8:00–5:00; from 1 Oct 2026: Mon–Thu, morning IN 7:00, morning OUT 12:00, afternoon IN 1:00 PM, afternoon OUT 6:00 PM, Fri–Sun off; a minute after the start of each half is late; migration `20261013000011_dtr_remarks_and_october_schedule.sql`), and the DTRs of the imported staff open for that half of the month. When a staff member did not scan the fingerprint, HR / Super Admin click **Edit times — (name)** above that DTR, type the missing morning/afternoon IN or OUT (or correct a wrong one), give a reason, and save; the device punches are kept, each manual entry is stored with the reason and audited, and the days are recomputed (migration `20261013000009_manual_punches.sql`). For a day with no times, the same dialog has a dropdown (Day Off, OB, L, SL, WL, Seminar, Holiday); the choice prints in the merged Undertime cell and is stored and audited. For a day with times in only the morning or only the afternoon, the dropdown offers **Half day**: the empty half's IN and OUT print as one merged "HALF DAY" cell, and the undertime is still shown; for "No undertime" staff (IDs 2, 3 and 12) "HALF DAY" prints in the merged Undertime cell instead and the empty half stays blank (migration `20261015000019_half_day_remark.sql`). Staff whose **DTR format** is "No undertime" (biometric IDs 2, 3 and 12 by default; editable per employee) get no undertime figures, and their rest days (and a "Day Off" remark) print the weekday (SAT, SUN, ...) in the merged Undertime cell. **Edit all DTRs** (dashboard header) applies to every DTR shown: **Form header (this half-month)** — the "For the month of" text, regular days and hours, and rest days line (table `dtr_period_headers`, migration `20261013000014_dtr_period_headers.sql`; "Reset to the schedule" returns to the computed text) — and **Days off**: keep "Office schedule" or tick the weekdays that are this staff member's days off (stored in `employees.rest_days`, migration `20261013000012_employee_rest_days.sql`); saving recomputes the half-month shown, other days use the office hours. **Export Excel** downloads each staff member's morning IN, morning OUT, afternoon IN and afternoon OUT for the selected period. Other file layouts go through the Import Attendance page. The correction-request page has been removed from the app; correction records already in the database are kept and still shown in each day's detail.
5. **Recompute** after any change to schedules, holidays, leave, or policies for the period: import the period's file again (punches already saved are not duplicated), or save an edit for the staff member.
6. **Print / finalize** (DTR): choose the month and period (1–15 or 16–end), preview, print (two staff per A4 page), and finalize when the period is settled. Each half is finalized separately. Finalization is refused while there are pending corrections, *Missing Punch*/*Needs Review* days, days not computed, or days computed without an approved policy.
To change a finalized DTR period (days 1–15 or 16–end of month), a Super Admin revokes the finalization with a reason (audited), the fix is made and recomputed, and the DTR is finalized again.

## Backup and restore

**Supabase managed backups.** Paid Supabase plans include daily backups, and Point-in-Time Recovery is available as an add-on. Check what your plan includes under **Database → Backups** and test a restore into a separate project before relying on it.

**Your own logical backups** (recommended in addition, e.g. weekly and before upgrades). Use the connection string from **Project Settings → Database** (session pooler or direct connection) with the database password kept in your password manager:

```bash
# schema + data of the application schema and auth users
npx supabase db dump --linked -f backup_schema.sql
npx supabase db dump --linked --data-only -f backup_data.sql
# or with pg_dump directly
pg_dump "$DATABASE_URL" --schema=public --format=custom --file=dtr_public.dump
```

Store dumps encrypted, with restricted access, and apply the same retention rules as the live data (they contain personal information).

**Restore** into a new or empty project:

```bash
psql "$NEW_DATABASE_URL" -f backup_schema.sql
psql "$NEW_DATABASE_URL" -f backup_data.sql
# or
pg_restore --dbname="$NEW_DATABASE_URL" --no-owner dtr_public.dump
```

Restores must run as the `postgres` role; the immutability triggers only block API users (`authenticated`/`anon`). After restoring, verify: RLS enabled on all tables, row counts of `attendance_events`, `daily_attendance`, `audit_logs`, and a sample DTR matching the printed copy.

The `auth` schema (user accounts) is managed by Supabase. When moving to a new project, either restore auth users with the Supabase migration tooling or re-invite users and re-link profiles to employees.

## Routine maintenance

- **Account review** (monthly): suspend accounts of staff who left (Users & Roles → Suspended), check that supervisors' departments are current.
- **Holidays** (yearly): the Calendar shows the standard Philippine holidays automatically (New Year's Day, Holy Week, Araw ng Kagitingan, Labor Day, Independence Day, Ninoy Aquino Day, National Heroes Day, All Saints' Day, Bonifacio Day, Immaculate Conception, Christmas Eve and Day, Rizal Day, Last Day of the Year, and Chinese New Year for 2024-2030), and attendance counts them. When the yearly proclamation is out, add Eid'l Fitr, Eid'l Adha and any one-off days; to move or cancel a standard day, edit it on the Calendar (your version for that date replaces it, e.g. "Special working day"). Recompute affected dates afterwards.
- **Birthdays**: HR / Super Admin add each active staff member's birth date on the Calendar (**Add birthday** lists only staff without one); birthdays show on the calendar and in the Staff birthdays list (column `employees.birth_date`, migration `20261013000017_employee_birth_date.sql`).
- **Policies**: never edit rules retroactively; create a new effective-dated policy.
- **Dependencies**: run `npm audit` and update dependencies periodically, then `npm run lint && npm test && npm run build` before deploying.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Supabase is not configured" screen | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing in `.env.local` or Vercel; redeploy after setting. |
| Login works but "Account profile not found" | The user was created before the migrations were applied. In the SQL editor: `insert into public.profiles (id, email) select id, email from auth.users where id not in (select id from public.profiles);` (new profiles start as `employee`). |
| "You do not have permission to perform this action" | The role does not allow it (enforced by RLS). Check the user's role and supervised departments. |
| Password reset/invite link opens "link is invalid or has expired" | The link was already used or expired, or the URL is not in Auth redirect URLs. Request a new one. |
| Invite user fails with "invitation service is unavailable" | Deploy `admin-users` and set `SITE_URL` and `ALLOWED_ORIGINS` (see setup guide). |
| Recompute says days were skipped | Those days are in a finalized DTR period. Revoke first if a change is really needed. |
| Cannot finalize DTR | The message lists the blocker: pending corrections, unresolved days, days not computed, or no approved policy. |
| Dashboard shows "No data" or "Not computed" instead of a number | The value is unavailable (nothing imported or computed for the period yet), which is different from zero. Import and recompute the period. |
