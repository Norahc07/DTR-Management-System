// Turns adapter output into a reviewable preview with totals. Nothing here
// writes to the database.
import { addDays, secondsToTime } from '@/lib/time';
import { matchEmployees } from './matching';
import { parseMatrixSheet } from './parser/matrixAdapter';
import { parseRowsSheet } from './parser/rowsAdapter';
import { isDate1904 } from './parser/workbook';

export function parseWorkbook(wb, config) {
  const date1904 = isDate1904(wb);
  const sheets = config.sheets?.length ? config.sheets : [];
  const out = { records: [], issues: [], stats: { sheetsProcessed: 0, rowsScanned: 0, rowsSkipped: 0 } };
  if (!sheets.length) {
    out.issues.push({ severity: 'error', code: 'NO_SHEETS', message: 'Select at least one worksheet' });
    return out;
  }
  for (const name of sheets) {
    const ws = wb.Sheets[name];
    if (!ws) {
      out.issues.push({ severity: 'error', code: 'SHEET_NOT_FOUND', message: `Worksheet "${name}" not found`, sheet: name });
      continue;
    }
    const fn = config.layout === 'rows' ? parseRowsSheet : parseMatrixSheet;
    const res = fn(ws, name, config, { date1904 });
    out.records.push(...res.records);
    out.issues.push(...res.issues);
    out.stats.sheetsProcessed++;
    out.stats.rowsScanned += res.stats.rowsScanned;
    out.stats.rowsSkipped += res.stats.rowsSkipped;
  }
  return out;
}

/**
 * @param {object} args
 * @param {Array} args.records adapter records
 * @param {Array} args.issues adapter issues
 * @param {Array} args.employees employees table rows
 * @param {{start:string,end:string}} args.period declared import period
 * @param {number} [args.duplicateWindowMinutes]
 * @param {number} [args.maxPunchesPerDay]
 */
export function buildImportPreview({ records, issues, stats = {}, employees, period, duplicateWindowMinutes = 2, maxPunchesPerDay = 4, ignoredIds = [] }) {
  const ignored = new Set(ignoredIds.map(String));
  const allIssues = issues.filter((i) => !ignored.has(String(i.biometricId)));
  const inPeriod = [];
  const lastAllowed = period ? addDays(period.end, 1) : null;
  let ignoredPunches = 0;
  for (const r of records) {
    if (ignored.has(String(r.biometricId))) {
      ignoredPunches++;
      continue;
    }
    if (period && (r.date < period.start || r.date > lastAllowed)) {
      allIssues.push({ severity: 'error', code: 'OUT_OF_PERIOD', message: `Punch on ${r.date} is outside the import period`, sheet: r.sheet, cell: r.cell, raw: r.raw, biometricId: r.biometricId });
      continue;
    }
    inPeriod.push(r);
  }

  // Exact duplicates across the file (same person, date, time) are kept once.
  const unique = new Map();
  for (const r of inPeriod) {
    const key = `${r.biometricId}|${r.date}|${r.seconds}`;
    if (unique.has(key)) {
      const first = unique.get(key);
      allIssues.push({ severity: 'warning', code: 'DUPLICATE_IN_FILE', message: `Same punch already read from ${first.sheet}!${first.cell}`, sheet: r.sheet, cell: r.cell, raw: r.raw, biometricId: r.biometricId });
      continue;
    }
    unique.set(key, r);
  }
  const deduped = [...unique.values()];

  const people = new Map();
  for (const r of deduped) {
    if (!people.has(r.biometricId)) people.set(r.biometricId, { biometricId: r.biometricId, names: new Set() });
    if (r.name) people.get(r.biometricId).names.add(r.name.trim());
  }
  const matches = matchEmployees([...people.values()], employees);
  for (const m of matches.values()) {
    for (const i of m.issues) allIssues.push({ ...i, biometricId: m.biometricId });
  }

  // Group by employee and date.
  const groups = new Map();
  for (const r of deduped) {
    if (!groups.has(r.biometricId)) groups.set(r.biometricId, new Map());
    const byDate = groups.get(r.biometricId);
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }

  let incomplete = 0;
  let duplicateCandidates = 0;
  let datesProcessed = 0;
  const employeesOut = [];
  for (const [bio, byDate] of groups) {
    const match = matches.get(bio);
    const days = [];
    for (const [date, punches] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      datesProcessed++;
      punches.sort((a, b) => a.seconds - b.seconds);
      const flags = [];
      if (punches.length % 2 === 1) flags.push('ODD_PUNCH_COUNT');
      if (punches.length > maxPunchesPerDay) flags.push('EXTRA_PUNCHES');
      for (let i = 1; i < punches.length; i++) {
        if (punches[i].seconds - punches[i - 1].seconds < duplicateWindowMinutes * 60) {
          flags.push('NEAR_DUPLICATE');
          duplicateCandidates++;
          break;
        }
      }
      if (flags.includes('ODD_PUNCH_COUNT')) incomplete++;
      days.push({ date, times: punches.map((p) => secondsToTime(p.seconds)), cells: punches.map((p) => `${p.sheet}!${p.cell}`), flags });
    }
    employeesOut.push({
      biometricId: bio,
      workbookNames: match.workbookNames,
      employee: match.employee,
      suggestions: match.suggestions,
      matched: Boolean(match.employee),
      punchCount: days.reduce((n, d) => n + d.times.length, 0),
      days,
    });
  }
  employeesOut.sort((a, b) => Number(b.matched) - Number(a.matched) || a.biometricId.localeCompare(b.biometricId, undefined, { numeric: true }));

  const matchedIds = new Set(employeesOut.filter((e) => e.matched).map((e) => e.biometricId));
  const errors = allIssues.filter((i) => i.severity === 'error');
  const warnings = allIssues.filter((i) => i.severity === 'warning');
  const totals = {
    employeesInFile: employeesOut.length,
    employeesRecognized: matchedIds.size,
    unmatchedIds: employeesOut.length - matchedIds.size,
    datesProcessed,
    validPunches: deduped.filter((r) => matchedIds.has(r.biometricId)).length,
    unmatchedPunches: deduped.filter((r) => !matchedIds.has(r.biometricId)).length,
    incompleteRecords: incomplete,
    duplicateCandidates,
    duplicatesInFile: allIssues.filter((i) => i.code === 'DUPLICATE_IN_FILE').length,
    skippedRows: stats.rowsSkipped ?? 0,
    ignoredPunches,
    errors: errors.length,
    warnings: warnings.length,
  };

  return {
    records: deduped,
    stagedRecords: deduped,
    employees: employeesOut,
    issues: allIssues,
    totals,
  };
}

/** Rows for the downloadable error report. */
export function issuesToRows(issues) {
  return issues.map((i) => ({
    Severity: i.severity,
    Code: i.code,
    Message: i.message,
    Sheet: i.sheet ?? '',
    Cell: i.cell ?? '',
    'Biometric ID': i.biometricId ?? '',
    'Raw value': i.raw ?? '',
  }));
}
