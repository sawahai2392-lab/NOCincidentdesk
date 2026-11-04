import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRealtimeDraftUpdate, shouldApplyRemoteListUpdate } from '../src/realtime-sync.ts';
function incident(overrides = {}) { return { id: 'incident-1', revision: 2, titleOverride: 'Baseline', ...overrides }; }

test('ignores unrelated realtime events and events during an in-flight save', () => {
  const current = incident({ titleOverride: 'Local edit' }), baseline = JSON.stringify(incident());
  assert.equal(decideRealtimeDraftUpdate({ current, incoming: incident(), baselineSerialized: baseline, saveInFlight: true }), 'ignore');
  assert.equal(decideRealtimeDraftUpdate({ current, incoming: incident({ id: 'other' }), baselineSerialized: baseline, saveInFlight: false }), 'ignore');
});
test('replaces a clean draft with a non-stale server revision', () => {
  const current = incident();
  assert.equal(decideRealtimeDraftUpdate({ current, incoming: incident({ revision: 3 }), baselineSerialized: JSON.stringify(current), saveInFlight: false }), 'replace');
});
test('preserves a clean draft when an older snapshot arrives', () => {
  const current = incident({ revision: 4 });
  assert.equal(decideRealtimeDraftUpdate({ current, incoming: incident({ revision: 3 }), baselineSerialized: JSON.stringify(current), saveInFlight: false }), 'preserve');
});
test('preserves dirty local edits and reports a newer remote revision as conflict', () => {
  const baseline = incident(), current = incident({ titleOverride: 'Unsaved local edit' });
  assert.equal(decideRealtimeDraftUpdate({ current, incoming: incident({ revision: 3, titleOverride: 'Remote edit' }), baselineSerialized: JSON.stringify(baseline), saveInFlight: false }), 'conflict');
});
test('does not create a conflict from an unchanged server snapshot', () => {
  const baseline = incident(), current = incident({ titleOverride: 'Unsaved local edit' });
  assert.equal(decideRealtimeDraftUpdate({ current, incoming: baseline, baselineSerialized: JSON.stringify(baseline), saveInFlight: false }), 'preserve');
});
test('rejects stale workspace-list updates but accepts equal, newer, or first snapshots', () => {
  const existing = incident({ revision: 5 });
  assert.equal(shouldApplyRemoteListUpdate(existing, incident({ revision: 4 })), false);
  assert.equal(shouldApplyRemoteListUpdate(existing, incident({ revision: 5 })), true);
  assert.equal(shouldApplyRemoteListUpdate(existing, incident({ revision: 6 })), true);
  assert.equal(shouldApplyRemoteListUpdate(undefined, incident()), true);
});
