import { validateRouteMasterChunkSet } from './route-master-integrity';

export type IntegritySeverity = 'critical' | 'warning';
export type IntegrityStatus = 'healthy' | 'warning' | 'critical';
export type IntegrityRepairKind = 'create-incident-key' | 'delete-orphan-incident-key';

export interface IntegrityDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface IntegrityHistorySet {
  incidentId: string;
  audit: IntegrityDocument[];
  versions: IntegrityDocument[];
  auditTruncated: boolean;
  versionsTruncated: boolean;
}

export interface WorkspaceIntegritySnapshot {
  workspace: { exists: boolean; data: Record<string, unknown> };
  members: IntegrityDocument[];
  membersTruncated: boolean;
  settings: { exists: boolean; data: Record<string, unknown> };
  incidents: IntegrityDocument[];
  incidentsTruncated: boolean;
  incidentKeys: IntegrityDocument[];
  incidentKeysTruncated: boolean;
  history: IntegrityHistorySet[];
  routeMaster: {
    meta: Record<string, unknown> | null;
    batch: IntegrityDocument | null;
    chunks: IntegrityDocument[];
    chunksTruncated: boolean;
  };
  restoreOperations: IntegrityDocument[];
  restoreOperationsTruncated: boolean;
}

export interface WorkspaceIntegrityRepair {
  id: string;
  kind: IntegrityRepairKind;
  incidentId?: string;
  normalizedKey?: string;
  keyId?: string;
}

export interface WorkspaceIntegrityFinding {
  id: string;
  category: 'workspace' | 'members' | 'settings' | 'incidents' | 'incident-keys' | 'history' | 'route-master' | 'restore-operations' | 'coverage';
  severity: IntegritySeverity;
  title: string;
  detail: string;
  entityId?: string;
  repair?: WorkspaceIntegrityRepair;
}

export interface WorkspaceIntegrityReport {
  scannedAt: number;
  status: IntegrityStatus;
  counts: { critical: number; warning: number; healthy: number; checks: number };
  coverage: {
    membersScanned: number;
    incidentsScanned: number;
    incidentKeysScanned: number;
    historyIncidentsScanned: number;
    routeMasterChunksScanned: number;
    restoreOperationsScanned: number;
    partial: boolean;
  };
  findings: WorkspaceIntegrityFinding[];
  repairs: WorkspaceIntegrityRepair[];
}

const MAX_FINDINGS = 200;
const MAX_REPAIRS = 50;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function keyIdFromNormalized(normalizedKey: string): string {
  return encodeURIComponent(normalizedKey).replace(/\./g, '%2E');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildWorkspaceIntegrityReport(
  snapshot: WorkspaceIntegritySnapshot,
  scannedAt = Date.now(),
): WorkspaceIntegrityReport {
  const findings: WorkspaceIntegrityFinding[] = [];
  const repairs: WorkspaceIntegrityRepair[] = [];
  let checks = 0;

  const evaluate = (
    passed: boolean,
    severity: IntegritySeverity,
    finding: Omit<WorkspaceIntegrityFinding, 'severity'>,
  ) => {
    checks += 1;
    if (passed || findings.length >= MAX_FINDINGS) return;
    findings.push({ ...finding, severity });
    if (finding.repair && repairs.length < MAX_REPAIRS) repairs.push(finding.repair);
  };

  const workspace = snapshot.workspace.data;
  evaluate(snapshot.workspace.exists, 'critical', {
    id: 'workspace:missing',
    category: 'workspace',
    title: 'Workspace document tidak ditemukan',
    detail: 'Dokumen workspace utama tidak dapat dibaca. Pemeriksaan relasi tingkat workspace tidak dapat dianggap lengkap.',
  });

  const activeAdmins = snapshot.members.filter((member) =>
    member.data.status === 'active' && member.data.role === 'admin',
  );
  evaluate(activeAdmins.length > 0, 'critical', {
    id: 'members:no-active-admin',
    category: 'members',
    title: 'Tidak ada Admin aktif',
    detail: 'Workspace harus memiliki setidaknya satu anggota dengan role Admin dan status active.',
  });
  evaluate(
    !text(workspace.ownerUid) || activeAdmins.some((member) =>
      member.id === text(workspace.ownerUid) || member.data.userId === text(workspace.ownerUid),
    ),
    'critical',
    {
      id: 'members:owner-not-active',
      category: 'members',
      title: 'Owner workspace tidak ditemukan sebagai Admin aktif',
      detail: 'ownerUid pada dokumen workspace tidak cocok dengan anggota Admin aktif.',
      entityId: text(workspace.ownerUid) || undefined,
    },
  );
  evaluate(activeAdmins.length > 1, 'warning', {
    id: 'members:single-admin',
    category: 'members',
    title: 'Hanya ada satu Admin aktif',
    detail: 'Pertimbangkan Admin cadangan agar pengelolaan workspace tidak bergantung pada satu akun.',
  });

  for (const member of snapshot.members) {
    evaluate(
      !text(member.data.userId) || text(member.data.userId) === member.id,
      'warning',
      {
        id: 'member:user-id:' + member.id,
        category: 'members',
        title: 'Identitas dokumen member tidak konsisten',
        detail: 'Field userId kosong atau berbeda dari ID dokumen member.',
        entityId: member.id,
      },
    );
    evaluate(
      !text(member.data.workspaceId) || text(member.data.workspaceId) === text(workspace.id),
      'warning',
      {
        id: 'member:workspace-id:' + member.id,
        category: 'members',
        title: 'Workspace ID pada member tidak konsisten',
        detail: 'Field workspaceId tidak cocok dengan workspace yang sedang diperiksa.',
        entityId: member.id,
      },
    );
  }

  evaluate(snapshot.settings.exists, 'warning', {
    id: 'settings:missing',
    category: 'settings',
    title: 'Workspace Settings belum tersimpan',
    detail: 'Aplikasi dapat memakai default lokal, tetapi dokumen settings/main belum ada di Firestore.',
  });

  const incidentById = new Map(snapshot.incidents.map((incident) => [incident.id, incident]));
  const keysById = new Map(snapshot.incidentKeys.map((key) => [key.id, key]));
  const activeByNormalized = new Map<string, IntegrityDocument[]>();

  for (const incident of snapshot.incidents) {
    const data = incident.data;
    evaluate(text(data.id) === incident.id, 'critical', {
      id: 'incident:document-id:' + incident.id,
      category: 'incidents',
      title: 'ID incident tidak cocok dengan ID dokumen',
      detail: 'Field id pada dokumen incident harus sama dengan document ID.',
      entityId: incident.id,
    });
    evaluate(Number.isInteger(numeric(data.revision)) && numeric(data.revision) >= 1, 'critical', {
      id: 'incident:revision:' + incident.id,
      category: 'incidents',
      title: 'Revision incident tidak valid',
      detail: 'Revision harus berupa bilangan bulat minimal 1.',
      entityId: incident.id,
    });
    evaluate(
      !numeric(data.createdAt) || !numeric(data.updatedAt) || numeric(data.updatedAt) >= numeric(data.createdAt),
      'warning',
      {
        id: 'incident:timestamps:' + incident.id,
        category: 'incidents',
        title: 'Timestamp incident tidak berurutan',
        detail: 'updatedAt lebih awal dari createdAt. Periksa kemungkinan data lama atau timestamp yang rusak.',
        entityId: incident.id,
      },
    );

    const normalizedKey = text(data.normalizedIncidentId);
    const deleted = numeric(data.deletedAt) > 0;
    if (!deleted && normalizedKey) {
      const siblings = activeByNormalized.get(normalizedKey) || [];
      siblings.push(incident);
      activeByNormalized.set(normalizedKey, siblings);
      const keyId = keyIdFromNormalized(normalizedKey);
      const key = keysById.get(keyId);
      if (!key && !snapshot.incidentKeysTruncated) {
        evaluate(false, 'critical', {
          id: 'incident-key:missing:' + incident.id,
          category: 'incident-keys',
          title: 'Index incident hilang',
          detail: 'Incident aktif memiliki normalizedIncidentId, tetapi dokumen incidentKeys tidak ditemukan.',
          entityId: incident.id,
          repair: {
            id: 'create-incident-key:' + incident.id,
            kind: 'create-incident-key',
            incidentId: incident.id,
            normalizedKey,
          },
        });
      } else if (key) {
        const keyMatches = key.data.active === true
          && text(key.data.incidentId) === incident.id
          && text(key.data.normalizedKey) === normalizedKey;
        evaluate(keyMatches, 'critical', {
          id: 'incident-key:mismatch:' + incident.id,
          category: 'incident-keys',
          title: 'Index incident tidak cocok',
          detail: 'Index harus aktif dan menunjuk ke incident serta normalized key yang sama.',
          entityId: incident.id,
        });
      }
    } else if (!deleted && text(data.incidentId)) {
      evaluate(false, 'warning', {
        id: 'incident:normalized-key-missing:' + incident.id,
        category: 'incidents',
        title: 'Normalized incident ID kosong',
        detail: 'Incident memiliki business ID tetapi normalizedIncidentId tidak tersimpan. Perbaikan otomatis tidak dibuat karena nilai kunci perlu diverifikasi.',
        entityId: incident.id,
      });
    }
  }

  for (const [normalizedKey, siblings] of activeByNormalized) {
    evaluate(siblings.length === 1, 'critical', {
      id: 'incident-key:duplicate-normalized:' + normalizedKey,
      category: 'incident-keys',
      title: 'Normalized incident ID duplikat',
      detail: 'Beberapa incident aktif menggunakan normalizedIncidentId yang sama. Konflik ini perlu ditinjau manual.',
      entityId: normalizedKey,
    });
  }

  for (const key of snapshot.incidentKeys) {
    const incidentId = text(key.data.incidentId);
    const normalizedKey = text(key.data.normalizedKey);
    const incident = incidentById.get(incidentId);
    const orphaned = !incident
      || numeric(incident.data.deletedAt) > 0
      || text(incident.data.normalizedIncidentId) !== normalizedKey;
    if (orphaned) {
      const canDelete = Boolean(incidentId && normalizedKey && (
        !incident
        || numeric(incident.data.deletedAt) > 0
        || text(incident.data.normalizedIncidentId) !== normalizedKey
      ));
      evaluate(false, 'warning', {
        id: 'incident-key:orphan:' + key.id,
        category: 'incident-keys',
        title: 'Index incident orphan',
        detail: !incident
          ? 'Index menunjuk ke dokumen incident yang tidak ditemukan.'
          : numeric(incident.data.deletedAt) > 0
            ? 'Index masih tersisa untuk incident yang berada di Trash.'
            : 'Normalized key pada index tidak lagi cocok dengan incident tujuan.',
        entityId: key.id,
        ...(canDelete ? {
          repair: {
            id: 'delete-orphan-incident-key:' + key.id,
            kind: 'delete-orphan-incident-key' as const,
            keyId: key.id,
            incidentId,
            normalizedKey,
          },
        } : {}),
      });
    } else {
      evaluate(key.data.active === true, 'warning', {
        id: 'incident-key:inactive:' + key.id,
        category: 'incident-keys',
        title: 'Index incident tidak aktif',
        detail: 'Index yang terhubung dengan incident aktif harus memiliki active=true.',
        entityId: key.id,
      });
    }
  }

  for (const history of snapshot.history) {
    const incident = incidentById.get(history.incidentId);
    const revision = numeric(incident?.data.revision);
    const auditById = new Map(history.audit.map((entry) => [entry.id, entry]));
    const versionById = new Map(history.versions.map((entry) => [entry.id, entry]));

    for (const audit of history.audit) {
      const data = audit.data;
      const action = text(data.action);
      const fromRevision = numeric(data.fromRevision);
      const toRevision = numeric(data.toRevision);
      const snapshotAction = action === 'snapshot_created';
      evaluate(
        snapshotAction ? fromRevision === toRevision : toRevision === fromRevision + 1,
        'critical',
        {
          id: 'audit:revision:' + history.incidentId + ':' + audit.id,
          category: 'history',
          title: 'Relasi revision pada audit tidak valid',
          detail: 'Audit harus merekam transisi revision yang valid atau snapshot pada revision yang sama.',
          entityId: history.incidentId,
        },
      );
      if (snapshotAction) {
        const versionId = text(data.versionId);
        const version = versionById.get(versionId);
        evaluate(Boolean(version && text(version.data.auditId) === audit.id), 'critical', {
          id: 'audit:version-link:' + history.incidentId + ':' + audit.id,
          category: 'history',
          title: 'Audit snapshot tidak memiliki version pasangan',
          detail: 'Audit snapshot_created harus terhubung ke version melalui versionId dan auditId.',
          entityId: history.incidentId,
        });
      }
    }

    for (const version of history.versions) {
      const data = version.data;
      const embeddedIncident = isRecord(data.incident) ? data.incident : {};
      const audit = auditById.get(text(data.auditId));
      evaluate(
        text(data.id) === version.id
          && text(embeddedIncident.id) === history.incidentId
          && Number.isInteger(numeric(data.revision))
          && numeric(data.revision) >= 1,
        'critical',
        {
          id: 'version:shape:' + history.incidentId + ':' + version.id,
          category: 'history',
          title: 'Snapshot version tidak konsisten',
          detail: 'ID, embedded incident ID, atau revision pada dokumen version tidak valid.',
          entityId: history.incidentId,
        },
      );
      evaluate(
        Boolean(audit
          && text(audit.data.action) === 'snapshot_created'
          && text(audit.data.versionId) === version.id
          && text(audit.data.actorId) === text(data.createdBy)
          && numeric(audit.data.toRevision) === numeric(data.revision)),
        'critical',
        {
          id: 'version:audit-link:' + history.incidentId + ':' + version.id,
          category: 'history',
          title: 'Version tidak memiliki audit snapshot yang cocok',
          detail: 'auditId harus menunjuk ke audit snapshot_created dengan actor, version ID, dan revision yang sama.',
          entityId: history.incidentId,
        },
      );
    }

    const latestAuditRevision = history.audit.reduce((latest, audit) =>
      Math.max(latest, numeric(audit.data.toRevision)), 0);
    if (!history.auditTruncated && revision > 1) {
      evaluate(latestAuditRevision >= revision, 'warning', {
        id: 'history:revision-gap:' + history.incidentId,
        category: 'history',
        title: 'Audit history tertinggal dari revision incident',
        detail: 'Revision terbaru pada audit lebih rendah dari revision incident saat ini.',
        entityId: history.incidentId,
      });
    }
  }

  const meta = snapshot.routeMaster.meta;
  const activeBatchId = text(meta?.currentBatchId);
  if (activeBatchId) {
    const batch = snapshot.routeMaster.batch;
    evaluate(Boolean(batch), 'critical', {
      id: 'route-master:active-batch-missing',
      category: 'route-master',
      title: 'Active Route Master batch tidak ditemukan',
      detail: 'Pointer currentBatchId menunjuk ke dokumen batch yang tidak tersedia.',
      entityId: activeBatchId,
    });
    if (batch) {
      evaluate(batch.data.status === 'committed', 'critical', {
        id: 'route-master:active-batch-status',
        category: 'route-master',
        title: 'Active Route Master batch bukan committed',
        detail: 'Batch yang ditunjuk oleh pointer aktif harus berstatus committed.',
        entityId: activeBatchId,
      });
      const count = numeric(batch.data.count);
      const expectedFingerprint = text(batch.data.fingerprint) || undefined;
      const validation = validateRouteMasterChunkSet(
        snapshot.routeMaster.chunks.map((chunk) => ({
          chunkIndex: numeric(chunk.data.chunkIndex),
          items: chunk.data.items,
        })),
        count,
        expectedFingerprint,
      );
      evaluate(!snapshot.routeMaster.chunksTruncated && validation.valid, 'critical', {
        id: 'route-master:chunk-integrity',
        category: 'route-master',
        title: 'Integritas chunk Route Master gagal',
        detail: snapshot.routeMaster.chunksTruncated
          ? 'Pembacaan chunk melewati batas scanner; validasi otomatis tidak dapat dinyatakan lengkap.'
          : validation.errors.join(' ') || 'Chunk Route Master tidak lolos validasi.',
        entityId: activeBatchId,
      });
      evaluate(numeric(meta?.count) === count, 'critical', {
        id: 'route-master:meta-count',
        category: 'route-master',
        title: 'Jumlah mapping pada metadata tidak cocok',
        detail: 'Count pada routeMasterMeta harus sama dengan count pada active batch.',
        entityId: activeBatchId,
      });
    }
  } else {
    evaluate(numeric(meta?.count) === 0, 'critical', {
      id: 'route-master:pointer-missing',
      category: 'route-master',
      title: 'Pointer Route Master kosong tetapi count tidak nol',
      detail: 'Metadata menyimpan jumlah mapping tanpa currentBatchId yang aktif.',
    });
    evaluate(false, 'warning', {
      id: 'route-master:not-configured',
      category: 'route-master',
      title: 'Route Master belum dikonfigurasi',
      detail: 'Belum ada batch Route Master aktif pada workspace ini.',
    });
  }

  for (const operation of snapshot.restoreOperations) {
    const status = text(operation.data.status);
    const lastUpdate = numeric(operation.data.updatedAt) || numeric(operation.data.createdAt);
    if (status === 'running' && lastUpdate > 0 && scannedAt - lastUpdate >= 60 * 60 * 1000) {
      evaluate(false, 'warning', {
        id: 'restore-operation:stale:' + operation.id,
        category: 'restore-operations',
        title: 'Restore operation membutuhkan pemeriksaan',
        detail: 'Aktivitas masih berstatus running, tetapi tidak diperbarui selama minimal satu jam.',
        entityId: operation.id,
      });
    } else {
      evaluate(true, 'warning', {
        id: 'restore-operation:healthy:' + operation.id,
        category: 'restore-operations',
        title: 'Restore operation aktif',
        detail: 'Status dan heartbeat aktivitas restore masih dalam batas normal.',
        entityId: operation.id,
      });
    }
  }

  const historyPartial = snapshot.history.some((item) => item.auditTruncated || item.versionsTruncated)
    || snapshot.history.length < snapshot.incidents.length;
  const partial = snapshot.membersTruncated
    || snapshot.incidentsTruncated
    || snapshot.incidentKeysTruncated
    || historyPartial
    || snapshot.routeMaster.chunksTruncated
    || snapshot.restoreOperationsTruncated;
  evaluate(!partial, 'warning', {
    id: 'coverage:partial',
    category: 'coverage',
    title: 'Pemeriksaan belum mencakup seluruh data',
    detail: 'Sebagian koleksi mencapai batas scan. Hasil ini bersifat parsial dan perlu pemeriksaan lanjutan.',
  });

  const critical = findings.filter((finding) => finding.severity === 'critical').length;
  const warning = findings.filter((finding) => finding.severity === 'warning').length;
  const healthy = Math.max(0, checks - critical - warning);
  const status: IntegrityStatus = critical > 0 ? 'critical' : warning > 0 ? 'warning' : 'healthy';

  return {
    scannedAt,
    status,
    counts: { critical, warning, healthy, checks },
    coverage: {
      membersScanned: snapshot.members.length,
      incidentsScanned: snapshot.incidents.length,
      incidentKeysScanned: snapshot.incidentKeys.length,
      historyIncidentsScanned: snapshot.history.length,
      routeMasterChunksScanned: snapshot.routeMaster.chunks.length,
      restoreOperationsScanned: snapshot.restoreOperations.length,
      partial,
    },
    findings,
    repairs,
  };
}

export function formatIntegrityStatus(status: IntegrityStatus): string {
  if (status === 'critical') return 'Perlu tindakan';
  if (status === 'warning') return 'Perlu perhatian';
  return 'Sehat';
}
