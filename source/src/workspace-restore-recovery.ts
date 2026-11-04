export const STALE_ROUTE_MASTER_BATCH_MS = 24 * 60 * 60 * 1000;
export const STALE_RESTORE_OPERATION_MS = 60 * 60 * 1000;

export type RestoreOperationStatus = 'running' | 'completed' | 'failed' | 'partial' | 'needs-review';
export type RestoreOperationKind = 'selective-restore' | 'reactivate-route-master' | 'cleanup-stale-route-master';

export interface RouteMasterRecoveryBatch {
  id: string;
  status: string;
  count: number;
  createdAt: number;
  lastActivityAt: number;
  committedAt?: number;
  sourceFileName?: string;
  sourceSheetName?: string;
}

export interface RestoreOperationRecord {
  id: string;
  kind: RestoreOperationKind;
  status: RestoreOperationStatus;
  createdAt: number;
  updatedAt?: number;
  finishedAt?: number;
  sourceFileName?: string;
  selectedSections?: string[];
  message?: string;
  errors?: string[];
  warnings?: string[];
}

export function isStaleRouteMasterStagingBatch(
  batch: RouteMasterRecoveryBatch,
  now: number,
  activeBatchId: string | null,
): boolean {
  if (batch.status !== 'staging' || !batch.id || batch.id === activeBatchId) return false;
  const lastActivityAt = Number(batch.lastActivityAt || batch.createdAt) || 0;
  return lastActivityAt > 0 && now - lastActivityAt >= STALE_ROUTE_MASTER_BATCH_MS;
}

export function canReactivateRouteMasterBatch(
  batch: RouteMasterRecoveryBatch,
  activeBatchId: string | null,
): boolean {
  return batch.status === 'committed'
    && Boolean(batch.id)
    && batch.id !== activeBatchId
    && Number.isInteger(batch.count)
    && batch.count > 0
    && batch.count <= 20000;
}

export function isRestoreOperationStale(
  operation: RestoreOperationRecord,
  now: number,
): boolean {
  if (operation.status !== 'running') return false;
  const lastUpdate = Number(operation.updatedAt || operation.createdAt) || 0;
  return lastUpdate > 0 && now - lastUpdate >= STALE_RESTORE_OPERATION_MS;
}

export function getRestoreOperationDisplayStatus(
  operation: RestoreOperationRecord,
  now: number,
): RestoreOperationStatus {
  return isRestoreOperationStale(operation, now) ? 'needs-review' : operation.status;
}

export function restoreOperationStatusLabel(status: RestoreOperationStatus): string {
  switch (status) {
    case 'running': return 'Sedang berjalan';
    case 'completed': return 'Selesai';
    case 'failed': return 'Gagal';
    case 'partial': return 'Parsial';
    case 'needs-review': return 'Perlu pemeriksaan';
  }
}

export function canCleanupStaleRouteMasterBatch(
  batch: RouteMasterRecoveryBatch & { stale?: boolean; cleanupSupported?: boolean },
  activeBatchId: string | null,
): boolean {
  return batch.status === 'staging'
    && batch.id !== activeBatchId
    && batch.stale === true
    && batch.cleanupSupported !== false;
}
