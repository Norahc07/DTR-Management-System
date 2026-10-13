# Attendance policy guide

This document explains exactly how the system turns punches into daily results, and lists the decisions your organization must make. **None of the defaults is a legal, Civil Service, DOLE, or payroll standard.** They are neutral starting values so the system can run; a Super Admin should approve a policy only after HR/management (and payroll or legal advisers where relevant) have confirmed each value.

## Principles the system always follows

- **Raw punches are evidence and are never changed.** Imported punches cannot be edited or deleted through the application. Corrections add new records (an added punch, or a void marker) after approval, and both the original and the correction remain visible and audited.
- **Times are never invented.** A missing time-out stays missing and the day is flagged **Missing Punch**; worked time, undertime, and overtime are not guessed.
- **No punches does not mean absent.** A workday with no punches is **No Recorded Punches** if attendance data was imported for that date, or **No Data Imported** if no import covered it. Whether it is an absence is an HR determination (leave, official business, device failure, etc.).
- **Results are reproducible.** Daily summaries are derived data recomputed from punches, schedules, holidays, leave, and the approved policy in effect for each date. Each summary stores the schedule snapshot and policy used, plus a line-by-line breakdown (stored in `daily_attendance.breakdown`).
- **Finalized periods are locked.** DTRs are semi-monthly (days 1–15 and 16–end of month) and each half is finalized separately. After a period is finalized, its summaries cannot be recomputed until a Super Admin revokes the finalization with a reason.

## How a day is computed

1. **Collect punches** for the employee whose local time belongs to the work date. For overnight schedules, punches up to `early window` minutes before the shift start and up to `late window` minutes after the shift end are assigned to the shift's start date.
2. **Remove voided punches** (approved void corrections) and add approved correction punches.
3. **Drop duplicates**: a punch less than `duplicate window` minutes after the previous kept punch is marked duplicate and ignored for pairing (flag `DUPLICATE_PUNCH`).
4. **Classify the day**: holiday (except *special working* days) → leave → no schedule assigned → rest day per schedule → workday.
5. **No punches**: holiday, leave, or rest day statuses as applicable; otherwise *No Recorded Punches* / *No Data Imported*.
6. **Pair punches**:
   - *Sequential* (default): 1st–2nd, 3rd–4th, … An odd punch left over is **unpaired** → status *Missing Punch*.
   - *First/last*: first punch to last punch; middle punches are ignored (flag `UNUSED_PUNCHES`).
   More punches than `expected max punches/day` → status *Needs Review* (flag `EXTRA_PUNCHES`).
7. **Round** time-in and time-out according to the rounding rule (default: none).
8. **Fixed schedules**:
   - *Worked* = paired time inside the scheduled start–end, minus unpaid break, plus early arrival only if *count early arrival as work* is on.
   - *Unpaid break*: if a break window is set, the overlap of worked time with that window is deducted; otherwise the fixed break minutes are deducted less any natural gap between pairs. Paid breaks are not deducted.
   - *Late*: first punch after start + grace. With *late counted from schedule start* (default), arriving 8 minutes late with a 5-minute grace counts 8 minutes; with *late counted from grace end* it counts 3. Within grace counts 0. If *enforce break window* is on and there are two or more pairs, returning after the break end is also late.
   - *Undertime*: required regular minutes (scheduled span minus unpaid break) minus regular worked minutes minus time already counted as late; counted only if above the undertime grace. Not computed when a punch is missing.
   - *Overtime*: time after the scheduled end, only if overtime is enabled, no punch is missing, and it reaches the minimum. If approval is required, the day is flagged `OVERTIME_PENDING_APPROVAL`; the system does not approve overtime by itself.
9. **Flexible schedules**: worked = paired time minus unpaid break; undertime = required minutes minus worked (above grace); late only against an optional core start; overtime = worked beyond required (if enabled and above minimum).
10. **Rest days, holidays, leave with punches**: worked time is shown and flagged (`WORKED_ON_REST_DAY`, `WORKED_ON_HOLIDAY`, `PUNCHES_ON_LEAVE`). No late/undertime/overtime is computed because premium-pay rules are organizational and are not modeled. Punches on leave days and days with no schedule are marked *Needs Review*.
11. **Status**: *Missing Punch* > *Needs Review* > *Approved Correction* (any correction applied) > *Complete*.
12. If no approved policy covers the date, baseline rules are used and the day is flagged `POLICY_NOT_APPROVED`. Such months cannot be finalized.

## Settings in a policy

| Setting | Default | Range |
| --- | --- | --- |
| Pairing mode | sequential | sequential / first-last |
| Duplicate window | 2 min | 0–30 |
| Expected max punches per day | 4 | 2–12 |
| Late grace | 0 min | 0–240 |
| Late counted from | schedule start | schedule start / grace end |
| Undertime grace | 0 min | 0–240 |
| Enforce break window | on | — |
| Count early arrival as work | off | — |
| Rounding increment / in / out | 1 min, none, none | 1–60; none, nearest, up, down |
| Overtime enabled / minimum / requires approval | off, 30 min, on | 0–600 |
| Overnight early / late window | 240 / 360 min | 0–720 |

Policies are **effective-dated**. The approved policy with the latest effective date on or before a work date applies. Drafts can be edited; approved policies cannot. Only a Super Admin can approve or retire a policy. To change rules, create a new draft with a later effective date, have it approved, then recompute the affected (non-finalized) dates.

## Decisions your organization must confirm

Please answer these before approving the first policy. Record who confirmed them in the policy notes.

1. Official working hours per position/office, including flexible-time arrangements and core hours.
2. Lunch/break: fixed window or fixed duration? Paid or unpaid? Are employees required to punch out and in for breaks?
3. Grace period for tardiness, and whether tardiness is counted from the schedule start or from the end of the grace period.
4. Rounding of punches, if any (many organizations use none).
5. Whether arriving early counts as work time.
6. Undertime rules and any grace.
7. Overtime: is it computed, the minimum duration, and does it require prior approval? How are overtime approvals recorded?
8. Night shifts and shifts crossing midnight: which date the shift belongs to, and the acceptable window for early/late punches.
9. How many punches per day are expected (2 or 4).
10. Treatment of work on rest days and holidays (the system only flags these).
11. Holiday list per year, including local/special days, and how special working days are treated.
12. Which leave types exist and who records them (leave approval itself is outside this system).
13. Whether the printed DTR must follow a prescribed government form (for example CS Form No. 48 for government offices). The current template is configurable and is **not** presented as any official form.
14. Who may finalize DTRs and the monthly cut-off date.

## Corrections

- Any user can request a correction for dates they are allowed to see; employees only for their own record.
- Types: **add a missing punch** (time, and next-day date for overnight shifts), **void an erroneous punch**, or **note** only. A reason of at least 5 characters is required.
- HR/Admins can review any request; Supervisors only for employees in their assigned departments. A requester cannot approve their own request (except a Super Admin).
- Approval creates the new punch or void record in the same transaction and is audited. Recompute the date afterwards. (The correction-request page is no longer part of the app; existing correction records are kept.)
- Corrections cannot be approved for a month whose DTR is finalized; a Super Admin must revoke the finalization first.
