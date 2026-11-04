import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSelectiveWorkspaceRestore } from '../src/workspace-restore-execution.ts';
import { fingerprintRouteMaster } from '../src/route-master-integrity.ts';

const preflight = {
  valid: true,
  restorePolicy: {
    items: [
      { key: 'settings', capability: 'admin-writable' },
      { key: 'routeMaster', capability: 'admin-writable' },
      { key: 'members', capability: 'blocked' },
      { key: 'incidents', capability: 'trusted-migration-required' },
      { key: 'history', capability: 'blocked' },
    ],
  },
};
const settings = {
  groups: ['NOC'],
  picAreas: ['Jakarta'],
  picNames: ['Operator'],
  rootCauses: ['FO Cut'],
  actions: ['Splicing'],
  progressPhrases: ['Team OTW'],
  sites: ['SITE-A'],
  slaCriticalMinutes: 15,
  slaMajorMinutes: 30,
  slaMinorMinutes: 60,
  staleUpdateMinutes: 45,
};
const previousSettings = {
  ...settings,
  groups: ['OLD'],
};
const routeMaster = Array.from({ length: 401 }, (_, index) => ({
  systemKey: `SK-${index + 1}`,
  routeSegment: `SEG-${index + 1}`,
}));
const bundle = { data: { settings, routeMaster } };

function createDependencies(overrides = {}) {
  const calls = [];
  const active = { items: [], meta: { currentBatchId: 'old-batch' } };
  const dependencies = {
    async saveSettings(value, expectedUpdatedAt) { calls.push(['saveSettings', value.groups[0], expectedUpdatedAt]); return { updatedAt: 200 }; },
    async startRouteMasterImport() { calls.push(['start']); return 'staged-batch'; },
    async addRouteMasterChunk(batchId, index, items) { calls.push(['chunk', batchId, index, items.length]); },
    async verifyStagedRouteMaster(batchId, count, fingerprint) {
      calls.push(['verify', batchId, count, fingerprint]);
      return { verifiedCount: count };
    },
    async commitRouteMaster(batchId, metadata) {
      calls.push(['commit', batchId, metadata.totalCount, metadata.expectedCurrentBatchId, metadata.expectedFingerprint]);
      active.items = routeMaster;
      active.meta = { currentBatchId: batchId };
    },
    async readActiveRouteMaster() { calls.push(['read-active']); return active; },
    onProgress(progress) { calls.push(['progress', progress.stage]); },
    ...overrides,
  };
  return { dependencies, calls, active };
}

function input(overrides = {}) {
  return {
    bundle,
    preflight,
    selection: { settings: true, routeMaster: true },
    role: 'admin',
    confirmed: true,
    currentSettings: { ...previousSettings, updatedAt: 100 },
    sourceFileName: 'backup.json',
    ...overrides,
  };
}

test('rejects Workspace Settings that exceed the safe Firestore document budget', async () => {
  const { dependencies, calls } = createDependencies();
  const oversized = { ...settings, groups: ['x'.repeat(950 * 1024)] };
  const result = await executeSelectiveWorkspaceRestore(
    input({ bundle: { data: { settings: oversized, routeMaster: [] } }, selection: { settings: true, routeMaster: false } }),
    dependencies,
  );
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join(' '), /schema/i);
  assert.equal(calls.some(call => call[0] === 'saveSettings'), false);
});

test('does not write anything before explicit confirmation', async () => {
  const { dependencies, calls } = createDependencies();
  const result = await executeSelectiveWorkspaceRestore(input({ confirmed: false }), dependencies);

  assert.equal(result.status, 'failed');
  assert.match(result.errors.join(' '), /konfirmasi/i);
  assert.equal(calls.some(call => ['start', 'saveSettings', 'commit'].includes(call[0])), false);
});

test('rejects non-admin and failed preflight before writes', async () => {
  for (const overrides of [{ role: 'operator' }, { preflight: { ...preflight, valid: false } }]) {
    const { dependencies, calls } = createDependencies();
    const result = await executeSelectiveWorkspaceRestore(input(overrides), dependencies);
    assert.equal(result.status, 'failed');
    assert.equal(calls.some(call => ['start', 'saveSettings', 'commit'].includes(call[0])), false);
  }
});

test('rejects invalid settings and invalid current snapshot before writes', async () => {
  const { dependencies, calls } = createDependencies();
  const invalidBundle = { data: { settings: { ...settings, groups: [1] }, routeMaster } };
  const result = await executeSelectiveWorkspaceRestore(input({ bundle: invalidBundle }), dependencies);
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join(' '), /schema/i);
  assert.equal(calls.some(call => ['start', 'chunk', 'saveSettings', 'commit'].includes(call[0])), false);

  const invalidCurrent = await executeSelectiveWorkspaceRestore(input({ currentSettings: { groups: [] } }), dependencies);
  assert.equal(invalidCurrent.status, 'failed');
  assert.match(invalidCurrent.errors.join(' '), /snapshot/i);
  assert.equal(calls.some(call => ['start', 'chunk', 'saveSettings', 'commit'].includes(call[0])), false);
});

test('stages chunks, verifies them, writes settings, and commits last', async () => {
  const { dependencies, calls } = createDependencies();
  const result = await executeSelectiveWorkspaceRestore(input(), dependencies);
  const names = calls.map(call => call[0]);

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.completedSections, ['settings', 'routeMaster']);
  assert.deepEqual(calls.filter(call => call[0] === 'chunk').map(call => call.slice(2)), [[0, 400], [1, 1]]);
  assert.ok(names.indexOf('verify') < names.indexOf('saveSettings'));
  assert.ok(names.indexOf('saveSettings') < names.indexOf('commit'));
  assert.equal(calls.find(call => call[0] === 'verify')[3], fingerprintRouteMaster(routeMaster));
  assert.equal(calls.find(call => call[0] === 'commit')[3], 'old-batch');
  assert.equal(calls.find(call => call[0] === 'commit')[4], fingerprintRouteMaster(routeMaster));
  assert.equal(calls.filter(call => call[0] === 'saveSettings')[0][2], 100);
});

test('does not commit when staged data verification fails', async () => {
  const state = createDependencies();
  state.dependencies.verifyStagedRouteMaster = async () => {
    state.calls.push(['verify-failed']);
    throw new Error('fingerprint mismatch');
  };
  const result = await executeSelectiveWorkspaceRestore(input({ selection: { settings: false, routeMaster: true } }), state.dependencies);

  assert.equal(result.status, 'failed');
  assert.match(result.errors.join(' '), /fingerprint mismatch/);
  assert.equal(state.calls.some(call => call[0] === 'commit'), false);
  assert.equal(state.calls.some(call => call[0] === 'saveSettings'), false);
});

test('restores the previous settings when Route Master commit fails and old batch remains active', async () => {
  const state = createDependencies();
  state.dependencies.commitRouteMaster = async () => {
    state.calls.push(['commit-failed']);
    throw new Error('commit rejected');
  };
  state.dependencies.readActiveRouteMaster = async () => {
    state.calls.push(['read-active']);
    state.active.meta = { currentBatchId: 'old-batch' };
    state.active.items = [];
    return state.active;
  };
  const result = await executeSelectiveWorkspaceRestore(input(), state.dependencies);

  assert.equal(result.status, 'failed');
  assert.equal(result.settingsRolledBack, true);
  assert.equal(result.partial, false);
  assert.deepEqual(state.calls.filter(call => call[0] === 'saveSettings').map(call => call[1]), ['NOC', 'OLD']);
});

test('reports uncertain commit outcome without rolling back settings blindly', async () => {
  const state = createDependencies();
  let reads = 0;
  state.dependencies.commitRouteMaster = async () => {
    state.calls.push(['commit-failed']);
    throw new Error('network lost');
  };
  state.dependencies.readActiveRouteMaster = async () => {
    reads += 1;
    state.calls.push(['read-active', reads]);
    if (reads > 1) throw new Error('offline');
    return state.active;
  };
  const result = await executeSelectiveWorkspaceRestore(input(), state.dependencies);

  assert.equal(result.status, 'needs-review');
  assert.equal(result.partial, true);
  assert.equal(state.calls.some(call => call[0] === 'saveSettings'), true);
  assert.equal(state.calls.filter(call => call[0] === 'saveSettings').length, 1);
});

test('reports partial state when compensating settings write fails', async () => {
  const state = createDependencies();
  state.dependencies.commitRouteMaster = async () => {
    state.calls.push(['commit-failed']);
    throw new Error('commit rejected');
  };
  state.dependencies.readActiveRouteMaster = async () => {
    state.calls.push(['read-active']);
    return state.active;
  };
  state.dependencies.saveSettings = async (value, expectedUpdatedAt) => {
    state.calls.push(['saveSettings', value.groups[0], expectedUpdatedAt]);
    if (value.groups[0] === 'OLD') throw new Error('rollback denied');
    return { updatedAt: 200 };
  };
  const result = await executeSelectiveWorkspaceRestore(input(), state.dependencies);

  assert.equal(result.status, 'partial');
  assert.equal(result.partial, true);
  assert.match(result.errors.join(' '), /rollback denied/i);
});


test('rolls back Settings if another Admin switches the active Route Master during staging', async () => {
  const state = createDependencies();
  state.dependencies.commitRouteMaster = async (_batchId, metadata) => {
    state.calls.push(['commit-conflict', metadata.expectedCurrentBatchId]);
    state.active.meta = { currentBatchId: 'concurrent-batch' };
    throw new Error('Route Master aktif berubah selama restore berlangsung.');
  };
  const result = await executeSelectiveWorkspaceRestore(input(), state.dependencies);

  assert.equal(result.status, 'failed');
  assert.equal(result.settingsRolledBack, true);
  assert.deepEqual(state.calls.filter(call => call[0] === 'saveSettings').map(call => call[1]), ['NOC', 'OLD']);
});

test('settings-only restore never starts or commits Route Master', async () => {
  const { dependencies, calls } = createDependencies();
  const result = await executeSelectiveWorkspaceRestore(
    input({ selection: { settings: true, routeMaster: false } }),
    dependencies,
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.completedSections, ['settings']);
  assert.equal(calls.some(call => ['start', 'chunk', 'commit'].includes(call[0])), false);
});

test('route-master-only restore never overwrites workspace settings', async () => {
  const { dependencies, calls } = createDependencies();
  const result = await executeSelectiveWorkspaceRestore(
    input({ selection: { settings: false, routeMaster: true } }),
    dependencies,
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.completedSections, ['routeMaster']);
  assert.equal(calls.some(call => call[0] === 'saveSettings'), false);
});
