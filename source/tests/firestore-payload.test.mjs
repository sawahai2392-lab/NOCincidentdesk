import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFirestoreIncidentPayloadSafe,
  measureFirestoreDocumentBytes,
  MAX_FIRESTORE_INCIDENT_DOCUMENT_BYTES,
} from '../src/firestore-payload.ts';

test('measures UTF-8 bytes rather than JavaScript character count', () => {
  const value = { note: 'Jakarta – FO terputus 🚧' };
  assert.equal(measureFirestoreDocumentBytes(value), new TextEncoder().encode(JSON.stringify(value)).byteLength);
  assert.ok(measureFirestoreDocumentBytes(value) > JSON.stringify(value).length);
});

test('accepts payloads within the configured safety budget', () => {
  assert.equal(isFirestoreIncidentPayloadSafe({ note: 'short update' }, 256), true);
});

test('rejects payloads that exceed the configured safety budget', () => {
  assert.equal(isFirestoreIncidentPayloadSafe({ note: 'x'.repeat(256) }, 128), false);
});

test('keeps the application limit below Firestore 1 MiB document maximum', () => {
  assert.ok(MAX_FIRESTORE_INCIDENT_DOCUMENT_BYTES < 1024 * 1024);
  assert.equal(MAX_FIRESTORE_INCIDENT_DOCUMENT_BYTES, 900 * 1024);
});

test('rejects non-JSON-serializable payloads', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => measureFirestoreDocumentBytes(circular), TypeError);
});
