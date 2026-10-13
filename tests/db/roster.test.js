import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { createTestDb } from './harness.js';
import { employeeSchema } from '@/features/employees/employeeSchema';
import { validateEmployeeRows } from '@/features/employees/employeeService';
import { readWorkbook, inspectWorkbook } from '@/features/import/parser/workbook';
import { initialConfig, periodOf } from '@/features/import/importConfig';
import { buildImportPreview, parseWorkbook } from '@/features/import/preview';
import { buildZkAttRecordWorkbook, workbookToBytes } from '../fixtures/syntheticWorkbooks';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROSTER = [
  ['2', 'bal', 'MIRABUENO', 'CONCHITA MARTA B.'],
  ['3', 'jm', 'ALMARIEGO', 'JONATHAN MENGGE'],
  ['4', 'manel', 'PEÑASCOSAS', 'MARINYL MEDINA'],
  ['5', 'jc', 'ABOGA', 'JONATHAN CECILLANO'],
  ['6', 'irma', 'BEDIA', 'IRMA EBREO'],
  ['7', 'liza', 'VILLAMAYOR', 'ANNALIZA S.'],
  ['8', 'jv', 'VILLAMENA', 'JAYVEE VALLERAS'],
  ['9', 'joy', 'RAMIREZ', 'ROSECA JOY T.'],
  ['10', 'erika', 'ALQUIROS', 'ERIKA MAE PRIOLO'],
  ['12', 'rio', 'MAMORE', 'RIO ASTOVEZA'],
  ['18', 'igi', 'AMARILLO', 'LUIGI D.'],
];

let db;
const all = async (sql, params) => (await db.query(sql, params)).rows;

beforeAll(async () => {
  db = await createTestDb();
}, 120000);

afterAll(async () => {
  await db?.close();
});

describe('upgrading a database that already has staff', () => {
  it('splits existing assignments at 2026-10-01 and sets the DTR format of IDs 2, 3 and 12', async () => {
    const old = await createTestDb({
      beforeMigration: async (name, d) => {
        if (!name.includes('_dtr_remarks_and_october_schedule')) return;
        await d.exec(
          `insert into employees (biometric_id, last_name, department_id)
           select v.id, v.n, (select id from departments where name = 'eLearning') from (values ('2', 'bal'), ('4', 'manel'), ('15', 'ojt')) v(id, n)`,
        );
      },
    });
    try {
      const rows = (await old.query(
        `select e.biometric_id, e.dtr_format, w.name, x.effective_from::text as f, x.effective_to::text as t
         from employee_schedules x join employees e on e.id = x.employee_id join work_schedules w on w.id = x.schedule_id
         where e.biometric_id in ('2', '4')
         order by e.biometric_id::int, x.effective_from`,
      )).rows;
      const people = (await old.query(`select biometric_id, nickname, full_name, is_active from employees order by biometric_id::int`)).rows;
      expect(people).toEqual([
        { biometric_id: '2', nickname: 'bal', full_name: 'MIRABUENO, CONCHITA MARTA B.', is_active: true },
        { biometric_id: '4', nickname: 'manel', full_name: 'PEÑASCOSAS, MARINYL MEDINA', is_active: true },
        { biometric_id: '15', nickname: null, full_name: 'ojt', is_active: false },
      ]);
      expect(rows).toEqual([
        { biometric_id: '2', dtr_format: 'no_undertime', name: 'e-LearningVille Office Hours (until Sep 2026)', f: '2000-01-01', t: '2026-09-30' },
        { biometric_id: '2', dtr_format: 'no_undertime', name: 'e-LearningVille Office Hours', f: '2026-10-01', t: null },
        { biometric_id: '4', dtr_format: 'standard', name: 'e-LearningVille Office Hours (until Sep 2026)', f: '2000-01-01', t: '2026-09-30' },
        { biometric_id: '4', dtr_format: 'standard', name: 'e-LearningVille Office Hours', f: '2026-10-01', t: null },
      ]);
    } finally {
      await old.close();
    }
  }, 120000);
});

describe('e-LearningVille staff roster', () => {
  it('the roster spreadsheet validates with no problems', async () => {
    const departments = await all('select id, code, name from departments');
    const wb = readWorkbook(new Uint8Array(readFileSync(join(root, 'data', 'elearningville-staff.xlsx'))));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
    const result = validateEmployeeRows(rows, [], departments, employeeSchema);
    expect(result.flatMap((r) => r.problems)).toEqual([]);
    expect(result.map((r) => [r.data.biometric_id, r.data.nickname, r.data.last_name, r.data.first_name])).toEqual(ROSTER);
    const elearning = departments.find((d) => d.name === 'eLearning').id;
    expect(result.every((r) => r.data.department_id === elearning)).toBe(true);
  });

  it('the SQL roster loads 11 eLearning employees and is safe to re-run', async () => {
    const sql = readFileSync(join(root, 'supabase', 'roster', 'elearningville_staff.sql'), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const rows = await all(
      `select e.biometric_id, e.nickname, e.full_name, d.name as dept
       from employees e join departments d on d.id = e.department_id order by e.biometric_id::int`,
    );
    expect(rows.map((r) => [r.biometric_id, r.nickname, r.full_name])).toEqual(ROSTER.map(([id, nick, last, first]) => [id, nick, `${last}, ${first}`]));
    expect(rows.every((r) => r.dept === 'eLearning')).toBe(true);
    const verifiers = await all(`select biometric_id, verifier_name, verifier_title from employees where verifier_name is not null`);
    expect(verifiers).toEqual([{ biometric_id: '2', verifier_name: 'BAUTISTA ERWIN DWIGHT C. PASTRANA', verifier_title: 'Municipal Mayor' }]);
  });

  it('full_name is just the last name when no first name is set', async () => {
    await db.exec(`update employees set first_name = null where biometric_id = '3'`);
    expect((await all(`select full_name from employees where biometric_id = '3'`))[0].full_name).toBe('ALMARIEGO');
    await db.exec(`update employees set first_name = 'JONATHAN MENGGE' where biometric_id = '3'`);
  });

  it('rejects a blank first name (null is used instead)', async () => {
    await expect(db.exec(`update employees set first_name = '  ' where biometric_id = '3'`)).rejects.toThrow();
  });

  it('office hours: Mon-Fri 8:00-5:00 until Sep 2026, Mon-Thu 7:00-6:00 from Oct 2026, for every staff member', async () => {
    const days = (name) =>
      all(
        `select d.weekday, d.is_workday, d.start_time::text as s, d.end_time::text as e, d.break_start::text as bs, d.break_end::text as be, d.break_minutes, d.break_paid
         from schedule_days d join work_schedules w on w.id = d.schedule_id where w.name = $1 order by d.weekday`,
        [name],
      );
    const oct = await days('e-LearningVille Office Hours');
    expect(oct.filter((d) => d.is_workday).map((d) => d.weekday)).toEqual([1, 2, 3, 4]);
    expect(oct.find((d) => d.weekday === 1)).toMatchObject({ s: '07:00:00', e: '18:00:00', bs: '12:00:00', be: '13:00:00', break_minutes: 60, break_paid: false });
    const sep = await days('e-LearningVille Office Hours (until Sep 2026)');
    expect(sep.filter((d) => d.is_workday).map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(sep.find((d) => d.weekday === 5)).toMatchObject({ s: '08:00:00', e: '17:00:00', break_minutes: 60 });

    const assignments = await all(
      `select e.biometric_id, w.name, x.effective_from::text as f, x.effective_to::text as t
       from employee_schedules x join employees e on e.id = x.employee_id join work_schedules w on w.id = x.schedule_id
       order by e.biometric_id::int, x.effective_from`,
    );
    for (const [id] of ROSTER) {
      expect(assignments.filter((a) => a.biometric_id === id)).toEqual([
        { biometric_id: id, name: 'e-LearningVille Office Hours (until Sep 2026)', f: '2000-01-01', t: '2026-09-30' },
        { biometric_id: id, name: 'e-LearningVille Office Hours', f: '2026-10-01', t: null },
      ]);
    }
    const formats = await all(`select biometric_id from employees where dtr_format = 'no_undertime' order by biometric_id::int`);
    expect(formats.map((r) => r.biometric_id)).toEqual(['2', '3', '12']);
    const [policy] = await all(`select status, rules from attendance_policies where name = 'e-LearningVille office rules'`);
    expect(policy).toMatchObject({ status: 'approved', rules: expect.objectContaining({ graceLateMinutes: 0, enforceBreakWindow: true, pairingMode: 'sequential' }) });
  });

  it('matches "Att. record report" rows to the roster by device ID', async () => {
    const employees = await all('select id, biometric_id, nickname, last_name, first_name, full_name, is_active from employees');
    const wb = readWorkbook(workbookToBytes(buildZkAttRecordWorkbook()));
    const config = initialConfig(wb, inspectWorkbook(wb), {});
    const preview = buildImportPreview({ ...parseWorkbook(wb, config), employees, period: periodOf(config) });
    const jm = preview.employees.find((e) => e.biometricId === '3');
    expect(jm.matched).toBe(true);
    expect(preview.issues.filter((i) => i.severity !== 'info' && String(i.message).includes('jm'))).toEqual([]);
    expect(preview.employees.find((e) => e.biometricId === '15').matched).toBe(false);
  });
});
