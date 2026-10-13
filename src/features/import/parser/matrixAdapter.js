// Monthly matrix layout: one column per calendar day; each employee occupies a
// block of rows. Two employee layouts are supported and fully configurable:
//  - 'labelRow': a row carrying labels such as "ID: 12  Name: Juan" followed by
//    one or more punch rows (offsets configurable).
//  - 'idColumn': each data row carries the ID (and name) in fixed columns;
//    consecutive rows with the same/blank ID belong to the same employee.
// No specific vendor layout is assumed; settings come from the mapping UI.
import { daysInMonth, toDateKey } from '@/lib/time';
import { extractTimesFromCell, normalizeBiometricId, cellText, readCell, excelSerialToParts } from './cellValues';
import { cellRef, colIndex, findDayColumns, getCell, getCellWithMerges, sheetRange } from './workbook';

export const DEFAULT_MATRIX_CONFIG = {
  layout: 'matrix',
  sheets: [],
  year: null,
  month: null,
  dayHeaderRow: null,
  employeeLayout: 'labelRow',
  idLabels: 'User ID, Employee ID, AC-No, ID, No',
  nameLabels: 'Name',
  departmentLabels: 'Dept.Name, Dept. Name, Dept, Department',
  punchRowOffsets: '1',
  idColumn: 'A',
  nameColumn: 'B',
  firstDataRow: null,
  idPadLength: 0,
};

/**
 * ZKTeco "Att. record report" sheet: day numbers in a header row, then per
 * employee a row "ID.: 3   Name: jm   Dept.Name: eLearning" followed by one row
 * whose day cells hold that day's punches separated by line breaks.
 */
export const ZKTECO_ATT_RECORD_SHEET = /^\s*att\.?\s*record\s*report\s*$/i;
export const ZKTECO_ATT_RECORD_PRESET = Object.freeze({
  layout: 'matrix',
  employeeLayout: 'labelRow',
  idLabels: 'User ID, ID',
  nameLabels: 'Name',
  departmentLabels: 'Dept.Name, Dept. Name, Dept, Department',
  punchRowOffsets: '1',
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const splitList = (s) =>
  String(s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

/** Finds "Label: value" pairs across the cells of one row. */
export function extractLabeledValues(cellsText, labelGroups) {
  const allLabels = Object.values(labelGroups).flat();
  if (!allLabels.length) return {};
  const anyLabel = allLabels.map(escapeRe).join('|');
  const found = {};
  for (let i = 0; i < cellsText.length; i++) {
    const text = cellsText[i];
    if (!text) continue;
    for (const [key, labels] of Object.entries(labelGroups)) {
      if (found[key] != null || !labels.length) continue;
      const group = labels.map(escapeRe).join('|');
      // Labels may carry a trailing dot before the colon, e.g. "ID.:" or "Dept.:".
      const pure = new RegExp(`^(?:${group})\\.?\\s*[:：]?\\s*$`, 'i');
      if (pure.test(text)) {
        const next = cellsText.slice(i + 1).find((t) => t);
        if (next && !new RegExp(`^(?:${anyLabel})\\.?\\s*[:：]?\\s*$`, 'i').test(next)) found[key] = { value: next, index: cellsText.indexOf(next, i + 1) };
        continue;
      }
      const inline = new RegExp(`(?:^|\\s)(?:${group})\\.?\\s*[:：]\\s*(.+?)(?=\\s+(?:${anyLabel})\\.?\\s*[:：]|$)`, 'i');
      const m = inline.exec(text);
      if (m) found[key] = { value: m[1].trim(), index: i };
    }
  }
  return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.value]));
}

function rowTexts(ws, r, range) {
  const out = [];
  for (let c = range.s.c; c <= range.e.c; c++) out.push(cellText(getCellWithMerges(ws, r, c)));
  return out;
}

function parseOffsets(str) {
  const nums = String(str ?? '1')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 10);
  return nums.length ? [...new Set(nums)] : [1];
}

/** Resolves calendar dates for each day column; validates against the month. */
export function resolveDayColumns(ws, headerRow0, year, month, range, { date1904 = false } = {}) {
  const issues = [];
  const cols = findDayColumns(ws, headerRow0, range, { date1904 });
  // Header cells formatted as full dates: confirm they match the chosen month.
  for (const { col } of cols) {
    const rc = readCell(getCell(ws, headerRow0, col));
    if (rc.kind === 'serial') {
      const parts = excelSerialToParts(rc.value, { date1904 });
      if (parts?.date && !parts.date.startsWith(`${year}-${String(month).padStart(2, '0')}`)) {
        issues.push({ severity: 'error', code: 'MONTH_MISMATCH', message: `Header date ${parts.date} is not in the selected month`, cell: cellRef(headerRow0, col) });
      }
    }
  }
  const maxDay = daysInMonth(year, month);
  const valid = [];
  for (const dc of cols) {
    if (dc.day > maxDay) {
      issues.push({ severity: 'error', code: 'INVALID_DAY', message: `Day ${dc.day} does not exist in the selected month`, cell: cellRef(headerRow0, dc.col) });
    } else {
      valid.push({ ...dc, date: toDateKey(year, month, dc.day) });
    }
  }
  if (valid.length && valid.length !== maxDay) {
    issues.push({ severity: 'warning', code: 'PARTIAL_MONTH', message: `Found ${valid.length} day columns; the month has ${maxDay} days`, cell: cellRef(headerRow0, valid[0].col) });
  }
  return { dayColumns: valid, issues };
}

/** Collects ordered punch times for one day from several rows; flags order/duplicates. */
export function collectDayPunches(ws, rows, col, ctx) {
  const punches = [];
  const issues = [];
  for (const r of rows) {
    const cell = getCell(ws, r, col);
    if (!cell) continue;
    const ref = cellRef(r, col);
    const { times, issues: cellIssues, raw, date } = extractTimesFromCell(cell, ctx);
    for (const ci of cellIssues) {
      const severity = ci.code === 'EXTRA_TEXT' || ci.code === 'NUMERIC_TIME_ASSUMED' ? 'warning' : 'error';
      issues.push({ severity, ...ci, cell: ref, raw });
    }
    if (ws['!rows']?.[r]?.hidden && times.length) {
      issues.push({ severity: 'warning', code: 'HIDDEN_ROW', message: 'Punch values found in a hidden row', cell: ref, raw });
    }
    for (const s of times) punches.push({ seconds: s, cell: ref, raw, cellDate: date });
  }
  for (let i = 1; i < punches.length; i++) {
    if (punches[i].seconds < punches[i - 1].seconds) {
      issues.push({ severity: 'warning', code: 'OUT_OF_ORDER', message: 'Punches are not in chronological order in the source', cell: punches[i].cell, raw: punches[i].raw });
      break;
    }
  }
  const seen = new Set();
  const unique = [];
  for (const p of punches) {
    if (seen.has(p.seconds)) {
      issues.push({ severity: 'warning', code: 'DUPLICATE_IN_SOURCE', message: 'Identical punch time repeated in the source; kept once', cell: p.cell, raw: p.raw });
      continue;
    }
    seen.add(p.seconds);
    unique.push(p);
  }
  return { punches: unique, issues };
}

/** Parses one worksheet. Rows/columns in config are 1-based / letters as shown to users. */
export function parseMatrixSheet(ws, sheetName, config, { date1904 = false } = {}) {
  const records = [];
  const issues = [];
  const stats = { rowsScanned: 0, rowsSkipped: 0, employeeBlocks: 0 };
  const tag = (i) => ({ sheet: sheetName, ...i });
  const range = sheetRange(ws);
  if (!range) {
    issues.push(tag({ severity: 'warning', code: 'EMPTY_SHEET', message: 'Worksheet is empty' }));
    return { records, issues, stats };
  }
  const { year, month } = config;
  if (!year || !month) {
    issues.push(tag({ severity: 'error', code: 'MISSING_PERIOD', message: 'Select the month and year of this report' }));
    return { records, issues, stats };
  }
  const headerRow0 = Number(config.dayHeaderRow) - 1;
  if (!(headerRow0 >= 0)) {
    issues.push(tag({ severity: 'error', code: 'MISSING_DAY_HEADER', message: 'Set the row that contains the day numbers' }));
    return { records, issues, stats };
  }
  const { dayColumns, issues: dayIssues } = resolveDayColumns(ws, headerRow0, year, month, range, { date1904 });
  issues.push(...dayIssues.map(tag));
  if (!dayColumns.length) {
    issues.push(tag({ severity: 'error', code: 'NO_DAY_COLUMNS', message: `No day numbers (1-31) found in row ${headerRow0 + 1}` }));
    return { records, issues, stats };
  }
  const ctx = { date1904 };

  const emit = (emp, rows) => {
    stats.employeeBlocks++;
    for (const dc of dayColumns) {
      const { punches, issues: dIssues } = collectDayPunches(ws, rows, dc.col, ctx);
      issues.push(...dIssues.map((i) => tag({ ...i, biometricId: emp.id })));
      for (const p of punches) {
        let date = dc.date;
        if (p.cellDate && p.cellDate !== dc.date) {
          issues.push(tag({ severity: 'warning', code: 'DATE_MISMATCH', message: `Cell date ${p.cellDate} differs from column date ${dc.date}; cell date used`, cell: p.cell, raw: p.raw, biometricId: emp.id }));
          date = p.cellDate;
        }
        records.push({ biometricId: emp.id, name: emp.name, date, seconds: p.seconds, sheet: sheetName, cell: p.cell, raw: p.raw });
      }
    }
  };

  if (config.employeeLayout === 'idColumn') {
    const idC = colIndex(config.idColumn || 'A');
    const nameC = config.nameColumn ? colIndex(config.nameColumn) : null;
    const start = Math.max(Number(config.firstDataRow) - 1 || headerRow0 + 1, headerRow0 + 1);
    let current = null;
    const flush = () => current && emit(current.emp, current.rows);
    for (let r = start; r <= range.e.r; r++) {
      stats.rowsScanned++;
      const idCell = getCellWithMerges(ws, r, idC);
      const idText = cellText(idCell);
      if (!idText) {
        if (current) current.rows.push(r);
        else stats.rowsSkipped++;
        continue;
      }
      const { id, issues: idIssues } = normalizeBiometricId(idCell, { padLength: Number(config.idPadLength) || 0 });
      if (!id) {
        idIssues.forEach((i) => issues.push(tag({ severity: 'error', ...i, cell: cellRef(r, idC), raw: idText })));
        flush();
        current = null;
        stats.rowsSkipped++;
        continue;
      }
      if (current && current.emp.id === id) {
        current.rows.push(r);
        continue;
      }
      flush();
      idIssues.forEach((i) => issues.push(tag({ severity: 'warning', ...i, cell: cellRef(r, idC), raw: idText, biometricId: id })));
      const name = nameC != null ? cellText(getCellWithMerges(ws, r, nameC)) : '';
      current = { emp: { id, name }, rows: [r] };
    }
    flush();
    return { records, issues, stats };
  }

  // labelRow layout
  const labelGroups = {
    id: splitList(config.idLabels),
    name: splitList(config.nameLabels),
    department: splitList(config.departmentLabels),
  };
  const offsets = parseOffsets(config.punchRowOffsets);
  const isLabelRow = (r) => {
    const vals = extractLabeledValues(rowTexts(ws, r, range), labelGroups);
    return vals.id ? vals : null;
  };
  for (let r = headerRow0 + 1; r <= range.e.r; r++) {
    stats.rowsScanned++;
    const vals = isLabelRow(r);
    if (!vals) continue;
    const { id, issues: idIssues } = normalizeBiometricId(vals.id, { padLength: Number(config.idPadLength) || 0 });
    if (!id) {
      idIssues.forEach((i) => issues.push(tag({ severity: 'error', ...i, cell: `row ${r + 1}`, raw: vals.id })));
      continue;
    }
    const rows = offsets.map((o) => r + o).filter((x) => x <= range.e.r && (x === r || !isLabelRow(x)));
    emit({ id, name: vals.name || '' }, rows);
  }
  if (!stats.employeeBlocks) {
    issues.push(tag({ severity: 'error', code: 'NO_EMPLOYEES', message: 'No employee rows were found with the current ID label settings' }));
  }
  return { records, issues, stats };
}
