export const MAX_FIRESTORE_INCIDENT_DOCUMENT_BYTES = 900 * 1024;

/** Measure the UTF-8 JSON payload size, not JavaScript character count. */
export function measureFirestoreDocumentBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new TypeError('Firestore document payload must be JSON-serializable.');
  }
  return new TextEncoder().encode(serialized).byteLength;
}

/** Keep incident documents below Firestore's 1 MiB hard limit with headroom. */
export function isFirestoreIncidentPayloadSafe(
  value: unknown,
  maxBytes = MAX_FIRESTORE_INCIDENT_DOCUMENT_BYTES,
): boolean {
  return measureFirestoreDocumentBytes(value) <= maxBytes;
}
