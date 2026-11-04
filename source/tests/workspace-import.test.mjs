import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWorkspaceImport } from '../src/workspace-import.ts';
import { WORKSPACE_BACKUP_FORMAT } from '../src/workspace-backup.ts';

function fixture() {
  return {
    format: WORKSPACE_BACKUP_FORMAT,
    schemaVersion: 1,
    exportedAt: '2026-11-05T10:00:00.000Z',
    workspaceId: 'workspace-1',
    data: {
      settings: { slaCriticalMinutes: 30 },
      members: [{ id: 'member-1', role: 'admin' }],
      incidents: [{ id: 'incident-1', progress: [{ id: 'p1' }] }],
      routeMaster: [{ systemKey: 'SYS-1', routeSegment: 'SEG-A' }],
      history: [{ incidentId: 'incident-1', audit: [], versions: [] }],
    },
  };
}

const context = {
  workspaceId: 'workspace-1',
  existingMemberIds: ['member-existing'],
  existingIncidentIds: ['incident-existing'],
};

test('accepts a compatible backup as eligible for a future gated import', () => {
  const result = analyzeWorkspaceImport(fixture(), context);
  assert.equal(result.valid, true);
  assert.equal(result.eligibleForFutureImport, true);
  assert.ok(result.warnings.some((item) => item.includes('Dry-run only')));
});

test('rejects cross-workspace backup bundles', () => {
  const bundle = fixture();
  bundle.workspaceId = 'workspace-other';
  const result = analyzeWorkspaceImport(bundle, context);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.includes('different workspace')));
});

test('reports existing member and incident ID collisions', () => {
  const bundle = fixture();
  bundle.data.members.push({ id: 'member-existing' });
  bundle.data.incidents.push({ id: 'incident-existing' });
  const result = analyzeWorkspaceImport(bundle, context);
  assert.deepEqual(result.conflicts.memberIds, ['member-existing']);
  assert.deepEqual(result.conflicts.incidentIds, ['incident-existing']);
  assert.equal(result.eligibleForFutureImport, false);
});

test('rejects invalid schema and malformed backup data', () => {
  const bundle = fixture();
  bundle.schemaVersion = 7;
  const result = analyzeWorkspaceImport(bundle, context);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.includes('schema version')));
});

test('does not approve when current workspace context is missing', () => {
  const result = analyzeWorkspaceImport(fixture(), {
    workspaceId: '',
    existingMemberIds: [],
    existingIncidentIds: [],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.includes('Current workspace ID')));
});

test('handles non-object input without throwing', () => {
  const result = analyzeWorkspaceImport('not-json-object', context);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});
