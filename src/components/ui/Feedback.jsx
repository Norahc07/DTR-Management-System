import { AlertTriangle, Inbox, Info, Loader2, XCircle, CheckCircle2 } from 'lucide-react';
import { STATUS_LABELS } from '@/features/attendance/engine/computeDay';

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Skeleton({ rows = 5 }) {
  return (
    <div className="space-y-2 py-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-8 animate-pulse rounded bg-slate-200" />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <Icon className="mb-3 h-10 w-10 text-slate-300" aria-hidden />
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Alert tone="error" title="Something went wrong">
      <p>{error?.message || String(error)}</p>
      {onRetry && (
        <button type="button" className="mt-2 text-sm font-medium underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </Alert>
  );
}

const TONES = {
  info: ['border-blue-200 bg-blue-50 text-blue-900', Info],
  warning: ['border-amber-200 bg-amber-50 text-amber-900', AlertTriangle],
  error: ['border-red-200 bg-red-50 text-red-900', XCircle],
  success: ['border-emerald-200 bg-emerald-50 text-emerald-900', CheckCircle2],
};

export function Alert({ tone = 'info', title, children, className = '' }) {
  const [cls, Icon] = TONES[tone];
  return (
    <div className={`flex gap-3 rounded-md border p-3 text-sm ${cls} ${className}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

const BADGE_TONES = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export function Badge({ tone = 'gray', children, title }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONES = {
  complete: 'green',
  approved_correction: 'blue',
  missing_punch: 'red',
  needs_review: 'amber',
  no_punches: 'gray',
  no_data: 'gray',
  rest_day: 'purple',
  holiday: 'purple',
  leave: 'blue',
  not_computed: 'gray',
};

export function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONES[status] ?? 'gray'}>{STATUS_LABELS[status] ?? (status === 'not_computed' ? 'Not computed' : status)}</Badge>;
}

export function Card({ title, actions, children, className = '', bodyClassName = 'p-4' }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
