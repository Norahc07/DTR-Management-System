-- Deleting an imported file's data (e.g. a wrong file was imported).
-- Removes the batch's punches, any manual removals that targeted them, and the
-- batch record; manual entries (source 'correction') are kept. Every deleted
-- row is recorded in the audit log with the reason. Refused when a DTR covering
-- the batch's punches is finalized. The caller recomputes the returned
-- employees for the returned period afterwards.
create or replace function public.delete_import_batch(p_batch_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_batch public.import_batches;
  v_employees uuid[];
  v_deleted integer;
begin
  if not public.is_admin() then
    raise exception 'Only HR / Admin or Super Admin can delete imported data' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Enter a reason (at least 5 characters)' using errcode = '22023';
  end if;
  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Import not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.attendance_events e
     where e.import_batch_id = p_batch_id and public.is_dtr_finalized(e.employee_id, e.local_date)
  ) then
    raise exception 'A DTR covering this import is finalized; revoke the finalization first' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct employee_id), '{}') into v_employees
    from public.attendance_events where import_batch_id = p_batch_id;

  perform set_config('app.audit_reason', 'Imported data deleted: ' || trim(p_reason), true);
  delete from public.attendance_event_voids v
   using public.attendance_events e
   where v.event_id = e.id and e.import_batch_id = p_batch_id;
  delete from public.correction_requests c
   using public.attendance_events e
   where c.target_event_id = e.id and e.import_batch_id = p_batch_id;
  delete from public.attendance_events where import_batch_id = p_batch_id;
  get diagnostics v_deleted = row_count;
  delete from public.import_batches where id = p_batch_id;

  return jsonb_build_object(
    'deleted', v_deleted,
    'employee_ids', to_jsonb(v_employees),
    'period_start', v_batch.period_start,
    'period_end', v_batch.period_end
  );
end;
$$;

revoke execute on function public.delete_import_batch(uuid, text) from public, anon;
grant execute on function public.delete_import_batch(uuid, text) to authenticated;
