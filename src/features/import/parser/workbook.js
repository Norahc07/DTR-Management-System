// Workbook loading and inspection. Uploaded files are untrusted input: we check
// size and file signature, never evaluate formulas or macros (SheetJS does not
// execute VBA; we also skip formula and VBA extraction).
import * as XLSX from 'xlsx';
import { cellText, excelSerialToParts, readCell } from './cellValues';

export const DEFAULT_MAX_FILE_MB = 10;
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];

export class ImportFileError extends Error {}

/** Detects the container format from magic bytes. */
export function sniffFormat(bytes) {
  const b = bytes.subarray(0, 8);
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'zip';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'ole';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<') && /<(table|html|\?xml|workbook)/.test(head)) return 'markup';
  return 'unknown';
}

/** Validates name/size/signature. Returns { format, warnings }. Throws ImportFileError. */
export function validateWorkbookFile({ name, size, bytes }, { maxMb = DEFAULT_MAX_FILE_MB } = {}) {
  const lower = String(name || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    throw new ImportFileError('Only Excel files (.xlsx or .xls) are accepted.');
  }
  if (!size) throw new ImportFileError('The file is empty.');
  if (size > maxMb * 1024 * 1024) {
    throw new ImportFileError(`The file is ${(size / 1048576).toFixed(1)} MB; the limit is ${maxMb} MB.`);
  }
  const format = sniffFormat(bytes);
  const warnings = [];
  if (format === 'unknown') {
    throw new ImportFileError('The file content is not a recognised Excel workbook. It may be corrupted or renamed.');
  }
  if (lower.endsWith('.xlsx') && format !== 'zip') {
    throw new ImportFileError('The file has an .xlsx extension but is not an Excel Open XML workbook.');
  }
  if (format === 'markup') {
    warnings.push('This .xls file is an HTML/XML spreadsheet (some attendance software exports this format). Verify the preview carefully.');
  }
  if (lower.endsWith('.xlsm') || lower.endsWith('.xlsb')) {
    throw new ImportFileError('Macro-enabled or binary workbooks are not accepted.');
  }
  return { format, warnings };
}

export function readWorkbook(bytes) {
  try {
    return XLSX.read(bytes, {
      type: 'array',
      cellDates: false,
      cellNF: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      bookDeps: false,
      bookFiles: false,
      sheetStubs: false,
      WTF: false,
    });
  } catch (error) {
    throw new ImportFileError(`The workbook could not be read: ${error.message}`);
  }
}

export function isDate1904(wb) {
  return Boolean(wb?.Workbook?.WBProps?.date1904);
}

export async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) return null;
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Grid helpers (all row/column indexes are 0-based internally)
// ---------------------------------------------------------------------------
export const colLetter = (c) => XLSX.utils.encode_col(c);
export const colIndex = (letter) => XLSX.utils.decode_col(String(letter).trim().toUpperCase());
export const cellRef = (r, c) => XLSX.utils.encode_cell({ r, c });

export function sheetRange(ws) {
  if (!ws?.['!ref']) return null;
  return XLSX.utils.decode_range(ws['!ref']);
}

export function getCell(ws, r, c) {
  return ws[cellRef(r, c)];
}

/** Value of the top-left cell when (r, c) lies inside a merged range. */
export function getCellWithMerges(ws, r, c) {
  const direct = getCell(ws, r, c);
  if (direct) return direct;
  for (const m of ws['!merges'] || []) {
    if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) return getCell(ws, m.s.r, m.s.c);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------
const PREVIEW_ROWS = 40;
const PREVIEW_COLS = 40;

export function inspectWorkbook(wb) {
  const meta = wb.Workbook?.Sheets || [];
  return {
    date1904: isDate1904(wb),
    sheets: wb.SheetNames.map((name, i) => {
      const ws = wb.Sheets[name];
      const range = sheetRange(ws);
      const hiddenRows = (ws['!rows'] || []).reduce((n, r) => n + (r?.hidden ? 1 : 0), 0);
      const hiddenCols = (ws['!cols'] || []).reduce((n, c) => n + (c?.hidden ? 1 : 0), 0);
      return {
        name,
        index: i,
        hidden: Boolean(meta[i]?.Hidden),
        ref: ws['!ref'] || null,
        rowCount: range ? range.e.r - range.s.r + 1 : 0,
        colCount: range ? range.e.c - range.s.c + 1 : 0,
        mergeCount: (ws['!merges'] || []).length,
        hiddenRows,
        hiddenCols,
        empty: !range,
        hints: range ? detectLayoutHints(ws, range) : null,
      };
    }),
  };
}

/** Builds a small text grid for display. */
export function previewGrid(ws, { rows = PREVIEW_ROWS, cols = PREVIEW_COLS, startRow = 0 } = {}) {
  const range = sheetRange(ws);
  if (!range) return { rows: [], colLetters: [] };
  const lastRow = Math.min(range.e.r, startRow + rows - 1);
  const lastCol = Math.min(range.e.c, cols - 1);
  const colLetters = Array.from({ length: lastCol + 1 }, (_, c) => colLetter(c));
  const out = [];
  for (let r = startRow; r <= lastRow; r++) {
    const cells = [];
    for (let c = 0; c <= lastCol; c++) {
      const cell = getCell(ws, r, c);
      cells.push(cell ? readCell(cell).text : '');
    }
    out.push({ row: r + 1, hidden: Boolean(ws['!rows']?.[r]?.hidden), cells });
  }
  return { rows: out, colLetters };
}

const DAY_TOKEN = /^\s*(\d{1,2})(?!\d)/;

/** Day numbers 1..31 found across a row -> [{ col, day }] (strictly increasing). */
export function findDayColumns(ws, row, range = sheetRange(ws), { date1904 = false } = {}) {
  const out = [];
  if (!range) return out;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = getCell(ws, row, c);
    const rc = readCell(cell);
    let day = null;
    if (rc.kind === 'number' && Number.isInteger(rc.value)) day = rc.value;
    else if (rc.kind === 'serial') {
      const parts = excelSerialToParts(rc.value, { date1904 });
      if (parts?.date) day = Number(parts.date.slice(8));
    } else if (rc.kind === 'string') {
      const m = DAY_TOKEN.exec(rc.value);
      if (m && !/^\s*\d{1,2}\s*:/.test(rc.value)) day = Number(m[1]);
    }
    if (day != null && day >= 1 && day <= 31 && (out.length === 0 || day > out[out.length - 1].day)) {
      out.push({ col: c, day });
    }
  }
  return out;
}

const PERIOD_PATTERN = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*(?:~|to|-|–)\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/i;

function detectLayoutHints(ws, range) {
  const maxRow = Math.min(range.e.r, range.s.r + 30);
  let dayHeaderRow = null;
  let headerRow = null;
  let period = null;
  for (let r = range.s.r; r <= maxRow; r++) {
    if (dayHeaderRow == null) {
      const days = findDayColumns(ws, r, range);
      if (days.length >= 20 && days[0].day === 1) dayHeaderRow = r;
    }
    const texts = [];
    for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 40); c++) {
      const t = cellText(getCell(ws, r, c));
      if (t) texts.push(t);
    }
    if (!period) {
      // The range may sit in one cell or be split across cells ("2026-09-01" "~" "2026-09-30").
      for (const t of [...texts, texts.join(' ')]) {
        const m = PERIOD_PATTERN.exec(t);
        if (m) {
          period = { start: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, end: `${m[4]}-${m[5].padStart(2, '0')}-${m[6].padStart(2, '0')}` };
          break;
        }
      }
    }
    if (headerRow == null) {
      const joined = texts.join(' | ').toLowerCase();
      const hasId = /\b(id|no\.?|ac-?no|pin|badge|employee)\b/.test(joined);
      const hasTime = /\b(time|date|check|clock)\b/.test(joined);
      if (hasId && hasTime && texts.length >= 3) headerRow = r;
    }
  }
  return {
    dayHeaderRow,
    headerRow,
    period,
    suggestedLayout: dayHeaderRow != null ? 'matrix' : headerRow != null ? 'rows' : null,
  };
}
