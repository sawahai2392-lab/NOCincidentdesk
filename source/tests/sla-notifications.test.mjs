import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../src/domain.ts';
import { getSlaNotice } from '../src/sla-notifications.ts';

function incident(overrides = {}, now = 1_800_000_000_000) {
  return {
    id: 'incident-1',
    identityMode: 'standard',
    incidentId: 'MDU-TEST-001',
    b2bTitle: '',
    linkA: 'SITE-A',
    linkB: 'SITE-B',
    status: 'Open',
    severity: 'Critical',
    progress: [],
    occurTime: '',
    createdAt: now,
    deletedAt: 0,
    ...overrides,
  };
}

test('does not create an SLA notice for healthy active incidents', () => {
  const now = 1_800_000_000_000;
  assert.equal(getSlaNotice(incident({}, now), defaultSettings, now - 10 * 60_000), null);
});

test('creates due-soon notice at the configured 25 percent warning window', () => {
  const now = 1_800_000_000_000;
  const notice = getSlaNotice(incident({}, now - 11 * 60_000), defaultSettings, now);
  assert.equal(notice?.stage, 'due_soon');
  assert.equal(notice?.remainingMinutes, 4);
});

test('creates overdue notice at the SLA boundary', () => {
  const now = 1_800_000_000_000;
  const notice = getSlaNotice(incident({}, now - 15 * 60_000), defaultSettings, now);
  assert.equal(notice?.stage, 'overdue');
  assert.match(notice?.title || '', /SLA terlewat/);
});

test('Critical incidents escalate to L3 at two times the SLA', () => {
  const now = 1_800_000_000_000;
  const notice = getSlaNotice(incident({}, now - 30 * 60_000), defaultSettings, now);
  assert.equal(notice?.stage, 'critical');
  assert.equal(notice?.level, 3);
});

test('Major incidents escalate to L2 at two times the SLA and L3 at three times', () => {
  const now = 1_800_000_000_000;
  const major = incident({ severity: 'Major' }, now - 60 * 60_000);
  assert.equal(getSlaNotice(major, defaultSettings, now)?.stage, 'escalated');
  const critical = incident({ severity: 'Major' }, now - 90 * 60_000);
  assert.equal(getSlaNotice(critical, defaultSettings, now)?.stage, 'critical');
});

test('does not notify for resolved, deleted, or inactive incidents', () => {
  const now = 1_800_000_000_000;
  assert.equal(getSlaNotice(incident({ status: 'Resolved' }, now - 60 * 60_000), defaultSettings, now), null);
  assert.equal(getSlaNotice(incident({ deletedAt: now }, now - 60 * 60_000), defaultSettings, now), null);
  assert.equal(getSlaNotice(incident({ status: 'Draft' }, now - 60 * 60_000), defaultSettings, now), null);
});

test('fingerprint changes when a new progress update resets the SLA clock', () => {
  const now = 1_800_000_000_000;
  const older = incident({ severity: 'Major', progress: [{ date: '2026-11-04', time: '10:00', text: 'Old update' }] }, now);
  const newer = incident({ severity: 'Major', progress: [{ date: '2026-11-04', time: '10:20', text: 'New update' }] }, now);
  const oldNotice = getSlaNotice(older, defaultSettings, now + 90 * 60_000);
  const newNotice = getSlaNotice(newer, defaultSettings, now + 90 * 60_000);
  assert.ok(oldNotice);
  assert.ok(newNotice);
  assert.notEqual(oldNotice.fingerprint, newNotice.fingerprint);
});

test('ignores invalid or disabled SLA thresholds', () => {
  const now = 1_800_000_000_000;
  const settings = { ...defaultSettings, slaCriticalMinutes: 0 };
  assert.equal(getSlaNotice(incident(), settings, now + 60 * 60_000), null);
});
