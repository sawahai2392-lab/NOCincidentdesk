import { validateWorkspaceBackupBundle, type WorkspaceBackupValidation } from './workspace-backup';

export interface WorkspaceImportContext {
  workspaceId: string;
  existingMemberIds: string[];
  existingIncidentIds: string[];
}

export interface WorkspaceImportDryRun {
  valid: boolean;
  eligibleForFutureImport: boolean;
  validation: WorkspaceBackupValidation;
  errors: string[];
  warnings: string[];
  conflicts: {
    memberIds: string[];
    incidentIds: string[];
  };
}

/**
 * Performs a read-only compatibility check. This module deliberately has no
 * Firestore dependency and exposes no import/write operation.
 */
export function analyzeWorkspaceImport(
  bundle: unknown,
  context: WorkspaceImportContext,
): WorkspaceImportDryRun {
  const validation = validateWorkspaceBackupBundle(bundle);
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];
  const conflicts = { memberIds: [] as string[], incidentIds: [] as string[] };

  if (!context.workspaceId.trim()) {
    errors.push('Current workspace ID is missing.');
  }

  if (bundle && typeof bundle === 'object' && !Array.isArray(bundle)) {
    const candidate = bundle as { workspaceId?: unknown; data?: { members?: unknown; incidents?: unknown } };
    if (typeof candidate.workspaceId === 'string' && candidate.workspaceId !== context.workspaceId) {
      errors.push('Backup belongs to a different workspace. Cross-workspace import is not supported.');
    }
    const existingMembers = new Set(context.existingMemberIds);
    const existingIncidents = new Set(context.existingIncidentIds);
    if (Array.isArray(candidate.data?.members)) {
      for (const member of candidate.data.members) {
        if (member && typeof member === 'object' && typeof (member as { id?: unknown }).id === 'string'
          && existingMembers.has((member as { id: string }).id)) {
          conflicts.memberIds.push((member as { id: string }).id);
        }
      }
    }
    if (Array.isArray(candidate.data?.incidents)) {
      for (const incident of candidate.data.incidents) {
        if (incident && typeof incident === 'object' && typeof (incident as { id?: unknown }).id === 'string'
          && existingIncidents.has((incident as { id: string }).id)) {
          conflicts.incidentIds.push((incident as { id: string }).id);
        }
      }
    }
  }

  if (conflicts.memberIds.length) errors.push('Backup member IDs already exist in the current workspace.');
  if (conflicts.incidentIds.length) errors.push('Backup incident IDs already exist in the current workspace.');
  if (validation.valid && errors.length === 0) {
    warnings.push('Dry-run only: no Firestore documents were created, updated, or deleted.');
  }

  const valid = errors.length === 0 && validation.valid;
  return {
    valid,
    eligibleForFutureImport: valid,
    validation,
    errors,
    warnings,
    conflicts,
  };
}
