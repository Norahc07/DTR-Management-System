import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, Card } from '@/components/ui/Feedback';
import { Checkbox, Select } from '@/components/ui/Form';
import { Table, Td, Th } from '@/components/ui/Table';
import { downloadXlsx } from '@/lib/exporters';
import { issuesToRows } from './preview';

const TOTAL_LABELS = [
  ['employeesRecognized', 'Employees recognized'],
  ['unmatchedIds', 'Unmatched IDs', 'amber'],
  ['datesProcessed', 'Employee-days processed'],
  ['validPunches', 'Punches to import'],
  ['incompleteRecords', 'Incomplete days (odd punches)', 'amber'],
  ['duplicateCandidates', 'Near-duplicate days', 'amber'],
  ['duplicatesInFile', 'Exact duplicates removed'],
  ['skippedRows', 'Skipped rows'],
  ['errors', 'Errors', 'red'],
  ['warnings', 'Warnings', 'amber'],
];

const FLAG_TEXT = { ODD_PUNCH_COUNT: 'odd punches', EXTRA_PUNCHES: 'extra punches', NEAR_DUPLICATE: 'near-duplicate' };

export function PreviewStep({ preview, period, fileName, onBack, onRefresh, refreshing, onConfirm }) {
  const [ack, setAck] = useState(false);
  const [severity, setSeverity] = useState('');
  const [expanded, setExpanded] = useState(null);
  const t = preview.totals;
  const issues = useMemo(() => preview.issues.filter((i) => !severity || i.severity === severity), [preview.issues, severity]);
  const needsAck = t.errors > 0 || t.unmatchedIds > 0;
  const nothing = t.validPunches === 0;

  return (
    <div className="space-y-4">
      <Card title={`Preview: ${fileName}`} actions={<span className="text-sm text-slate-600">Period {period.start} to {period.end}</span>}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {TOTAL_LABELS.map(([key, label, tone]) => (
            <div key={key} className="rounded-md border border-slate-200 p-3">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className={`text-xl font-semibold ${t[key] > 0 && tone === 'red' ? 'text-red-700' : t[key] > 0 && tone === 'amber' ? 'text-amber-700' : 'text-slate-900'}`}>{t[key]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          Nothing has been saved yet. Punches already in the database (same employee, date, and time) will be skipped on commit, so re-importing the same file does not create duplicates.
        </p>
      </Card>

      <Card
        title={`Employees in file (${preview.employees.length})`}
        actions={
          <Button size="sm" variant="secondary" icon={RefreshCw} loading={refreshing} onClick={onRefresh}>
            Re-check employee matches
          </Button>
        }
        bodyClassName=""
      >
        <div className="max-h-[28rem] overflow-y-auto">
          <Table>
            <thead className="sticky top-0">
              <tr>
                <Th />
                <Th>Biometric ID</Th>
                <Th>Name in workbook</Th>
                <Th>Matched employee</Th>
                <Th>Days</Th>
                <Th>Punches</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.employees.map((e) => {
                const flagged = e.days.filter((d) => d.flags.length).length;
                const open = expanded === e.biometricId;
                return [
                  <tr key={e.biometricId} className={e.matched ? '' : 'bg-amber-50/60'}>
                    <Td>
                      <button type="button" className="rounded p-1 hover:bg-slate-100" onClick={() => setExpanded(open ? null : e.biometricId)} aria-expanded={open} aria-label={`Show days for ${e.biometricId}`}>
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </Td>
                    <Td className="font-mono">{e.biometricId}</Td>
                    <Td>{e.workbookNames.join(' / ') || <span className="text-slate-400">—</span>}</Td>
                    <Td>
                      {e.employee ? (
                        e.employee.full_name
                      ) : (
                        <div>
                          <Badge tone="amber">Unmatched — will not be imported</Badge>
                          {e.suggestions.length > 0 && <p className="mt-1 text-xs text-slate-600">Similar names: {e.suggestions.map((s) => `${s.full_name} (ID ${s.biometric_id})`).join('; ')}. Verify the biometric ID; names are never used to match automatically.</p>}
                        </div>
                      )}
                    </Td>
                    <Td>{e.days.length}</Td>
                    <Td>{e.punchCount}</Td>
                    <Td>{flagged ? <Badge tone="amber">{flagged} day(s)</Badge> : <Badge tone="green">OK</Badge>}</Td>
                  </tr>,
                  open && (
                    <tr key={`${e.biometricId}-days`}>
                      <td colSpan={7} className="bg-slate-50 px-6 py-2">
                        <table className="text-xs">
                          <thead>
                            <tr className="text-left text-slate-500">
                              <th className="pr-4">Date</th>
                              <th className="pr-4">Punch times (sorted)</th>
                              <th className="pr-4">Source cells</th>
                              <th>Flags</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.days.map((d) => (
                              <tr key={d.date}>
                                <td className="pr-4 font-mono">{d.date}</td>
                                <td className="pr-4 font-mono">{d.times.join(', ')}</td>
                                <td className="pr-4 text-slate-500">{[...new Set(d.cells)].join(', ')}</td>
                                <td>{d.flags.map((f) => <Badge key={f} tone="amber">{FLAG_TEXT[f] ?? f}</Badge>)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </Table>
        </div>
        {t.unmatchedIds > 0 && (
          <p className="border-t border-slate-200 p-3 text-sm text-slate-600">
            To import unmatched IDs, <Link to="/employees" target="_blank" className="text-blue-700 hover:underline">add the employees</Link> with those biometric IDs, then click “Re-check employee matches”.
          </p>
        )}
      </Card>

      <Card
        title={`Validation issues (${preview.issues.length})`}
        actions={
          <>
            <Select aria-label="Filter issues" className="h-8 w-36 py-1" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">All</option>
              <option value="error">Errors</option>
              <option value="warning">Warnings</option>
            </Select>
            <Button size="sm" variant="secondary" icon={Download} disabled={!preview.issues.length} onClick={() => downloadXlsx([{ name: 'Issues', rows: issuesToRows(preview.issues) }], `import-issues-${fileName.replace(/\.[^.]+$/, '')}.xlsx`)}>
              Error report
            </Button>
          </>
        }
        bodyClassName=""
      >
        {issues.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No issues found.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <thead className="sticky top-0">
                <tr>
                  <Th>Severity</Th>
                  <Th>Code</Th>
                  <Th>Message</Th>
                  <Th>Location</Th>
                  <Th>Raw value</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {issues.slice(0, 500).map((i, idx) => (
                  <tr key={idx}>
                    <Td>{i.severity === 'error' ? <Badge tone="red">Error</Badge> : <Badge tone="amber">Warning</Badge>}</Td>
                    <Td className="font-mono text-xs">{i.code}</Td>
                    <Td>{i.message}</Td>
                    <Td className="whitespace-nowrap text-xs">{[i.sheet, i.cell].filter(Boolean).join('!')}{i.biometricId ? ` · ID ${i.biometricId}` : ''}</Td>
                    <Td className="max-w-48 truncate font-mono text-xs" title={i.raw}>{i.raw}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {issues.length > 500 && <p className="p-3 text-xs text-slate-500">Showing first 500 of {issues.length}. Download the error report for the full list.</p>}
          </div>
        )}
      </Card>

      {nothing && <Alert tone="warning">There are no punches for recognized employees to import. Adjust the mapping or add the missing employees.</Alert>}
      {needsAck && !nothing && (
        <Alert tone="warning" title="Review before importing">
          {t.errors > 0 && <p>{t.errors} error(s): the affected cells/rows are excluded. Correct the mapping or the source file if these values should be imported.</p>}
          {t.unmatchedIds > 0 && <p>{t.unmatchedIds} unmatched biometric ID(s): {t.unmatchedPunches} punch(es) will not be imported and will be listed in the batch report.</p>}
          <Checkbox className="mt-2" label="I reviewed these issues and want to import the valid punches only." checked={ack} onChange={(e) => setAck(e.target.checked)} />
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onBack}>
          Back to mapping
        </Button>
        <Button onClick={onConfirm} disabled={nothing || (needsAck && !ack)}>
          Import {t.validPunches} punch(es)
        </Button>
      </div>
    </div>
  );
}
