import type { WorkspaceImportDryRun } from './workspace-import.ts';

export type SelectiveRestoreDomain = 'settings' | 'routeMaster';

export interface SelectiveRestoreSelection {
  settings: boolean;
  routeMaster: boolean;
}

export interface SelectiveRestorePlan {
  executable: boolean;
  selected: SelectiveRestoreDomain[];
  skipped: Array<'members' | 'incidents' | 'history'>;
  counts: { settings: number; routeMasterPairs: number };
  errors: string[];
  warnings: string[];
}

/**
 * Builds a safe, explicit restore plan. It never writes data and only includes
 * domains currently classified as admin-writable by the restore policy.
 */
export function planSelectiveWorkspaceRestore(
  bundle: unknown,
  preflight: WorkspaceImportDryRun,
  selection: SelectiveRestoreSelection,
  role: string,
): SelectiveRestorePlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const selected: SelectiveRestoreDomain[] = [];
  const record = bundle && typeof bundle === 'object' && !Array.isArray(bundle)
    ? bundle as { data?: { settings?: unknown; routeMaster?: unknown[] } }
    : {};

  if (role !== 'admin') errors.push('Only a workspace Admin can execute a selective restore.');
  if (!preflight.valid) errors.push('Backup preflight must pass before a restore plan can be prepared.');

  const capabilities = new Map(preflight.restorePolicy.items.map(item => [item.key, item.capability]));
  if (selection.settings) {
    if (capabilities.get('settings') !== 'admin-writable') errors.push('Workspace settings are not writable under the current restore policy.');
    else if (!record.data?.settings || typeof record.data.settings !== 'object' || Array.isArray(record.data.settings)) errors.push('Backup workspace settings are missing or invalid.');
    else selected.push('settings');
  }
  if (selection.routeMaster) {
    if (capabilities.get('routeMaster') !== 'admin-writable') errors.push('Route Master is not writable under the current restore policy.');
    else if (!Array.isArray(record.data?.routeMaster) || record.data.routeMaster.length === 0) errors.push('Route Master restore requires at least one valid mapping because the current import API does not commit empty batches.');
    else selected.push('routeMaster');
  }
  if (!selected.length && !errors.length) errors.push('Select at least one supported restore section.');

  const skipped: SelectiveRestorePlan['skipped'] = ['members', 'incidents', 'history'];
  warnings.push('Selective restore only: members, incidents, audit trail, and version history are never modified.');
  warnings.push('This is a planning-only result. No Firestore or workspace data has been changed.');
  if (selection.routeMaster) warnings.push('Route Master replacement changes the active mapping batch after the import is committed.');

  return {
    executable: errors.length === 0,
    selected,
    skipped,
    counts: {
      settings: selected.includes('settings') ? 1 : 0,
      routeMasterPairs: selected.includes('routeMaster') && Array.isArray(record.data?.routeMaster) ? record.data.routeMaster.length : 0,
    },
    errors,
    warnings,
  };
}
