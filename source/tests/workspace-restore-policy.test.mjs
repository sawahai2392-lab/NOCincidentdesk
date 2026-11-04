import test from 'node:test';
import assert from 'node:assert/strict';
import { getWorkspaceRestorePolicy } from '../src/workspace-restore-policy.ts';

test('never advertises full client-side workspace restore as supported', () => {
  const policy = getWorkspaceRestorePolicy();
  assert.equal(policy.fullRestoreSupported, false);
  assert.equal(policy.requiresTrustedMigration, true);
});

test('only settings and Route Master are marked admin-writable', () => {
  const policy = getWorkspaceRestorePolicy();
  const writable = policy.items.filter((item) => item.capability === 'admin-writable').map((item) => item.key);
  assert.deepEqual(writable, ['settings', 'routeMaster']);
});

test('member and history replay remain blocked by current security rules', () => {
  const policy = getWorkspaceRestorePolicy();
  assert.equal(policy.items.find((item) => item.key === 'members')?.capability, 'blocked');
  assert.equal(policy.items.find((item) => item.key === 'history')?.capability, 'blocked');
});

test('incident migration requires a trusted migration path to preserve provenance', () => {
  const policy = getWorkspaceRestorePolicy();
  const incidents = policy.items.find((item) => item.key === 'incidents');
  assert.equal(incidents?.capability, 'trusted-migration-required');
  assert.match(incidents?.reason || '', /provenance/i);
});
