import test from 'node:test';
import assert from 'node:assert/strict';
import { planSelectiveWorkspaceRestore } from '../src/workspace-restore-plan.ts';

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

const bundle = { data: { settings: { slaCriticalMinutes: 30 }, routeMaster: [{ systemKey: 'SK-1', routeSegment: 'SEG-1' }] } };

test('plans only selected admin-writable sections', () => {
  const plan = planSelectiveWorkspaceRestore(bundle, preflight, { settings: true, routeMaster: true }, 'admin');
  assert.equal(plan.executable, true);
  assert.deepEqual(plan.selected, ['settings', 'routeMaster']);
  assert.deepEqual(plan.skipped, ['members', 'incidents', 'history']);
  assert.equal(plan.counts.settings, 1);
  assert.equal(plan.counts.routeMasterPairs, 1);
});

test('rejects non-admin execution', () => {
  const plan = planSelectiveWorkspaceRestore(bundle, preflight, { settings: true, routeMaster: false }, 'operator');
  assert.equal(plan.executable, false);
  assert.match(plan.errors.join(' '), /Admin/);
});

test('rejects failed preflight', () => {
  const plan = planSelectiveWorkspaceRestore(bundle, { ...preflight, valid: false }, { settings: true, routeMaster: false }, 'admin');
  assert.equal(plan.executable, false);
  assert.match(plan.errors.join(' '), /preflight/);
});

test('rejects empty Route Master batch', () => {
  const plan = planSelectiveWorkspaceRestore({ data: { settings: {}, routeMaster: [] } }, preflight, { settings: false, routeMaster: true }, 'admin');
  assert.equal(plan.executable, false);
  assert.match(plan.errors.join(' '), /at least one valid mapping/);
});

test('requires at least one supported section', () => {
  const plan = planSelectiveWorkspaceRestore(bundle, preflight, { settings: false, routeMaster: false }, 'admin');
  assert.equal(plan.executable, false);
  assert.match(plan.errors.join(' '), /Select at least one/);
});

test('never schedules member, incident, or history restoration', () => {
  const plan = planSelectiveWorkspaceRestore(bundle, preflight, { settings: true, routeMaster: false }, 'admin');
  assert.deepEqual(plan.skipped, ['members', 'incidents', 'history']);
  assert.equal(plan.counts.routeMasterPairs, 0);
});
