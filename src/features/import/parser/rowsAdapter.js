// Row-oriented layout: each row is one punch (date+time / datetime column) or
// one day (date column plus one or more time columns, each possibly holding
// several times). Column assignments come from the mapping UI.
import { extractDateFromCell, extractTimesFromCell, normalizeBiometricId, cellText } from './cellValues';
import { cellRef, colIndex, getCell, sheetRange } from './workbook';

export const DEFAULT_ROWS_CONFIG = {
  layout: 'rows',
  sheets: [],
  headerRow: 1,
  firstDataRow: null,
  idColumn: '',
  nameColumn: '',
  dateColumn: '',
  timeColumns: '',
  datetimeColumn: '',
  deviceEventIdColumn: '',
  dateOrder: 'MDY',
  idPadLength: 0,
};

const HEADER_GUESSES = [
  ['datetimeColumn', /^(date\s*time|datetime|timestamp|check\s*time|punch\s*time|att(endance)?\s*time)$/i],
  ['idColumn', /^(ac-?no\.?|user\s*id|emp(loyee)?\s*(id|no\.?|number)|enroll(ment)?\s*(id|no\.?)|badge(\s*no\.?)?|pin|id|no\.?)$/i],
  ['nameColumn', /^(name|employee(\s*name)?|full\s*name)$/i],
  ['dateColumn', /^(date|day|work\s*date)$/i],
  ['deviceEventIdColumn', /^(log\s*id|record\s*id|event\s*id|serial)$/i],
  ['timeColumns', /^(time|clock|check[\s-]*(in|out)|time\s*(in|out)|in|out|on\s*duty|off\s*duty|punch\s*\d*|time\s*\d)$/i],
];

/** Suggests a column mapping from header labels (user must confirm). */
export function suggestRowsMapping(ws, headerRow1) {
  const range = sheetRange(ws);
  const r = Number(headerRow1) - 1;
  const mapping = { idColumn: '', nameColumn: '', dateColumn: '', timeColumns: '', datetimeColumn: '', deviceEventIdColumn: '' };
  if (!range || r < 0) return mapping;
  const times = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const label = cellText(getCell(ws, r, c));
    if (!label) continue;
    for (const [key, re] of HEADER_GUESSES) {
      if (!re.test(label)) continue;
      const letter = cellRef(0, c).replace(/\d+$/, '');
      if (key === 'timeColumns') times.push(letter);
      else if (!mapping[key]) mapping[key] = letter;
      break;
    }
  }
  // A "Time" header whose values carry full dates is really a date-time column.
  if (!mapping.dateColumn && !mapping.datetimeColumn && times.length) {
    const c = colIndex(times[0]);
    for (let rr = r + 1; rr <= Math.min(range.e.r, r + 10); rr++) {
      const cell = getCell(ws, rr, c);
      if (!cellText(cell)) continue;
      if (extractDateFromCell(cell)?.date) mapping.datetimeColumn = times.shift();
      break;
    }
  }
  mapping.timeColumns = times.join(',');
  return mapping;
}

const letters = (s) =>
  String(s ?? '')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter((x) => /^[A-Z]{1,3}$/.test(x));

export function parseRowsSheet(ws, sheetName, config, { date1904 = false } = {}) {
  const records = [];
  const issues = [];
  const stats = { rowsScanned: 0, rowsSkipped: 0, rowsWithoutPunches: 0 };
  const tag = (i) => ({ sheet: sheetName, ...i });
  const range = sheetRange(ws);
  if (!range) {
    issues.push(tag({ severity: 'warning', code: 'EMPTY_SHEET', message: 'Worksheet is empty' }));
    return { records, issues, stats };
  }
  if (!config.idColumn) {
    issues.push(tag({ severity: 'error', code: 'MAPPING_INCOMPLETE', message: 'Map the employee ID column' }));
    return { records, issues, stats };
  }
  const timeCols = letters(config.timeColumns).map(colIndex);
  if (!config.datetimeColumn && (!config.dateColumn || !timeCols.length)) {
    issues.push(tag({ severity: 'error', code: 'MAPPING_INCOMPLETE', message: 'Map either a date-time column, or a date column plus time column(s)' }));
    return { records, issues, stats };
  }
  const idC = colIndex(config.idColumn);
  const nameC = config.nameColumn ? colIndex(config.nameColumn) : null;
  const dateC = config.dateColumn ? colIndex(config.dateColumn) : null;
  const dtC = config.datetimeColumn ? colIndex(config.datetimeColumn) : null;
  const evC = config.deviceEventIdColumn ? colIndex(config.deviceEventIdColumn) : null;
  const ctx = { date1904, dateOrder: config.dateOrder || 'MDY' };
  const start = Number(config.firstDataRow) > 0 ? Number(config.firstDataRow) - 1 : Number(config.headerRow || 1);

  for (let r = start; r <= range.e.r; r++) {
    stats.rowsScanned++;
    const used = [idC, nameC, dateC, dtC, ...timeCols].filter((c) => c != null);
    if (used.every((c) => !cellText(getCell(ws, r, c)))) {
      stats.rowsSkipped++;
      continue;
    }
    const idCell = getCell(ws, r, idC);
    const { id, issues: idIssues } = normalizeBiometricId(idCell, { padLength: Number(config.idPadLength) || 0 });
    if (!id) {
      issues.push(tag({ severity: 'error', code: idIssues[0]?.code || 'MISSING_ID', message: idIssues[0]?.message || 'Row has no employee ID', cell: cellRef(r, idC), raw: cellText(idCell) }));
      stats.rowsSkipped++;
      continue;
    }
    for (const i of idIssues) issues.push(tag({ severity: 'warning', ...i, cell: cellRef(r, idC), biometricId: id }));
    const name = nameC != null ? cellText(getCell(ws, r, nameC)) : '';
    const deviceEventId = evC != null ? cellText(getCell(ws, r, evC)).slice(0, 64) || null : null;
    const ws_hidden = Boolean(ws['!rows']?.[r]?.hidden);
    if (ws_hidden) issues.push(tag({ severity: 'warning', code: 'HIDDEN_ROW', message: 'Data found in a hidden row', cell: `row ${r + 1}`, biometricId: id }));

    const punches = [];
    let rowDate = null;
    if (dtC != null) {
      const cell = getCell(ws, r, dtC);
      const parsed = extractDateFromCell(cell, ctx);
      if (!parsed?.date) {
        issues.push(tag({ severity: 'error', code: 'INVALID_DATE', message: 'Unrecognised date-time value', cell: cellRef(r, dtC), raw: cellText(cell), biometricId: id }));
        stats.rowsSkipped++;
        continue;
      }
      rowDate = parsed.date;
      if (parsed.seconds == null) {
        issues.push(tag({ severity: 'error', code: 'MISSING_TIME', message: 'Date-time value has no time part', cell: cellRef(r, dtC), raw: cellText(cell), biometricId: id }));
      } else {
        punches.push({ seconds: parsed.seconds, cell: cellRef(r, dtC), raw: cellText(cell) });
      }
    }
    if (dateC != null) {
      const cell = getCell(ws, r, dateC);
      const parsed = extractDateFromCell(cell, ctx);
      if (!parsed?.date) {
        issues.push(tag({ severity: 'error', code: 'INVALID_DATE', message: 'Unrecognised date value', cell: cellRef(r, dateC), raw: cellText(cell), biometricId: id }));
        stats.rowsSkipped++;
        continue;
      }
      rowDate = rowDate ?? parsed.date;
    }
    for (const c of timeCols) {
      const cell = getCell(ws, r, c);
      if (!cell) continue;
      const ref = cellRef(r, c);
      const { times, issues: tIssues, raw, date } = extractTimesFromCell(cell, ctx);
      for (const ti of tIssues) {
        issues.push(tag({ severity: ti.code === 'EXTRA_TEXT' || ti.code === 'NUMERIC_TIME_ASSUMED' ? 'warning' : 'error', ...ti, cell: ref, raw, biometricId: id }));
      }
      if (date && rowDate && date !== rowDate) {
        issues.push(tag({ severity: 'warning', code: 'DATE_MISMATCH', message: `Time cell date ${date} differs from row date ${rowDate}`, cell: ref, raw, biometricId: id }));
      }
      for (const s of times) punches.push({ seconds: s, cell: ref, raw, date: date || rowDate });
    }
    if (!punches.length) {
      stats.rowsWithoutPunches++;
      continue;
    }
    for (let i = 1; i < punches.length; i++) {
      if (punches[i].seconds < punches[i - 1].seconds) {
        issues.push(tag({ severity: 'warning', code: 'OUT_OF_ORDER', message: 'Punches in this row are not in chronological order', cell: punches[i].cell, raw: punches[i].raw, biometricId: id }));
        break;
      }
    }
    for (const p of punches) {
      records.push({
        biometricId: id,
        name,
        date: p.date || rowDate,
        seconds: p.seconds,
        sheet: sheetName,
        cell: p.cell,
        raw: p.raw,
        deviceEventId: punches.length === 1 ? deviceEventId : null,
      });
    }
  }
  return { records, issues, stats };
}
