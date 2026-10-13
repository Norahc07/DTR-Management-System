# Data dictionary

All tables are in the `public` schema and have RLS enabled. Changes to configuration, people, schedules, policies, calendar, import batches, corrections, voids, and finalizations are audited into `audit_logs`; raw punches are immutable instead, and `daily_attendance` is derived data that can be recomputed. Timestamps are `timestamptz` (UTC); `local_date`/`local_time` are wall-clock values in the organization timezone.

## Organization and people

**organization_settings** — single row (`id = 1`).
`org_name`, `org_address`, `logo_url` (https only), `timezone` (IANA name, validated; default `Asia/Manila`), `date_format`, `print_paper` (no longer used; printing is always A4), `dtr_template` (JSON for the CS Form No. 48 printout: form number, title, official-hours labels and values, slot mode, time format, whether undertime is filled, certification text, verification line, verifier name and position), `import_config` (JSON: `defaultMapping`), `max_import_file_mb` (1–50).

**departments** — `code` (unique, letters/digits/`_-`, ≤20), `name` (unique), `is_active`.

**employees** — `biometric_id` (unique text, `^[A-Za-z0-9_-]{1,32}$`, must equal the device user ID including leading zeros), `employee_no` (optional, unique), `last_name`, `first_name`, `middle_name`, `suffix`, `full_name` (generated "Last, First Middle Suffix"), `department_id`, `position`, `employment_status`, `date_hired`, `birth_date` (optional, on/after 1900-01-01; shown on the Calendar, visible under the same rules as the employee row), `is_active`, `deactivated_at`, `deactivation_reason` (required when inactive). Employees with attendance history cannot be deleted; deactivate them.

**profiles** — one per Supabase Auth user: `email`, `full_name`, `role` (`super_admin`, `hr_admin`, `supervisor`, `employee`), `status` (`active`, `suspended`), `employee_id` (unique link to the person's employee record).

**supervisor_departments** — (`profile_id`, `department_id`): departments a supervisor may see and review.

## Schedules, policies, calendar

**work_schedules** — `name` (unique), `schedule_type` (`fixed`, `flexible`), `description`, `is_active`.

**schedule_days** — key (`schedule_id`, `weekday` 0=Sunday…6=Saturday): `is_workday`, `start_time`, `end_time` (end ≤ start means overnight), `break_start`/`break_end` (both or neither), `break_minutes`, `break_paid`, `required_minutes` (flexible), `core_start`/`core_end`.

**employee_schedules** — `employee_id`, `schedule_id`, `effective_from`, `effective_to` (open-ended if null). Overlapping assignments for one employee are rejected.

**attendance_policies** — `name`, `effective_from`, `status` (`draft`, `approved`, `retired`), `rules` (JSON, see the policy guide), `notes`, `approved_by`, `approved_at`. Only one approved policy per effective date; approved rules are immutable.

**holidays** — `holiday_date`, `name`, `holiday_type` (`regular`, `special_non_working`, `special_working`, `company`).

**leave_records** — `employee_id`, `start_date`, `end_date`, `leave_type`, `remarks`, `is_cancelled`.

## Imports

**import_batches** — one per upload: `file_name`, `file_size`, `file_sha256`, `adapter` (`matrix`, `rows`), `mapping` (JSON), `period_start`/`period_end` (≤62 days), `status` (`staging`, `completed`, `failed`, `cancelled`), `summary` (JSON totals), `events_staged`, `events_inserted`, `events_existing`, `error_message`, `created_by`, `completed_at`.

**import_errors** — issues for a batch: `severity`, `code`, `message`, `sheet_name`, `cell_ref`, `biometric_id`, `raw_value`.

**import_staging_events** — validated punches uploaded before commit: `biometric_id`, `source_name`, `local_date`, `local_time`, `device_event_id`, `sheet_name`, `cell_ref`, `raw_value`.

## Attendance

**attendance_events** — immutable raw punches. `employee_id`, `biometric_id`, `event_time` (instant), `local_date`, `local_time`, `source` (`import`, `correction`), `import_batch_id` or `correction_id`, `device_event_id`, `dedupe_key` (unique: `biometric_id|YYYY-MM-DDTHH:MM:SS`), `source_file`, `source_sheet`, `source_cell`, `raw_value` (traceability back to the workbook cell), `created_by`.

**attendance_event_voids** — `event_id` (one void per event), `correction_id`, `voided_by`, `voided_at`. A voided punch is excluded from computation but remains stored.

**correction_requests** — `employee_id`, `work_date`, `correction_type` (`add_punch`, `void_punch`, `note`), `proposed_date` (work date or next day), `proposed_time`, `target_event_id`, `reason` (5–1000 chars), `status` (`pending`, `approved`, `rejected`, `cancelled`), `requested_by`, `requested_at`, `reviewed_by`, `reviewed_at`, `review_remarks`, `created_event_id`.

**daily_attendance** — derived summary, unique (`employee_id`, `work_date`): `status` (`complete`, `missing_punch`, `rest_day`, `leave`, `holiday`, `no_punches`, `no_data`, `needs_review`, `approved_correction`), `flags` (text array, see policy guide), `punches` (JSON: minutes, role in/out/unpaired/duplicate/voided/unused, source), `worked_minutes`, `late_minutes`, `undertime_minutes`, `overtime_minutes`, `break_deducted_minutes`, `schedule_id`, `schedule_snapshot`, `policy_id`, `breakdown` (JSON explanation lines), `computed_at`, `computed_by`. Locked while the month's DTR is finalized.

**dtr_finalizations** — `employee_id`, `period_month` (first of month), `status` (`finalized`, `revoked`), `snapshot` (JSON copy of the DTR as finalized), `finalized_by`, `finalized_at`, `revoked_by`, `revoked_at`, `revoke_reason`. One active finalization per employee and month.

## Audit

**audit_logs** — append-only: `occurred_at`, `actor_id`, `actor_email`, `action` (`insert`/`update`/`delete` or an event such as `login`, `logout`, `dtr_printed`, `report_exported`, `user_invited`), `table_name`, `record_id`, `reason`, `old_values`, `new_values`.
