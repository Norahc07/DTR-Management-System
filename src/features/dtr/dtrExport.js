import { DAY_REMARKS, HALF_DAY_REMARK, periodDays, usesRemarkUndertime } from './form48';

const REMARK_LABEL = Object.fromEntries([...DAY_REMARKS, HALF_DAY_REMARK].map(([v, l]) => [v, l]));

/** One spreadsheet row per staff member per day of the period, with the four DTR times as printed. */
export function dtrExportRows(docs, { year, month, period }) {
  const { from, to } = periodDays(year, month, period);
  return docs.flatMap(({ emp, dtr }) =>
    dtr.rows
      .filter((r) => r.day >= from && r.day <= to)
      .map((r) => {
        const slots = r.printSlots ?? r.slots;
        return {
          Staff: emp.full_name,
          'Biometric ID': emp.biometric_id,
          Date: r.date,
          Day: r.weekday,
          'Morning IN': slots[0] || '',
          'Morning OUT': slots[1] || '',
          'Afternoon IN': slots[2] || '',
          'Afternoon OUT': slots[3] || '',
          'Late (min)': usesRemarkUndertime(emp) ? '' : r.late || 0,
          'Undertime (min)': usesRemarkUndertime(emp) ? '' : r.undertime || 0,
          Remark: r.remark ? REMARK_LABEL[r.remark] ?? r.remark : '',
          Status: r.statusLabel,
          Remarks: r.remarks || '',
        };
      }),
  );
}
