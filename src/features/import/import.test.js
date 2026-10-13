import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildMatrixIdColumnWorkbook,
  buildMatrixLabelWorkbook,
  buildRowLogWorkbook,
  workbookToBytes,
} from '../../../tests/fixtures/syntheticWorkbooks';
import { DEFAULT_MATRIX_CONFIG, extractLabeledValues } from './parser/matrixAdapter';
import { DEFAULT_ROWS_CONFIG, suggestRowsMapping } from './parser/rowsAdapter';
import { ImportFileError, inspectWorkbook, readWorkbook, sniffFormat, validateWorkbookFile } from './parser/workbook';
import { buildImportPreview, parseWorkbook } from './preview';
import { matchEmployees, namesCompatible } from './matching';

const employees = [
  { id: 'e1', biometric_id: '0001', last_name: 'DEVSAMPLE', first_name: 'Alpha', full_name: 'DEVSAMPLE, Alpha', is_active: true },
  { id: 'e2', biometric_id: '0002', last_name: 'DEVSAMPLE', first_name: 'Bravo', full_name: 'DEVSAMPLE, Bravo', is_active: true },
  { id: 'e3', biometric_id: '0003', last_name: 'DEVSAMPLE', first_name: 'Charlie', full_name: 'DEVSAMPLE, Charlie', is_active: true },
];
const september = { start: '2026-09-01', end: '2026-09-30' };

const roundTrip = (wb) => readWorkbook(workbookToBytes(wb));

describe('file validation', () => {
  it('accepts a real xlsx container', () => {
    const bytes = workbookToBytes(buildMatrixLabelWorkbook());
    expect(validateWorkbookFile({ name: 'report.xlsx', size: bytes.length, bytes }).format).toBe('zip');
  });

  it('rejects wrong extensions, oversize, empty, and disguised files', () => {
    const bytes = new TextEncoder().encode('just some text, not a workbook');
    expect(() => validateWorkbookFile({ name: 'a.csv', size: 10, bytes })).toThrow(ImportFileError);
    expect(() => validateWorkbookFile({ name: 'a.xlsx', size: 0, bytes })).toThrow(/empty/);
    expect(() => validateWorkbookFile({ name: 'a.xlsx', size: 11 * 1048576, bytes }, { maxMb: 10 })).toThrow(/limit/);
    expect(() => validateWorkbookFile({ name: 'a.xlsx', size: bytes.length, bytes })).toThrow(/not a recognised/);
  });

  it('accepts legacy .xls (OLE) and warns on HTML-based .xls', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(sniffFormat(ole)).toBe('ole');
    const html = new TextEncoder().encode('<html><table><tr><td>1</td></tr></table></html>');
    const r = validateWorkbookFile({ name: 'x.xls', size: html.length, bytes: html });
    expect(r.format).toBe('markup');
    expect(r.warnings.length).toBe(1);
  });

  it('reports malformed zip content as a readable error', () => {
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]);
    expect(() => readWorkbook(broken)).toThrow(ImportFileError);
  });
});

describe('workbook inspection', () => {
  it('lists sheets, empty sheets, and detects a matrix layout and period', () => {
    const info = inspectWorkbook(roundTrip(buildMatrixLabelWorkbook()));
    expect(info.sheets.map((s) => s.name)).toEqual(['Attendance', 'Empty']);
    expect(info.sheets[1].empty).toBe(true);
    expect(info.sheets[0].hints).toMatchObject({ dayHeaderRow: 3, suggestedLayout: 'matrix', period: { start: '2026-09-01', end: '2026-09-30' } });
  });

  it('detects a row layout header and suggests a mapping', () => {
    const wb = roundTrip(buildRowLogWorkbook());
    const info = inspectWorkbook(wb);
    expect(info.sheets[0].hints.suggestedLayout).toBe('rows');
    expect(suggestRowsMapping(wb.Sheets.Logs, 1)).toMatchObject({ idColumn: 'A', nameColumn: 'B', datetimeColumn: 'C' });
  });
});

describe('label extraction', () => {
  it('reads separate-cell and inline labels', () => {
    const groups = { id: ['User ID', 'ID'], name: ['Name'] };
    expect(extractLabeledValues(['ID:', '12', 'Name:', 'Juan'], groups)).toEqual({ id: '12', name: 'Juan' });
    expect(extractLabeledValues(['ID: 0012 Name: Juan Dela Cruz'], groups)).toEqual({ id: '0012', name: 'Juan Dela Cruz' });
  });
});

describe('matrix adapter (labelRow)', () => {
  const config = { ...DEFAULT_MATRIX_CONFIG, sheets: ['Attendance', 'Empty'], year: 2026, month: 9, dayHeaderRow: 4, punchRowOffsets: '1' };

  it('parses punches, flags duplicates/unmatched/empty sheet, and totals', () => {
    const wb = roundTrip(buildMatrixLabelWorkbook());
    const parsed = parseWorkbook(wb, config);
    expect(parsed.stats.sheetsProcessed).toBe(2);
    expect(parsed.issues.some((i) => i.code === 'EMPTY_SHEET' && i.sheet === 'Empty')).toBe(true);
    expect(parsed.issues.some((i) => i.code === 'DUPLICATE_IN_SOURCE')).toBe(true);

    const alphaDay1 = parsed.records.filter((r) => r.biometricId === '0001' && r.date === '2026-09-01');
    expect(alphaDay1.map((r) => r.seconds / 60)).toEqual([481, 722, 780, 1025]);
    expect(alphaDay1[0].cell).toBe('B6');

    const bravoDay1 = parsed.records.filter((r) => r.biometricId === '0002' && r.date === '2026-09-01');
    expect(bravoDay1).toHaveLength(4);

    const preview = buildImportPreview({ ...parsed, employees, period: september });
    expect(preview.totals).toMatchObject({
      employeesInFile: 3,
      employeesRecognized: 2,
      unmatchedIds: 1,
      unmatchedPunches: 2,
      incompleteRecords: 1,
    });
    const unmatched = preview.employees.find((e) => e.biometricId === '0777');
    expect(unmatched.matched).toBe(false);
    const alpha = preview.employees.find((e) => e.biometricId === '0001');
    expect(alpha.days.find((d) => d.date === '2026-09-04').flags).toContain('ODD_PUNCH_COUNT');
  });

  it('requires month/year and a valid day header row', () => {
    const wb = roundTrip(buildMatrixLabelWorkbook());
    expect(parseWorkbook(wb, { ...config, year: null }).issues[0].code).toBe('MISSING_PERIOD');
    const bad = parseWorkbook(wb, { ...config, sheets: ['Attendance'], dayHeaderRow: 1 });
    expect(bad.issues.some((i) => i.code === 'NO_DAY_COLUMNS')).toBe(true);
  });

  it('flags day columns that do not exist in a shorter month', () => {
    const wb = roundTrip(buildMatrixLabelWorkbook({ days: 31 }));
    const parsed = parseWorkbook(wb, { ...config, sheets: ['Attendance'], month: 9 });
    expect(parsed.issues.some((i) => i.code === 'INVALID_DAY')).toBe(true);
  });

  it('flags punches outside the declared period', () => {
    const wb = roundTrip(buildMatrixLabelWorkbook());
    const parsed = parseWorkbook(wb, config);
    const preview = buildImportPreview({ ...parsed, employees, period: { start: '2026-09-02', end: '2026-09-30' } });
    expect(preview.issues.some((i) => i.code === 'OUT_OF_PERIOD')).toBe(true);
    expect(preview.records.every((r) => r.date >= '2026-09-02')).toBe(true);
  });

  it('produces identical records on reimport (idempotent input to the server)', () => {
    const a = parseWorkbook(roundTrip(buildMatrixLabelWorkbook()), config);
    const b = parseWorkbook(roundTrip(buildMatrixLabelWorkbook()), config);
    const key = (r) => `${r.biometricId}|${r.date}|${r.seconds}`;
    expect(a.records.map(key)).toEqual(b.records.map(key));
  });
});

describe('matrix adapter (idColumn) with mixed formats and partially invalid cells', () => {
  it('reads serial times and 12h strings across multiple rows per employee', () => {
    const wb = roundTrip(buildMatrixIdColumnWorkbook());
    const parsed = parseWorkbook(wb, {
      ...DEFAULT_MATRIX_CONFIG,
      sheets: ['Sheet1'],
      employeeLayout: 'idColumn',
      idColumn: 'A',
      nameColumn: 'B',
      year: 2026,
      month: 9,
      dayHeaderRow: 2,
    });
    const day = (d) => parsed.records.filter((r) => r.date === d).map((r) => r.seconds / 60);
    expect(day('2026-09-01')).toEqual([480, 1050]);
    expect(day('2026-09-02')).toEqual([495, 1020]);
    expect(parsed.records.every((r) => r.biometricId === '0003')).toBe(true);
    expect(parsed.issues.some((i) => i.code === 'UNRECOGNIZED_VALUE' && i.cell === 'E4')).toBe(true);
    expect(parsed.issues.some((i) => i.code === 'PARTIAL_MONTH')).toBe(true);
  });
});

describe('rows adapter', () => {
  it('parses date-time rows, skips blanks, and reports bad rows', () => {
    const wb = roundTrip(buildRowLogWorkbook());
    const parsed = parseWorkbook(wb, { ...DEFAULT_ROWS_CONFIG, sheets: ['Logs'], headerRow: 1, idColumn: 'A', nameColumn: 'B', datetimeColumn: 'C' });
    const recs = parsed.records.map((r) => `${r.biometricId} ${r.date} ${r.seconds}`);
    expect(recs).toEqual([
      '0001 2026-09-01 28875',
      '0001 2026-09-01 61380',
      '0002 2026-09-01 29400',
      '1 2026-09-02 30600',
    ]);
    const codes = parsed.issues.map((i) => i.code);
    expect(codes).toContain('INVALID_DATE');
    expect(codes).toContain('MISSING_ID');
    expect(codes).toContain('NUMERIC_ID');
    expect(parsed.stats.rowsSkipped).toBe(3);
  });

  it('requires a usable mapping', () => {
    const wb = roundTrip(buildRowLogWorkbook());
    const parsed = parseWorkbook(wb, { ...DEFAULT_ROWS_CONFIG, sheets: ['Logs'], idColumn: 'A' });
    expect(parsed.issues[0].code).toBe('MAPPING_INCOMPLETE');
  });

  it('handles unknown headers by producing no suggestions', () => {
    const ws = XLSX.utils.aoa_to_sheet([['foo', 'bar'], ['1', '2']]);
    expect(suggestRowsMapping(ws, 1)).toMatchObject({ idColumn: '', datetimeColumn: '', timeColumns: '' });
  });
});

describe('employee matching', () => {
  it('matches by ID only and flags name conflicts', () => {
    const res = matchEmployees(
      [
        { biometricId: '0001', names: new Set(['Someone Else']) },
        { biometricId: '0009', names: new Set(['DEVSAMPLE Alpha']) },
      ],
      employees,
    );
    expect(res.get('0001').employee.id).toBe('e1');
    expect(res.get('0001').issues.map((i) => i.code)).toContain('NAME_CONFLICT');
    expect(res.get('0009').employee).toBeNull();
    expect(res.get('0009').suggestions.length).toBeGreaterThan(0);
  });

  it('compares names loosely', () => {
    expect(namesCompatible('Alpha DEVSAMPLE', employees[0])).toBe(true);
    expect(namesCompatible('', employees[0])).toBe(true);
    expect(namesCompatible('Zed Unknown', employees[0])).toBe(false);
  });
});
