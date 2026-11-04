export const WORKSPACE_BACKUP_FORMAT = 'noc-incident-desk-workspace-backup' as const;
export const WORKSPACE_BACKUP_SCHEMA_VERSION = 1 as const;
export const MAX_WORKSPACE_BACKUP_BYTES = 100 * 1024 * 1024;

export interface WorkspaceBackupData {
  settings: Record<string, unknown>;
  members: Array<{ id: string; userId?: string; [key: string]: unknown }>;
  incidents: Array<{ id: string; [key: string]: unknown }>;
  routeMaster: Array<{ systemKey: string; routeSegment: string }>;
  history: Array<{ incidentId: string; audit: unknown[]; versions: unknown[] }>;
}

export interface WorkspaceBackupBundle {
  format: typeof WORKSPACE_BACKUP_FORMAT;
  schemaVersion: typeof WORKSPACE_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  workspaceId: string;
  data: WorkspaceBackupData;
}

export interface WorkspaceBackupValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  counts: {
    members: number;
    incidents: number;
    progressEvents: number;
    auditEntries: number;
    versions: number;
    routeMasterPairs: number;
  };
  serializedBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasUniqueIds(items: unknown[]): boolean {
  if (!items.every((item) => isRecord(item) && typeof item.id === 'string' && item.id.trim())) return false;
  const ids = items.map((item) => (item as Record<string, unknown>).id as string);
  return new Set(ids).size === ids.length;
}

function serializedSize(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') throw new TypeError('Value is not JSON serializable.');
  return new TextEncoder().encode(serialized).byteLength;
}

export function createWorkspaceBackupBundle(
  workspaceId: string,
  data: WorkspaceBackupData,
  exportedAt = new Date().toISOString(),
): WorkspaceBackupBundle {
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw new TypeError('Workspace ID is required.');
  const serializedData = JSON.stringify(data);
  if (typeof serializedData !== 'string') throw new TypeError('Workspace data is not JSON serializable.');
  const bundle: WorkspaceBackupBundle = {
    format: WORKSPACE_BACKUP_FORMAT,
    schemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION,
    exportedAt,
    workspaceId,
    data: JSON.parse(serializedData) as WorkspaceBackupData,
  };
  const validation = validateWorkspaceBackupBundle(bundle);
  if (!validation.valid) throw new TypeError('Invalid workspace backup: ' + validation.errors.join(' '));
  if (validation.serializedBytes > MAX_WORKSPACE_BACKUP_BYTES) {
    throw new TypeError('Workspace backup exceeds the 100 MiB safety limit.');
  }
  return bundle;
}

/**
 * Validates a backup file without writing to Firestore. This is deliberately a
 * dry-run only: validation never mutates workspace data or creates documents.
 */
export function validateWorkspaceBackupBundle(value: unknown): WorkspaceBackupValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const emptyCounts = { members: 0, incidents: 0, progressEvents: 0, auditEntries: 0, versions: 0, routeMasterPairs: 0 };

  if (!isRecord(value)) {
    return { valid: false, errors: ['Backup root must be an object.'], warnings, counts: emptyCounts, serializedBytes: 0 };
  }
  if (value.format !== WORKSPACE_BACKUP_FORMAT) errors.push('Unsupported backup format.');
  if (value.schemaVersion !== WORKSPACE_BACKUP_SCHEMA_VERSION) errors.push('Unsupported backup schema version.');
  if (typeof value.workspaceId !== 'string' || !value.workspaceId.trim()) errors.push('Workspace ID is missing.');
  if (typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))) errors.push('Export timestamp is invalid.');

  if (!isRecord(value.data)) {
    errors.push('Backup data section is missing.');
    return { valid: false, errors, warnings, counts: emptyCounts, serializedBytes: 0 };
  }
  const data = value.data;
  for (const key of ['members', 'incidents', 'routeMaster', 'history'] as const) {
    if (!Array.isArray(data[key])) errors.push('Data field "' + key + '" must be an array.');
  }
  if (!isRecord(data.settings)) errors.push('Workspace settings must be an object.');

  const membersRaw = Array.isArray(data.members) ? data.members : [];
  const incidentsRaw = Array.isArray(data.incidents) ? data.incidents : [];
  const routeMasterRaw = Array.isArray(data.routeMaster) ? data.routeMaster : [];
  const historyRaw = Array.isArray(data.history) ? data.history : [];
  if (!hasUniqueIds(membersRaw)) errors.push('Member IDs must be present and unique.');
  if (!hasUniqueIds(incidentsRaw)) errors.push('Incident IDs must be present and unique.');

  const members = membersRaw.filter(isRecord);
  const incidents = incidentsRaw.filter(isRecord);
  const routeMaster = routeMasterRaw.filter(isRecord);
  const history = historyRaw.filter(isRecord);
  const incidentIds = new Set(incidents.map((incident) => incident.id).filter((id): id is string => typeof id === 'string'));
  const historyIds = history.map((entry) => entry.incidentId);
  if (historyIds.some((id) => typeof id !== 'string' || !id.trim())) errors.push('Every history entry must reference an incident ID.');
  if (new Set(historyIds).size !== historyIds.length) errors.push('History entries must be unique per incident.');
  for (const id of historyIds) {
    if (typeof id === 'string' && !incidentIds.has(id)) errors.push('History references an incident that is not in this backup: ' + id);
  }

  const routeKeys = routeMaster.map((pair) => {
    if (typeof pair.systemKey !== 'string' || !pair.systemKey.trim()
      || typeof pair.routeSegment !== 'string' || !pair.routeSegment.trim()) {
      errors.push('Every route-master pair must contain System Key and Segment Route.');
      return '';
    }
    return pair.systemKey.trim() + '\u0000' + pair.routeSegment.trim();
  });
  if (new Set(routeKeys).size !== routeKeys.length) errors.push('Route-master contains duplicate mapping pairs.');

  let progressEvents = 0;
  for (const incident of incidents) {
    if (Array.isArray(incident.progress)) progressEvents += incident.progress.length;
  }
  let auditEntries = 0;
  let versions = 0;
  for (const entry of history) {
    if (Array.isArray(entry.audit)) auditEntries += entry.audit.length;
    else errors.push('Audit history must be an array for incident ' + String(entry.incidentId) + '.');
    if (Array.isArray(entry.versions)) versions += entry.versions.length;
    else errors.push('Version history must be an array for incident ' + String(entry.incidentId) + '.');
  }

  let serializedBytes = 0;
  try {
    serializedBytes = serializedSize(value);
  } catch {
    errors.push('Backup contains values that cannot be serialized as JSON.');
  }
  if (serializedBytes > MAX_WORKSPACE_BACKUP_BYTES) errors.push('Backup exceeds the 100 MiB safety limit.');
  if (members.length === 0) warnings.push('No workspace members are included.');
  if (incidents.length === 0) warnings.push('No incidents are included.');
  if (incidents.length > 0 && history.length !== incidents.length) warnings.push('Some incidents have no audit/version history entry.');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts: {
      members: members.length,
      incidents: incidents.length,
      progressEvents,
      auditEntries,
      versions,
      routeMasterPairs: routeMaster.length,
    },
    serializedBytes,
  };
}
