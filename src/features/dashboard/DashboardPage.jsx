import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlarmClock, Check, FileCheck2, FileDown, FileText, Pencil, Printer, Trash2, Upload, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Alert, Card, EmptyState, ErrorState, Skeleton, Spinner } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { downloadXlsx } from '@/lib/exporters';
import { MONTH_NAMES, todayInZone } from '@/lib/time';
import { useAuth } from '@/features/auth/authContext';
import { listAllEmployees } from '@/features/employees/employeeService';
import { loadDashboardCounts } from '@/features/lates/latesService';
import { buildMonthlyDtr, resolveTemplate } from '@/features/dtr/buildDtr';
import { DtrDocument, DtrSheet } from '@/features/dtr/DtrDocument';
import { PERIODS, isPeriod, periodLabel, periodOfDay, periodRange, periodSummary, shownOnHalfPeriod } from '@/features/dtr/form48';
import { latestAttendanceDate, loadDtrData, logPrint, periodHasAttendance } from '@/features/dtr/dtrService';
import { DtrEditDialog } from '@/features/dtr/DtrEditDialog';
import { DtrBulkEditDialog } from '@/features/dtr/DtrBulkEditDialog';
import { ignoredBiometricIds } from '@/features/import/importConfig';
import { dtrExportRows } from '@/features/dtr/dtrExport';
import { ImportToDtrDialog } from '@/features/dtr/ImportToDtrDialog';
import { DeleteImportDialog } from '@/features/import/DeleteImportDialog';

export function DashboardPage() {
  const { role, profile, settings, can, timezone } = useAuth();
  const toast = useToast();
  const selfOnly = role === 'employee';
  const [params, setParams] = useSearchParams();
  const today = todayInZone(timezone);
  const periodInUrl = params.has('year') || params.has('month') || params.has('period');
  const latest = useAsync(() => latestAttendanceDate(), [], { cacheKey: 'latest-attendance', enabled: !periodInUrl });
  const resolvingPeriod = !periodInUrl && latest.data === undefined && !latest.error;
  const basis = (!periodInUrl && latest.data) || today;
  const year = Number(params.get('year') || basis.slice(0, 4));
  const month = Number(params.get('month') || basis.slice(5, 7));
  const period = isPeriod(params.get('period')) ? params.get('period') : periodOfDay(Number(basis.slice(8, 10)));
  const label = periodLabel(year, month, period);
  const range = periodRange(year, month, period);
  const picked = (params.get('employee') || '').split(',').filter(Boolean);
  const [editing, setEditing] = useState(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(null);
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [deletingImport, setDeletingImport] = useState(null);
  const template = useMemo(() => resolveTemplate(settings?.dtr_template), [settings]);

  const set = (patch) => {
    const next = new URLSearchParams(params);
    const full = ['year', 'month', 'period'].some((k) => k in patch) ? { year: String(year), month: String(month), period: String(period), ...patch } : patch;
    Object.entries(full).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  const counts = useAsync(() => loadDashboardCounts(year), [year], { cacheKey: 'dashboard-counts' });
  const employees = useAsync(() => (selfOnly ? Promise.resolve([]) : listAllEmployees()), [selfOnly], { cacheKey: 'dashboard-staff' });
  const roster = employees.data ?? [];
  const eligible = roster.filter((e) => e.is_active && (period === 'month' || shownOnHalfPeriod(e)));
  const eligibleIds = eligible.map((e) => e.id);
  const selected = selfOnly ? (profile?.employee_id ? [profile.employee_id] : []) : picked.length ? picked.filter((id) => eligibleIds.includes(id)) : eligibleIds;
  const coverage = useAsync(
    () => (selected.length ? periodHasAttendance(selected, range.start, range.end) : Promise.resolve(false)),
    [selected.join(','), range.start, range.end],
    { cacheKey: 'dashboard-coverage', enabled: !resolvingPeriod },
  );
  const hasAttendance = coverage.data === true;
  const data = useAsync(
    () => (selected.length ? loadDtrData(selected, year, month, period) : Promise.resolve(null)),
    [selected.join(','), year, month, period],
    { cacheKey: 'dashboard-dtr', enabled: hasAttendance },
  );
  const refresh = () => {
    latest.reload();
    coverage.reload();
    data.reload();
    counts.reload();
  };

  const docs = useMemo(() => {
    if (!hasAttendance || !data.data) return [];
    return data.data.employees.filter((emp) => period === 'month' || shownOnHalfPeriod(emp)).map((emp) => {
      const summaries = data.data.summaries.filter((s) => s.employee_id === emp.id);
      const remarks = (data.data.remarks ?? []).filter((r) => r.employee_id === emp.id);
      const dtr = buildMonthlyDtr({ year, month, summaries, template, remarks });
      const stats = periodSummary({ dtr, summaries, year, month, period });
      const finalization = data.data.finalizations.find((f) => f.employee_id === emp.id) || null;
      const header = (data.data.headers ?? []).find((h) => h.employee_id === emp.id) || null;
      return { emp, dtr, stats, finalization, header };
    });
  }, [hasAttendance, data.data, year, month, period, template]);

  const sheets = useMemo(() => {
    const out = [];
    for (let i = 0; i < docs.length; i += 2) out.push(docs.slice(i, i + 2));
    return out;
  }, [docs]);

  const print = () => {
    logPrint({ employees: docs.map((d) => d.emp.biometric_id).slice(0, 50), period: label });
    window.print();
  };

  const exportExcel = () => {
    const ignored = new Set(ignoredBiometricIds(settings));
    const rows = dtrExportRows(docs.filter((d) => !ignored.has(String(d.emp.biometric_id))), { year, month, period });
    downloadXlsx([{ name: 'DTR', rows }], `DTR ${label.replace(/[^\w -]+/g, '')}.xlsx`);
  };

  const toggleEmployee = (id, on) => {
    const next = on ? [...new Set([...selected, id])] : selected.filter((x) => x !== id);
    set({ employee: next.join(',') });
  };

  const c = counts.data;

  return (
    <>
      <style>{'@page { size: A4 portrait; margin: 0; }'}</style>
      <PageHeader
        title="Dashboard"
        description="Totals for the selected year, and the Daily Time Records (CS Form No. 48, two staff per portrait page). When printing, set Scale to 100% (or “Actual size”)."
        actions={
          <>
            {can('import.run') && <Button variant="secondary" icon={Upload} onClick={() => setImporting(true)}>Import attendance</Button>}
            {can('dtr.edit') && (
              <Button variant="secondary" icon={Pencil} onClick={() => setBulkEditing(true)} disabled={!docs.length} title={docs.length ? 'Form header and days off for all DTRs shown' : 'Select staff first'}>
                Edit all DTRs
              </Button>
            )}
            <Button variant="secondary" icon={FileDown} onClick={exportExcel} disabled={!docs.length} title={docs.length ? 'Download the IN/OUT times of the DTRs below' : 'Select staff first'}>Export Excel</Button>
            <Button icon={Printer} onClick={print} disabled={!docs.length} title={docs.length ? undefined : 'Select staff first'}>Print / Save PDF</Button>
          </>
        }
      />

      <div className="no-print mb-4">
        {counts.error ? (
          <ErrorState error={counts.error} onRetry={counts.reload} />
        ) : counts.loading && !c ? (
          <Skeleton rows={2} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat icon={Users} tone="blue" label="Staff" value={c.staff} hint="Active employees" to={can('employees.view') ? '/employees' : null} />
            <Stat icon={AlarmClock} tone="amber" label="Lates" value={c.lates} hint={`Late days in ${year} — view staff names`} to={`/lates?year=${year}`} />
            <Stat icon={FileCheck2} tone="green" label="DTRs made" value={c.dtrs} hint={`1 per staff per half-month with attendance in ${year}`} />
          </div>
        )}
      </div>

      {imported && (
        <Alert tone={imported.recomputeError ? 'warning' : 'success'} className="no-print mb-4" title="Attendance imported">
          {imported.result.inserted} new punch(es) saved, {imported.result.existing} already existed
          {imported.result.unmatched_ids > 0 && `, ${imported.result.unmatched_ids} unmatched ID(s) skipped`}.
          {imported.recompute && ` ${imported.recompute.saved} day(s) computed${imported.recompute.skippedLocked > 0 ? `, ${imported.recompute.skippedLocked} skipped because the DTR is finalized` : ''}.`}
          {imported.recomputeError && ` Daily summaries were not fully computed: ${imported.recomputeError} Import the same file again to retry; punches already saved are not duplicated.`}
          {imported.batch && can('import.run') && (
            <div className="mt-2">
              <Button size="sm" variant="secondary" icon={Trash2} onClick={() => setDeletingImport(imported.batch)}>Delete this import</Button>
            </div>
          )}
        </Alert>
      )}
      {!can('import.run') && (
        <Alert tone="info" className="no-print mb-4" title={`You are signed in as ${role === 'supervisor' ? 'a Supervisor' : 'an Employee'}`}>
          Importing attendance files is available to HR / Admin and Super Admin accounts only.
          {role === 'employee' && !profile?.employee_id && ' Your login is also not linked to an employee record, so there is no DTR to print or export yet.'}
          {' '}Ask a Super Admin to change your role under Users &amp; Roles.
        </Alert>
      )}
      <Card
        className="no-print mb-4"
        title="Daily Time Record"
        actions={
          <Button size="sm" variant={editingPeriod ? 'primary' : 'secondary'} icon={editingPeriod ? Check : Pencil} onClick={() => setEditingPeriod((v) => !v)}>
            {editingPeriod ? 'Done' : 'Edit'}
          </Button>
        }
      >
        {!editingPeriod ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            {[['Month', MONTH_NAMES[month - 1]], ['Year', year], ['Period', PERIODS.find((x) => x.value === period)?.label]].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium text-slate-500">{k}</dt>
                <dd className="mt-0.5 font-semibold text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Month">
            {(p) => (
              <Select {...p} value={month} onChange={(e) => set({ month: e.target.value })}>
                {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Year">{(p) => <Input {...p} type="number" min={2000} max={2100} value={year} onChange={(e) => set({ year: e.target.value })} placeholder="e.g. 2026" />}</Field>
          <Field label="Period">
            {(p) => (
              <Select {...p} value={period} onChange={(e) => set({ period: e.target.value })}>
                {PERIODS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </Select>
            )}
          </Field>
        </div>
        )}
        {period !== 'month' && (
          <p className="mt-3 text-sm text-slate-600">Biometric IDs 2 and 12 are included only when the period is Whole month. ID 3 stays on this half.</p>
        )}
        {!selfOnly && selected.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(employees.data ?? []).filter((e) => selected.includes(e.id)).map((e) => (
              <span key={e.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-900">
                {e.full_name}
                <button type="button" aria-label={`Remove ${e.full_name}`} className="text-blue-700 hover:text-blue-950" onClick={() => toggleEmployee(e.id, false)}>×</button>
              </span>
            ))}
            {picked.length > 0 && <Button size="sm" variant="ghost" onClick={() => set({ employee: '' })}>Show all active staff</Button>}
          </div>
        )}
      </Card>

      {selfOnly && !profile?.employee_id ? null : !selected.length && employees.loading ? (
        <Spinner label="Loading staff…" />
      ) : !selected.length ? (
        <EmptyState icon={FileText} title="No active staff">Add employees on the Employees page, or import an attendance file. Two staff are printed on each portrait page.</EmptyState>
      ) : latest.error || coverage.error ? (
        <ErrorState error={latest.error || coverage.error} onRetry={refresh} />
      ) : resolvingPeriod || coverage.data === undefined ? (
        <Spinner label="Loading DTR…" />
      ) : !hasAttendance ? (
        <EmptyState
          icon={FileText}
          title={`No attendance imported for ${label}`}
          action={can('import.run') && <Button icon={Upload} onClick={() => setImporting(true)}>Import attendance</Button>}
        >
          {latest.data === null
            ? 'No attendance file has been imported yet. The DTRs appear here after the first import.'
            : 'Import the attendance file for this period, or click Edit above to choose a period that was already imported.'}
        </EmptyState>
      ) : data.loading && !data.data ? (
        <Spinner label="Loading DTR…" />
      ) : data.error ? (
        <ErrorState error={data.error} onRetry={data.reload} />
      ) : !docs.length ? (
        <EmptyState icon={FileText} title="No Daily Time Record for this period">
          {period !== 'month' ? 'Biometric IDs 2 and 12 are included only when the period is Whole month.' : 'None of the selected staff have a DTR for this period.'}
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <div className="print-area space-y-6 overflow-x-auto pb-2">
            {sheets.map((pair) => (
              <div key={pair.map((d) => d.emp.id).join('-')} className="space-y-2">
                {can('dtr.edit') && (
                  <div className="no-print mx-auto grid" style={{ width: '210mm', gridTemplateColumns: '1fr 1fr', columnGap: '8mm', padding: '0 6mm' }}>
                    {pair.map((d) => (
                      <div key={d.emp.id} className="flex flex-col items-center gap-1 text-center">
                        <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(d)}>Edit times — {d.emp.full_name}</Button>
                        {d.stats.unresolved > 0 && <span className="text-xs text-amber-700">{d.stats.unresolved} day(s) missing IN/OUT</span>}
                      </div>
                    ))}
                  </div>
                )}
                <DtrSheet>
                  {pair.map(({ emp, dtr, finalization, header }) => (
                    <DtrDocument key={emp.id} org={settings} employee={emp} year={year} month={month} period={period} dtr={dtr} template={template} finalization={finalization} header={header} />
                  ))}
                </DtrSheet>
              </div>
            ))}
          </div>
          {docs.length === 0 && <EmptyState title="No accessible employee records for this selection" />}
        </div>
      )}

      <DtrEditDialog
        doc={editing}
        year={year}
        month={month}
        period={period}
        onClose={() => setEditing(null)}
        onSaved={(n) => {
          setEditing(null);
          toast.success(`Changes saved for ${n} day(s)`);
          refresh();
        }}
      />
      <DtrBulkEditDialog
        open={bulkEditing}
        docs={docs}
        year={year}
        month={month}
        period={period}
        template={template}
        onClose={() => setBulkEditing(false)}
        onSaved={(n) => {
          setBulkEditing(false);
          toast.success(`Applied to ${n} staff`);
          refresh();
        }}
      />
      <DeleteImportDialog
        target={deletingImport}
        onClose={() => setDeletingImport(null)}
        onDeleted={(r) => {
          setImported(null);
          toast.success(`Deleted ${r.deleted} punch(es); the DTRs were recomputed`);
          refresh();
        }}
      />
      <ImportToDtrDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(r) => {
          setImporting(false);
          setImported(r);
          refresh();
          const employee = r.employeeIds.join(',');
          const same = r.year === year && r.month === month && r.period === period && employee === selected.join(',');
          if (same) refresh();
          else set({ year: String(r.year), month: String(r.month), period: r.period, employee });
        }}
      />
    </>
  );
}

const TONES = {
  blue: 'bg-blue-100 text-blue-700',
  amber: 'bg-amber-100 text-amber-700',
  green: 'bg-emerald-100 text-emerald-700',
};

function Stat({ icon: Icon, label, value, hint, to, tone }) {
  const body = (
    <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${TONES[tone]}`}>
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <div>
        <p className="text-sm text-slate-600">{label}</p>
        <p className="text-3xl font-semibold text-slate-900">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-lg hover:ring-2 hover:ring-blue-200">{body}</Link> : body;
}
