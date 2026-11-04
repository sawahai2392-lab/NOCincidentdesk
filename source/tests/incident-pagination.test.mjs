import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeIncidentPageCursor,
  encodeIncidentPageCursor,
  mergeIncidentPage,
} from '../src/incident-pagination.ts';

test('round-trips a stable timestamp and document id cursor', () => {
  const cursor = { updatedAt: 1793812345678, id: 'incident/with space' };
  assert.deepEqual(decodeIncidentPageCursor(encodeIncidentPageCursor(cursor)), cursor);
});

test('rejects malformed, incomplete, and non-numeric cursors', () => {
  for (const token of ['', 'abc~incident-1', '123~', '123~%E0%A4%A', '-1~incident-1']) {
    assert.equal(decodeIncidentPageCursor(token), null);
  }
});

test('merges pages without duplicate incidents and lets the latest record win', () => {
  const existing = [
    { id: 'a', updatedAt: 30, title: 'old-a' },
    { id: 'b', updatedAt: 20, title: 'b' },
  ];
  const incoming = [
    { id: 'a', updatedAt: 40, title: 'new-a' },
    { id: 'c', updatedAt: 20, title: 'c' },
  ];
  const merged = mergeIncidentPage(existing, incoming);
  assert.deepEqual(merged.map((item) => item.id), ['a', 'c', 'b']);
  assert.equal(merged[0].title, 'new-a');
  assert.equal(new Set(merged.map((item) => item.id)).size, merged.length);
});

test('uses document id as a deterministic tie-breaker for equal timestamps', () => {
  const merged = mergeIncidentPage(
    [{ id: 'a', updatedAt: 10 }],
    [{ id: 'z', updatedAt: 10 }, { id: 'm', updatedAt: 10 }],
  );
  assert.deepEqual(merged.map((item) => item.id), ['z', 'm', 'a']);
});
