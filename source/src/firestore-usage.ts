export interface FirestoreUsageSnapshot {
  documentReads: number;
  queryReads: number;
  transactions: number;
  directWrites: number;
  batchWrites: number;
  listenerSnapshots: number;
  listenerDocuments: number;
  activeListeners: number;
}

const counters: FirestoreUsageSnapshot = {
  documentReads: 0,
  queryReads: 0,
  transactions: 0,
  directWrites: 0,
  batchWrites: 0,
  listenerSnapshots: 0,
  listenerDocuments: 0,
  activeListeners: 0,
};

export function recordDocumentRead(count = 1): void {
  counters.documentReads += Math.max(0, Math.floor(count));
}

export function recordQueryRead(count = 0): void {
  counters.queryReads += 1;
  counters.documentReads += Math.max(0, Math.floor(count));
}

export function recordTransaction(): void {
  counters.transactions += 1;
}

export function recordDirectWrite(count = 1): void {
  counters.directWrites += Math.max(0, Math.floor(count));
}

export function recordBatchWrite(count = 1): void {
  counters.batchWrites += Math.max(0, Math.floor(count));
}

export function recordListenerStart(): void {
  counters.activeListeners += 1;
}

export function recordListenerStop(): void {
  counters.activeListeners = Math.max(0, counters.activeListeners - 1);
}

export function recordListenerSnapshot(documentCount = 0): void {
  counters.listenerSnapshots += 1;
  counters.listenerDocuments += Math.max(0, Math.floor(documentCount));
}

export function getFirestoreUsageSnapshot(): FirestoreUsageSnapshot {
  return { ...counters };
}

export function resetFirestoreUsageSnapshot(): void {
  Object.keys(counters).forEach((key) => {
    counters[key as keyof FirestoreUsageSnapshot] = 0;
  });
}
