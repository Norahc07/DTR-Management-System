import { describe, it, expect } from 'vitest';
import {
  excelSerialToParts,
  extractDateFromCell,
  extractTimesFromCell,
  isDateFormat,
  normalizeBiometricId,
  parseDateString,
  parseTimeTokens,
} from './cellValues';

describe('excelSerialToParts', () => {
  it('decodes pure times', () => {
    expect(excelSerialToParts(0.5)).toEqual({ date: null, seconds: 43200 });
    expect(excelSerialToParts(8 / 24 + 1 / 1440)).toEqual({ date: null, seconds: 8 * 3600 + 60 });
  });

  it('decodes date-times in the 1900 system', () => {
    expect(excelSerialToParts(46267 + 8.5 / 24)).toEqual({ date: '2026-09-02', seconds: 30600 });
    expect(excelSerialToParts(46267)).toEqual({ date: '2026-09-02', seconds: null });
    expect(excelSerialToParts(61)).toEqual({ date: '1900-03-01', seconds: null });
  });

  it('decodes the 1904 date system', () => {
    expect(excelSerialToParts(0, { date1904: true })).toEqual({ date: '1904-01-01', seconds: null });
  });

  it('carries rounding to the next day', () => {
    expect(excelSerialToParts(46267.9999999999)).toEqual({ date: '2026-09-03', seconds: 0 });
  });

  it('rejects invalid input', () => {
    expect(excelSerialToParts(-1)).toBeNull();
    expect(excelSerialToParts(Number.NaN)).toBeNull();
  });
});

describe('isDateFormat', () => {
  it('recognises date/time formats only', () => {
    expect(isDateFormat('hh:mm')).toBe(true);
    expect(isDateFormat('yyyy-mm-dd')).toBe(true);
    expect(isDateFormat('[$-409]h:mm AM/PM')).toBe(true);
    expect(isDateFormat('General')).toBe(false);
    expect(isDateFormat('0.00')).toBe(false);
    expect(isDateFormat('"Day" 0')).toBe(false);
  });
});

describe('parseTimeTokens', () => {
  it('parses 24h, seconds, and 12h strings', () => {
    expect(parseTimeTokens('08:05').times.map((t) => t.seconds)).toEqual([29100]);
    expect(parseTimeTokens('17:03:09').times.map((t) => t.seconds)).toEqual([61389]);
    expect(parseTimeTokens('12:15 AM').times.map((t) => t.seconds)).toEqual([900]);
    expect(parseTimeTokens('12:15 PM').times.map((t) => t.seconds)).toEqual([44100]);
    expect(parseTimeTokens('5:30 p.m.').times.map((t) => t.seconds)).toEqual([63000]);
  });

  it('splits multi-line and concatenated values in order', () => {
    expect(parseTimeTokens('08:01\n12:02\n13:00').times.map((t) => t.raw)).toEqual(['08:01', '12:02', '13:00']);
    expect(parseTimeTokens('08:0112:0213:0017:05').times.map((t) => t.raw)).toEqual(['08:01', '12:02', '13:00', '17:05']);
  });

  it('reports invalid tokens and leftover text', () => {
    const r = parseTimeTokens('25:00 absent');
    expect(r.times).toEqual([]);
    expect(r.invalid).toEqual(['25:00']);
    expect(r.leftover).toBe('absent');
  });
});

describe('parseDateString', () => {
  it('handles ISO and configurable day/month order', () => {
    expect(parseDateString('2026-09-01')).toEqual({ date: '2026-09-01', seconds: null });
    expect(parseDateString('2026/9/1 8:30')).toEqual({ date: '2026-09-01', seconds: 30600 });
    expect(parseDateString('09/01/2026', 'MDY').date).toBe('2026-09-01');
    expect(parseDateString('09/01/2026', 'DMY').date).toBe('2026-01-09');
    expect(parseDateString('31/02/2026', 'DMY')).toBeNull();
    expect(parseDateString('hello')).toBeNull();
  });
});

describe('extractTimesFromCell', () => {
  it('reads formatted serial times', () => {
    expect(extractTimesFromCell({ t: 'n', v: 0.75, z: 'h:mm' }).times).toEqual([64800]);
  });

  it('flags unformatted fractional numbers as assumed times', () => {
    const r = extractTimesFromCell({ t: 'n', v: 0.5, z: 'General' });
    expect(r.times).toEqual([43200]);
    expect(r.issues[0].code).toBe('NUMERIC_TIME_ASSUMED');
  });

  it('flags non-time text without inventing values', () => {
    const r = extractTimesFromCell({ t: 's', v: 'Absent' });
    expect(r.times).toEqual([]);
    expect(r.issues[0].code).toBe('UNRECOGNIZED_VALUE');
  });

  it('returns nothing for empty cells', () => {
    expect(extractTimesFromCell(undefined).times).toEqual([]);
    expect(extractTimesFromCell({ t: 's', v: '   ' }).times).toEqual([]);
  });

  it('flags a date without time', () => {
    const r = extractTimesFromCell({ t: 'n', v: 46267, z: 'yyyy-mm-dd' });
    expect(r.times).toEqual([]);
    expect(r.issues[0].code).toBe('DATE_WITHOUT_TIME');
  });
});

describe('extractDateFromCell', () => {
  it('reads serial date-times and strings', () => {
    expect(extractDateFromCell({ t: 'n', v: 46267.5, z: 'm/d/yy h:mm' })).toEqual({ date: '2026-09-02', seconds: 43200 });
    expect(extractDateFromCell({ t: 's', v: '2026-09-02 07:59:59' })).toEqual({ date: '2026-09-02', seconds: 28799 });
  });
});

describe('normalizeBiometricId', () => {
  it('keeps string IDs with leading zeros intact', () => {
    expect(normalizeBiometricId({ t: 's', v: '000123' }).id).toBe('000123');
  });

  it('strips a label prefix', () => {
    expect(normalizeBiometricId('ID: 45').id).toBe('45');
  });

  it('warns when a numeric cell may have lost leading zeros and can pad', () => {
    const r = normalizeBiometricId({ t: 'n', v: 123, z: 'General' }, { padLength: 6 });
    expect(r.id).toBe('000123');
    expect(r.issues[0].code).toBe('NUMERIC_ID');
  });

  it('rejects invalid IDs', () => {
    expect(normalizeBiometricId({ t: 's', v: 'abc def' }).id).toBeNull();
    expect(normalizeBiometricId({ t: 'n', v: 1.5, z: 'General' }).id).toBeNull();
  });
});
