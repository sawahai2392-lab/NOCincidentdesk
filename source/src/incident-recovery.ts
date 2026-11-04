import type { Incident } from './domain';

const RECOVERY_PREFIX = 'noc-recovery:';
const VERSIONED_PREFIX = 'noc-recovery:v2:';
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;

type RecoveryRecord = {
  version: 2;
  savedAt: number;
  workspaceId: string;
  userId: string;
  incident: Incident;
};

function storageKey(workspaceId: string, userId: string, incidentId: string): string {
  return VERSIONED_PREFIX + [
    encodeURIComponent(workspaceId),
    encodeURIComponent(userId),
    encodeURIComponent(incidentId),
  ].join(':');
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

export function storeIncidentRecovery(
  incident: Incident,
  workspaceId: string,
  userId: string,
): void {
  if (!workspaceId || !userId) return;

  const record: RecoveryRecord = {
    version: 2,
    savedAt: Date.now(),
    workspaceId,
    userId,
    incident,
  };

  try {
    localStorage.setItem(storageKey(workspaceId, userId, incident.id), JSON.stringify(record));
  } catch {
    // Recovery is best-effort and must never block the incident editor.
  }
}

export function readIncidentRecovery(
  serverIncident: Incident,
  workspaceId: string,
  userId: string,
): Incident | null {
  if (!workspaceId || !userId) return null;

  const key = storageKey(workspaceId, userId, serverIncident.id);

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      let recovered: RecoveryRecord | null = null;
      try {
        recovered = JSON.parse(raw) as RecoveryRecord;
      } catch {
        safeRemove(key);
      }

      if (recovered) {
        const age = Date.now() - recovered.savedAt;
        const valid = recovered.version === 2
          && recovered.workspaceId === workspaceId
          && recovered.userId === userId
          && Number.isFinite(recovered.savedAt)
          && age >= 0
          && age <= RECOVERY_TTL_MS
          && recovered.incident?.id === serverIncident.id
          && recovered.incident?.revision === serverIncident.revision;

        if (valid && JSON.stringify(recovered.incident) !== JSON.stringify(serverIncident)) {
          return recovered.incident;
        }

        safeRemove(key);
      }
    }

    // Migrate a legacy v1 draft once, after verifying it matches this server incident.
    const legacyKey = RECOVERY_PREFIX + serverIncident.id;
    const legacyRaw = localStorage.getItem(legacyKey);
    if (!legacyRaw) return null;

    try {
      const legacy = JSON.parse(legacyRaw) as Incident;
      const validLegacy = legacy?.id === serverIncident.id
        && legacy?.revision === serverIncident.revision
        && JSON.stringify(legacy) !== JSON.stringify(serverIncident);

      if (validLegacy) {
        storeIncidentRecovery(legacy, workspaceId, userId);
        safeRemove(legacyKey);
        return legacy;
      }
    } catch {
      // Invalid legacy recovery data is discarded below.
    }

    safeRemove(legacyKey);
    return null;
  } catch {
    return null;
  }
}

export function clearIncidentRecovery(
  workspaceId: string | undefined,
  userId: string | undefined,
  incidentId: string,
): void {
  if (workspaceId && userId) {
    safeRemove(storageKey(workspaceId, userId, incidentId));
  }
  safeRemove(RECOVERY_PREFIX + incidentId);
}

export function clearAllIncidentRecoveries(): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(RECOVERY_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Logout should still complete if the browser blocks local storage access.
  }
}
