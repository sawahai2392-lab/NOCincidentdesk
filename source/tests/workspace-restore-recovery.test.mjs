import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canCleanupStaleRouteMasterBatch,
  canReactivateRouteMasterBatch,
  getRestoreOperationDisplayStatus,
  isRestoreOperationStale,
  isStaleRouteMasterStagingBatch,
  restoreOperationStatusLabel,
  STALE_RESTORE_OPERATION_MS,
  STALE_ROUTE_MASTER_BATCH_MS,
} from '../src/workspace-restore-recovery.ts';

const now = 1_800_000_000_000;

test('only inactive staging batches idle for at least 24 hours are cleanup candidates', () => {
  const base = {
    id: 'batch-staging',
    status: 'staging',
    count: 0,
    createdAt: now - STALE_ROUTE_MASTER_BATCH_MS - 1000,
    lastActivityAt: now - STALE_ROUTE_MASTER_BATCH_MS - 1000,
  };
  assert.equal(isStaleRouteMasterStagingBatch(base, now, 'active-batch'), true);
  assert.equal(isStaleRouteMasterStagingBatch({ ...base, lastActivityAt: now - 1000 }, now, 'active-batch'), false);
  assert.equal(isStaleRouteMasterStagingBatch(base, now, base.id), false);
  assert.equal(isStaleRouteMasterStagingBatch({ ...base, status: 'committed' }, now, 'active-batch'), false);
});

test('uses createdAt for older staging batches without lastActivityAt', () => {
  const candidate = {
    id: 'legacy-stage',
    status: 'staging',
    count: 0,
    createdAt: now - STALE_ROUTE_MASTER_BATCH_MS,
    lastActivityAt: 0,
  };
  assert.equal(isStaleRouteMasterStagingBatch(candidate, now, null), true);
});

test('keeps recent staging batches out of cleanup even when their creation date is old', () => {
  const candidate = {
    id: 'active-upload',
    status: 'staging',
    count: 0,
    createdAt: now - STALE_ROUTE_MASTER_BATCH_MS * 2,
    lastActivityAt: now - 5 * 60 * 1000,
  };
  assert.equal(isStaleRouteMasterStagingBatch(candidate, now, null), false);
});

test('reactivation is limited to a different committed batch with a valid mapping count', () => {
  const batch = { id: 'old-batch', status: 'committed', count: 401, createdAt: 1, lastActivityAt: 1 };
  assert.equal(canReactivateRouteMasterBatch(batch, 'current-batch'), true);
  assert.equal(canReactivateRouteMasterBatch(batch, 'old-batch'), false);
  assert.equal(canReactivateRouteMasterBatch({ ...batch, status: 'staging' }, 'current-batch'), false);
  assert.equal(canReactivateRouteMasterBatch({ ...batch, count: 0 }, 'current-batch'), false);
  assert.equal(canReactivateRouteMasterBatch({ ...batch, count: 20001 }, 'current-batch'), false);
});

test('marks running restore operations stale after one hour without mutating stored status', () => {
  const record = {
    id: 'restore-1',
    kind: 'selective-restore',
    status: 'running',
    createdAt: now - STALE_RESTORE_OPERATION_MS - 1,
    updatedAt: now - STALE_RESTORE_OPERATION_MS - 1,
  };
  assert.equal(isRestoreOperationStale(record, now), true);
  assert.equal(getRestoreOperationDisplayStatus(record, now), 'needs-review');
  assert.equal(record.status, 'running');
});

test('recent, completed, and failed restore operations keep their persisted status', () => {
  const recent = { id: 'restore-2', kind: 'selective-restore', status: 'running', createdAt: now - 1000 };
  const completed = { ...recent, status: 'completed', createdAt: now - STALE_RESTORE_OPERATION_MS * 2 };
  const failed = { ...recent, status: 'failed', createdAt: now - STALE_RESTORE_OPERATION_MS * 2 };
  assert.equal(getRestoreOperationDisplayStatus(recent, now), 'running');
  assert.equal(getRestoreOperationDisplayStatus(completed, now), 'completed');
  assert.equal(getRestoreOperationDisplayStatus(failed, now), 'failed');
});

test('operation labels cover every persisted status', () => {
  assert.equal(restoreOperationStatusLabel('running'), 'Sedang berjalan');
  assert.equal(restoreOperationStatusLabel('completed'), 'Selesai');
  assert.equal(restoreOperationStatusLabel('failed'), 'Gagal');
  assert.equal(restoreOperationStatusLabel('partial'), 'Parsial');
  assert.equal(restoreOperationStatusLabel('needs-review'), 'Perlu pemeriksaan');
});

test('only stale, inactive staging batches within the automated chunk cap can be cleaned', () => {
  const base = {
    id: 'stale-batch',
    status: 'staging',
    count: 0,
    createdAt: now - STALE_ROUTE_MASTER_BATCH_MS - 1,
    lastActivityAt: now - STALE_ROUTE_MASTER_BATCH_MS - 1,
    stale: true,
    cleanupSupported: true,
  };
  assert.equal(canCleanupStaleRouteMasterBatch(base, 'active-batch'), true);
  assert.equal(canCleanupStaleRouteMasterBatch({ ...base, cleanupSupported: false }, 'active-batch'), false);
  assert.equal(canCleanupStaleRouteMasterBatch({ ...base, stale: false }, 'active-batch'), false);
  assert.equal(canCleanupStaleRouteMasterBatch(base, base.id), false);
  assert.equal(canCleanupStaleRouteMasterBatch({ ...base, status: 'committed' }, 'active-batch'), false);
});
