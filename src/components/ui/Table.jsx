import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';

export function Table({ children, className = '' }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, sortKey, sort, onSort, className = '' }) {
  const active = sort && sortKey && sort.key === sortKey;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;
  return (
    <th scope="col" aria-sort={ariaSort} className={`bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 ${className}`}>
      {sortKey && onSort ? (
        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => onSort(sortKey)}>
          {children}
          {active && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function Td({ children, className = '', ...props }) {
  return (
    <td className={`px-3 py-2 align-top text-slate-700 ${className}`} {...props}>
      {children}
    </td>
  );
}

/** Page numbers to show: first, last, and a window around the current page, with null for gaps. */
function pageList(page, pages) {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...keep].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i && p - sorted[i - 1] > 1 ? [null, p] : [p]));
}

export function Pagination({ page, pageSize, total, onPage, pageSizes, onPageSize, className = 'border-t' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = 'min-w-8 rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <nav className={`flex flex-wrap items-center justify-between gap-2 border-slate-200 px-3 py-2 text-sm text-slate-600 ${className}`} aria-label="Pagination">
      <div className="flex items-center gap-3">
        <span>
          {from}–{to} of {total}
        </span>
        {pageSizes && onPageSize && (
          <label className="flex items-center gap-1.5 text-xs">
            Rows per page
            <select className="rounded border border-slate-300 bg-white px-1.5 py-1 text-sm" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
              {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pageList(page, pages).map((p, i) =>
          p === null ? (
            <span key={`gap${i}`} className="px-1 text-slate-400" aria-hidden>…</span>
          ) : (
            <button
              key={p}
              type="button"
              className={`${btn} ${p === page ? 'bg-blue-600 font-semibold text-white hover:bg-blue-600' : ''}`}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Page ${p}`}
              onClick={() => p !== page && onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
