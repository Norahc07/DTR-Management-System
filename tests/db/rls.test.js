import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb, createUser, asUser } from './harness.js';

const U = {
  super: '00000000-0000-4000-8000-000000000001',
  hr: '00000000-0000-4000-8000-000000000002',
  sup: '00000000-0000-4000-8000-000000000003',
  emp1: '00000000-0000-4000-8000-000000000004',
  emp2: '00000000-0000-4000-8000-000000000005',
  hr2: '00000000-0000-4000-8000-000000000006',
};

let db;
let deptA;
let deptB;
let e1;
let e2;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;

async function stageBatch(userId, records, file = 'test.xlsx') {
  return asUser(db, userId, async () => {
    const batch = await one(
      `insert into import_batches (file_name, file_size, adapter, period_start, period_end)
       values ($1, 100, 'matrix', '2026-09-01', '2026-09-30') returning id`,
      [file],
    );
    for (const r of records) {
      await db.query(
        `insert into import_staging_events (batch_id, biometric_id, local_date, local_time, sheet_name, cell_ref, raw_value)
         values ($1, $2, $3, $4::time, 'Sheet1', 'B5', $5)`,
        [batch.id, r.bio, r.date, r.time, r.time],
      );
    }
    return batch.id;
  });
}

beforeAll(async () => {
  db = await createTestDb();
  deptA = (await one(`insert into departments (code, name) values ('A', 'Dept A') returning id`)).id;
  deptB = (await one(`insert into departments (code, name) values ('B', 'Dept B') returning id`)).id;
  e1 = (await one(
    `insert into employees (biometric_id, last_name, first_name, department_id) values ('0001', 'One', 'Emp', $1) returning id`,
    [deptA],
  )).id;
  e2 = (await one(
    `insert into employees (biometric_id, last_name, first_name, department_id) values ('0002', 'Two', 'Emp', $1) returning id`,
    [deptB],
  )).id;
  await createUser(db, { id: U.super, email: 'super@example.test', role: 'super_admin' });
  await createUser(db, { id: U.hr, email: 'hr@example.test', role: 'hr_admin' });
  await createUser(db, { id: U.hr2, email: 'hr2@example.test', role: 'hr_admin' });
  await createUser(db, { id: U.sup, email: 'sup@example.test', role: 'supervisor' });
  await createUser(db, { id: U.emp1, email: 'emp1@example.test', role: 'employee', employeeId: e1 });
  await createUser(db, { id: U.emp2, email: 'emp2@example.test', role: 'employee', employeeId: e2 });
  await db.query(`insert into supervisor_departments (profile_id, department_id) values ($1, $2)`, [U.sup, deptA]);
}, 120000);

afterAll(async () => {
  await db?.close();
});

describe('profiles and roles', () => {
  it('ignores role metadata at sign-up and assigns employee', async () => {
    const id = '00000000-0000-4000-8000-0000000000aa';
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'x@example.test', '{"role":"super_admin"}')`,
      [id],
    );
    const p = await one('select role from profiles where id = $1', [id]);
    expect(p.role).toBe('employee');
  });

  it('prevents a user from escalating their own role', async () => {
    await expect(
      asUser(db, U.emp1, () => db.query(`update profiles set role = 'super_admin' where id = $1`, [U.emp1])),
    ).rejects.toThrow(/super admin/i);
  });

  it('allows a user to edit their own display name', async () => {
    await asUser(db, U.emp1, () => db.query(`update profiles set full_name = 'Emp One' where id = $1`, [U.emp1]));
    expect((await one('select full_name from profiles where id = $1', [U.emp1])).full_name).toBe('Emp One');
  });

  it('prevents HR admins from changing roles', async () => {
    await expect(
      asUser(db, U.hr, () => db.query(`update profiles set role = 'super_admin' where id = $1`, [U.hr])),
    ).rejects.toThrow(/super admin/i);
  });

  it('blocks demoting the last active super admin', async () => {
    await expect(
      asUser(db, U.super, () => db.query(`update profiles set role = 'hr_admin' where id = $1`, [U.super])),
    ).rejects.toThrow(/last active super admin/i);
  });
});

describe('employee visibility', () => {
  it('denies anonymous access entirely', async () => {
    await expect(asUser(db, null, () => db.query('select * from employees'))).rejects.toThrow(/permission denied/i);
  });

  it('employee sees only their own record', async () => {
    const rows = await asUser(db, U.emp1, () => all('select biometric_id from employees'));
    expect(rows.map((r) => r.biometric_id)).toEqual(['0001']);
  });

  it('supervisor sees only assigned departments', async () => {
    const rows = await asUser(db, U.sup, () => all('select biometric_id from employees order by 1'));
    expect(rows.map((r) => r.biometric_id)).toEqual(['0001']);
  });

  it('HR admin sees all employees', async () => {
    const rows = await asUser(db, U.hr, () => all('select biometric_id from employees order by 1'));
    expect(rows.map((r) => r.biometric_id)).toEqual(['0001', '0002']);
  });

  it('employees and supervisors cannot create employees', async () => {
    for (const u of [U.emp1, U.sup]) {
      await expect(
        asUser(db, u, () =>
          db.query(`insert into employees (biometric_id, last_name, first_name) values ('0099', 'X', 'Y')`),
        ),
      ).rejects.toThrow(/row-level security/i);
    }
  });

  it('deactivation requires a reason and is audited', async () => {
    await asUser(db, U.hr, () => db.query(`select set_employee_active($1, false, 'Resigned')`, [e2]));
    const log = await one(
      `select reason from audit_logs where table_name = 'employees' and record_id = $1 order by id desc limit 1`,
      [e2],
    );
    expect(log.reason).toBe('Resigned');
    await asUser(db, U.hr, () => db.query(`select set_employee_active($1, true, 'Rehired')`, [e2]));
  });
});

describe('import commit', () => {
  it('rejects commits from non-admins', async () => {
    await expect(asUser(db, U.emp1, () => db.query(`select commit_import(gen_random_uuid())`))).rejects.toThrow(
      /not authorized/i,
    );
  });

  it('employees cannot stage import batches', async () => {
    await expect(
      asUser(db, U.emp1, () =>
        db.query(`insert into import_batches (file_name, file_size, adapter, period_start, period_end)
                  values ('x.xlsx', 1, 'rows', '2026-09-01', '2026-09-30')`),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('imports matched punches, flags unmatched IDs, and is idempotent on reimport', async () => {
    const records = [
      { bio: '0001', date: '2026-09-01', time: '08:00:00' },
      { bio: '0001', date: '2026-09-01', time: '17:00:00' },
      { bio: '0001', date: '2026-09-01', time: '17:00:00' },
      { bio: '0002', date: '2026-09-01', time: '08:05:00' },
      { bio: '9999', date: '2026-09-01', time: '08:00:00' },
    ];
    const b1 = await stageBatch(U.hr, records);
    const r1 = (await asUser(db, U.hr, () => one('select commit_import($1) as r', [b1]))).r;
    expect(r1).toMatchObject({ staged: 5, matched: 4, inserted: 3, unmatched_ids: 1, unmatched_punches: 1 });

    const errors = await all(`select code, biometric_id from import_errors where batch_id = $1`, [b1]);
    expect(errors).toEqual([{ code: 'UNMATCHED_ID', biometric_id: '9999' }]);

    const b2 = await stageBatch(U.hr, records, 'test-again.xlsx');
    const r2 = (await asUser(db, U.hr, () => one('select commit_import($1) as r', [b2]))).r;
    expect(r2).toMatchObject({ inserted: 0, existing: 4 });

    const count = await one(`select count(*)::int as n from attendance_events where employee_id = $1`, [e1]);
    expect(count.n).toBe(2);
    const tz = await one(
      `select to_char(event_time at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as t from attendance_events
       where employee_id = $1 order by event_time limit 1`,
      [e1],
    );
    expect(tz.t).toBe('2026-09-01 00:00');
  });

  it('cannot commit the same batch twice', async () => {
    const b = await stageBatch(U.hr, [{ bio: '0001', date: '2026-09-02', time: '08:00:00' }]);
    await asUser(db, U.hr, () => db.query('select commit_import($1)', [b]));
    await expect(asUser(db, U.hr, () => db.query('select commit_import($1)', [b]))).rejects.toThrow(/already completed/i);
  });

  it('rejects punches outside the declared period atomically', async () => {
    const b = await stageBatch(U.hr, [
      { bio: '0001', date: '2026-09-03', time: '08:00:00' },
      { bio: '0001', date: '2026-11-01', time: '08:00:00' },
    ]);
    await expect(asUser(db, U.hr, () => db.query('select commit_import($1)', [b]))).rejects.toThrow(/outside/i);
    const n = await one(`select count(*)::int as n from attendance_events where local_date = '2026-09-03'`);
    expect(n.n).toBe(0);
    await asUser(db, U.hr, () => db.query(`select fail_import($1, 'out of period')`, [b]));
    expect((await one('select status from import_batches where id = $1', [b])).status).toBe('failed');
  });
});

describe('office hours from the import settings', () => {
  it('assigns a matching schedule for the period only, splitting other assignments; admin only', async () => {
    const emp = await one(`insert into employees (biometric_id, last_name, first_name) values ('0888', 'Hours', 'Test') returning id`);
    await db.query(`delete from employee_schedules where employee_id = $1`, [emp.id]);
    const base = await asUser(db, U.hr, () => one(`insert into work_schedules (name) values ('Base hours') returning id`));
    await db.query(`insert into employee_schedules (employee_id, schedule_id, effective_from) values ($1, $2, '2000-01-01')`, [emp.id, base.id]);
    const args = `array[$1]::uuid[], date '2026-09-16', date '2026-09-30', array[1,2,3,4]::smallint[], time '07:00', time '12:00', time '13:00', time '18:00'`;

    await expect(asUser(db, U.emp1, () => db.query(`select apply_period_schedule(${args})`, [emp.id]))).rejects.toThrow(/HR \/ Admin/);

    const { apply_period_schedule: sid } = await asUser(db, U.hr, () => one(`select apply_period_schedule(${args})`, [emp.id]));
    expect(await one(`select name from work_schedules where id = $1`, [sid])).toEqual({ name: 'Office hours 07:00-12:00, 13:00-18:00 (Mon,Tue,Wed,Thu)' });
    const days = (await db.query(`select weekday, is_workday, start_time::text s, end_time::text e, break_start::text bs, break_end::text be from schedule_days where schedule_id = $1 order by weekday`, [sid])).rows;
    expect(days.find((d) => d.weekday === 1)).toMatchObject({ is_workday: true, s: '07:00:00', e: '18:00:00', bs: '12:00:00', be: '13:00:00' });
    expect(days.find((d) => d.weekday === 5)).toMatchObject({ is_workday: false, s: null });

    const rows = (await db.query(`select schedule_id, effective_from::text f, effective_to::text t from employee_schedules where employee_id = $1 order by effective_from`, [emp.id])).rows;
    expect(rows).toEqual([
      { schedule_id: base.id, f: '2000-01-01', t: '2026-09-15' },
      { schedule_id: sid, f: '2026-09-16', t: '2026-09-30' },
      { schedule_id: base.id, f: '2026-10-01', t: null },
    ]);

    const again = await asUser(db, U.hr, () => one(`select apply_period_schedule(${args})`, [emp.id]));
    expect(again.apply_period_schedule).toBe(sid);
    expect((await db.query(`select 1 from employee_schedules where employee_id = $1`, [emp.id])).rows).toHaveLength(3);

    await expect(
      asUser(db, U.hr, () => db.query(`select apply_period_schedule(array[$1]::uuid[], date '2026-09-16', date '2026-09-30', array[1]::smallint[], time '13:00', time '12:00', time '13:00', time '18:00')`, [emp.id])),
    ).rejects.toThrow(/in order/);
  });
});

describe('staff birthdays', () => {
  it('admins set birth dates; employees cannot change their own', async () => {
    await asUser(db, U.hr, () => db.query(`update employees set birth_date = '1990-09-28' where id = $1`, [e1]));
    await asUser(db, U.emp1, () => db.query(`update employees set birth_date = '2001-01-01' where id = $1`, [e1]));
    expect(await asUser(db, U.emp1, () => one(`select birth_date::text as d from employees where id = $1`, [e1]))).toEqual({ d: '1990-09-28' });
    await expect(db.query(`update employees set birth_date = '1800-01-01' where id = $1`, [e1])).rejects.toThrow(/check/i);
    await asUser(db, U.hr, () => db.query(`update employees set birth_date = null where id = $1`, [e1]));
  });
});

describe('deleting work schedules', () => {
  it('only a Super Admin deletes, and only a schedule no employee is assigned to', async () => {
    const make = (name) => asUser(db, U.hr, () => one(`insert into work_schedules (name, schedule_type) values ($1, 'fixed') returning id`, [name]));
    const unused = (await make('Unused schedule')).id;
    await db.query(`insert into schedule_days (schedule_id, weekday, is_workday) values ($1, 1, false)`, [unused]);
    const used = (await make('Used schedule')).id;
    const emp = await one(`insert into employees (biometric_id, last_name, first_name) values ('0777', 'Sched', 'Test') returning id`);
    await db.query(`delete from employee_schedules where employee_id = $1`, [emp.id]);
    await db.query(`insert into employee_schedules (employee_id, schedule_id, effective_from) values ($1, $2, '1990-01-01')`, [emp.id, used]);

    await asUser(db, U.hr, () => db.query(`delete from work_schedules where id = $1`, [unused]));
    expect(await one(`select count(*)::int as n from work_schedules where id = $1`, [unused])).toEqual({ n: 1 });

    await asUser(db, U.super, () => db.query(`delete from work_schedules where id = $1`, [unused]));
    expect(await one(`select count(*)::int as n from work_schedules where id = $1`, [unused])).toEqual({ n: 0 });
    expect(await one(`select count(*)::int as n from schedule_days where schedule_id = $1`, [unused])).toEqual({ n: 0 });

    await expect(asUser(db, U.super, () => db.query(`delete from work_schedules where id = $1`, [used]))).rejects.toThrow(/foreign key|violates/i);
    await db.query(`delete from employee_schedules where schedule_id = $1`, [used]);
    await db.query(`delete from work_schedules where id = $1`, [used]);
  });
});

describe('deleting imported data', () => {
  it('HR deletes an import with a reason (audited); manual removals on it go too; employees cannot', async () => {
    const b = await stageBatch(U.hr, [
      { bio: '0002', date: '2026-09-25', time: '07:55:00' },
      { bio: '0002', date: '2026-09-25', time: '18:02:00' },
    ], 'wrong-file.xlsx');
    await asUser(db, U.hr, () => db.query('select commit_import($1)', [b]));
    const [ev] = await all(`select id from attendance_events where import_batch_id = $1 order by local_time limit 1`, [b]);
    await asUser(db, U.hr, () => db.query(`select manual_void_punch($1, 'Wrong punch time')`, [ev.id]));

    await expect(asUser(db, U.emp2, () => db.query(`select delete_import_batch($1, 'Wrong file imported')`, [b]))).rejects.toThrow(/only hr/i);
    await expect(asUser(db, U.hr, () => db.query(`select delete_import_batch($1, 'no')`, [b]))).rejects.toThrow(/reason/i);

    const { r } = await asUser(db, U.hr, () => one(`select delete_import_batch($1, 'Wrong file imported') as r`, [b]));
    expect(r).toMatchObject({ deleted: 2, employee_ids: [e2], period_start: '2026-09-01', period_end: '2026-09-30' });
    expect(await one(`select count(*)::int as n from attendance_events where import_batch_id = $1`, [b])).toEqual({ n: 0 });
    expect(await one(`select count(*)::int as n from import_batches where id = $1`, [b])).toEqual({ n: 0 });
    expect(await one(`select count(*)::int as n from attendance_event_voids where event_id = $1`, [ev.id])).toEqual({ n: 0 });
    const audit = await one(`select reason from audit_logs where table_name = 'import_batches' and action = 'delete' and record_id = $1`, [b]);
    expect(audit.reason).toBe('Imported data deleted: Wrong file imported');
  });
});

describe('raw events and audit immutability', () => {
  it('nobody can insert or modify raw events through the API', async () => {
    await expect(
      asUser(db, U.super, () => db.query(`update attendance_events set local_time = '09:00' where employee_id = $1`, [e1])),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(db, U.hr, () => db.query(`delete from attendance_events where employee_id = $1`, [e1])),
    ).rejects.toThrow(/permission denied/i);
  });

  it('employees cannot read other employees punches', async () => {
    const rows = await asUser(db, U.emp2, () => all(`select * from attendance_events where employee_id = $1`, [e1]));
    expect(rows).toHaveLength(0);
  });

  it('audit logs are hidden from employees and append-only for admins', async () => {
    const rows = await asUser(db, U.emp1, () => all('select * from audit_logs'));
    expect(rows).toHaveLength(0);
    const visible = await asUser(db, U.hr, () => all('select id from audit_logs limit 1'));
    expect(visible.length).toBe(1);
    await expect(asUser(db, U.super, () => db.query('delete from audit_logs'))).rejects.toThrow(/permission denied/i);
  });
});

describe('manual IN/OUT entry', () => {
  it('HR adds a missing time and removes a wrong one; employees cannot', async () => {
    await expect(
      asUser(db, U.emp1, () => db.query(`select manual_add_punch($1, '2026-08-20', '13:00', 'No fingerprint scan')`, [e1])),
    ).rejects.toThrow(/only hr/i);
    await expect(
      asUser(db, U.hr, () => db.query(`select manual_add_punch($1, '2026-08-20', '13:00', 'no')`, [e1])),
    ).rejects.toThrow(/reason/i);

    const { manual_add_punch: id } = await asUser(db, U.hr, () =>
      one(`select manual_add_punch($1, '2026-08-20', '13:00', 'No fingerprint scan')`, [e1]),
    );
    const ev = await one(`select source, local_time::text as t, correction_id, display_slot from attendance_events where id = $1`, [id]);
    expect(ev).toMatchObject({ source: 'correction', t: '13:00:00', display_slot: null });
    expect(await one(`select status, reason from correction_requests where id = $1`, [ev.correction_id])).toEqual({ status: 'approved', reason: 'No fingerprint scan' });

    const { manual_add_punch: pinned } = await asUser(db, U.hr, () =>
      one(`select manual_add_punch($1, '2026-08-20', '14:00', 'Afternoon arrival', 2::smallint)`, [e1]),
    );
    expect(await one(`select display_slot from attendance_events where id = $1`, [pinned])).toEqual({ display_slot: 2 });
    await asUser(db, U.hr, () => db.query(`select manual_void_punch($1, 'Entered the wrong time')`, [pinned]));

    await asUser(db, U.hr, () => db.query(`select manual_void_punch($1, 'Entered the wrong time')`, [id]));
    expect(await one(`select count(*)::int as n from attendance_event_voids where event_id = $1`, [id])).toEqual({ n: 1 });
  });
});

describe('corrections workflow', () => {
  it('employee files a correction for themselves only', async () => {
    await asUser(db, U.emp1, () =>
      db.query(
        `insert into correction_requests (employee_id, work_date, correction_type, proposed_time, reason)
         values ($1, '2026-09-04', 'add_punch', '08:00', 'Forgot to punch in')`,
        [e1],
      ),
    );
    await expect(
      asUser(db, U.emp1, () =>
        db.query(
          `insert into correction_requests (employee_id, work_date, correction_type, proposed_time, reason)
           values ($1, '2026-09-04', 'add_punch', '08:00', 'Not my record')`,
          [e2],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('employee cannot approve; supervisor of the department can', async () => {
    const req = await one(`select id from correction_requests where employee_id = $1 and work_date = '2026-09-04'`, [e1]);
    await expect(
      asUser(db, U.emp1, () => db.query(`select review_correction($1, 'approved', 'ok')`, [req.id])),
    ).rejects.toThrow(/not authorized/i);
    await asUser(db, U.sup, () => db.query(`select review_correction($1, 'approved', 'Verified with logbook')`, [req.id]));
    const ev = await one(
      `select source, local_time::text as t from attendance_events where correction_id = $1`,
      [req.id],
    );
    expect(ev).toEqual({ source: 'correction', t: '08:00:00' });
  });

  it('supervisor cannot review employees outside their departments', async () => {
    await asUser(db, U.emp2, () =>
      db.query(
        `insert into correction_requests (employee_id, work_date, correction_type, reason)
         values ($1, '2026-09-04', 'note', 'Was on official business')`,
        [e2],
      ),
    );
    const req = await one(`select id from correction_requests where employee_id = $1`, [e2]);
    await expect(
      asUser(db, U.sup, () => db.query(`select review_correction($1, 'approved', 'ok')`, [req.id])),
    ).rejects.toThrow(/not authorized/i);
  });

  it('HR admin cannot approve their own request but another admin can', async () => {
    const req = await asUser(db, U.hr, () =>
      one(
        `insert into correction_requests (employee_id, work_date, correction_type, proposed_time, reason)
         values ($1, '2026-09-05', 'add_punch', '17:00', 'Manual record from logbook') returning id`,
        [e2],
      ),
    );
    await expect(
      asUser(db, U.hr, () => db.query(`select review_correction($1, 'approved', 'ok')`, [req.id])),
    ).rejects.toThrow(/own correction/i);
    await asUser(db, U.hr2, () => db.query(`select review_correction($1, 'approved', 'Confirmed')`, [req.id]));
    expect((await one('select status from correction_requests where id = $1', [req.id])).status).toBe('approved');
  });

  it('rejecting requires remarks', async () => {
    const req = await asUser(db, U.emp1, () =>
      one(
        `insert into correction_requests (employee_id, work_date, correction_type, reason)
         values ($1, '2026-09-06', 'note', 'Please check this day') returning id`,
        [e1],
      ),
    );
    await expect(asUser(db, U.hr, () => db.query(`select review_correction($1, 'rejected', '')`, [req.id]))).rejects.toThrow(
      /remarks/i,
    );
  });

  it('employees cannot void punches belonging to someone else', async () => {
    const ev = await one(`select id from attendance_events where employee_id = $1 limit 1`, [e2]);
    await expect(
      asUser(db, U.emp1, () =>
        db.query(
          `insert into correction_requests (employee_id, work_date, correction_type, target_event_id, reason)
           values ($1, '2026-09-01', 'void_punch', $2, 'Not my punch')`,
          [e1, ev.id],
        ),
      ),
    ).rejects.toThrow(/does not belong/i);
  });
});

describe('policies and finalization', () => {
  let policyId;

  it('HR can draft but not approve a policy; super admin approves', async () => {
    policyId = (await asUser(db, U.hr, () =>
      one(
        `insert into attendance_policies (name, effective_from, rules) values ('P1', '2026-01-01', '{"graceLateMinutes":5}') returning id`,
      ),
    )).id;
    await expect(
      asUser(db, U.hr, () => db.query(`update attendance_policies set status = 'approved' where id = $1`, [policyId])),
    ).rejects.toThrow(/super admin/i);
    await asUser(db, U.super, () => db.query(`update attendance_policies set status = 'approved' where id = $1`, [policyId]));
    await expect(
      asUser(db, U.super, () =>
        db.query(`update attendance_policies set rules = '{"graceLateMinutes":15}' where id = $1`, [policyId]),
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('finalized DTR locks daily summaries until revoked', async () => {
    await asUser(db, U.hr, () =>
      db.query(
        `insert into daily_attendance (employee_id, work_date, status, policy_id) values ($1, '2026-08-03', 'complete', $2)`,
        [e1, policyId],
      ),
    );
    const fin = await asUser(db, U.hr, () =>
      one(`select (finalize_dtr($1, '2026-08-01', 1, '{"rows":[]}'::jsonb)).id as id`, [e1]),
    );
    await expect(
      asUser(db, U.hr, () => db.query(`select finalize_dtr($1, '2026-08-01', 1, '{}'::jsonb)`, [e1])),
    ).rejects.toThrow(/already finalized/i);
    await expect(
      asUser(db, U.hr, () =>
        db.query(`update daily_attendance set status = 'no_punches' where employee_id = $1 and work_date = '2026-08-03'`, [e1]),
      ),
    ).rejects.toThrow(/finalized/i);
    await expect(asUser(db, U.hr, () => db.query(`select revoke_dtr($1, 'Need to correct')`, [fin.id]))).rejects.toThrow(
      /super admin/i,
    );
    await asUser(db, U.super, () => db.query(`select revoke_dtr($1, 'Need to correct')`, [fin.id]));
    await asUser(db, U.hr, () =>
      db.query(`update daily_attendance set status = 'no_punches' where employee_id = $1 and work_date = '2026-08-03'`, [e1]),
    );
  });

  it('finalizing days 1-15 leaves days 16-end open', async () => {
    await asUser(db, U.hr, () =>
      db.query(
        `insert into daily_attendance (employee_id, work_date, status, policy_id)
         values ($1, '2026-06-10', 'complete', $2), ($1, '2026-06-20', 'complete', $2)`,
        [e1, policyId],
      ),
    );
    const fin = await asUser(db, U.hr, () => one(`select * from finalize_dtr($1, '2026-06-01', 1, '{}'::jsonb)`, [e1]));
    expect(fin.period_half).toBe(1);
    await expect(
      asUser(db, U.hr, () => db.query(`update daily_attendance set status = 'no_punches' where employee_id = $1 and work_date = '2026-06-10'`, [e1])),
    ).rejects.toThrow(/finalized/i);
    await asUser(db, U.hr, () => db.query(`update daily_attendance set status = 'no_punches' where employee_id = $1 and work_date = '2026-06-20'`, [e1]));
    await asUser(db, U.hr, () => db.query(`update daily_attendance set status = 'complete' where employee_id = $1 and work_date = '2026-06-20'`, [e1]));
    const second = await asUser(db, U.hr, () => one(`select (finalize_dtr($1, '2026-06-01', 2, '{}'::jsonb)).period_half as h`, [e1]));
    expect(second.h).toBe(2);
    await expect(
      asUser(db, U.hr, () => db.query(`insert into daily_attendance (employee_id, work_date, status) values ($1, '2026-06-30', 'complete')`, [e1])),
    ).rejects.toThrow(/finalized/i);
  });

  it('rejects a period other than 1 or 2', async () => {
    await expect(
      asUser(db, U.hr, () => db.query(`select finalize_dtr($1, '2026-05-01', 3, '{}'::jsonb)`, [e1])),
    ).rejects.toThrow(/period must be/i);
  });

  it('finalization is blocked while days are unresolved', async () => {
    await asUser(db, U.hr, () =>
      db.query(
        `insert into daily_attendance (employee_id, work_date, status, policy_id) values ($1, '2026-07-03', 'missing_punch', $2)`,
        [e1, policyId],
      ),
    );
    await expect(
      asUser(db, U.hr, () => db.query(`select finalize_dtr($1, '2026-07-01', 1, '{}'::jsonb)`, [e1])),
    ).rejects.toThrow(/missing punches/i);
  });

  it('employees cannot finalize DTRs', async () => {
    await expect(
      asUser(db, U.emp1, () => db.query(`select finalize_dtr($1, '2026-08-01', 1, '{}'::jsonb)`, [e1])),
    ).rejects.toThrow(/not authorized/i);
  });
});
