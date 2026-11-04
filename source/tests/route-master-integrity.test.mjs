import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fingerprintRouteMaster,
  validateRouteMasterChunkSet,
} from '../src/route-master-integrity.ts';

const pairs = Array.from({ length: 401 }, (_, index) => ({
  systemKey: `SK-${index + 1}`,
  routeSegment: `SEG-${index + 1}`,
}));

function chunk(items, index) {
  return { chunkIndex: index, items };
}

test('validates contiguous 400-item chunks and the final partial chunk', () => {
  const result = validateRouteMasterChunkSet([
    chunk(pairs.slice(0, 400), 0),
    chunk(pairs.slice(400), 1),
  ], pairs.length, fingerprintRouteMaster(pairs));

  assert.equal(result.valid, true);
  assert.equal(result.count, 401);
  assert.equal(result.chunkCount, 2);
  assert.deepEqual(result.items, pairs);
});

test('rejects missing, duplicated, or out-of-order chunk indexes', () => {
  const result = validateRouteMasterChunkSet([
    chunk(pairs.slice(0, 400), 1),
    chunk(pairs.slice(400), 1),
  ], pairs.length);

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /indeks chunk tidak berurutan/i);
});

test('rejects a short middle chunk and unexpected mapping count', () => {
  const result = validateRouteMasterChunkSet([
    chunk(pairs.slice(0, 399), 0),
    chunk(pairs.slice(400), 1),
  ], pairs.length);

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /jumlah mapping chunk/i);
});

test('rejects malformed and duplicate mapping pairs', () => {
  const duplicatePairs = [
    { systemKey: 'SK-1', routeSegment: 'SEG-1' },
    { systemKey: 'SK-1', routeSegment: 'SEG-1' },
  ];
  const result = validateRouteMasterChunkSet([chunk(duplicatePairs, 0)], 2);

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /duplikat/i);
});

test('rejects a staging fingerprint mismatch', () => {
  const result = validateRouteMasterChunkSet([
    chunk([{ systemKey: 'SK-1', routeSegment: 'SEG-1' }], 0),
  ], 1, fingerprintRouteMaster([{ systemKey: 'SK-2', routeSegment: 'SEG-2' }]));

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /fingerprint/i);
});

test('enforces the 20,000 mapping limit', () => {
  const result = validateRouteMasterChunkSet([], 20001);

  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /20\.000/);
});
