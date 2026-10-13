import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, Badge, Alert } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/Form';
import { MONTH_NAMES } from '@/lib/time';
import { SheetGrid } from './SheetGrid';
import { suggestRowsMapping } from './parser/rowsAdapter';
import { colIndex, colLetter, findDayColumns } from './parser/workbook';

export function ConfigureStep({ wb, inspection, config, setConfig, onBack, onPreview }) {
  const [gridSheet, setGridSheet] = useState(config.sheets[0] || inspection.sheets[0]?.name);
  const ws = wb.Sheets[gridSheet];
  const set = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const toggleSheet = (name, on) =>
    setConfig((c) => ({ ...c, sheets: on ? [...new Set([...c.sheets, name])] : c.sheets.filter((s) => s !== name) }));

  const dayCols = config.layout === 'matrix' && ws && Number(config.dayHeaderRow) > 0 ? findDayColumns(ws, Number(config.dayHeaderRow) - 1) : [];
  const highlightCols =
    config.layout === 'matrix'
      ? dayCols.map((d) => colLetter(d.col))
      : [config.idColumn, config.nameColumn, config.dateColumn, config.datetimeColumn, ...String(config.timeColumns).split(',')].map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
  const highlightRow = config.layout === 'matrix' ? Number(config.dayHeaderRow) : Number(config.headerRow);

  const validCol = (v) => !v || /^[A-Za-z]{1,3}$/.test(String(v).trim());
  const colsOk = [config.idColumn, config.nameColumn, config.dateColumn, config.datetimeColumn, config.deviceEventIdColumn].every(validCol) &&
    String(config.timeColumns || '').split(',').map((s) => s.trim()).filter(Boolean).every(validCol);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-4">
        <Card title="1. Worksheets">
          <div className="space-y-2">
            {inspection.sheets.map((s) => (
              <div key={s.name} className="flex flex-wrap items-center gap-2 text-sm">
                <Checkbox label={s.name} checked={config.sheets.includes(s.name)} disabled={s.empty} onChange={(e) => toggleSheet(s.name, e.target.checked)} />
                <span className="text-xs text-slate-500">
                  {s.empty ? 'empty' : `${s.rowCount}×${s.colCount}`}
                  {s.mergeCount ? ` · ${s.mergeCount} merged` : ''}
                  {s.hiddenRows ? ` · ${s.hiddenRows} hidden rows` : ''}
                </span>
                {s.hidden && <Badge tone="amber">hidden sheet</Badge>}
                {s.hints?.suggestedLayout && <Badge tone="blue">looks like {s.hints.suggestedLayout}</Badge>}
                {!s.empty && (
                  <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setGridSheet(s.name)}>
                    view
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">All selected sheets are parsed with the same mapping.</p>
        </Card>

        <Card title="2. Layout">
          <div className="space-y-3">
            <Field label="Layout type">
              {(p) => (
                <Select {...p} value={config.layout} onChange={(e) => set({ layout: e.target.value })}>
                  <option value="matrix">Monthly matrix (days as columns)</option>
                  <option value="rows">Rows (one punch or one day per row)</option>
                </Select>
              )}
            </Field>

            {config.layout === 'matrix' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Month" required>
                    {(p) => (
                      <Select {...p} value={config.month} onChange={(e) => set({ month: Number(e.target.value) })}>
                        {MONTH_NAMES.map((m, i) => (
                          <option key={m} value={i + 1}>{m}</option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Year" required>
                    {(p) => <Input {...p} type="number" min={2000} max={2100} value={config.year} onChange={(e) => set({ year: Number(e.target.value) })} placeholder="e.g. 2026" />}
                  </Field>
                </div>
                <Field label="Row with day numbers (1, 2, 3 …)" required hint={dayCols.length ? `Found ${dayCols.length} day columns (${colLetter(dayCols[0].col)}–${colLetter(dayCols[dayCols.length - 1].col)})` : 'No day numbers found in this row of the viewed sheet'}>
                  {(p) => <Input {...p} type="number" min={1} value={config.dayHeaderRow ?? ''} placeholder="e.g. 4" onChange={(e) => set({ dayHeaderRow: Number(e.target.value) })} />}
                </Field>
                <Field label="Employee rows">
                  {(p) => (
                    <Select {...p} value={config.employeeLayout} onChange={(e) => set({ employeeLayout: e.target.value })}>
                      <option value="labelRow">Label row (e.g. "ID: 12  Name: …") then punch rows</option>
                      <option value="idColumn">ID in a fixed column on each employee row</option>
                    </Select>
                  )}
                </Field>
                {config.employeeLayout === 'labelRow' ? (
                  <>
                    <Field label="ID labels" hint="Comma-separated labels that precede the employee ID">
                      {(p) => <Input {...p} value={config.idLabels} placeholder="e.g. ID:, No:" onChange={(e) => set({ idLabels: e.target.value })} />}
                    </Field>
                    <Field label="Name labels">
                      {(p) => <Input {...p} value={config.nameLabels} placeholder="e.g. Name:" onChange={(e) => set({ nameLabels: e.target.value })} />}
                    </Field>
                    <Field label="Punch rows below the label row" hint="Offsets, e.g. 1 (next row) or 1,2,3,4 for one row per punch">
                      {(p) => <Input {...p} value={config.punchRowOffsets} placeholder="e.g. 1" onChange={(e) => set({ punchRowOffsets: e.target.value })} />}
                    </Field>
                  </>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="ID column">
                      {(p) => <Input {...p} value={config.idColumn} onChange={(e) => set({ idColumn: e.target.value.toUpperCase() })} placeholder="e.g. A" />}
                    </Field>
                    <Field label="Name column">
                      {(p) => <Input {...p} value={config.nameColumn} onChange={(e) => set({ nameColumn: e.target.value.toUpperCase() })} placeholder="e.g. B" />}
                    </Field>
                    <Field label="First data row">
                      {(p) => <Input {...p} type="number" min={1} value={config.firstDataRow ?? ''} placeholder="e.g. 2" onChange={(e) => set({ firstDataRow: e.target.value ? Number(e.target.value) : null })} />}
                    </Field>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Header row">
                    {(p) => <Input {...p} type="number" min={1} value={config.headerRow ?? 1} placeholder="e.g. 1" onChange={(e) => set({ headerRow: Number(e.target.value) })} />}
                  </Field>
                  <div className="flex items-end">
                    <Button variant="secondary" size="sm" icon={Wand2} onClick={() => ws && set(suggestRowsMapping(ws, config.headerRow))}>
                      Suggest from headers
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Employee ID column" required>
                    {(p) => <Input {...p} value={config.idColumn} onChange={(e) => set({ idColumn: e.target.value.toUpperCase() })} placeholder="A" />}
                  </Field>
                  <Field label="Name column">
                    {(p) => <Input {...p} value={config.nameColumn} onChange={(e) => set({ nameColumn: e.target.value.toUpperCase() })} placeholder="e.g. B" />}
                  </Field>
                  <Field label="Date-time column" hint="Use when date and time are in one cell">
                    {(p) => <Input {...p} value={config.datetimeColumn} placeholder="e.g. C" onChange={(e) => set({ datetimeColumn: e.target.value.toUpperCase() })} />}
                  </Field>
                  <Field label="Date column">
                    {(p) => <Input {...p} value={config.dateColumn} placeholder="e.g. C" onChange={(e) => set({ dateColumn: e.target.value.toUpperCase() })} />}
                  </Field>
                  <Field label="Time column(s)" hint="Comma-separated, e.g. D,E,F,G">
                    {(p) => <Input {...p} value={config.timeColumns} placeholder="e.g. D,E,F,G" onChange={(e) => set({ timeColumns: e.target.value.toUpperCase() })} />}
                  </Field>
                  <Field label="Device event ID column" hint="Optional">
                    {(p) => <Input {...p} value={config.deviceEventIdColumn} placeholder="Optional, e.g. H" onChange={(e) => set({ deviceEventIdColumn: e.target.value.toUpperCase() })} />}
                  </Field>
                </div>
                <Field label="Numeric date order" hint="How to read dates like 03/04/2026">
                  {(p) => (
                    <Select {...p} value={config.dateOrder} onChange={(e) => set({ dateOrder: e.target.value })}>
                      <option value="MDY">Month/Day/Year</option>
                      <option value="DMY">Day/Month/Year</option>
                    </Select>
                  )}
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Period start" required>
                    {(p) => <Input {...p} type="date" value={config.periodStart} onChange={(e) => set({ periodStart: e.target.value })} />}
                  </Field>
                  <Field label="Period end" required>
                    {(p) => <Input {...p} type="date" value={config.periodEnd} onChange={(e) => set({ periodEnd: e.target.value })} />}
                  </Field>
                </div>
              </>
            )}
            <Field label="Pad numeric IDs to length" hint="0 = off. Only use if the device IDs have a fixed width and Excel dropped leading zeros.">
              {(p) => <Input {...p} type="number" min={0} max={32} value={config.idPadLength ?? 0} placeholder="0" onChange={(e) => set({ idPadLength: Number(e.target.value) })} />}
            </Field>
          </div>
        </Card>
        {!colsOk && <Alert tone="error">Column fields must be Excel column letters such as A or AB.</Alert>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onPreview} disabled={!config.sheets.length || !colsOk}>
            Preview & validate
          </Button>
        </div>
      </div>

      <Card title={`Sheet preview: ${gridSheet ?? ''}`} actions={<span className="text-xs text-slate-500">First 30 rows · highlighted row/columns follow your mapping</span>}>
        {ws ? <SheetGrid ws={ws} highlightRow={highlightRow} highlightCols={highlightCols.filter((c) => { try { return colIndex(c) >= 0; } catch { return false; } })} /> : <p className="text-sm text-slate-500">Select a sheet to view.</p>}
      </Card>
    </div>
  );
}
