export type WorkspaceRestoreCapability = 'admin-writable' | 'trusted-migration-required' | 'blocked';

export interface WorkspaceRestorePolicyItem {
  key: 'settings' | 'routeMaster' | 'members' | 'incidents' | 'history';
  label: string;
  capability: WorkspaceRestoreCapability;
  reason: string;
}

export interface WorkspaceRestorePolicy {
  fullRestoreSupported: false;
  requiresTrustedMigration: true;
  items: WorkspaceRestorePolicyItem[];
  summary: string;
}

/**
 * Describes what the current client-only Firebase Spark security rules permit.
 * This is an explanatory policy matrix, not an authorization substitute.
 */
export function getWorkspaceRestorePolicy(): WorkspaceRestorePolicy {
  return {
    fullRestoreSupported: false,
    requiresTrustedMigration: true,
    summary: 'A complete workspace restore cannot safely run from the current client-only Firebase Spark app without weakening security rules or rewriting historical authorship.',
    items: [
      {
        key: 'settings',
        label: 'Workspace settings',
        capability: 'admin-writable',
        reason: 'Current Firestore rules allow an active workspace Admin to create or update settings.',
      },
      {
        key: 'routeMaster',
        label: 'Route Master',
        capability: 'admin-writable',
        reason: 'Current Firestore rules allow an active workspace Admin to manage Route Master metadata and batches.',
      },
      {
        key: 'members',
        label: 'Workspace members',
        capability: 'blocked',
        reason: 'Member creation is restricted to the authenticated member or a valid invitation flow; an Admin cannot recreate arbitrary member identities from a backup.',
      },
      {
        key: 'incidents',
        label: 'Incident records',
        capability: 'trusted-migration-required',
        reason: 'Incident creation binds creator and updater to the authenticated user and requires matching incident-key records. Rewriting those fields would alter provenance.',
      },
      {
        key: 'history',
        label: 'Audit trail and version history',
        capability: 'blocked',
        reason: 'Audit and version records are append-only and cross-linked to incident revisions. Historical actor identity cannot be replayed by a different client user under current rules.',
      },
    ],
  };
}
