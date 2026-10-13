import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Form';
import { Pagination, Table, Td, Th } from '@/components/ui/Table';
import { useAsync } from '@/hooks/useAsync';
import { AUDIT_PAGE_SIZE, AUDIT_PAGE_SIZES, changedKeys, listAuditLogs } from './auditService';

const TABLES = [
  'employees', 'departments', 'work_schedules', 'schedule_days', 'employee_schedules', 'profiles', 'supervisor_departments',
  'attendance_policies', 'holidays', 'leave_records', 'import_batches', 'correction_requests', 'attendance_event_voids',
  'dtr_finalizations', 'organization_settings',
];

const show = (v) => (v === undefined ? '' : v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const filters = {
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    table: params.get('table') ?? '',
    action: params.get('action') ?? '',
    actor: params.get('actor') ?? '',
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: AUDIT_PAGE_SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : AUDIT_PAGE_SIZE,
  };
  const [draft, setDraft] = useState(filters);
  const [expanded, setExpanded] = useState(null);
  const result = useAsync(() => listAuditLogs(filters), [params.toString()], { cacheKey: 'audit' });

  const apply = (e) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...draft, page: '', pageSize: '' })) if (v) next.set(k, v);
    if (params.get('size')) next.set('size', params.get('size'));
    setParams(next);
  };
  const setPage = (page) => {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    setParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const setPageSize = (size) => {
    const next = new URLSearchParams(params);
    next.set('size', String(size));
    next.delete('page');
    setParams(next);
  };

  const rows = result.data?.data ?? [];
  const total = result.data?.count ?? rows.length;
  const pager = (className) => (
    <Pagination page={filters.page} pageSize={filters.pageSize} total={total} onPage={setPage} pageSizes={AUDIT_PAGE_SIZES} onPageSize={setPageSize} className={className} />
  );
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of data changes and significant actions. Entries cannot be edited or deleted from the application."
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Audit Log' }]}
      />
      <Card className="mb-4">
        <form onSubmit={apply} className="grid gap-3 md:grid-cols-6">
          <Field label="From">{(p) => <Input {...p} type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />}</Field>
          <Field label="To">{(p) => <Input {...p} type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />}</Field>
          <Field label="Table">
            {(p) => (
              <Select {...p} value={draft.table} onChange={(e) => setDraft({ ...draft, table: e.target.value })}>
                <option value="">All</option>
                {TABLES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Action contains">{(p) => <Input {...p} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} placeholder="e.g. update, login" />}</Field>
          <Field label="Actor email contains">{(p) => <Input {...p} value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} placeholder="e.g. admin@example.com" />}</Field>
          <div className="flex items-end gap-2">
            <Button type="submit">Apply</Button>
            <Button variant="ghost" onClick={() => { setDraft({ from: '', to: '', table: '', action: '', actor: '', page: 1 }); setParams(new URLSearchParams()); }}>Clear</Button>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-500">Date filters use UTC day boundaries; times in the table are shown in your browser’s local time.</p>
      </Card>
      <Card bodyClassName="">
        {result.error ? (
          <div className="p-4"><ErrorState error={result.error} onRetry={result.reload} /></div>
        ) : result.loading && !result.data ? (
          <div className="p-4"><Skeleton rows={8} /></div>
        ) : !rows.length ? (
          <EmptyState icon={ScrollText} title="No audit entries match the filters" />
        ) : (
          <>
            {pager('border-b')}
            <Table>
              <thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Table</Th><Th>Record</Th><Th>Reason</Th><Th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const keys = changedKeys(r.old_values, r.new_values);
                  const open = expanded === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <Td className="whitespace-nowrap">{new Date(r.occurred_at).toLocaleString()}</Td>
                        <Td>{r.actor_email ?? <span className="text-slate-400">system</span>}</Td>
                        <Td className="font-mono text-xs">{r.action}</Td>
                        <Td className="font-mono text-xs">{r.table_name ?? '—'}</Td>
                        <Td className="max-w-[10rem] truncate font-mono text-xs" title={r.record_id}>{r.record_id ?? '—'}</Td>
                        <Td className="max-w-xs text-xs">{r.reason}</Td>
                        <Td className="text-right">
                          {keys.length > 0 && (
                            <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setExpanded(open ? null : r.id)}>
                              {open ? 'Hide' : `${keys.length} field${keys.length === 1 ? '' : 's'}`}
                            </Button>
                          )}
                        </Td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7} className="bg-slate-50 px-3 py-2">
                            <table className="w-full text-xs">
                              <thead><tr className="text-left text-slate-500"><th className="p-1">Field</th><th className="p-1">Before</th><th className="p-1">After</th></tr></thead>
                              <tbody>
                                {keys.map((k) => (
                                  <tr key={k} className="align-top">
                                    <td className="p-1 font-mono">{k}</td>
                                    <td className="max-w-md break-all p-1 font-mono text-red-700">{show(r.old_values?.[k])}</td>
                                    <td className="max-w-md break-all p-1 font-mono text-emerald-700">{show(r.new_values?.[k])}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
            {pager('border-t')}
          </>
        )}
      </Card>
    </>
  );
}
