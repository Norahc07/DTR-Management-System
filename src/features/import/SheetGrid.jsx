import { useMemo } from 'react';
import { previewGrid } from './parser/workbook';

/** Raw cell preview with Excel-style row numbers and column letters. */
export function SheetGrid({ ws, highlightRow, highlightCols = [], maxRows = 30 }) {
  const grid = useMemo(() => previewGrid(ws, { rows: maxRows, cols: 40 }), [ws, maxRows]);
  if (!grid.rows.length) return <p className="p-4 text-sm text-slate-500">This worksheet is empty.</p>;
  const hl = new Set(highlightCols);
  return (
    <div className="max-h-96 overflow-auto rounded border border-slate-200">
      <table className="border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-20 border border-slate-200 bg-slate-100 px-2 py-1" />
            {grid.colLetters.map((c) => (
              <th key={c} scope="col" className={`border border-slate-200 px-2 py-1 font-mono font-medium ${hl.has(c) ? 'bg-blue-100 text-blue-900' : 'bg-slate-100 text-slate-600'}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => (
            <tr key={r.row} className={r.row === highlightRow ? 'bg-amber-50' : r.hidden ? 'bg-slate-100 text-slate-400' : ''}>
              <th scope="row" className="sticky left-0 border border-slate-200 bg-slate-100 px-2 py-1 text-right font-mono font-medium text-slate-600">
                {r.row}
                {r.hidden && <span title="Hidden row"> ·h</span>}
              </th>
              {r.cells.map((v, i) => (
                <td key={i} className="max-w-40 truncate border border-slate-200 px-2 py-1 whitespace-pre" title={v}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
