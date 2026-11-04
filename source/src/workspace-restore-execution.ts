import { planSelectiveWorkspaceRestore, type SelectiveRestoreSelection } from './workspace-restore-plan.ts';
import type { WorkspaceImportDryRun } from './workspace-import.ts';
import {
  fingerprintRouteMaster,
  MAX_ROUTE_MASTER_PAIRS,
  ROUTE_MASTER_CHUNK_SIZE,
  type RouteMasterPairValue,
} from './route-master-integrity.ts';

const SETTING_ARRAY_FIELDS = [
  'groups',
  'picAreas',
  'picNames',
  'rootCauses',
  'actions',
  'progressPhrases',
  'sites',
] as const;

const SETTING_NUMBER_FIELDS = [
  'slaCriticalMinutes',
  'slaMajorMinutes',
  'slaMinorMinutes',
  'staleUpdateMinutes',
] as const;

export type WorkspaceRestoreStage =
  | 'validating'
  | 'staging-route-master'
  | 'verifying-route-master'
  | 'applying-settings'
  | 'committing-route-master'
  | 'verifying-active-route-master'
  | 'rolling-back-settings'
  | 'completed'
  | 'failed'
  | 'needs-review';

export interface WorkspaceRestoreSettings {
  groups: string[];
  picAreas: string[];
  picNames: string[];
  rootCauses: string[];
  actions: string[];
  progressPhrases: string[];
  sites: string[];
  slaCriticalMinutes: number;
  slaMajorMinutes: number;
  slaMinorMinutes: number;
  staleUpdateMinutes: number;
}

export interface WorkspaceRestoreProgress {
  stage: WorkspaceRestoreStage;
  completed: number;
  total: number;
  message: string;
}

export interface WorkspaceRestoreExecutionInput {
  bundle: unknown;
  preflight: WorkspaceImportDryRun;
  selection: SelectiveRestoreSelection;
  role: string;
  confirmed: boolean;
  currentSettings: Record<string, unknown>;
  sourceFileName?: string;
}

export interface WorkspaceRestoreActiveRouteMaster {
  items: RouteMasterPairValue[];
  meta: Record<string, unknown> | null;
}

export interface WorkspaceRestoreExecutionDependencies {
  saveSettings(settings: WorkspaceRestoreSettings, expectedUpdatedAt: number): Promise<{ updatedAt: number }>;
  startRouteMasterImport(): Promise<string>;
  addRouteMasterChunk(batchId: string, chunkIndex: number, items: RouteMasterPairValue[]): Promise<void>;
  verifyStagedRouteMaster(batchId: string, expectedCount: number, expectedFingerprint: string): Promise<{ verifiedCount: number }>;
  commitRouteMaster(batchId: string, metadata: Record<string, unknown>): Promise<void>;
  readActiveRouteMaster(): Promise<WorkspaceRestoreActiveRouteMaster>;
  onProgress?(progress: WorkspaceRestoreProgress): void;
}

export interface WorkspaceRestoreExecutionResult {
  status: 'completed' | 'failed' | 'partial' | 'needs-review';
  completedSections: Array<'settings' | 'routeMaster'>;
  stagedBatchId: string | null;
  settingsRolledBack: boolean;
  partial: boolean;
  errors: string[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readWorkspaceRestoreSettings(value: unknown): WorkspaceRestoreSettings | null {
  if (!isRecord(value)) return null;
  const result: Record<string, unknown> = {};
  for (const field of SETTING_ARRAY_FIELDS) {
    const items = value[field];
    if (!Array.isArray(items) || !items.every((item) => typeof item === 'string')) return null;
    result[field] = [...items];
  }
  for (const field of SETTING_NUMBER_FIELDS) {
    const number = value[field];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 1 || number > 1440) return null;
    result[field] = number;
  }
  return result as unknown as WorkspaceRestoreSettings;
}

function sameRouteMasterItems(left: RouteMasterPairValue[], right: RouteMasterPairValue[]): boolean {
  return left.length === right.length && left.every((item, index) =>
    item.systemKey === right[index]?.systemKey && item.routeSegment === right[index]?.routeSegment);
}

function emit(
  dependencies: WorkspaceRestoreExecutionDependencies,
  stage: WorkspaceRestoreStage,
  completed: number,
  total: number,
  message: string,
): void {
  dependencies.onProgress?.({ stage, completed, total, message });
}

function failure(
  errors: string[],
  stagedBatchId: string | null = null,
  status: WorkspaceRestoreExecutionResult['status'] = 'failed',
  warnings: string[] = [],
  settingsRolledBack = false,
): WorkspaceRestoreExecutionResult {
  return {
    status,
    completedSections: [],
    stagedBatchId,
    settingsRolledBack,
    partial: status === 'partial' || status === 'needs-review',
    errors,
    warnings,
  };
}

/**
 * Executes only explicitly selected, admin-writable workspace sections.
 * Route Master is staged and read-verified before the active pointer can change.
 * If the later Route Master commit fails after settings were overwritten, the
 * previous settings snapshot is written back as a compensating operation.
 */
export async function executeSelectiveWorkspaceRestore(
  input: WorkspaceRestoreExecutionInput,
  dependencies: WorkspaceRestoreExecutionDependencies,
): Promise<WorkspaceRestoreExecutionResult> {
  emit(dependencies, 'validating', 0, 1, 'Memvalidasi pilihan dan isi backup.');
  const plan = planSelectiveWorkspaceRestore(input.bundle, input.preflight, input.selection, input.role);
  if (!plan.executable) return failure(plan.errors);
  if (!input.confirmed) return failure(['Konfirmasi eksplisit diperlukan sebelum restore dapat dijalankan.']);

  const root = isRecord(input.bundle) && isRecord(input.bundle.data) ? input.bundle.data : null;
  if (!root) return failure(['Data backup tidak tersedia.']);

  const settings = input.selection.settings ? readWorkspaceRestoreSettings(root.settings) : null;
  if (input.selection.settings && !settings) {
    return failure(['Struktur Workspace Settings pada backup tidak sesuai schema aplikasi.']);
  }
  const previousSettings = input.selection.settings ? readWorkspaceRestoreSettings(input.currentSettings) : null;
  if (input.selection.settings && !previousSettings) {
    return failure(['Snapshot Workspace Settings saat ini tidak valid; restore dibatalkan agar tidak ada overwrite tanpa pemulihan.']);
  }

  const routeMaster = input.selection.routeMaster && Array.isArray(root.routeMaster)
    ? root.routeMaster as RouteMasterPairValue[]
    : [];
  if (input.selection.routeMaster) {
    if (!routeMaster.length || routeMaster.length > MAX_ROUTE_MASTER_PAIRS) {
      return failure(['Route Master backup harus berisi 1 sampai 20.000 mapping.']);
    }
    if (!routeMaster.every((item) => isRecord(item)
      && typeof item.systemKey === 'string' && item.systemKey.trim()
      && typeof item.routeSegment === 'string' && item.routeSegment.trim())) {
      return failure(['Terdapat mapping Route Master yang tidak valid.']);
    }
  }

  const completedSections: WorkspaceRestoreExecutionResult['completedSections'] = [];
  let expectedCurrentBatchId: string | null = null;
  if (input.selection.routeMaster) {
    const currentActive = await dependencies.readActiveRouteMaster();
    expectedCurrentBatchId = typeof currentActive.meta?.currentBatchId === 'string'
      ? currentActive.meta.currentBatchId
      : null;
  }
  let settingsUpdatedAtAfterApply: number | null = null;
  const warnings = [
    'Members, incidents, audit trail, dan version history tidak disentuh.',
    'Batch Route Master sebelumnya dipertahankan; batch aktif hanya berganti setelah staging dan verifikasi berhasil.',
  ];
  let stagedBatchId: string | null = null;
  let settingsApplied = false;
  let routeMasterCommitted = false;
  let routeMasterCommitAcknowledged = false;
  const expectedFingerprint = input.selection.routeMaster ? fingerprintRouteMaster(routeMaster) : '';

  try {
    if (input.selection.routeMaster) {
      emit(dependencies, 'staging-route-master', 0, routeMaster.length, 'Membuat batch Route Master terpisah.');
      stagedBatchId = await dependencies.startRouteMasterImport();
      if (!stagedBatchId.trim()) throw new Error('Batch staging Route Master tidak berhasil dibuat.');

      for (let offset = 0; offset < routeMaster.length; offset += ROUTE_MASTER_CHUNK_SIZE) {
        const chunk = routeMaster.slice(offset, offset + ROUTE_MASTER_CHUNK_SIZE);
        const chunkIndex = Math.floor(offset / ROUTE_MASTER_CHUNK_SIZE);
        await dependencies.addRouteMasterChunk(stagedBatchId, chunkIndex, chunk);
        emit(dependencies, 'staging-route-master', Math.min(offset + chunk.length, routeMaster.length), routeMaster.length,
          `Mengunggah chunk ${chunkIndex + 1} dari ${Math.ceil(routeMaster.length / ROUTE_MASTER_CHUNK_SIZE)}.`);
      }

      emit(dependencies, 'verifying-route-master', 0, routeMaster.length, 'Membaca ulang seluruh chunk sebelum commit.');
      const verification = await dependencies.verifyStagedRouteMaster(stagedBatchId, routeMaster.length, expectedFingerprint);
      if (verification.verifiedCount !== routeMaster.length) {
        throw new Error(`Verifikasi Route Master gagal: ${verification.verifiedCount} dari ${routeMaster.length} mapping terbaca.`);
      }
      emit(dependencies, 'verifying-route-master', routeMaster.length, routeMaster.length, 'Semua mapping staging cocok dengan backup.');
    }

    if (input.selection.settings && settings) {
      emit(dependencies, 'applying-settings', 0, 1, 'Mengganti Workspace Settings sesuai backup.');
      const savedSettings = await dependencies.saveSettings(
        settings,
        Number(input.currentSettings.updatedAt) || 0,
      );
      settingsUpdatedAtAfterApply = savedSettings.updatedAt;
      settingsApplied = true;
      emit(dependencies, 'applying-settings', 1, 1, 'Workspace Settings berhasil ditulis.');
    }

    if (input.selection.routeMaster && stagedBatchId) {
      emit(dependencies, 'committing-route-master', 0, 1, 'Mengalihkan pointer ke batch Route Master baru.');
      const metadata = {
        totalCount: routeMaster.length,
        expectedCurrentBatchId,
        fileName: `Backup restore · ${(input.sourceFileName || 'workspace backup').slice(0, 180)}`,
        sheetName: 'Route Master backup',
        systemKeyColumn: 'systemKey',
        routeSegmentColumn: 'routeSegment',
      };
      try {
        await dependencies.commitRouteMaster(stagedBatchId, metadata);
        routeMasterCommitAcknowledged = true;
      } catch (commitError) {
        // A lost response can occur after the atomic Firestore batch already committed.
        let active: WorkspaceRestoreActiveRouteMaster;
        try {
          active = await dependencies.readActiveRouteMaster();
        } catch {
          return failure(
            ['Hasil commit Route Master belum dapat dipastikan. Jangan jalankan restore ulang sebelum memeriksa Route Master aktif.'],
            stagedBatchId,
            'needs-review',
            [...warnings, 'Status aktif tidak dapat dibaca setelah respons commit gagal; Workspace Settings tidak dikembalikan otomatis karena commit mungkin sudah berhasil.'],
          );
        }
        if (active.meta?.currentBatchId !== stagedBatchId || !sameRouteMasterItems(active.items, routeMaster)) {
          throw commitError;
        }
        routeMasterCommitAcknowledged = true;
        warnings.push('Respons commit Route Master terputus, tetapi batch aktif berhasil diverifikasi setelahnya.');
      }

      emit(dependencies, 'verifying-active-route-master', 0, routeMaster.length, 'Memastikan batch aktif menunjuk ke isi backup.');
      const active = await dependencies.readActiveRouteMaster();
      if (active.meta?.currentBatchId !== stagedBatchId || !sameRouteMasterItems(active.items, routeMaster)) {
        throw new Error('Batch Route Master belum terverifikasi sebagai batch aktif setelah commit.');
      }
      routeMasterCommitted = true;
      emit(dependencies, 'verifying-active-route-master', routeMaster.length, routeMaster.length, 'Batch aktif cocok dengan backup.');
    }

    if (input.selection.settings) completedSections.push('settings');
    if (input.selection.routeMaster) completedSections.push('routeMaster');
    emit(dependencies, 'completed', 1, 1, 'Selective restore selesai dan hasilnya terverifikasi.');
    return {
      status: 'completed',
      completedSections,
      stagedBatchId,
      settingsRolledBack: false,
      partial: false,
      errors: [],
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Selective restore gagal.';
    if (settingsApplied && input.selection.routeMaster && routeMasterCommitAcknowledged && !routeMasterCommitted) {
      return failure(
        [message, 'Commit Route Master sudah diakui tetapi status aktif belum dapat diverifikasi.'],
        stagedBatchId,
        'needs-review',
        [...warnings, 'Workspace Settings tidak dikembalikan otomatis karena batch Route Master mungkin sudah aktif. Periksa batch aktif sebelum tindakan lanjutan.'],
      );
    }
    if (settingsApplied && input.selection.routeMaster && !routeMasterCommitted && !routeMasterCommitAcknowledged && previousSettings) {
      emit(dependencies, 'rolling-back-settings', 0, 1, 'Commit Route Master gagal; mengembalikan Workspace Settings sebelumnya.');
      try {
        if (settingsUpdatedAtAfterApply === null) {
          throw new Error('Versi hasil penulisan Settings tidak tersedia untuk rollback bersyarat.');
        }
        await dependencies.saveSettings(previousSettings, settingsUpdatedAtAfterApply);
        emit(dependencies, 'rolling-back-settings', 1, 1, 'Workspace Settings sebelumnya berhasil dikembalikan.');
        return failure(
          [message],
          stagedBatchId,
          'failed',
          [...warnings, 'Workspace Settings dikembalikan ke snapshot sebelum restore. Batch Route Master lama tetap aktif.'],
          true,
        );
      } catch (rollbackError) {
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : 'Rollback Workspace Settings gagal.';
        return failure(
          [message, 'Rollback Workspace Settings juga gagal: ' + rollbackMessage],
          stagedBatchId,
          'partial',
          [...warnings, 'Periksa Workspace Settings secara manual. Batch Route Master lama tetap aktif kecuali status commit masih perlu diverifikasi.'],
          false,
        );
      }
    }
    return failure(
      [message],
      stagedBatchId,
      'failed',
      [...warnings, stagedBatchId ? 'Batch staging yang gagal dibiarkan terisolasi dan tidak menjadi batch aktif.' : 'Tidak ada batch staging yang dibuat.'],
    );
  }
}
