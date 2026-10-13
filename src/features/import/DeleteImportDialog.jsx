import { ConfirmDialog } from '@/components/ui/Dialog';
import { deleteImportBatch } from './importService';

/** Confirms deleting one import's punches; target = { id, fileName }. */
export function DeleteImportDialog({ target, onClose, onDeleted }) {
  return (
    <ConfirmDialog
      open={Boolean(target)}
      onClose={onClose}
      title="Delete imported data"
      confirmLabel="Delete imported data"
      tone="danger"
      requireReason
      minReason={5}
      onConfirm={async (reason) => onDeleted(await deleteImportBatch(target.id, reason))}
    >
      <p>
        All punches saved from <strong>{target?.fileName}</strong> are deleted and the DTRs of those staff are recomputed for the file&apos;s period.
        Times entered manually are kept. Use this when the wrong file was imported; the deletion is recorded in the audit log.
      </p>
    </ConfirmDialog>
  );
}
