// Writes clearly labeled SYNTHETIC workbooks for trying the import wizard
// locally. They are not real ZKTeco exports; real-format support must be
// verified with an anonymized workbook from the actual device.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMatrixIdColumnWorkbook,
  buildMatrixLabelWorkbook,
  buildRowLogWorkbook,
  buildZkAttRecordWorkbook,
  workbookToBytes,
} from '../tests/fixtures/syntheticWorkbooks.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'synthetic');
mkdirSync(outDir, { recursive: true });

const files = [
  ['SYNTHETIC-zkteco-att-record-report-2026-09.xlsx', buildZkAttRecordWorkbook(), 'xlsx'],
  ['SYNTHETIC-matrix-label-rows-2026-09.xlsx', buildMatrixLabelWorkbook(), 'xlsx'],
  ['SYNTHETIC-matrix-id-column.xlsx', buildMatrixIdColumnWorkbook(), 'xlsx'],
  ['SYNTHETIC-row-log.xlsx', buildRowLogWorkbook(), 'xlsx'],
  ['SYNTHETIC-row-log-legacy.xls', buildRowLogWorkbook(), 'biff8'],
];

for (const [name, wb, type] of files) {
  writeFileSync(join(outDir, name), workbookToBytes(wb, type));
  console.log(`wrote fixtures/synthetic/${name}`);
}
console.log('These files are SYNTHETIC test fixtures, not real device exports.');
