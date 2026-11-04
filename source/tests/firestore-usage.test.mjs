import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getFirestoreUsageSnapshot,
  recordBatchWrite,
  recordDirectWrite,
  recordDocumentRead,
  recordListenerSnapshot,
  recordListenerStart,
  recordListenerStop,
  recordQueryRead,
  recordTransaction,
  resetFirestoreUsageSnapshot,
} from '../src/firestore-usage.ts';

test('records query and document reads separately while exposing total document reads', () => {
  resetFirestoreUsageSnapshot();
  recordDocumentRead();
  recordQueryRead(12);
  assert.deepEqual(getFirestoreUsageSnapshot(), {
    documentReads: 13,
    queryReads: 1,
    transactions: 0,
    directWrites: 0,
    batchWrites: 0,
    listenerSnapshots: 0,
    listenerDocuments: 0,
    activeListeners: 0,
  });
});

test('records transaction, direct-write, and batch-write activity', () => {
  resetFirestoreUsageSnapshot();
  recordTransaction();
  recordDirectWrite(2);
  recordBatchWrite(3);
  assert.equal(getFirestoreUsageSnapshot().transactions, 1);
  assert.equal(getFirestoreUsageSnapshot().directWrites, 2);
  assert.equal(getFirestoreUsageSnapshot().batchWrites, 3);
});

test('tracks listener lifecycle and snapshot volume without negative active counts', () => {
  resetFirestoreUsageSnapshot();
  recordListenerStart();
  recordListenerStart();
  recordListenerSnapshot(5);
  recordListenerStop();
  recordListenerStop();
  recordListenerStop();
  assert.deepEqual(getFirestoreUsageSnapshot(), {
    documentReads: 0,
    queryReads: 0,
    transactions: 0,
    directWrites: 0,
    batchWrites: 0,
    listenerSnapshots: 1,
    listenerDocuments: 5,
    activeListeners: 0,
  });
});

test('returns isolated snapshots and supports reset', () => {
  resetFirestoreUsageSnapshot();
  recordDocumentRead(4);
  const snapshot = getFirestoreUsageSnapshot();
  snapshot.documentReads = 999;
  assert.equal(getFirestoreUsageSnapshot().documentReads, 4);
  resetFirestoreUsageSnapshot();
  assert.equal(getFirestoreUsageSnapshot().documentReads, 0);
});
