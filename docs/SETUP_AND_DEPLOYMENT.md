# Setup and deployment

This guide takes a new Supabase project and Vercel project to a working installation. None of these steps have been performed for you; each needs access to your own accounts.

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com). Choose a region close to your users (for the Philippines, Singapore `ap-southeast-1` is the nearest) and record the region in your privacy documentation (see [Security and privacy](SECURITY_AND_PRIVACY.md)).
2. Use a strong database password and store it in your organization's password manager, not in this repository.
3. From **Project Settings → API**, note the **Project URL** and the **anon / publishable key**. The **service-role key** on the same page must never be copied into this repository, a `.env` file used by Vite, Vercel environment variables, or chat/email.

## 2. Apply the database migrations

The schema is in `supabase/migrations/` and must be applied in filename order:

1. `20261013000001_core_schema.sql` — tables, constraints, immutability triggers.
2. `20261013000002_security.sql` — role helper functions, profile creation trigger, grants, Row Level Security policies.
3. `20261013000003_operations_audit.sql` — audit triggers and server-side operations (import commit, corrections, DTR finalization, dashboard).

**Option A — Supabase CLI (recommended):**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**Option B — SQL editor:** open each file in order in **SQL Editor**, paste, and run.

Do **not** run `supabase/seed.sql` against production. It inserts clearly labeled `DEV`/`DEVSAMPLE` sample data for local development only (`supabase db reset` applies it locally).

### Loading the e-LearningVille staff

The 12 staff enrolled on the biometric device (IDs 1–10, 12, 18; department eLearning) are provided in two equivalent forms. Use one:

- **In the app (recommended, audited):** sign in as HR/Admin → Employees → Import → choose `data/elearningville-staff.xlsx` → confirm.
- **SQL editor:** run `supabase/roster/elearningville_staff.sql` after all migrations. Re-running it skips IDs that already exist.

Each record stores the device name (e.g. `jm`) as the last name with the first name blank; edit each employee later to add the full legal name used on the printed DTR. The biometric ID must match the `ID.:` value in the "Att. record report" exactly.

Before applying to Supabase you can check the migrations locally without any account:

```bash
node scripts/check-migrations.mjs   # applies migrations + seed to embedded Postgres, checks RLS on every table
npm run test:db                     # role-by-role RLS and workflow tests
```

## 3. Configure Supabase Auth

In **Authentication → Sign In / Providers** (labels vary slightly between dashboard versions):

- **Disable "Allow new users to sign up".** Accounts are created only by invitation. Even if sign-up were left on, new accounts are always created with the `employee` role and no employee link, so they cannot see other people's data — but leaving it on would still let strangers create accounts.
- Keep **Email** provider enabled. Consider requiring a minimum password length of at least 10 (the app enforces 10 characters with a letter and a number when users set passwords).

In **Authentication → URL Configuration**:

- **Site URL:** your production URL, e.g. `https://dtr.example.org`.
- **Redirect URLs:** add
  - `https://dtr.example.org/reset-password`
  - `http://localhost:5175/reset-password` (local development)
  - any Vercel preview URL pattern you use, e.g. `https://*-yourteam.vercel.app/reset-password`

Both password-reset emails and invitation emails send users to `/reset-password`, where they choose a password.

Configure **custom SMTP** (Authentication → Emails / SMTP settings) before go-live: Supabase's built-in email service is heavily rate limited and intended for testing.

## 4. Deploy the `admin-users` Edge Function

The Users & Roles page invites users through `supabase/functions/admin-users`. It runs on Supabase, verifies that the caller is an active Super Admin, and uses the service-role key that Supabase injects into the function environment. The key is never sent to the browser.

```bash
npx supabase secrets set SITE_URL=https://dtr.example.org ALLOWED_ORIGINS=https://dtr.example.org,http://localhost:5175
npx supabase functions deploy admin-users
```

- `SITE_URL` — base URL used for the invitation redirect (`<SITE_URL>/reset-password`).
- `ALLOWED_ORIGINS` — comma-separated browser origins permitted to call the function (CORS). If it is not set, browser calls are rejected.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically by Supabase; do not set them yourself.

If the function is not deployed, everything else works; only the **Invite user** action fails, with a message saying the invitation service is unavailable. You can instead invite users from **Authentication → Users → Invite user** in the dashboard and then set their role on the Users & Roles page.

## 5. Create the first Super Admin

Because there is no public sign-up and new accounts always start as `employee`, the first Super Admin is created by the project owner:

1. In the Supabase dashboard, **Authentication → Users → Invite user** (or **Add user** with "auto-confirm"), using the administrator's email.
2. In **SQL Editor**, run (replace the email):

   ```sql
   update public.profiles
   set role = 'super_admin', status = 'active'
   where email = 'admin@example.org';
   ```

   The SQL editor runs as a trusted database role, which is the only way to grant the first Super Admin. After that, Super Admins manage roles from **Users & Roles** in the app.
3. The administrator accepts the invitation (or uses **Forgot password** on the login page) to set a password and signs in.

The database prevents demoting or suspending the last active Super Admin.

## 6. Configure the frontend

Environment variables (see `.env.example`):

| Variable | Required | Value |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Project URL, e.g. `https://abcd1234.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | yes | anon / publishable key (public by design; protected by RLS) |
| `VITE_SITE_URL` | recommended | Absolute site URL used in password-reset emails; defaults to the current origin |

Every `VITE_` variable is embedded in the JavaScript sent to browsers. **Never** put the service-role key, database password, or any other secret in a `VITE_` variable.

Local development: copy `.env.example` to `.env.local` (git-ignored) and fill in the values, then `npm run dev`.

## 7. Deploy to Vercel

1. Push the repository to GitHub/GitLab and import it in Vercel. The included `vercel.json` sets the build command (`npm run build`), output directory (`dist`), SPA rewrites, and security headers (CSP restricted to your own origin and `*.supabase.co`).
2. In **Project → Settings → Environment Variables**, add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_SITE_URL` for Production (and Preview if you use previews with a separate Supabase project).
3. Deploy. Then add the production domain to Supabase Auth redirect URLs (step 3) and to `ALLOWED_ORIGINS` (step 4).

If you host a logo outside Supabase, it must be served over `https://` (the settings page enforces this and the CSP allows `https:` images).

## 8. First-run configuration in the app

Signed in as Super Admin:

1. **Settings** — organization name/address/logo, timezone (default `Asia/Manila`), date format, paper size, DTR template labels, maximum upload size.
2. **Employees → Departments**, then add employees (or import a CSV/XLSX employee list). The **biometric ID** must match the user ID enrolled on the device exactly, including leading zeros.
3. **Schedules & Policies** — create schedules, assign them to employees (employee detail page), then create an attendance policy draft, have it confirmed by HR/management, and approve it.
4. **Holidays & Leave** — enter the year's holidays from the official proclamations.
5. **Users & Roles** — invite HR/Admins, Supervisors (and assign their departments), and Employees (link each to their employee record).
6. **Import Attendance** — import the first month and review the results (see [Import guide](IMPORT_GUIDE.md)).

## Verifying the deployment

- Sign in as each role and confirm the navigation matches the role (Employees see only Dashboard, Corrections, DTR, Holidays & Leave).
- Follow the RLS checks in [Security and privacy](SECURITY_AND_PRIVACY.md#verifying-rls-on-your-project).
- Import a small anonymized workbook, re-import the same file, and confirm the second import reports all punches as already existing.
