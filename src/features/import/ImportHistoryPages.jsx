import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, FileSpreadsheet, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, Skeleton, Spinner } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { Pagination, Table, Td, Th } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { downloadXlsx } from '@/lib/exporters';
import { countBatchEvents, getBatch, listBatchErrors, listBatches } from './importService';
import { DeleteImportDialog } from './DeleteImportDialog';

const STATUS_TONE = { completed: 'green', failed: 'red', staging: 'amber', cancelled: 'gray' };

export function ImportHistoryPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [deleting, setDeleting] = useState(null);
  const list = useAsync(() => listBatches({ page, status }), [page, status], { cacheKey: 'import-history' });
  const rows = list.data?.data ?? [];
  return (
    <>
      <PageHeader title="Import history" breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Import Attendance', to: '/import' }, { label: 'History' }]} />
      <Card bodyClassName="">
        <div className="border-b border-slate-200 p-3">
          <Select aria-label="Status filter" className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="staging">Staging (incomplete)</option>
          </Select>
        </div>
        {list.error ? (
          <div className="p-4"><ErrorState error={list.error} onRetry={list.reload} /></div>
        ) : list.loading && !list.data ? (
          <div className="p-4"><Skeleton /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="No imports yet">Imported workbooks will be listed here with their results.</EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Uploaded</Th>
                  <Th>File</Th>
                  <Th>Period</Th>
                  <Th>Status</Th>
                  <Th>New punches</Th>
                  <Th>Already existed</Th>
                  <Th><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((b) => (
                  <tr key={b.id}>
                    <Td className="whitespace-nowrap">{new Date(b.created_at).toLocaleString()}</Td>
                    <Td><Link className="font-medium text-blue-700 hover:underline" to={`/import/history/${b.id}`}>{b.file_name}</Link></Td>
                    <Td className="whitespace-nowrap">{b.period_start} – {b.period_end}</Td>
                    <Td><Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge></Td>
                    <Td>{b.events_inserted ?? '—'}</Td>
                    <Td>{b.events_existing ?? '—'}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDeleting({ id: b.id, fileName: b.file_name })}>Delete</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={20} total={list.data?.count ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
      <DeleteImportDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(r) => {
          toast.success(`Deleted ${r.deleted} punch(es); the DTRs were recomputed`);
          list.reload();
        }}
      />
    </>
  );
}

export function ImportBatchPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [deleting, setDeleting] = useState(null);
  const batch = useAsync(() => getBatch(id), [id]);
  const errors = useAsync(() => listBatchErrors(id), [id]);
  const events = useAsync(() => countBatchEvents(id), [id]);
  if (batch.loading && !batch.data) return <Spinner />;
  if (batch.error) return <ErrorState error={batch.error} onRetry={batch.reload} />;
  if (!batch.data) return <EmptyState title="Batch not found" />;
  const b = batch.data;
  const pre = b.summary?.preview || {};
  const server = b.summary?.server || {};
  const errRows = errors.data ?? [];
  return (
    <>
      <PageHeader
        title={b.file_name}
        description={`Import batch ${b.id}`}
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Import history', to: '/import/history' }, { label: b.file_name }]}
        actions={
          <>
          <Button variant="danger" icon={Trash2} onClick={() => setDeleting({ id: b.id, fileName: b.file_name })}>Delete imported data</Button>
          <Button
            variant="secondary"
            icon={Download}
            disabled={!errRows.length}
            onClick={() =>
              downloadXlsx(
                [{ name: 'Issues', rows: errRows.map((e) => ({ Severity: e.severity, Code: e.code, Message: e.message, Sheet: e.sheet_name ?? '', Cell: e.cell_ref ?? '', 'Biometric ID': e.biometric_id ?? '', 'Raw value': e.raw_value ?? '' })) }],
                `import-report-${b.id.slice(0, 8)}.xlsx`,
              )
            }
          >
            Download error report
          </Button>
          </>
        }
      />
      <DeleteImportDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(r) => {
          toast.success(`Deleted ${r.deleted} punch(es); the DTRs were recomputed`);
          navigate('/import/history');
        }}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Batch">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-slate-500">Status</dt>
            <dd><Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge></dd>
            <dt className="text-slate-500">Period</dt>
            <dd>{b.period_start} – {b.period_end}</dd>
            <dt className="text-slate-500">Layout</dt>
            <dd>{b.adapter}</dd>
            <dt className="text-slate-500">Sheets</dt>
            <dd>{(b.mapping?.sheets || []).join(', ')}</dd>
            <dt className="text-slate-500">File size</dt>
            <dd>{(b.file_size / 1024).toFixed(0)} KB</dd>
            <dt className="text-slate-500">SHA-256</dt>
            <dd className="truncate font-mono text-xs" title={b.file_sha256}>{b.file_sha256 || '—'}</dd>
            <dt className="text-slate-500">Uploaded</dt>
            <dd>{new Date(b.created_at).toLocaleString()}</dd>
            <dt className="text-slate-500">Completed</dt>
            <dd>{b.completed_at ? new Date(b.completed_at).toLocaleString() : '—'}</dd>
          </dl>
          {b.error_message && <p className="mt-3 text-sm text-red-700">{b.error_message}</p>}
        </Card>
        <Card title="Server result (authoritative)">
          {b.status === 'completed' ? (
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
              <dt>Punches staged</dt><dd className="text-right font-medium">{server.staged ?? b.events_staged}</dd>
              <dt>New punches saved</dt><dd className="text-right font-medium">{b.events_inserted}</dd>
              <dt>Already existed (skipped)</dt><dd className="text-right font-medium">{b.events_existing}</dd>
              <dt>Unmatched IDs</dt><dd className="text-right font-medium">{server.unmatched_ids ?? '—'}</dd>
              <dt>Unmatched punches</dt><dd className="text-right font-medium">{server.unmatched_punches ?? '—'}</dd>
              <dt>Punches linked to this batch now</dt><dd className="text-right font-medium">{events.loading ? '…' : events.data}</dd>
            </dl>
          ) : (
            <p className="text-sm text-slate-600">No punches from this batch were saved.</p>
          )}
        </Card>
        <Card title="Preview totals (client)">
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            {Object.entries(pre).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-600">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
      <Card title={`Issues (${errRows.length})`} className="mt-4" bodyClassName="">
        {errors.loading && !errors.data ? (
          <Spinner />
        ) : errRows.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No issues were recorded.</p>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto">
            <Table>
              <thead className="sticky top-0">
                <tr><Th>Severity</Th><Th>Code</Th><Th>Message</Th><Th>Location</Th><Th>Raw</Th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {errRows.slice(0, 1000).map((e) => (
                  <tr key={e.id}>
                    <Td><Badge tone={e.severity === 'error' ? 'red' : 'amber'}>{e.severity}</Badge></Td>
                    <Td className="font-mono text-xs">{e.code}</Td>
                    <Td>{e.message}</Td>
                    <Td className="text-xs">{[e.sheet_name, e.cell_ref].filter(Boolean).join('!')}{e.biometric_id ? ` · ID ${e.biometric_id}` : ''}</Td>
                    <Td className="max-w-48 truncate font-mono text-xs">{e.raw_value}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
