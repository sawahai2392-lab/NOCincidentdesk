import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceIntegrityReport,
  formatIntegrityStatus,
} from '../src/workspace-integrity.ts';
import { fingerprintRouteMaster } from '../src/route-master-integrity.ts';

const pairs = [{ systemKey: 'SYS-1', routeSegment: 'SEG-1' }];
const fingerprint = fingerprintRouteMaster(pairs);

function createSnapshot(overrides = {}) {
  const base = {
    workspaceId: 'workspace-a',
    workspace: {
      exists: true,
      data: { id: 'workspace-a', ownerUid: 'admin-a' },
    },
    members: [
      { id: 'admin-a', data: { userId: 'admin-a', workspaceId: 'workspace-a', role: 'admin', status: 'active' } },
      { id: 'admin-b', data: { userId: 'admin-b', workspaceId: 'workspace-a', role: 'admin', status: 'active' } },
    ],
    membersTruncated: false,
    settings: { exists: true, data: { updatedAt: 10 } },
    incidents: [
      {
        id: 'incident-a',
        data: {
          id: 'incident-a',
          incidentId: 'TT-001',
          normalizedIncidentId: 'tt001',
          deletedAt: 0,
          revision: 1,
          createdAt: 1,
          updatedAt: 2,
        },
      },
    ],
    incidentsTruncated: false,
    incidentKeys: [
      { id: 'tt001', data: { incidentId: 'incident-a', normalizedKey: 'tt001', active: true } },
    ],
    incidentKeysTruncated: false,
    history: [
      {
        incidentId: 'incident-a',
        audit: [
          { id: 'audit-1', data: { action: 'created', fromRevision: 0, toRevision: 1, actorId: 'admin-a', createdAt: 2 } },
        ],
        versions: [],
        auditTruncated: false,
        versionsTruncated: false,
      },
    ],
    routeMaster: {
      meta: { currentBatchId: 'batch-1', count: 1 },
      batch: { id: 'batch-1', data: { status: 'committed', count: 1, fingerprint } },
      chunks: [{ id: '0000', data: { chunkIndex: 0, items: pairs } }],
      chunksTruncated: false,
    },
    restoreOperations: [],
    restoreOperationsTruncated: false,
  };
  return {
    ...base,
    ...overrides,
    routeMaster: { ...base.routeMaster, ...(overrides.routeMaster || {}) },
  };
}

test('healthy workspace passes integrity checks with bounded complete coverage', () => {
  const report = buildWorkspaceIntegrityReport(createSnapshot(), 1000);
  assert.equal(report.status, 'healthy');
  assert.equal(report.counts.critical, 0);
  assert.equal(report.counts.warning, 0);
  assert.equal(report.coverage.partial, false);
  assert.equal(formatIntegrityStatus(report.status), 'Sehat');
});

test('missing incident key produces a deterministic create repair candidate', () => {
  const snapshot = createSnapshot({ incidentKeys: [] });
  const report = buildWorkspaceIntegrityReport(snapshot, 1000);
  const finding = report.findings.find((item) => item.id === 'incident-key:missing:incident-a');
  assert.equal(finding?.severity, 'critical');
  assert.deepEqual(finding?.repair, {
    id: 'create-incident-key:incident-a',
    kind: 'create-incident-key',
    incidentId: 'incident-a',
    normalizedKey: 'tt001',
  });
});

test('orphan key pointing to a missing incident produces a guarded delete candidate', () => {
  const snapshot = createSnapshot({
    incidents: [],
    history: [],
    incidentKeys: [
      { id: 'orphan-key', data: { incidentId: 'missing-incident', normalizedKey: 'oldkey', active: true } },
    ],
  });
  const report = buildWorkspaceIntegrityReport(snapshot, 1000);
  const finding = report.findings.find((item) => item.id === 'incident-key:orphan:orphan-key');
  assert.equal(finding?.severity, 'warning');
  assert.equal(finding?.repair?.kind, 'delete-orphan-incident-key');
});

test('scanner does not propose missing-key repair when key collection coverage is partial', () => {
  const report = buildWorkspaceIntegrityReport(createSnapshot({
    incidentKeys: [],
    incidentKeysTruncated: true,
  }), 1000);
  assert.equal(report.repairs.some((item) => item.kind === 'create-incident-key'), false);
  assert.equal(report.coverage.partial, true);
  assert.equal(report.status, 'warning');
});

test('active Route Master pointer with invalid batch state is critical', () => {
  const report = buildWorkspaceIntegrityReport(createSnapshot({
    routeMaster: {
      batch: { id: 'batch-1', data: { status: 'staging', count: 2, fingerprint } },
      chunks: [{ id: '0000', data: { chunkIndex: 0, items: pairs } }],
      meta: { currentBatchId: 'batch-1', count: 1 },
    },
  }), 1000);
  assert.equal(report.status, 'critical');
  assert.ok(report.findings.some((item) => item.id === 'route-master:active-batch-status'));
  assert.ok(report.findings.some((item) => item.id === 'route-master:chunk-integrity'));
});

test('version documents must link to a matching immutable snapshot audit', () => {
  const report = buildWorkspaceIntegrityReport(createSnapshot({
    history: [{
      incidentId: 'incident-a',
      audit: [
        { id: 'audit-1', data: { action: 'snapshot_created', fromRevision: 1, toRevision: 1, versionId: 'version-1', actorId: 'admin-a', createdAt: 3 } },
      ],
      versions: [
        { id: 'version-1', data: { id: 'version-1', incident: { id: 'other-incident' }, revision: 1, auditId: 'missing-audit', createdBy: 'admin-a' } },
      ],
      auditTruncated: false,
      versionsTruncated: false,
    }],
  }), 1000);
  assert.ok(report.findings.some((item) => item.id === 'version:shape:incident-a:version-1'));
  assert.ok(report.findings.some((item) => item.id === 'version:audit-link:incident-a:version-1'));
});

test('stale restore operations are flagged without changing their persisted state', () => {
  const snapshot = createSnapshot({
    restoreOperations: [
      { id: 'restore-1', data: { status: 'running', createdAt: 1, updatedAt: 1 } },
    ],
  });
  const report = buildWorkspaceIntegrityReport(snapshot, 60 * 60 * 1000 + 2);
  assert.ok(report.findings.some((item) => item.id === 'restore-operation:stale:restore-1'));
  assert.equal(snapshot.restoreOperations[0].data.status, 'running');
});

test('single active Admin and truncated history are warnings, not automatic repairs', () => {
  const snapshot = createSnapshot({
    members: [
      { id: 'admin-a', data: { userId: 'admin-a', workspaceId: 'workspace-a', role: 'admin', status: 'active' } },
    ],
    history: [],
  });
  const report = buildWorkspaceIntegrityReport(snapshot, 1000);
  assert.ok(report.findings.some((item) => item.id === 'members:single-admin'));
  assert.ok(report.findings.some((item) => item.id === 'coverage:partial'));
  assert.equal(report.repairs.length, 0);
});

test('does not classify unseen incident-key targets as orphan when incident scan is partial', () => {
  const snapshot = createSnapshot({
    incidents: [],
    incidentsTruncated: true,
    history: [],
    incidentKeys: [
      { id: 'tt001', data: { incidentId: 'incident-outside-page', normalizedKey: 'tt001', active: true } },
    ],
  });
  const report = buildWorkspaceIntegrityReport(snapshot, 1000);
  assert.equal(report.findings.some((item) => item.id === 'incident-key:orphan:tt001'), false);
  assert.equal(report.repairs.some((item) => item.kind === 'delete-orphan-incident-key'), false);
  assert.equal(report.coverage.partial, true);
});
