import { describe, expect, it } from 'vitest';
import { dtrExportRows } from './dtrExport';

const day = (d, slots, extra = {}) => ({ date: `2026-09-${String(d).padStart(2, '0')}`, day: d, weekday: 'Tue', slots, late: 0, undertime: 0, statusLabel: 'Complete', remarks: '', ...extra });

describe('dtrExportRows', () => {
  it('exports morning/afternoon IN and OUT for the days of the selected half only', () => {
    const dtr = { rows: [day(1, ['07:05', '12:00', '13:00', '18:00'], { late: 5 }), day(15, ['07:00', '12:00', '', '']), day(16, ['07:00', '12:00', '13:00', '18:00'])] };
    const rows = dtrExportRows([{ emp: { full_name: 'jm', biometric_id: '3' }, dtr }], { year: 2026, month: 9, period: 'first' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ Staff: 'jm', 'Biometric ID': '3', Date: '2026-09-01', 'Morning IN': '07:05', 'Morning OUT': '12:00', 'Afternoon IN': '13:00', 'Afternoon OUT': '18:00', 'Late (min)': 5 });
    expect(rows[1]).toMatchObject({ Date: '2026-09-15', 'Afternoon IN': '', 'Afternoon OUT': '' });
  });
});
