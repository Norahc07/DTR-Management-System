import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Alert, Card, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/features/auth/authContext';
import { DEFAULT_DTR_TEMPLATE, TEMPLATE_TEXT_KEYS, resolveTemplate } from '@/features/dtr/buildDtr';
import { readLocalMapping, sanitizeMapping } from '@/features/import/importConfig';
import { DATE_FORMATS, loadSettings, saveSettings, validateSettings } from './settingsService';

function listTimezones() {
  try {
    const zones = Intl.supportedValuesOf?.('timeZone');
    if (zones?.length) return zones;
  } catch {
    // fall through
  }
  return ['Asia/Manila', 'UTC'];
}

function SettingsForm({ initial, onSaved }) {
  const toast = useToast();
  const timezones = listTimezones();
  const [f, setF] = useState(() => ({
    org_name: initial.org_name ?? '',
    org_address: initial.org_address ?? '',
    logo_url: initial.logo_url ?? '',
    timezone: initial.timezone,
    date_format: initial.date_format,
    max_import_file_mb: initial.max_import_file_mb,
    template: resolveTemplate(initial.dtr_template),
    defaultMapping: sanitizeMapping(initial.import_config?.defaultMapping),
  }));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const setT = (patch) => setF((x) => ({ ...x, template: { ...x.template, ...patch } }));
  const tzChanged = f.timezone !== initial.timezone;

  const submit = async (e) => {
    e.preventDefault();
    const errs = validateSettings(f);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      const t = f.template;
      await saveSettings({
        org_name: f.org_name.trim(),
        org_address: f.org_address.trim() || null,
        logo_url: f.logo_url.trim() || null,
        timezone: f.timezone,
        date_format: f.date_format,
        max_import_file_mb: Number(f.max_import_file_mb),
        dtr_template: {
          ...Object.fromEntries(TEMPLATE_TEXT_KEYS.map((k) => [k, t[k].trim() || DEFAULT_DTR_TEMPLATE[k]])),
          slotMode: t.slotMode,
          splitMinute: Number(t.splitMinute),
          timeFormat: t.timeFormat,
          showComputation: t.showComputation,
        },
        import_config: { ...(initial.import_config || {}), defaultMapping: f.defaultMapping },
      });
      toast.success('Settings saved');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const localMapping = readLocalMapping();
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <Card title="Organization">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Organization name" required error={errors.org_name}>{(p) => <Input {...p} value={f.org_name} maxLength={200} placeholder="e.g. e-LearningVille" onChange={(e) => setF({ ...f, org_name: e.target.value })} />}</Field>
          <Field label="Logo URL" hint="Optional https:// image for printed DTRs; the e-LearningVille logomark is used when empty" error={errors.logo_url}>{(p) => <Input {...p} type="url" value={f.logo_url} placeholder="https://example.com/logo.png" onChange={(e) => setF({ ...f, logo_url: e.target.value })} />}</Field>
          <Field label="Address" className="md:col-span-2">{(p) => <Textarea {...p} value={f.org_address} maxLength={500} placeholder="Street, barangay, municipality, province" onChange={(e) => setF({ ...f, org_address: e.target.value })} className="min-h-12" />}</Field>
        </div>
      </Card>
      <Card title="Regional and printing">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Timezone" hint="Device times in imported files are interpreted in this zone">
            {(p) => (
              <Select {...p} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
                {timezones.map((z) => <option key={z} value={z}>{z}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Date format">
            {(p) => (
              <Select {...p} value={f.date_format} onChange={(e) => setF({ ...f, date_format: e.target.value })}>
                {DATE_FORMATS.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Max import file (MB)" error={errors.max_import_file_mb}>{(p) => <Input {...p} type="number" min={1} max={50} value={f.max_import_file_mb} placeholder="e.g. 10" onChange={(e) => setF({ ...f, max_import_file_mb: e.target.value })} />}</Field>
        </div>
        {tzChanged && (
          <Alert tone="warning" className="mt-3" title="Changing the timezone">
            Punches already imported keep their stored instant. Changing the zone changes how those instants map to local dates and times, so recompute attendance afterwards and re-check any non-finalized DTRs. Only change this if the original setting was wrong.
          </Alert>
        )}
      </Card>
      <Card title="DTR print form (CS Form No. 48)">
        <p className="mb-3 text-sm text-slate-600">Two forms print on each portrait page. Blank text fields fall back to the defaults shown on the form.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Form number line">{(p) => <Input {...p} value={f.template.formNumber} placeholder={DEFAULT_DTR_TEMPLATE.formNumber} maxLength={80} onChange={(e) => setT({ formNumber: e.target.value })} />}</Field>
          <Field label="Title">{(p) => <Input {...p} value={f.template.title} placeholder={DEFAULT_DTR_TEMPLATE.title} maxLength={80} onChange={(e) => setT({ title: e.target.value })} />}</Field>
          <div />
          <Field label="Regular days label">{(p) => <Input {...p} value={f.template.regularDaysLabel} placeholder={DEFAULT_DTR_TEMPLATE.regularDaysLabel} maxLength={30} onChange={(e) => setT({ regularDaysLabel: e.target.value })} />}</Field>
          <Field label="Regular days hours">{(p) => <Input {...p} value={f.template.regularHours} placeholder={DEFAULT_DTR_TEMPLATE.regularHours} maxLength={30} onChange={(e) => setT({ regularHours: e.target.value })} />}</Field>
          <div />
          <Field label="Weekend label">{(p) => <Input {...p} value={f.template.weekendLabel} placeholder={DEFAULT_DTR_TEMPLATE.weekendLabel} maxLength={30} onChange={(e) => setT({ weekendLabel: e.target.value })} />}</Field>
          <Field label="Weekend hours">{(p) => <Input {...p} value={f.template.weekendHours} placeholder={DEFAULT_DTR_TEMPLATE.weekendHours} maxLength={30} onChange={(e) => setT({ weekendHours: e.target.value })} />}</Field>
          <div />
          <Field label="Verified by (name)" hint="Printed in capitals under the verification line">{(p) => <Input {...p} value={f.template.verifierName} placeholder={DEFAULT_DTR_TEMPLATE.verifierName} maxLength={80} onChange={(e) => setT({ verifierName: e.target.value })} />}</Field>
          <Field label="Verified by (position)">{(p) => <Input {...p} value={f.template.verifierTitle} placeholder={DEFAULT_DTR_TEMPLATE.verifierTitle} maxLength={80} onChange={(e) => setT({ verifierTitle: e.target.value })} />}</Field>
          <Field label="Verification line">{(p) => <Input {...p} value={f.template.verifiedText} placeholder={DEFAULT_DTR_TEMPLATE.verifiedText} maxLength={120} onChange={(e) => setT({ verifiedText: e.target.value })} />}</Field>
          <Field label="Time format">
            {(p) => (
              <Select {...p} value={f.template.timeFormat} onChange={(e) => setT({ timeFormat: e.target.value })}>
                <option value="12h">12-hour</option>
                <option value="24h">24-hour</option>
              </Select>
            )}
          </Field>
          <Field label="Punch placement">
            {(p) => (
              <Select {...p} value={f.template.slotMode} onChange={(e) => setT({ slotMode: e.target.value })}>
                <option value="split_at_break">Split morning / afternoon</option>
                <option value="chronological">Chronological</option>
              </Select>
            )}
          </Field>
          <Field label="Split at (minutes after midnight)" hint="720 = 12:00 noon" error={errors.splitMinute}>{(p) => <Input {...p} type="number" min={0} max={1439} value={f.template.splitMinute} placeholder="720" onChange={(e) => setT({ splitMinute: e.target.value })} />}</Field>
          <div className="md:col-span-3">
            <Checkbox label="Fill the Undertime columns (late arrival + early departure, from the attendance policy)" checked={f.template.showComputation} onChange={(e) => setT({ showComputation: e.target.checked })} />
          </div>
          <Field label="Certification text" className="md:col-span-3">{(p) => <Textarea {...p} value={f.template.certificationText} placeholder={DEFAULT_DTR_TEMPLATE.certificationText} maxLength={600} onChange={(e) => setT({ certificationText: e.target.value })} />}</Field>
        </div>
      </Card>
      <Card title="Default import mapping">
        <p className="mb-2 text-sm text-slate-600">Pre-fills the column/label mapping in the import wizard for every admin. Each import still shows the preview before anything is saved.</p>
        {Object.keys(f.defaultMapping).length ? (
          <dl className="grid gap-x-4 gap-y-1 text-xs md:grid-cols-3">
            {Object.entries(f.defaultMapping).map(([k, v]) => (
              <div key={k} className="flex gap-2"><dt className="font-mono text-slate-500">{k}</dt><dd className="font-mono">{String(v)}</dd></div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">No organization default saved.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={!localMapping} onClick={() => setF({ ...f, defaultMapping: sanitizeMapping(localMapping) })}>
            Use mapping from my last import
          </Button>
          <Button variant="ghost" size="sm" disabled={!Object.keys(f.defaultMapping).length} onClick={() => setF({ ...f, defaultMapping: {} })}>Clear default</Button>
        </div>
        {!localMapping && <p className="mt-1 text-xs text-slate-500">Run an import in this browser first to capture a mapping.</p>}
      </Card>
      <div className="flex justify-end">
        <Button type="submit" loading={busy}>Save settings</Button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const { refreshProfile } = useAuth();
  const settings = useAsync(() => loadSettings(), [], { cacheKey: 'settings' });
  return (
    <>
      <PageHeader title="Settings" description="Organization-wide configuration. Changes are audited." breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Settings' }]} />
      {settings.error ? (
        <ErrorState error={settings.error} onRetry={settings.reload} />
      ) : !settings.data ? (
        <Skeleton rows={8} />
      ) : (
        <SettingsForm key={settings.data.updated_at} initial={settings.data} onSaved={() => { settings.reload(); refreshProfile(); }} />
      )}
    </>
  );
}
