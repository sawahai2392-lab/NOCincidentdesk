export interface RouteMasterPairValue {
  systemKey: string;
  routeSegment: string;
}

export interface StagedRouteMasterChunk {
  chunkIndex: number;
  items: unknown;
}

export interface RouteMasterChunkValidation {
  valid: boolean;
  count: number;
  chunkCount: number;
  items: RouteMasterPairValue[];
  errors: string[];
}

export const ROUTE_MASTER_CHUNK_SIZE = 400;
export const MAX_ROUTE_MASTER_PAIRS = 20000;

/**
 * Deterministic, non-cryptographic fingerprint for read-after-write integrity checks.
 * It detects accidental or partial staging mismatches; it is not an authorization primitive.
 */
export function fingerprintRouteMaster(items: RouteMasterPairValue[]): string {
  const serialized = JSON.stringify(items.map((item) => ({
    systemKey: item.systemKey,
    routeSegment: item.routeSegment,
  })));
  const bytes = new TextEncoder().encode(serialized);
  let hash = 14695981039346656037n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function validateRouteMasterChunkSet(
  chunks: StagedRouteMasterChunk[],
  expectedCount: number,
  expectedFingerprint?: string,
): RouteMasterChunkValidation {
  const errors: string[] = [];
  const items: RouteMasterPairValue[] = [];
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > MAX_ROUTE_MASTER_PAIRS) {
    errors.push('Jumlah mapping Route Master harus antara 1 dan 20.000.');
    return { valid: false, count: 0, chunkCount: 0, items, errors };
  }

  const expectedChunkCount = Math.ceil(expectedCount / ROUTE_MASTER_CHUNK_SIZE);
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  if (ordered.length !== expectedChunkCount) {
    errors.push(`Jumlah chunk tidak sesuai. Diharapkan ${expectedChunkCount}, diterima ${ordered.length}.`);
  }

  const seenPairs = new Set<string>();
  ordered.forEach((chunk, index) => {
    if (!Number.isInteger(chunk.chunkIndex) || chunk.chunkIndex !== index) {
      errors.push(`Indeks chunk tidak berurutan pada posisi ${index}.`);
    }
    if (!Array.isArray(chunk.items)) {
      errors.push(`Isi chunk ${index} bukan array.`);
      return;
    }
    const expectedChunkSize = Math.min(ROUTE_MASTER_CHUNK_SIZE, expectedCount - index * ROUTE_MASTER_CHUNK_SIZE);
    if (chunk.items.length !== expectedChunkSize) {
      errors.push(`Jumlah mapping chunk ${index} tidak sesuai. Diharapkan ${expectedChunkSize}, diterima ${chunk.items.length}.`);
    }
    for (const raw of chunk.items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push(`Mapping pada chunk ${index} tidak valid.`);
        continue;
      }
      const pair = raw as Record<string, unknown>;
      if (typeof pair.systemKey !== 'string' || !pair.systemKey.trim()
        || typeof pair.routeSegment !== 'string' || !pair.routeSegment.trim()) {
        errors.push(`Mapping pada chunk ${index} tidak memiliki System Key dan Segment Route.`);
        continue;
      }
      const normalized = pair.systemKey.trim() + '\u0000' + pair.routeSegment.trim();
      if (seenPairs.has(normalized)) errors.push('Route Master berisi mapping duplikat.');
      seenPairs.add(normalized);
      items.push({ systemKey: pair.systemKey, routeSegment: pair.routeSegment });
    }
  });

  if (items.length !== expectedCount) {
    errors.push(`Total mapping tidak sesuai. Diharapkan ${expectedCount}, diterima ${items.length}.`);
  }
  if (expectedFingerprint && items.length === expectedCount
    && fingerprintRouteMaster(items) !== expectedFingerprint) {
    errors.push('Fingerprint staging Route Master tidak cocok dengan isi backup.');
  }

  return {
    valid: errors.length === 0,
    count: items.length,
    chunkCount: ordered.length,
    items,
    errors,
  };
}
