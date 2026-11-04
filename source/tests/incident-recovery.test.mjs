import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearAllIncidentRecoveries, clearIncidentRecovery, readIncidentRecovery, storeIncidentRecovery } from '../src/incident-recovery.ts';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(String(key), String(value)); },
  removeItem(key) { values.delete(String(key)); },
  key(index) { return [...values.keys()][index] ?? null; },
};
function incident(overrides = {}) { return { id: 'incident-1', revision: 3, titleOverride: 'Server', progress: [], ...overrides }; }
beforeEach(() => values.clear());

test('restores a local draft based on the same server revision', () => {
  const server = incident(), local = incident({ titleOverride: 'Local unsaved edit' });
  storeIncidentRecovery(local, 'workspace-a', 'user-a');
  assert.deepEqual(readIncidentRecovery(server, 'workspace-a', 'user-a'), local);
});
test('preserves a stale local draft for explicit revision conflict resolution', () => {
  const server = incident({ revision: 5, titleOverride: 'Remote edit' });
  const local = incident({ revision: 4, titleOverride: 'Offline local edit' });
  storeIncidentRecovery(local, 'workspace-a', 'user-a');
  assert.deepEqual(readIncidentRecovery(server, 'workspace-a', 'user-a'), local);
});
test('discards recovery records from a future revision', () => {
  storeIncidentRecovery(incident({ revision: 6 }), 'workspace-a', 'user-a');
  assert.equal(readIncidentRecovery(incident({ revision: 5 }), 'workspace-a', 'user-a'), null);
  assert.equal(values.size, 0);
});
test('isolates recovery records by workspace and user', () => {
  storeIncidentRecovery(incident({ titleOverride: 'Private local edit' }), 'workspace-a', 'user-a');
  assert.equal(readIncidentRecovery(incident(), 'workspace-b', 'user-a'), null);
  assert.equal(readIncidentRecovery(incident(), 'workspace-a', 'user-b'), null);
});
test('removes expired recovery records', () => {
  const key = 'noc-recovery:v2:workspace-a:user-a:incident-1';
  values.set(key, JSON.stringify({ version: 2, savedAt: Date.now() - 25 * 60 * 60 * 1000, workspaceId: 'workspace-a', userId: 'user-a', incident: incident() }));
  assert.equal(readIncidentRecovery(incident(), 'workspace-a', 'user-a'), null);
  assert.equal(values.has(key), false);
});
test('clears only the requested incident recovery record', () => {
  storeIncidentRecovery(incident(), 'workspace-a', 'user-a');
  storeIncidentRecovery(incident({ id: 'incident-2' }), 'workspace-a', 'user-a');
  clearIncidentRecovery('workspace-a', 'user-a', 'incident-1');
  assert.equal(readIncidentRecovery(incident(), 'workspace-a', 'user-a'), null);
  assert.ok(values.size > 0);
});
test('clears versioned and legacy recovery records on logout', () => {
  storeIncidentRecovery(incident(), 'workspace-a', 'user-a');
  values.set('noc-recovery:legacy-id', JSON.stringify(incident({ id: 'legacy-id' })));
  clearAllIncidentRecoveries();
  assert.equal(values.size, 0);
});
