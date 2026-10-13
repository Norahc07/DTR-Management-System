// SYNTHETIC TEST FIXTURES. These workbooks are generated for automated tests
// and demos. They are NOT real ZKTeco exports and must not be used to claim
// compatibility with any specific device format.
import * as XLSX from 'xlsx';

export const FIXTURE_BANNER = 'SYNTHETIC TEST FIXTURE - NOT A REAL ZKTECO EXPORT';

/** Monthly matrix: label rows ("ID:" / "Name:") followed by one punch row; times as multi-line text. */
export function buildMatrixLabelWorkbook({ year = 2026, month = 9, days = 30 } = {}) {
  const header = [''];
  for (let d = 1; d <= days; d++) header.push(d);
  const aoa = [
    [FIXTURE_BANNER],
    [`Att. Time: ${year}-${String(month).padStart(2, '0')}-01 ~ ${year}-${String(month).padStart(2, '0')}-${days}`],
    [],
    header,
    ['ID:', '0001', 'Name:', 'DEVSAMPLE Alpha'],
    ['', '08:01\n12:02\n13:00\n17:05', '07:55\n17:10', '08:20\n12:00\n13:15\n17:00', '08:00'],
    ['ID:', '0002', 'Name:', 'DEVSAMPLE Bravo'],
    ['', '08:0012:0113:0217:00', '', '08:00 08:00 17:00'],
    ['ID:', '0777', 'Name:', 'Unknown Person'],
    ['', '09:00\n18:00'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Empty');
  return wb;
}

/** Matrix where each employee row has ID/name columns and day cells hold Excel time serials. */
export function buildMatrixIdColumnWorkbook() {
  const ws = XLSX.utils.aoa_to_sheet([
    [FIXTURE_BANNER],
    ['No.', 'Name', 1, 2, 3],
    ['0003', 'DEVSAMPLE Charlie', '', '', ''],
  ]);
  // Excel serial time 08:00 and 17:30 in a single-punch-per-row layout (2 rows per employee).
  ws.C3 = { t: 'n', v: 8 / 24, z: 'hh:mm' };
  ws.D3 = { t: 's', v: '8:15 AM' };
  ws.C4 = { t: 'n', v: 17.5 / 24, z: 'hh:mm' };
  ws.D4 = { t: 's', v: '5:00 PM' };
  ws.E4 = { t: 's', v: 'Absent' };
  ws['!ref'] = 'A1:E4';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

/** Row-oriented log: one punch per row with a combined date-time column. */
export function buildRowLogWorkbook() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['AC-No.', 'Name', 'Time', 'State'],
    ['0001', 'DEVSAMPLE Alpha', '2026-09-01 08:01:15', 'C/In'],
    ['0001', 'DEVSAMPLE Alpha', '2026-09-01 17:03:00', 'C/Out'],
    ['', '', '', ''],
    ['0002', 'DEVSAMPLE Bravo', '09/01/2026 8:10 AM', 'C/In'],
    ['0002', 'DEVSAMPLE Bravo', 'not a date', 'C/Out'],
    ['', 'Missing ID', '2026-09-01 09:00', ''],
  ]);
  // A true Excel date-time serial: 2026-09-02 08:30
  ws.C8 = { t: 'n', v: 46267 + 8.5 / 24, z: 'yyyy-mm-dd hh:mm' };
  ws.A8 = { t: 'n', v: 1, z: 'General' };
  ws['!ref'] = 'A1:D8';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Logs');
  return wb;
}

/**
 * Imitates the ZKTeco "Att. record report" sheet as described by the client:
 * day numbers in row 3, an "ID.: / Name: / Dept.Name:" row per employee and
 * the punches for each day in the next row, one time per line.
 * labelStyle 'single' puts the whole label text in one merged cell;
 * 'split' puts labels and values in separate cells.
 */
export function buildZkAttRecordWorkbook({ labelStyle = 'single', year = 2026, month = 9, days = 30 } = {}) {
  const mm = String(month).padStart(2, '0');
  const width = days;
  const blank = () => Array(width).fill('');
  const dayRow = Array.from({ length: days }, (_, i) => i + 1);
  const labelRow = (id, name, dept) => {
    const row = blank();
    if (labelStyle === 'single') row[0] = `ID.: ${id}       Name: ${name}    Dept.Name: ${dept}`;
    else Object.assign(row, { 0: 'ID.:', 2: id, 8: 'Name:', 10: name, 18: 'Dept.Name:', 20: dept });
    return row;
  };
  const punchRow = (byDay) => {
    const row = blank();
    for (const [day, text] of Object.entries(byDay)) row[Number(day) - 1] = text;
    return row;
  };
  const periodRow = blank();
  if (labelStyle === 'single') Object.assign(periodRow, { 0: 'Att. Time:', 2: `${year}-${mm}-01 ~ ${year}-${mm}-${days}` });
  else Object.assign(periodRow, { 0: 'Att. Time:', 2: `${year}-${mm}-01`, 4: '~', 5: `${year}-${mm}-${days}` });

  const aoa = [
    [FIXTURE_BANNER],
    periodRow,
    dayRow,
    labelRow('3', 'jm', 'eLearning'),
    punchRow({ 1: '07:56\n12:02\n12:46\n17:00', 2: '08:10\n17:05', 3: '07:58\n12:00\n13:01' }),
    labelRow('15', 'DEVSAMPLE Bravo', 'Admin'),
    punchRow({ 1: '07:45\n12:01\n12:55\n17:02' }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (labelStyle === 'single') ws['!merges'] = [{ s: { r: 3, c: 0 }, e: { r: 3, c: width - 1 } }, { s: { r: 5, c: 0 }, e: { r: 5, c: width - 1 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[FIXTURE_BANNER], ['Att. Stat. report (not imported)']]), 'Att. Stat. report');
  XLSX.utils.book_append_sheet(wb, ws, 'Att. record report');
  return wb;
}

export function workbookToBytes(wb, bookType = 'xlsx') {
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType }));
}
