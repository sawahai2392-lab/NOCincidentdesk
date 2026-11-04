import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceBackupBundle,
  validateWorkspaceBackupBundle,
  WORKSPACE_BACKUP_FORMAT,
} from '../src/workspace-backup.ts';

function fixture() {
  return {
    format: WORKSPACE_BACKUP_FORMAT,
    schemaVersion: 1,
    exportedAt: '2026-11-05T10:00:00.000Z',
    workspaceId: 'workspace-1',
    data: {
      settings: { slaCriticalMinutes: 30 },
      members: [{ id: 'user-1', role: 'admin' }],
      incidents: [{ id: 'incident-1', progress: [{ id: 'p1' }] }],
      routeMaster: [{ systemKey: 'SYS-1', routeSegment: 'SEG-A' }],
      history: [{ incidentId: 'incident-1', audit: [{ id: 'a1' }], versions: [{ id: 'v1' }] }],
    },
  };
}

test('creates a versioned workspace backup bundle and clones its data', () => {
  const data = fixture().data;
  const bundle = createWorkspaceBackupBundle('workspace-1', data, '2026-11-05T10:00:00.000Z');
  assert.equal(bundle.format, WORKSPACE_BACKUP_FORMAT);
  assert.equal(bundle.schemaVersion, 1);
  assert.notEqual(bundle.data, data);
  assert.equal(validateWorkspaceBackupBundle(bundle).valid, true);
});

test('reports record counts for a valid dry-run', () => {
  const result = validateWorkspaceBackupBundle(fixture());
  assert.equal(result.valid, true);
  assert.deepEqual(result.counts, {
    members: 1,
    incidents: 1,
    progressEvents: 1,
    auditEntries: 1,
    versions: 1,
    routeMasterPairs: 1,
  });
  assert.ok(result.serializedBytes > 0);
});

test('rejects an unsupported format or schema version', () => {
  const bundle = fixture();
  bundle.schemaVersion = 99;
  assert.equal(validateWorkspaceBackupBundle(bundle).valid, false);
  assert.ok(validateWorkspaceBackupBundle(bundle).errors.some((item) => item.includes('schema version')));
});

test('rejects duplicate member and incident IDs', () => {
  const bundle = fixture();
  bundle.data.members.push({ id: 'user-1' });
  bundle.data.incidents.push({ id: 'incident-1' });
  const result = validateWorkspaceBackupBundle(bundle);
  assert.ok(result.errors.some((item) => item.includes('Member IDs')));
  assert.ok(result.errors.some((item) => item.includes('Incident IDs')));
});

test('rejects orphaned or duplicate history references', () => {
  const bundle = fixture();
  bundle.data.history = [
    { incidentId: 'missing-incident', audit: [], versions: [] },
    { incidentId: 'missing-incident', audit: [], versions: [] },
  ];
  const result = validateWorkspaceBackupBundle(bundle);
  assert.ok(result.errors.some((item) => item.includes('not in this backup')));
  assert.ok(result.errors.some((item) => item.includes('unique per incident')));
});

test('rejects malformed and duplicate route-master mappings', () => {
  const bundle = fixture();
  bundle.data.routeMaster.push({ systemKey: 'SYS-1', routeSegment: 'SEG-A' });
  const result = validateWorkspaceBackupBundle(bundle);
  assert.ok(result.errors.some((item) => item.includes('duplicate mapping')));
});

test('rejects missing required arrays and invalid export timestamps', () => {
  const bundle = fixture();
  bundle.exportedAt = 'not-a-date';
  bundle.data.history = null;
  const result = validateWorkspaceBackupBundle(bundle);
  assert.ok(result.errors.some((item) => item.includes('Export timestamp')));
  assert.ok(result.errors.some((item) => item.includes('history')));
});

test('does not mutate Firestore or accept a non-object backup root', () => {
  assert.equal(validateWorkspaceBackupBundle(null).valid, false);
  assert.throws(() => createWorkspaceBackupBundle('', fixture().data));
});
