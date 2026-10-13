import { daysInMonth, toDateKey } from '@/lib/time';
import { DEFAULT_MATRIX_CONFIG, ZKTECO_ATT_RECORD_PRESET, ZKTECO_ATT_RECORD_SHEET } from './parser/matrixAdapter';
import { DEFAULT_ROWS_CONFIG, suggestRowsMapping } from './parser/rowsAdapter';

const STORAGE_KEY = 'dtr.import.mapping.v1';
export const MAPPING_KEYS = [
  'layout', 'employeeLayout', 'idLabels', 'nameLabels', 'departmentLabels', 'punchRowOffsets', 'idColumn', 'nameColumn',
  'idPadLength', 'dateColumn', 'timeColumns', 'datetimeColumn', 'deviceEventIdColumn', 'dateOrder',
];

/** Device IDs whose punches are never imported (ID 1 is the device administrator, not staff). */
export function ignoredBiometricIds(settings) {
  const list = settings?.import_config?.ignoredBiometricIds;
  return Array.isArray(list) ? list.map(String) : ['1'];
}

export function loadSavedMapping(orgDefault) {
  try {
    const local = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return { ...(orgDefault || {}), ...(local || {}) };
  } catch {
    return orgDefault || {};
  }
}

/** Mapping saved in this browser by the last import, or null. */
export function readLocalMapping() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

/** Keeps only known mapping keys with primitive values. */
export function sanitizeMapping(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(
    MAPPING_KEYS.filter((k) => input[k] !== undefined && input[k] !== null && ['string', 'number', 'boolean'].includes(typeof input[k])).map((k) => [k, input[k]]),
  );
}

export function saveMapping(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(MAPPING_KEYS.map((k) => [k, config[k]]))));
  } catch {
    /* storage unavailable */
  }
}

/** The ZKTeco "Att. record report" sheet, when present with a day-number row. */
export function findZkAttRecordSheet(inspection) {
  return inspection.sheets.find((s) => !s.empty && ZKTECO_ATT_RECORD_SHEET.test(s.name) && s.hints?.dayHeaderRow != null) || null;
}

/** Initial configuration from inspection hints + saved mapping. */
export function initialConfig(wb, inspection, saved = {}) {
  const zk = findZkAttRecordSheet(inspection);
  if (zk) {
    const hints = zk.hints;
    const start = hints.period?.start;
    const now = new Date();
    const year = start ? Number(start.slice(0, 4)) : now.getFullYear();
    const month = start ? Number(start.slice(5, 7)) : now.getMonth() + 1;
    return {
      ...DEFAULT_MATRIX_CONFIG,
      ...DEFAULT_ROWS_CONFIG,
      idPadLength: saved.idPadLength ?? 0,
      ...ZKTECO_ATT_RECORD_PRESET,
      preset: 'zkteco_att_record',
      periodDetected: Boolean(start),
      sheets: [zk.name],
      year,
      month,
      dayHeaderRow: hints.dayHeaderRow + 1,
      periodStart: toDateKey(year, month, 1),
      periodEnd: toDateKey(year, month, daysInMonth(year, month)),
    };
  }
  const usable = inspection.sheets.filter((s) => !s.empty && !s.hidden);
  const primary = usable.find((s) => s.hints?.suggestedLayout) || usable[0] || inspection.sheets[0];
  const hints = primary?.hints || {};
  const layout = hints.suggestedLayout || saved.layout || 'matrix';
  const now = new Date();
  const periodStart = hints.period?.start;
  const year = periodStart ? Number(periodStart.slice(0, 4)) : now.getFullYear();
  const month = periodStart ? Number(periodStart.slice(5, 7)) : now.getMonth() + 1;
  const base = { ...DEFAULT_MATRIX_CONFIG, ...DEFAULT_ROWS_CONFIG, ...saved, layout };
  const config = {
    ...base,
    sheets: primary ? [primary.name] : [],
    year,
    month,
    dayHeaderRow: hints.dayHeaderRow != null ? hints.dayHeaderRow + 1 : base.dayHeaderRow,
    headerRow: hints.headerRow != null ? hints.headerRow + 1 : base.headerRow || 1,
    periodStart: hints.period?.start || toDateKey(year, month, 1),
    periodEnd: hints.period?.end || toDateKey(year, month, daysInMonth(year, month)),
  };
  if (layout === 'rows' && primary && !saved.idColumn) {
    Object.assign(config, suggestRowsMapping(wb.Sheets[primary.name], config.headerRow));
  }
  return config;
}

/** Declared import period for the server-side check. */
export function periodOf(config) {
  if (config.layout === 'matrix') {
    const y = Number(config.year);
    const m = Number(config.month);
    if (!y || !m) return null;
    return { start: toDateKey(y, m, 1), end: toDateKey(y, m, daysInMonth(y, m)) };
  }
  if (!config.periodStart || !config.periodEnd || config.periodEnd < config.periodStart) return null;
  return { start: config.periodStart, end: config.periodEnd };
}
