import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildZkAttRecordWorkbook, workbookToBytes } from '../../../tests/fixtures/syntheticWorkbooks';
import { inspectWorkbook, readWorkbook } from './parser/workbook';
import { extractLabeledValues, splitList, DEFAULT_MATRIX_CONFIG } from './parser/matrixAdapter';
import { initialConfig, periodOf } from './importConfig';
import { buildImportPreview, parseWorkbook } from './preview';

const employees = [
  { id: 'e3', biometric_id: '3', last_name: 'JM', first_name: 'JM', full_name: 'jm', is_active: true },
  { id: 'e15', biometric_id: '15', last_name: 'DEVSAMPLE', first_name: 'Bravo', full_name: 'DEVSAMPLE, Bravo', is_active: true },
];

const groups = {
  id: splitList(DEFAULT_MATRIX_CONFIG.idLabels),
  name: splitList(DEFAULT_MATRIX_CONFIG.nameLabels),
  department: splitList(DEFAULT_MATRIX_CONFIG.departmentLabels),
};

describe('ZKTeco "Att. record report" labels', () => {
  it('reads ID, name and department from one cell', () => {
    expect(extractLabeledValues(['ID.: 3       Name: jm    Dept.Name: eLearning'], groups)).toEqual({ id: '3', name: 'jm', department: 'eLearning' });
  });

  it('reads labels and values from separate cells', () => {
    expect(extractLabeledValues(['ID.:', '', '3', 'Name:', 'jm', 'Dept.Name:', 'eLearning'], groups)).toEqual({ id: '3', name: 'jm', department: 'eLearning' });
  });

  it('keeps multi-word names intact', () => {
    expect(extractLabeledValues(['ID.: 15 Name: Dela Cruz Juan Dept.Name: Admin Office'], groups)).toEqual({ id: '15', name: 'Dela Cruz Juan', department: 'Admin Office' });
  });
});

describe.each(['single', 'split'])('auto-detected import (%s label cells)', (labelStyle) => {
  const wb = readWorkbook(workbookToBytes(buildZkAttRecordWorkbook({ labelStyle })));
  const inspection = inspectWorkbook(wb);
  const config = initialConfig(wb, inspection, {});

  it('selects the Att. record report sheet, day row 3, and the period', () => {
    expect(config.preset).toBe('zkteco_att_record');
    expect(config.sheets).toEqual(['Att. record report']);
    expect(config.dayHeaderRow).toBe(3);
    expect(config.periodDetected).toBe(true);
    expect(periodOf(config)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('reads every punch from the multi-line day cells', () => {
    const parsed = parseWorkbook(wb, config);
    const preview = buildImportPreview({ ...parsed, employees, period: periodOf(config) });
    const errors = preview.issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    const jm = preview.records.filter((r) => r.biometricId === '3');
    const fmt = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
    expect(jm.filter((r) => r.date === '2026-09-01').map((r) => fmt(r.seconds))).toEqual(['07:56', '12:02', '12:46', '17:00']);
    expect(jm.filter((r) => r.date === '2026-09-02').map((r) => fmt(r.seconds))).toEqual(['08:10', '17:05']);
    expect(jm.filter((r) => r.date === '2026-09-03')).toHaveLength(3);
    expect(preview.records.filter((r) => r.biometricId === '15')).toHaveLength(4);
    expect(preview.employees.every((e) => e.matched)).toBe(true);
    expect(preview.totals.validPunches).toBe(13);
  });

  it('skips ignored device IDs (e.g. the device administrator) entirely', () => {
    const preview = buildImportPreview({ ...parseWorkbook(wb, config), employees, period: periodOf(config), ignoredIds: ['15'] });
    expect(preview.records.some((r) => r.biometricId === '15')).toBe(false);
    expect(preview.employees.map((e) => e.biometricId)).toEqual(['3']);
    expect(preview.totals).toMatchObject({ validPunches: 9, ignoredPunches: 4, unmatchedIds: 0 });
  });
});

it('falls back to manual month selection when the sheet has no period text', () => {
  const wb = buildZkAttRecordWorkbook();
  const ws = wb.Sheets['Att. record report'];
  delete ws.C2;
  const book = readWorkbook(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
  const config = initialConfig(book, inspectWorkbook(book), {});
  expect(config.preset).toBe('zkteco_att_record');
  expect(config.periodDetected).toBe(false);
});
