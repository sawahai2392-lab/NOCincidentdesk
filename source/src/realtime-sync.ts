import type { Incident } from './domain';

export type RealtimeDraftDecision = 'ignore' | 'preserve' | 'replace' | 'conflict';

export function shouldApplyRemoteListUpdate(existing: Incident | undefined, incoming: Incident): boolean {
  return !existing || incoming.revision >= existing.revision;
}

export function decideRealtimeDraftUpdate(input: {
  current: Incident | null;
  incoming: Incident;
  baselineSerialized: string | null;
  saveInFlight: boolean;
}): RealtimeDraftDecision {
  const { current, incoming, baselineSerialized, saveInFlight } = input;
  if (!current || current.id !== incoming.id || saveInFlight) return 'ignore';
  const dirty = JSON.stringify(current) !== baselineSerialized;
  if (!dirty) return incoming.revision < current.revision ? 'preserve' : 'replace';
  const changedRemotely = incoming.revision > current.revision
    || (baselineSerialized !== null && JSON.stringify(incoming) !== baselineSerialized);
  return changedRemotely && incoming.revision >= current.revision ? 'conflict' : 'preserve';
}
