import * as XLSX from 'xlsx';

// Values beginning with these characters can be interpreted as formulas by
// spreadsheet software (CSV/formula injection); prefix them with a quote.
const FORMULA_START = /^[=+\-@\t\r]/;

export function sanitizeCell(v) {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  return FORMULA_START.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}

export function sanitizeRows(rows) {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, sanitizeCell(v)])));
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(sanitizeCell(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(rows, filename) {
  // BOM so Excel opens UTF-8 correctly (names with ñ, etc.)
  triggerDownload(new Blob(['\uFEFF', toCsv(rows)], { type: 'text/csv;charset=utf-8' }), filename);
}

/** sheets: [{ name, rows: [objects] }] */
export function downloadXlsx(sheets, filename) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(sanitizeRows(s.rows.length ? s.rows : [{ Note: 'No records' }]));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename, { compression: true });
}

export function fileStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
