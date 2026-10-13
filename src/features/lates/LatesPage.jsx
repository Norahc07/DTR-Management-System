import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlarmClock } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Form';
import { useAsync } from '@/hooks/useAsync';
import { MONTH_NAMES, todayInZone } from '@/lib/time';
import { useAuth } from '@/features/auth/authContext';
import { loadLateDays } from './latesService';
import { groupLates } from './groupLates';

export function LatesPage() {
  const { timezone } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = todayInZone(timezone);
  const year = Number(params.get('year') || today.slice(0, 4));
  const month = Number(params.get('month') || 0);
  const set = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  const rows = useAsync(() => loadLateDays({ year, month }), [year, month], { cacheKey: 'lates' });
  const groups = useMemo(() => groupLates(rows.data ?? []), [rows.data]);
  const scope = month ? `${MONTH_NAMES[month - 1]} ${year}` : String(year);

  return (
    <>
      <PageHeader
        title="Lates"
        description="Staff who arrived late: morning IN after the start of office hours (7:00; 8:00 until September 2026) or afternoon IN after 1:00 PM. Each late day counts once."
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Lates' }]}
      />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Year">{(p) => <Input {...p} type="number" min={2000} max={2100} value={year} onChange={(e) => set({ year: e.target.value })} placeholder="e.g. 2026" />}</Field>
          <Field label="Month">
            {(p) => (
              <Select {...p} value={month} onChange={(e) => set({ month: e.target.value === '0' ? '' : e.target.value })}>
                <option value="0">Whole year</option>
                {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      {rows.error ? (
        <ErrorState error={rows.error} onRetry={rows.reload} />
      ) : rows.loading && !rows.data ? (
        <Skeleton rows={5} />
      ) : groups.length === 0 ? (
        <EmptyState icon={AlarmClock} title={`No lates recorded for ${scope}`}>Only days that have been imported and computed are counted.</EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">{scope}: {rows.data.length} late day(s), {groups.length} staff</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => (
              <article key={g.employeeId} aria-label={`Lates of ${g.name}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="font-semibold text-slate-900">{g.name}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  <span className="text-2xl font-bold text-amber-700">{g.days.length}</span> late day{g.days.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
                  {g.months.map((m) => (
                    <li key={m.key}>
                      <span className="font-medium text-slate-800">{m.label}</span>
                      <span className="block text-slate-600">({m.days.join(', ')})</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
