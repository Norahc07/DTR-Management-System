import { fetchAll, requireClient, unwrap } from '@/lib/supabase';
import { secondsToTime } from '@/lib/time';
import { recomputeAttendance } from '@/features/attendance/recomputeService';

const STAGE_CHUNK = 1000;
const MAX_ERRORS_STORED = 5000;

export async function findBatchesByHash(hash) {
  if (!hash) return [];
  return unwrap(
    await requireClient()
      .from('import_batches')
      .select('id, file_name, status, created_at, events_inserted')
      .eq('file_sha256', hash)
      .order('created_at', { ascending: false }),
  );
}

/**
 * Stages all parsed punches, then commits them atomically on the server.
 * If staging or commit fails, the batch is marked failed and no punches are
 * written to attendance_events (commit_import runs in a single transaction).
 */
export async function runImport({ file, config, period, preview, onProgress = () => {} }) {
  const sb = requireClient();
  const { data: userData } = await sb.auth.getUser();
  const userId = userData?.user?.id;

  onProgress({ step: 'batch', message: 'Creating import batch…' });
  const batch = unwrap(
    await sb
      .from('import_batches')
      .insert({
        file_name: file.name.slice(0, 255),
        file_size: file.size,
        file_sha256: file.sha256,
        adapter: config.layout,
        mapping: config,
        period_start: period.start,
        period_end: period.end,
        status: 'staging',
        created_by: userId,
        summary: { preview: preview.totals },
      })
      .select()
      .single(),
  );

  try {
    const issues = preview.issues.filter((i) => i.code !== 'UNMATCHED_ID').slice(0, MAX_ERRORS_STORED);
    for (let i = 0; i < issues.length; i += STAGE_CHUNK) {
      const chunk = issues.slice(i, i + STAGE_CHUNK).map((x) => ({
        batch_id: batch.id,
        severity: x.severity,
        code: String(x.code).slice(0, 60),
        message: String(x.message).slice(0, 1000),
        sheet_name: x.sheet ?? null,
        cell_ref: x.cell ?? null,
        biometric_id: x.biometricId ?? null,
        raw_value: x.raw != null ? String(x.raw).slice(0, 500) : null,
      }));
      unwrap(await sb.from('import_errors').insert(chunk));
    }

    const records = preview.stagedRecords;
    for (let i = 0; i < records.length; i += STAGE_CHUNK) {
      onProgress({ step: 'stage', message: `Uploading punches ${Math.min(i + STAGE_CHUNK, records.length)} of ${records.length}…`, done: i, total: records.length });
      const chunk = records.slice(i, i + STAGE_CHUNK).map((r) => ({
        batch_id: batch.id,
        biometric_id: r.biometricId,
        source_name: r.name ? String(r.name).slice(0, 200) : null,
        local_date: r.date,
        local_time: secondsToTime(r.seconds),
        device_event_id: r.deviceEventId || null,
        sheet_name: r.sheet,
        cell_ref: r.cell,
        raw_value: r.raw != null ? String(r.raw).slice(0, 500) : null,
      }));
      unwrap(await sb.from('import_staging_events').insert(chunk));
    }

    onProgress({ step: 'commit', message: 'Committing punches on the server…' });
    const result = unwrap(await sb.rpc('commit_import', { p_batch_id: batch.id }));
    return { batch, result };
  } catch (error) {
    await sb.rpc('fail_import', { p_batch_id: batch.id, p_message: error.message }).then(() => {}, () => {});
    error.batchId = batch.id;
    throw error;
  }
}

export async function listBatches({ page = 1, pageSize = 20, status = '' } = {}) {
  let q = requireClient()
    .from('import_batches')
    .select('id, file_name, file_size, adapter, period_start, period_end, status, events_staged, events_inserted, events_existing, error_message, created_at, completed_at, summary', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (status) q = q.eq('status', status);
  return unwrap(await q);
}

export async function getBatch(id) {
  return unwrap(await requireClient().from('import_batches').select('*').eq('id', id).maybeSingle());
}

export async function listBatchErrors(batchId) {
  const sb = requireClient();
  return fetchAll(() => sb.from('import_errors').select('*').eq('batch_id', batchId).order('id'));
}

/** Deletes an import's punches (audited, with the reason) and recomputes the affected staff for its period. */
export async function deleteImportBatch(batchId, reason) {
  const r = unwrap(await requireClient().rpc('delete_import_batch', { p_batch_id: batchId, p_reason: reason }));
  if (r.employee_ids?.length) await recomputeAttendance({ employeeIds: r.employee_ids, from: r.period_start, to: r.period_end });
  return r;
}

export async function countBatchEvents(batchId) {
  const { count } = unwrap(
    await requireClient().from('attendance_events').select('id', { count: 'exact', head: true }).eq('import_batch_id', batchId),
  );
  return count ?? 0;
}
