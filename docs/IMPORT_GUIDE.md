# Import guide

## Important limitation

The parser has been developed and tested with **synthetic** workbooks that imitate common biometric report shapes. It has **not** yet been validated against an export from your actual ZKTeco device and firmware. Before relying on it for payroll, import an anonymized real export, compare the preview against the device report cell by cell for a few employees, and keep the mapping that works (Settings → Default import mapping).

## Workflow

1. **Export** the attendance report from the device (or its PC software) to USB/SD and copy the `.xlsx`/`.xls` file to the HR computer.
2. **Upload** (Import Attendance → step 1). The file is read in the browser. Checks performed before anything else:
   - extension `.xlsx` or `.xls` and size within the configured limit (default 10 MB, Settings);
   - file signature must really be a spreadsheet (a renamed text/HTML file is rejected);
   - macros and formulas are never executed; cached cell values are read as data;
   - a SHA-256 fingerprint is computed so the app can tell you if the exact file was uploaded before.
3. **Map fields** (step 2). The app shows every sheet (including hidden ones, with row/column counts, merged ranges, hidden rows) and a cell grid preview. Choose sheets, layout, period, and the cells that hold IDs, names, and punches. Suggestions are pre-filled from the sheet's contents, the organization default, and the mapping last used in this browser.
4. **Preview & validate** (step 3). Nothing has been saved yet. The preview shows:
   - totals: employees, days, punches, matched/unmatched IDs, errors and warnings;
   - every employee found, matched by **biometric ID** (names are only used to warn about mismatches), expandable to the per-day punches;
   - every issue with sheet, cell reference, raw value, and severity, downloadable as CSV.
   If there are errors or unmatched IDs you must tick the acknowledgement before importing. Only valid punches are imported.
5. **Import** (step 4). Punches are uploaded to a staging table and committed in one database transaction by `commit_import`. Then daily summaries are recomputed for matched employees in the import period. The result shows new punches, punches that already existed, and unmatched IDs. The batch report (Import history) keeps the file name, fingerprint, mapping, counts, and all issues.

### Idempotency and safety

- Every punch has a deterministic key: `biometric ID | local date and time to the second`. Re-importing the same or an overlapping file inserts only punches that do not exist yet, so importing the same month twice is safe.
- The commit is all-or-nothing. If anything fails, the batch is marked **failed**, no punches from it are saved, and the error is shown.
- Raw punches are never edited or deleted by the app. Mistakes are fixed through corrections (see the Attendance policy guide).
- Punches for IDs with no matching employee are not imported; they are recorded as `UNMATCHED_ID` issues on the batch. Add the employee (with the exact biometric ID) and import the file again — already-imported punches are skipped and the missing ones are added.
- The import period is limited to 62 days per batch, and every punch must fall within the declared period.

## Supported layouts

### ZKTeco "Att. record report" (automatic)

When the workbook has a sheet named **Att. record report**, the import is configured automatically:

- only that sheet is read (other sheets such as "Att. Stat. report" are ignored);
- the row with day numbers `1, 2, 3 …` (row 3 in the device export) gives the column for each date;
- each employee row such as `ID.: 3   Name: jm   Dept.Name: eLearning` is read whether the text is in one merged cell or split across cells;
- the row below it holds each day's punches, one time per line (`07:56` / `12:02` / `12:46` / `17:00`);
- the month comes from the period text in the sheet (e.g. `2026-09-01 ~ 2026-09-30`).

If everything is found, the wizard goes straight to the preview. Check it, then select **Import**. After the import, **Open DTRs for <month>** opens the computed DTRs for all imported employees, ready to print. If the period text is missing, the wizard stops at the mapping step so you can choose the month. **Adjust mapping** on the preview lets you correct anything that was detected wrongly.

The employee's **ID** in the report must match the **biometric ID** of an employee record exactly (e.g. `3`, not `003`).

### Matrix (monthly grid)

One column per day of the month, with the day numbers in a header row. Employees appear in blocks. Two ways of locating employees are supported:

- **Label rows** — a row such as `ID: 0001   Name: Juan`, with punch rows below it. Configure the ID labels (default `User ID, Employee ID, AC-No, ID, No`), name labels, and which rows below the label hold punches (`1` for the next row; `1,2,3,4` if each punch has its own row).
- **ID column** — each employee's rows have the ID and name in fixed columns (for example A and B), and day cells to the right.

You must select the **month and year** of the report (pre-filled when the sheet contains a period such as `2026-09-01 ~ 2026-09-30`).

### Rows (punch log)

One punch per row (or one day per row with several time columns). Map the employee ID column, optional name column, and either:

- a single **date-time** column, or
- a **date** column plus one or more **time** columns (e.g. `D,E,F,G`).

Optionally map a **device event ID** column; when present, it is also used to prevent duplicates. Choose the date order (`MDY` or `DMY`) for ambiguous dates such as `03/04/2026`, and enter the import period.

### Cell values understood

- Excel date/time serial numbers (both the 1900 and 1904 date systems), including cells formatted only as time.
- Text times: `8:05`, `08:05:30`, `8:05 AM`, `5:00 PM`.
- Several times in one cell, separated by line breaks, spaces, commas, or concatenated without separators (`08:0112:0213:0017:05`).
- Text dates `2026-09-01`, `09/01/2026` (per the chosen order), with optional time.
- Biometric IDs as text or numbers. If Excel stored an ID as a number, leading zeros may be lost; the preview warns (`NUMERIC_ID`) and you can set **Pad numeric IDs to length** if your IDs have a fixed width.

Empty cells mean "no punch". The parser never invents times, and an empty day is never treated as an absence by the importer.

## Issue codes

| Code | Severity | Meaning / what to do |
| --- | --- | --- |
| `UNMATCHED_ID` | warning | No employee has this biometric ID. Add or correct the employee, then re-import. |
| `NAME_CONFLICT` | warning | The workbook name differs from the employee record for the same ID. Check the ID assignment on the device. |
| `ID_MULTIPLE_NAMES` | warning | The same ID appears with different names in the file. |
| `INACTIVE_EMPLOYEE` | warning | Punches belong to a deactivated employee. |
| `NUMERIC_ID` | warning | ID was stored as a number; leading zeros may have been lost. |
| `INVALID_ID` | error | Cell in the ID position is not a valid ID (letters, digits, `_`, `-`; max 32). |
| `INVALID_TIME`, `UNRECOGNIZED_VALUE` | error | Text that is not a recognizable time (for example "Absent"). Not imported. |
| `NUMERIC_TIME_ASSUMED` | warning | Unformatted number interpreted as a time fraction. Verify. |
| `DATE_WITHOUT_TIME`, `MISSING_TIME` | error | A date with no time part where a punch was expected. |
| `INVALID_DATE` | error | Unrecognized date in a rows layout. |
| `DATE_MISMATCH` | warning | Cell's own date differs from its column/row date; the cell's date is used. |
| `OUT_OF_PERIOD` | error | Punch is outside the declared import period. |
| `OUT_OF_ORDER` | warning | Punches in the source are not chronological (they are sorted on import). |
| `DUPLICATE_IN_SOURCE`, `DUPLICATE_IN_FILE` | warning | The same punch appears more than once; it is kept once. |
| `HIDDEN_ROW` | warning | Data found in a hidden row. Check whether it should be imported. |
| `MONTH_MISMATCH`, `INVALID_DAY`, `PARTIAL_MONTH` | error/warning | Day header does not match the selected month, or not all days were found. |
| `NO_DAY_COLUMNS`, `MISSING_DAY_HEADER`, `MISSING_PERIOD` | error | Matrix mapping incomplete. Set the day header row and month/year. |
| `NO_EMPLOYEES` | error | No employee blocks found with the current ID labels/columns. |
| `MAPPING_INCOMPLETE` | error | Rows layout is missing the ID or time columns. |
| `EMPTY_SHEET`, `NO_SHEETS`, `SHEET_NOT_FOUND` | warning/error | Sheet selection problem. |

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| "The file is not a valid Excel workbook" | The file was renamed or is an HTML/CSV export. Re-export as Excel, or open it in Excel and save as `.xlsx`. |
| "No day numbers found" | The day header row is wrong. Look at the grid preview and enter the row number that contains `1, 2, 3 …`. |
| No employees found | Adjust the ID labels to exactly what the sheet shows (e.g. `AC-No.`), or switch to **ID column** mode. |
| Every ID is unmatched | IDs in the employee list differ from the device (leading zeros, prefixes). Fix the employee records; biometric IDs are compared exactly as text. |
| Times are off by hours | Settings → timezone is wrong. Fix it before importing; imported punches keep their original local date and time. |
| Import says all punches "already existed" | That file (or the same punches) was already imported. This is expected and harmless. |
| Import failed | Nothing from that batch was saved. Read the message, fix the cause (often permissions or a network error), and import again. |
