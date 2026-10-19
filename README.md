# DTR Management System

A Daily Time Record (DTR) system for organizations that collect attendance on ZKTeco (or similar) biometric devices and transfer the monthly Excel report by USB/SD card. There is no live device connection: an HR/Admin uploads the exported workbook, maps its layout, reviews a validated preview, and imports it. The system then computes daily attendance against effective-dated schedules and approved policies, supports audited corrections, and prints semi-monthly DTRs (days 1–15 and 16–end of month, CS Form No. 48, two per A4 page) and reports.

**Stack:** React 19 + Vite 8 (JavaScript), Tailwind CSS 4, React Router 7, React Hook Form + Zod, SheetJS, Supabase (Postgres, Auth, Row Level Security, one Edge Function), Vercel for the frontend.

> The system imports attendance **records only**. It never collects or stores fingerprint images or templates.

## Status

| Area | State |
| --- | --- |
| Database schema, RLS, server-side operations | Implemented; verified on embedded Postgres (PGlite) |
| Excel import (inspection, mapping, preview, idempotent commit) | Implemented; verified with **synthetic** workbooks only |
| Attendance engine, review, corrections, DTR printing, reports | Implemented and unit/component tested |
| Employees, schedules, policies, holidays/leave, users, audit, settings | Implemented |
| Supabase project, Auth settings, Edge Function deployment | **Not done** — needs your Supabase project ([setup guide](docs/SETUP_AND_DEPLOYMENT.md)) |
| Vercel deployment | **Not done** — needs your Vercel project |
| Compatibility with your actual ZKTeco export | **Unverified** — needs an anonymized sample workbook |
| Attendance policy values (grace, rounding, overtime, …) | **Must be confirmed** by your organization ([policy guide](docs/ATTENDANCE_POLICY.md)) |

### Inputs still needed

1. **An anonymized ZKTeco export** (`.xlsx`/`.xls`) as the device produces it. Replace names with placeholders and shift or replace IDs if needed, but keep the layout, cell formats, and sheet structure unchanged. The parser is configurable and tested against synthetic layouts; it has not been validated against your device's real format. Put the file in `fixtures/private/` (git-ignored).
2. **A Supabase project** (URL + anon key for the frontend; the service-role key stays in Supabase only).
3. **Your organization's attendance rules** — see the checklist in [docs/ATTENDANCE_POLICY.md](docs/ATTENDANCE_POLICY.md).
4. **The DTR print format** your office requires, if it must match a prescribed form.

## Quick start (local)

Requirements: Node.js 20+ (developed on Node 24), npm.

```bash
npm install
cp .env.example .env.local      # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                      # http://localhost:5175
```

Without Supabase variables the app shows a "Supabase is not configured" screen instead of failing silently. Database setup, auth configuration, and creating the first Super Admin are covered in [docs/SETUP_AND_DEPLOYMENT.md](docs/SETUP_AND_DEPLOYMENT.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm test` | All tests (unit, import, component/integration, database/RLS) |
| `npm run test:db` | Only the database/RLS tests (embedded Postgres) |
| `node scripts/check-migrations.mjs` | Apply all migrations + seed to an embedded Postgres and confirm RLS is enabled on every table |
| `npm run fixtures` | Write **synthetic** sample workbooks to `fixtures/synthetic/` for trying the import wizard |

### Verification results (last run, local)

- `npm run lint` — no errors or warnings.
- `npm test` — 18 test files, 193 tests passed (including the whole-month DTR, editable time columns, import date ranges, the Half day remark, the page data cache, deleting imported data, import settings for period, work days and office hours, automatic Philippine holidays and staff birthdays): engine and time utilities (including the office-hours lateness rules by DTR slot, missing OUTs printed as 12:00 / end of day, per-employee days off, day remarks and the no-undertime DTR format, the per-staff lates list, the DTR Excel export, and manual IN/OUT edits), cell/serial parsing, import adapters and preview, component/integration tests (import wizard upload → preview → confirm, one-step import from the dashboard, DTR print document, permission guard), the e-LearningVille staff roster (spreadsheet validation, SQL load, office-hours schedule assignment, matching against an "Att. record report"), and 36 database tests that run the real migrations on PGlite and check RLS per role, import idempotency, immutability, audit, corrections, manual IN/OUT entry, policy approval, and DTR finalization.
- `npm run build` — succeeds.
- Not run: end-to-end tests against a live Supabase project (none is configured), Deno type-check of the Edge Function (Deno is not installed here).

## Documentation

- [Setup and deployment](docs/SETUP_AND_DEPLOYMENT.md) — Supabase project, migrations, Auth, Edge Function, environment variables, first admin, Vercel.
- [Import guide](docs/IMPORT_GUIDE.md) — workflow, supported layouts, issue codes, troubleshooting.
- [Attendance policy guide](docs/ATTENDANCE_POLICY.md) — how time is computed and what your organization must confirm.
- [Security and privacy](docs/SECURITY_AND_PRIVACY.md) — roles, RLS model and how to verify it, Data Privacy Act considerations.
- [Operations](docs/OPERATIONS.md) — month-end workflow, backup and restore, routine troubleshooting.
- [Data dictionary](docs/DATA_DICTIONARY.md) — tables and key columns.

## Project layout

```
src/
  components/        layout and shared UI (dialogs, tables, feedback, forms)
  features/
    import/          workbook parser, adapters, matching, preview, wizard
    attendance/      calculation engine (pure JS), recompute, review
    corrections/     correction requests and review
    dtr/             DTR builder and CS Form No. 48 print document
    reports/         aggregation and report page
    employees/ schedules/ users/ audit/ settings/ dashboard/ auth/
  lib/               time utilities, Supabase client, exporters
supabase/
  migrations/        schema, security (RLS), operations and audit
  functions/admin-users/   invitation Edge Function (server-side only)
  seed.sql           DEVELOPMENT-ONLY sample data
  roster/            one-time e-LearningVille staff load (see data/elearningville-staff.xlsx)
tests/               database/RLS harness, UI tests, synthetic fixtures
```
