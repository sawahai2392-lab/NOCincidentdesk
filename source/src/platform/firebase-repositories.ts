import {
  collection,
  doc,
  documentId,
  getDoc as firestoreGetDoc,
  getDocs as firestoreGetDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction as firestoreRunTransaction,
  setDoc as firestoreSetDoc,
  startAfter,
  Timestamp,
  where,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { firestore } from './firebase';
import { recordBatchWrite, recordDirectWrite, recordDocumentRead, recordListenerSnapshot, recordListenerStart, recordListenerStop, recordQueryRead, recordTransaction } from '../firestore-usage';
import { decodeIncidentPageCursor, encodeIncidentPageCursor } from '../incident-pagination';
import { createWorkspaceBackupBundle, type WorkspaceBackupBundle } from '../workspace-backup';
import { validateRouteMasterChunkSet } from '../route-master-integrity';
import {
  STALE_ROUTE_MASTER_BATCH_MS,
  type RestoreOperationKind,
  type RestoreOperationStatus,
} from '../workspace-restore-recovery';
import {
  buildWorkspaceIntegrityReport,
  type WorkspaceIntegrityRepair,
  type WorkspaceIntegritySnapshot,
} from '../workspace-integrity';
import { isFirestoreIncidentPayloadSafe, measureFirestoreDocumentBytes, MAX_FIRESTORE_INCIDENT_DOCUMENT_BYTES } from '../firestore-payload';
import {
  defaultSettings,
  emptyIncident,
  newId,
  type AuditEntry,
  type BootstrapData,
  type Incident,
  type IncidentVersion,
  type Member,
  type Profile,
  type Role,
  type SettingsData,
} from '../domain';


// Preserve the SDK overloads at call sites while delegating through Reflect.apply.
// Parameters<> collapses Firebase's overloads and loses the snapshot generics.
const getDoc = ((...args: any[]) => {
  const pending = Reflect.apply(firestoreGetDoc, undefined, args);
  return pending.then((snapshot: Awaited<typeof pending>) => {
    recordDocumentRead();
    return snapshot;
  });
}) as typeof firestoreGetDoc;

const getDocs = ((...args: any[]) => {
  const pending = Reflect.apply(firestoreGetDocs, undefined, args);
  return pending.then((snapshot: Awaited<typeof pending>) => {
    recordQueryRead(snapshot.size);
    return snapshot;
  });
}) as typeof firestoreGetDocs;

const setDoc = ((...args: any[]) => {
  const pending = Reflect.apply(firestoreSetDoc, undefined, args);
  return pending.then(() => {
    recordDirectWrite();
  });
}) as typeof firestoreSetDoc;

const runTransaction = ((...args: any[]) => {
  recordTransaction();
  return Reflect.apply(firestoreRunTransaction, undefined, args);
}) as typeof firestoreRunTransaction;

const now = () => Date.now();
const workspacePath = (workspaceId: string) => 'workspaces/' + workspaceId;
const membersPath = (workspaceId: string) => workspacePath(workspaceId) + '/members';
const incidentsPath = (workspaceId: string) => workspacePath(workspaceId) + '/incidents';
const settingsPath = (workspaceId: string) => workspacePath(workspaceId) + '/settings/main';
const auditPath = (workspaceId: string, incidentId: string) =>
  incidentsPath(workspaceId) + '/' + incidentId + '/audit';
const versionsPath = (workspaceId: string, incidentId: string) =>
  incidentsPath(workspaceId) + '/' + incidentId + '/versions';
const normalizeKey = (value: string) =>
  value.normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const keyDocumentId = (value: string) => encodeURIComponent(normalizeKey(value)).replace(/\./g, '%2E');

export class FirebaseRepositoryError extends Error {
  code: string;
  current?: Incident;

  constructor(code: string, message: string, current?: Incident) {
    super(message);
    this.name = 'FirebaseRepositoryError';
    this.code = code;
    this.current = current;
  }
}

export interface WorkspaceContext {
  profile: Profile;
  user: User;
}

function asProfile(data: DocumentData, uid: string): Profile {
  return {
    id: uid,
    userId: uid,
    workspaceId: String(data.workspaceId || ''),
    role: (data.role === 'admin' || data.role === 'supervisor' ? data.role : 'operator') as Role,
    email: String(data.email || ''),
    name: String(data.name || data.displayName || 'NOC User'),
  };
}

export async function ensureWorkspace(user: User): Promise<WorkspaceContext> {
  const userRef = doc(firestore, 'users', user.uid);
  const existing = await getDoc(userRef);

  if (existing.exists()) {
    const userData = existing.data();
    const workspaceId = String(userData.workspaceId || '');
    if (!workspaceId) {
      throw new FirebaseRepositoryError(
        'workspace_not_initialized',
        'Profil akun belum memiliki workspace. Hubungi Admin untuk pemulihan akses.',
      );
    }
    const memberRef = doc(firestore, membersPath(workspaceId), user.uid);
    const member = await getDoc(memberRef);
    if (!member.exists() || member.data().status === 'removed') {
      throw new FirebaseRepositoryError(
        'workspace_membership_missing',
        'Akun ini tidak memiliki keanggotaan workspace yang aktif.',
      );
    }
    // Workspace membership is the source of truth for role changes.
    const profile = asProfile({ ...userData, ...member.data(), workspaceId }, user.uid);
    return { profile, user };
  }

  const workspaceRef = doc(collection(firestore, 'workspaces'));
  const workspaceId = workspaceRef.id;
  const createdAt = now();
  const profile: Profile = {
    id: user.uid,
    userId: user.uid,
    workspaceId,
    role: 'admin',
    email: user.email || '',
    name: user.displayName || user.email?.split('@')[0] || 'Admin NOC',
  };
  const memberRef = doc(firestore, membersPath(workspaceId), user.uid);
  const settingsRef = doc(firestore, settingsPath(workspaceId));

  // Re-check the user document inside the transaction so two first-login tabs
  // cannot create orphan workspaces for the same Auth account.
  const created = await runTransaction(firestore, async (transaction) => {
    const latestUser = await transaction.get(userRef);
    if (latestUser.exists()) return false;

    transaction.set(workspaceRef, {
      name: 'NOC Workspace',
      ownerUid: user.uid,
      createdAt,
      updatedAt: createdAt,
      status: 'active',
    });
    transaction.set(memberRef, {
      ...profile,
      joinedAt: createdAt,
      status: 'active',
    });
    transaction.set(userRef, {
      uid: user.uid,
      workspaceId,
      role: 'admin',
      email: user.email || '',
      name: profile.name,
      photoURL: user.photoURL || '',
      createdAt,
      updatedAt: createdAt,
    });
    transaction.set(settingsRef, {
      ...defaultSettings,
      updatedAt: createdAt,
      updatedBy: user.uid,
    });
    return true;
  });

  if (!created) return ensureWorkspace(user);
  return { profile, user };
}

export function normalizeIncidentSnapshot(value: DocumentData, id: string): Incident {
  const base = emptyIncident(String(value.reporter || ''));
  const defined = Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
  const merged = { ...base, ...defined } as Incident;
  const checklist = value.checklist && typeof value.checklist === 'object' && !Array.isArray(value.checklist)
    ? value.checklist as Partial<Incident['checklist']>
    : {};
  return {
    ...merged,
    id,
    identityMode: value.identityMode === 'b2b' ? 'b2b' : 'standard',
    status: typeof value.status === 'string' ? value.status as Incident['status'] : base.status,
    severity: typeof value.severity === 'string' ? value.severity as Incident['severity'] : base.severity,
    condition: typeof value.condition === 'string' ? value.condition as Incident['condition'] : base.condition,
    occurTime: typeof value.occurTime === 'string' ? value.occurTime : '',
    progress: Array.isArray(value.progress) ? value.progress as Incident['progress'] : [],
    impacts: Array.isArray(value.impacts) ? value.impacts as Incident['impacts'] : [],
    cutPoints: Array.isArray(value.cutPoints) ? value.cutPoints as Incident['cutPoints'] : [],
    geoCoordinates: Array.isArray(value.geoCoordinates) ? value.geoCoordinates as Incident['geoCoordinates'] : [],
    attachments: Array.isArray(value.attachments) ? value.attachments : [],
    checklist: { ...base.checklist, ...checklist },
    revision: Number(value.revision) > 0 ? Number(value.revision) : 1,
    createdAt: Number(value.createdAt) || 0,
    updatedAt: Number(value.updatedAt) || Number(value.createdAt) || 0,
    deletedAt: Number(value.deletedAt) || 0,
  };
}

export async function bootstrapWorkspace(user: User): Promise<BootstrapData> {
  const context = await ensureWorkspace(user);
  const workspaceId = context.profile.workspaceId;

  const [incidentSnapshot, memberSnapshot, settingsSnapshot] = await Promise.all([
    getDocs(query(collection(firestore, incidentsPath(workspaceId)), orderBy('updatedAt', 'desc'), orderBy(documentId(), 'desc'), limit(100))),
    getDocs(query(collection(firestore, membersPath(workspaceId)), orderBy('joinedAt', 'asc'), limit(100))),
    getDoc(doc(firestore, settingsPath(workspaceId))),
  ]);

  const incidents = incidentSnapshot.docs.map((snapshot) => normalizeIncidentSnapshot(snapshot.data(), snapshot.id));
  const members = memberSnapshot.docs
    .filter((snapshot) => snapshot.data().status !== 'removed')
    .map((snapshot) => ({ ...snapshot.data(), id: snapshot.id })) as Member[];
  const settings = settingsSnapshot.exists()
    ? ({ ...defaultSettings, ...settingsSnapshot.data(), id: settingsSnapshot.id } as SettingsData)
    : { ...defaultSettings };

  return {
    profile: context.profile,
    members,
    incidents,
    incidentsNextToken: incidentSnapshot.docs.length === 100
      ? encodeIncidentPageCursor({
          updatedAt: Number(incidentSnapshot.docs[incidentSnapshot.docs.length - 1].data().updatedAt) || 0,
          id: incidentSnapshot.docs[incidentSnapshot.docs.length - 1].id,
        })
      : null,
    settings,
  };
}

export async function loadIncidentPage(
  workspaceId: string,
  nextToken: string,
): Promise<{ incidents: Incident[]; nextToken: string | null }> {
  const cursor = decodeIncidentPageCursor(nextToken);
  if (!cursor) {
    throw new FirebaseRepositoryError('invalid_page_cursor', 'Cursor halaman incident tidak valid. Muat ulang daftar incident.');
  }
  const snapshot = await getDocs(
    query(
      collection(firestore, incidentsPath(workspaceId)),
      orderBy('updatedAt', 'desc'),
      orderBy(documentId(), 'desc'),
      startAfter(cursor.updatedAt, cursor.id),
      limit(100),
    ),
  );
  const last = snapshot.docs[snapshot.docs.length - 1];
  return {
    incidents: snapshot.docs.map((item) => normalizeIncidentSnapshot(item.data(), item.id)),
    nextToken: snapshot.docs.length === 100 && last
      ? encodeIncidentPageCursor({ updatedAt: Number(last.data().updatedAt) || 0, id: last.id })
      : null,
  };
}

function incidentKeyRef(workspaceId: string, incidentId: string) {
  return doc(firestore, workspacePath(workspaceId) + '/incidentKeys', keyDocumentId(incidentId));
}

function changedFields(before: Incident | null, after: Incident): string[] {
  if (!before) return Object.keys(after);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) =>
    JSON.stringify((before as unknown as Record<string, unknown>)[key]) !==
    JSON.stringify((after as unknown as Record<string, unknown>)[key]),
  );
}

type IncidentRole = Role;

function progressIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((row) => String((row as { id?: unknown })?.id || '').trim())
    : [];
}

function progressHistoryChangeIsValid(beforeValue: unknown, afterValue: unknown): boolean {
  const beforeIds = progressIds(beforeValue);
  const afterIds = progressIds(afterValue);
  if (beforeIds.some((id) => !id) || new Set(beforeIds).size !== beforeIds.length) return false;
  if (afterIds.some((id) => !id) || new Set(afterIds).size !== afterIds.length) return false;

  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);
  const retainedBefore = beforeIds.filter((id) => afterSet.has(id));
  const retainedAfter = afterIds.filter((id) => beforeSet.has(id));
  if (retainedBefore.length !== retainedAfter.length
    || retainedBefore.some((id, index) => id !== retainedAfter[index])) return false;

  const firstNewIndex = afterIds.findIndex((id) => !beforeSet.has(id));
  return firstNewIndex < 0 || !afterIds.slice(firstNewIndex).some((id) => beforeSet.has(id));
}

function statusTransitionError(current: Incident, next: Incident, role: IncidentRole): string {
  if (current.status === next.status) return '';
  const allowed: Record<string, string[]> = {
    Draft: ['Open', 'Cancel'],
    Open: ['Monitoring', 'Resolved', 'Cancel'],
    Monitoring: ['Open', 'Resolved', 'Cancel'],
    Resolved: ['Closed', 'Open'],
    Closed: ['Open'],
    Cancel: ['Open'],
  };
  if (!(allowed[current.status] || []).includes(next.status)) return 'invalid_status_transition';
  const operatorAllowed =
    (current.status === 'Draft' && next.status === 'Open')
    || (current.status === 'Open' && next.status === 'Monitoring')
    || (current.status === 'Monitoring' && next.status === 'Open');
  if (role === 'operator' && !operatorAllowed) return 'supervisor_required_to_close';
  if (['Resolved', 'Closed', 'Cancel'].includes(current.status)
    && next.status === 'Open'
    && !next.reopenReason.trim()) return 'reopen_reason_required';
  return '';
}

function validateIncidentPayload(incident: Incident, current?: Incident): string {
  if (incident.status !== 'Draft') {
    if (incident.identityMode === 'b2b') {
      if (!incident.b2bTitle.trim()) return 'b2b_title_required';
    } else {
      const legacyIdentity = Boolean(current && (
        current.incidentId.trim()
        || (current.group.trim() && current.linkA.trim() && current.linkB.trim())
      ));
      if (!incident.titleOverride.trim() && !legacyIdentity) return 'title_required';
    }
  }

  const occurAt = Date.parse(incident.occurTime || '');
  const dispatchAt = Date.parse(incident.dispatchTime || '');
  const closedAt = Date.parse(incident.closedTime || '');
  if (Number.isFinite(dispatchAt) && Number.isFinite(occurAt) && dispatchAt < occurAt) {
    return 'dispatch_before_occur';
  }

  const latestProgressAt = (incident.progress || []).reduce((latest, row) => {
    const parsed = Date.parse(`${row.date}T${row.time}`);
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);
  if (Number.isFinite(closedAt) && latestProgressAt && closedAt < latestProgressAt) {
    return 'closed_before_latest_progress';
  }

  if (incident.status === 'Resolved' || incident.status === 'Closed') {
    if (!(incident.progress || []).some((row) => /normal|closed|clear|recovered|recovery/i.test(row.text || ''))) {
      return 'recovery_update_required';
    }
  }

  if (incident.status === 'Closed') {
    const checklist = incident.checklist;
    if (!incident.closedTime) return 'closed_time_required';
    if (!checklist || !['statementWag', 'ticketStatus', 'photo', 'rfo', 'closedEmail'].every((key) =>
      Boolean(checklist[key as keyof typeof checklist]))) return 'closing_checklist_incomplete';
    if (!incident.closingEvidenceNote.trim()) return 'closing_evidence_required';
  }

  if (current?.deletedAt) return 'incident_in_trash';
  return '';
}

function normalizeIncidentRecord(
  value: Partial<Incident>,
  user: User,
  previous?: Incident,
): Incident {
  const timestamp = now();
  const id = previous?.id || value.id || newId();
  return {
    ...(value as Incident),
    id,
    attachments: previous?.attachments || [],
    createdAt: previous?.createdAt || timestamp,
    createdBy: previous?.createdBy || user.uid,
    updatedAt: timestamp,
    updatedBy: user.uid,
    revision: previous ? previous.revision + 1 : 1,
    progress: Array.isArray(value.progress) ? value.progress.slice(-500) : previous?.progress || [],
    impacts: Array.isArray(value.impacts) ? value.impacts.slice(0, 200) : previous?.impacts || [],
    cutPoints: Array.isArray(value.cutPoints) ? value.cutPoints.slice(0, 20) : previous?.cutPoints || [],
    geoCoordinates: Array.isArray(value.geoCoordinates) ? value.geoCoordinates.slice(0, 20) : previous?.geoCoordinates || [],
  };
}

export async function createIncident(
  workspaceId: string,
  user: User,
  value: Partial<Incident>,
): Promise<Incident> {
  const id = newId();
  const incident = normalizeIncidentRecord({ ...value, id }, user);
  const payload = { ...incident, normalizedIncidentId: normalizeKey(incident.incidentId) };
  if (!isFirestoreIncidentPayloadSafe(payload)) {
    const sizeKb = Math.ceil(measureFirestoreDocumentBytes(payload) / 1024);
    throw new FirebaseRepositoryError('incident_payload_too_large', `Data incident ${sizeKb} KiB melebihi batas aman ${Math.round(MAX_FIRESTORE_INCIDENT_DOCUMENT_BYTES / 1024)} KiB. Ringkas progress atau teks yang terlalu panjang sebelum menyimpan.`);
  }
  const validationError = validateIncidentPayload(incident);
  if (validationError) {
    throw new FirebaseRepositoryError(validationError, 'Data incident belum memenuhi validasi workflow.');
  }
  const incidentRef = doc(firestore, incidentsPath(workspaceId), id);
  const auditRef = doc(collection(firestore, auditPath(workspaceId, id)));
  const normalized = normalizeKey(incident.incidentId);
  const keyRef = normalized ? incidentKeyRef(workspaceId, incident.incidentId) : null;

  await runTransaction(firestore, async (transaction) => {
    if (keyRef) {
      const keySnapshot = await transaction.get(keyRef);
      if (keySnapshot.exists()) {
        throw new FirebaseRepositoryError('duplicate_incident_id', 'Incident ID sudah digunakan.');
      }
    }
    transaction.set(incidentRef, { ...incident, normalizedIncidentId: normalized });
    transaction.set(auditRef, {
      action: 'created',
      summary: 'Incident dibuat',
      changedFields: Object.keys(incident),
      fromRevision: 0,
      toRevision: 1,
      actorId: user.uid,
      actorName: user.displayName || user.email || 'NOC User',
      createdAt: now(),
    });
    if (keyRef) {
      transaction.set(keyRef, { incidentId: id, normalizedKey: normalized, active: true });
    }
  });
  return incident;
}

export async function saveIncident(
  workspaceId: string,
  user: User,
  value: Incident,
  auditContext: { action?: string; summary?: string; sourceVersionId?: string } = {},
): Promise<Incident> {
  const incidentRef = doc(firestore, incidentsPath(workspaceId), value.id);
  const auditRef = doc(collection(firestore, auditPath(workspaceId, value.id)));
  const nextNormalized = normalizeKey(value.incidentId);

  return runTransaction(firestore, async (transaction) => {
    const [currentSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(incidentRef),
      transaction.get(doc(firestore, membersPath(workspaceId), user.uid)),
    ]);
    if (!currentSnapshot.exists()) {
      throw new FirebaseRepositoryError('incident_not_found', 'Incident tidak ditemukan.');
    }
    if (!memberSnapshot.exists() || memberSnapshot.data().status !== 'active') {
      throw new FirebaseRepositoryError('workspace_membership_missing', 'Keanggotaan workspace tidak aktif.');
    }

    const current = normalizeIncidentSnapshot(currentSnapshot.data(), currentSnapshot.id);
    if (current.deletedAt) {
      throw new FirebaseRepositoryError('incident_in_trash', 'Incident berada di Trash.');
    }
    if (value.revision !== current.revision) {
      throw new FirebaseRepositoryError('revision_conflict', 'Data incident sudah berubah di perangkat lain.', current);
    }

    const role = memberSnapshot.data().role as Role;
    const next = normalizeIncidentRecord(value, user, current);
    const transitionError = statusTransitionError(current, next, role);
    if (transitionError) {
      throw new FirebaseRepositoryError(transitionError, 'Perubahan status tidak sesuai workflow atau role akun.');
    }
    if (!progressHistoryChangeIsValid(current.progress, next.progress)) {
      throw new FirebaseRepositoryError('progress_history_immutable', 'Urutan progress lama tidak boleh diubah; update baru harus ditambahkan di akhir timeline.');
    }
    const payload = { ...next, normalizedIncidentId: nextNormalized };
    if (!isFirestoreIncidentPayloadSafe(payload)) {
      const sizeKb = Math.ceil(measureFirestoreDocumentBytes(payload) / 1024);
      throw new FirebaseRepositoryError('incident_payload_too_large', `Data incident ${sizeKb} KiB melebihi batas aman ${Math.round(MAX_FIRESTORE_INCIDENT_DOCUMENT_BYTES / 1024)} KiB. Ringkas progress atau teks yang terlalu panjang sebelum menyimpan.`, current);
    }
    const validationError = validateIncidentPayload(next, current);
    if (validationError) {
      throw new FirebaseRepositoryError(validationError, 'Data incident belum memenuhi validasi workflow.');
    }

    const previousNormalized = normalizeKey(current.incidentId);
    const nextKeyRef = nextNormalized ? incidentKeyRef(workspaceId, value.incidentId) : null;
    const previousKeyRef = previousNormalized ? incidentKeyRef(workspaceId, current.incidentId) : null;

    let nextKeySnapshot = null;
    let previousKeySnapshot = null;
    if (nextKeyRef && nextNormalized !== previousNormalized) {
      nextKeySnapshot = await transaction.get(nextKeyRef);
      if (nextKeySnapshot.exists() && nextKeySnapshot.data().incidentId !== value.id) {
        throw new FirebaseRepositoryError('duplicate_incident_id', 'Incident ID sudah digunakan.');
      }
    }
    if (previousKeyRef && previousNormalized !== nextNormalized) {
      previousKeySnapshot = await transaction.get(previousKeyRef);
    }

    const fields = changedFields(current, next);
    transaction.set(incidentRef, { ...next, normalizedIncidentId: nextNormalized });
    transaction.set(auditRef, {
      action: auditContext.action || 'updated',
      summary: auditContext.summary || 'Incident diperbarui',
      changedFields: fields,
      fromRevision: current.revision,
      toRevision: next.revision,
      ...(auditContext.sourceVersionId ? { sourceVersionId: auditContext.sourceVersionId } : {}),
      actorId: user.uid,
      actorName: user.displayName || user.email || 'NOC User',
      createdAt: now(),
    });
    if (previousKeyRef && previousKeySnapshot?.exists()) transaction.delete(previousKeyRef);
    if (nextKeyRef) transaction.set(nextKeyRef, { incidentId: value.id, normalizedKey: nextNormalized, active: true });
    return next;
  });
}

export async function softDeleteIncident(
  workspaceId: string,
  user: User,
  incidentId: string,
  reason = '',
): Promise<Incident> {
  const reference = doc(firestore, incidentsPath(workspaceId), incidentId);
  const auditRef = doc(collection(firestore, auditPath(workspaceId, incidentId)));
  return runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new FirebaseRepositoryError('incident_not_found', 'Incident tidak ditemukan.');
    const current = normalizeIncidentSnapshot(snapshot.data(), snapshot.id);
    if (current.deletedAt) throw new FirebaseRepositoryError('incident_already_in_trash', 'Incident sudah berada di Trash.');
    const keyRef = current.incidentId.trim()
      ? incidentKeyRef(workspaceId, current.incidentId)
      : null;
    const keySnapshot = keyRef ? await transaction.get(keyRef) : null;
    const next = {
      ...current,
      deletedAt: now(),
      deletedBy: user.uid,
      deleteReason: reason,
      updatedAt: now(),
      updatedBy: user.uid,
      revision: current.revision + 1,
    };
    transaction.set(reference, next);
    if (keyRef && keySnapshot?.exists()) transaction.delete(keyRef);
    transaction.set(auditRef, {
      action: 'deleted',
      summary: 'Incident dipindahkan ke Trash',
      changedFields: ['deletedAt', 'deletedBy', 'deleteReason'],
      fromRevision: current.revision,
      toRevision: next.revision,
      actorId: user.uid,
      actorName: user.displayName || user.email || 'NOC User',
      createdAt: now(),
    });
    return next;
  });
}

export async function restoreIncident(
  workspaceId: string,
  user: User,
  incidentId: string,
): Promise<Incident> {
  const reference = doc(firestore, incidentsPath(workspaceId), incidentId);
  const auditRef = doc(collection(firestore, auditPath(workspaceId, incidentId)));
  return runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new FirebaseRepositoryError('trashed_incident_not_found', 'Incident tidak ditemukan.');
    const current = normalizeIncidentSnapshot(snapshot.data(), snapshot.id);
    if (!current.deletedAt) throw new FirebaseRepositoryError('incident_not_in_trash', 'Incident tidak berada di Trash.');

    const keyRef = current.incidentId.trim() ? incidentKeyRef(workspaceId, current.incidentId) : null;
    const keySnapshot = keyRef ? await transaction.get(keyRef) : null;
    if (keySnapshot?.exists() && keySnapshot.data().incidentId !== incidentId) {
      throw new FirebaseRepositoryError('duplicate_incident_id', 'Incident ID sudah digunakan oleh incident lain.');
    }

    const next = {
      ...current,
      deletedAt: 0,
      deletedBy: '',
      deleteReason: '',
      updatedAt: now(),
      updatedBy: user.uid,
      revision: current.revision + 1,
    };
    transaction.set(reference, { ...next, normalizedIncidentId: normalizeKey(next.incidentId) });
    if (keyRef) {
      transaction.set(keyRef, {
        incidentId,
        normalizedKey: normalizeKey(next.incidentId),
        active: true,
      });
    }
    transaction.set(auditRef, {
      action: 'restored',
      summary: 'Incident dipulihkan dari Trash',
      changedFields: ['deletedAt', 'deletedBy', 'deleteReason'],
      fromRevision: current.revision,
      toRevision: next.revision,
      actorId: user.uid,
      actorName: user.displayName || user.email || 'NOC User',
      createdAt: now(),
    });
    return next;
  });
}

export async function purgeIncident(workspaceId: string, incidentId: string): Promise<void> {
  const reference = doc(firestore, incidentsPath(workspaceId), incidentId);
  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) return;

  const incident = normalizeIncidentSnapshot(snapshot.data(), incidentId);
  if (!incident.deletedAt) {
    throw new FirebaseRepositoryError(
      'incident_must_be_trashed',
      'Pindahkan incident ke Trash sebelum menghapus permanen.',
    );
  }

  // Firestore Security Rules cannot verify that every document in arbitrary
  // subcollections has been deleted. A client-side cascade could therefore
  // leave orphaned audit/version records after a partial failure. Keep the
  // record in Trash until a trusted purge workflow is available.
  throw new FirebaseRepositoryError(
    'permanent_purge_unavailable',
    'Penghapusan permanen dinonaktifkan pada mode Firebase Spark-only. Incident tetap tersimpan di Trash agar audit dan version history tidak terhapus sebagian.',
  );
}

export async function duplicateIncident(
  workspaceId: string,
  user: User,
  sourceId: string,
): Promise<Incident> {
  const snapshot = await getDoc(doc(firestore, incidentsPath(workspaceId), sourceId));
  if (!snapshot.exists()) throw new FirebaseRepositoryError('incident_not_found', 'Incident tidak ditemukan.');
  const source = normalizeIncidentSnapshot(snapshot.data(), snapshot.id);
  const copy: Partial<Incident> = {
    ...source,
    id: undefined,
    status: 'Draft',
    incidentId: '',
    mduTicket: '',
    closedTime: '',
    resolvedAt: 0,
    resolvedBy: '',
    deletedAt: 0,
    deletedBy: '',
    deleteReason: '',
    attachments: [],
    progress: [],
  };
  return createIncident(workspaceId, user, copy);
}

export async function readVersions(workspaceId: string, incidentId: string): Promise<IncidentVersion[]> {
  const snapshot = await getDocs(
    query(collection(firestore, versionsPath(workspaceId, incidentId)), orderBy('createdAt', 'desc'), limit(50)),
  );
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id })) as IncidentVersion[];
}

export async function readAudit(workspaceId: string, incidentId: string): Promise<AuditEntry[]> {
  const snapshot = await getDocs(
    query(collection(firestore, auditPath(workspaceId, incidentId)), orderBy('createdAt', 'desc'), limit(100)),
  );
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id })) as AuditEntry[];
}

export async function createVersion(
  workspaceId: string,
  user: User,
  incidentId: string,
  label: string,
  expectedRevision: number,
): Promise<IncidentVersion> {
  const incidentRef = doc(firestore, incidentsPath(workspaceId), incidentId);
  const versionRef = doc(collection(firestore, versionsPath(workspaceId, incidentId)));
  const auditRef = doc(collection(firestore, auditPath(workspaceId, incidentId)));
  return runTransaction(firestore, async (transaction) => {
    const [incidentSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(incidentRef),
      transaction.get(doc(firestore, membersPath(workspaceId), user.uid)),
    ]);
    if (!incidentSnapshot.exists()) {
      throw new FirebaseRepositoryError('incident_not_found', 'Incident tidak ditemukan.');
    }
    if (!memberSnapshot.exists() || memberSnapshot.data().status !== 'active') {
      throw new FirebaseRepositoryError('workspace_membership_missing', 'Keanggotaan workspace tidak aktif.');
    }
    const incident = normalizeIncidentSnapshot(incidentSnapshot.data(), incidentSnapshot.id);
    if (incident.deletedAt) {
      throw new FirebaseRepositoryError('incident_in_trash', 'Incident di Trash tidak dapat dibuatkan snapshot.');
    }
    if (incident.revision !== expectedRevision) {
      throw new FirebaseRepositoryError('revision_conflict', 'Incident berubah sebelum snapshot dibuat.', incident);
    }
    const createdAt = now();
    const auditId = auditRef.id;
    const version: IncidentVersion = {
      id: versionRef.id,
      label: label.slice(0, 180),
      // Store the exact persisted document shape so Security Rules can verify
      // the snapshot matches the incident read in this transaction.
      incident: { ...incidentSnapshot.data(), id: incidentSnapshot.id } as Incident,
      revision: incident.revision,
      auditId,
      createdAt,
      createdBy: user.uid,
      createdByName: user.displayName || user.email || 'NOC User',
    };
    transaction.set(versionRef, version);
    transaction.set(auditRef, {
      action: 'snapshot_created',
      summary: 'Version snapshot dibuat',
      changedFields: [],
      fromRevision: incident.revision,
      toRevision: incident.revision,
      versionId: versionRef.id,
      actorId: user.uid,
      actorName: user.displayName || user.email || 'NOC User',
      createdAt,
    });
    return version;
  });
}

export async function restoreVersion(
  workspaceId: string,
  user: User,
  incidentId: string,
  versionId: string,
): Promise<Incident> {
  const versionSnapshot = await getDoc(doc(firestore, versionsPath(workspaceId, incidentId), versionId));
  if (!versionSnapshot.exists()) throw new FirebaseRepositoryError('version_not_found', 'Version tidak ditemukan.');
  const version = versionSnapshot.data() as IncidentVersion;
  const currentSnapshot = await getDoc(doc(firestore, incidentsPath(workspaceId), incidentId));
  if (!currentSnapshot.exists()) throw new FirebaseRepositoryError('incident_not_found', 'Incident tidak ditemukan.');
  const current = normalizeIncidentSnapshot(currentSnapshot.data(), incidentId);
  const versionIncident = normalizeIncidentSnapshot(version.incident as unknown as DocumentData, incidentId);
  if (versionIncident.id !== incidentId) {
    throw new FirebaseRepositoryError('version_incident_mismatch', 'Snapshot tidak cocok dengan incident yang dipilih.');
  }
  // Progress is an append-only operational record. Restoring an older
  // snapshot must not erase timeline entries added after that snapshot.
  const restored = {
    ...versionIncident,
    id: incidentId,
    revision: current.revision,
    progress: current.progress,
  };
  return saveIncident(workspaceId, user, restored, {
    action: 'version_restored',
    summary: 'Incident dipulihkan dari version snapshot',
    sourceVersionId: versionId,
  });
}

export async function getWorkspaceSettings(workspaceId: string): Promise<SettingsData> {
  const snapshot = await getDoc(doc(firestore, settingsPath(workspaceId)));
  return snapshot.exists()
    ? ({ ...defaultSettings, ...snapshot.data(), id: snapshot.id } as SettingsData)
    : { ...defaultSettings };
}

export async function saveSettings(
  workspaceId: string,
  user: User,
  value: SettingsData,
  expectedUpdatedAt?: number,
): Promise<SettingsData> {
  const next = {
    ...defaultSettings,
    ...value,
    updatedAt: now(),
    updatedBy: user.uid,
  };
  const reference = doc(firestore, settingsPath(workspaceId));
  if (typeof expectedUpdatedAt === 'number') {
    await runTransaction(firestore, async (transaction) => {
      const current = await transaction.get(reference);
      const actualUpdatedAt = current.exists() ? Number(current.data().updatedAt) || 0 : 0;
      if (actualUpdatedAt !== expectedUpdatedAt) {
        throw new FirebaseRepositoryError(
          'settings_conflict',
          'Workspace Settings berubah sejak snapshot dibaca. Muat ulang data sebelum mencoba restore.',
        );
      }
      transaction.set(reference, next);
    });
    recordBatchWrite(1);
  } else {
    await setDoc(reference, next);
  }
  return next;
}

export async function getRouteMaster(workspaceId: string): Promise<{ items: Array<{ systemKey: string; routeSegment: string }>; meta: Record<string, unknown> | null }> {
  const metaSnapshot = await getDoc(doc(firestore, workspacePath(workspaceId) + '/routeMasterMeta/main'));
  if (!metaSnapshot.exists()) return { items: [], meta: null };
  const meta = metaSnapshot.data();
  const batchId = String(meta.currentBatchId || '');
  if (!batchId) return { items: [], meta };
  const chunksSnapshot = await getDocs(
    query(
      collection(firestore, workspacePath(workspaceId) + '/routeMasterBatches/' + batchId + '/chunks'),
      orderBy('chunkIndex', 'asc'),
      limit(60),
    ),
  );
  const items = chunksSnapshot.docs.flatMap((item) =>
    Array.isArray(item.data().items) ? item.data().items : [],
  ) as Array<{ systemKey: string; routeSegment: string }>;
  return { items, meta };
}

async function assertWorkspaceAdmin(workspaceId: string, user: User): Promise<void> {
  const member = await getDoc(doc(firestore, membersPath(workspaceId), user.uid));
  if (!member.exists() || member.data().status !== 'active' || member.data().role !== 'admin') {
    throw new FirebaseRepositoryError('admin_required', 'Recovery workspace hanya tersedia untuk Admin aktif.');
  }
}

export interface WorkspaceRestoreRecoverySnapshot {
  activeBatchId: string | null;
  activeCount: number;
  committedBatches: Array<Record<string, unknown> & { id: string }>;
  stagingBatches: Array<Record<string, unknown> & { id: string; lastActivityAt: number; stale: boolean }>;
  stagingScanTruncated: boolean;
}

export async function getWorkspaceRestoreRecovery(
  workspaceId: string,
  user: User,
): Promise<WorkspaceRestoreRecoverySnapshot> {
  await assertWorkspaceAdmin(workspaceId, user);
  const batches = collection(firestore, workspacePath(workspaceId) + '/routeMasterBatches');
  const [metaSnapshot, stagingSnapshot, committedSnapshot] = await Promise.all([
    getDoc(doc(firestore, workspacePath(workspaceId) + '/routeMasterMeta/main')),
    getDocs(query(batches, where('status', '==', 'staging'), limit(100))),
    getDocs(query(batches, orderBy('committedAt', 'desc'), limit(25))),
  ]);
  const meta = metaSnapshot.exists() ? metaSnapshot.data() : null;
  const activeBatchId = typeof meta?.currentBatchId === 'string' && meta.currentBatchId
    ? meta.currentBatchId
    : null;
  const currentTime = now();
  const stagingBatches = (await Promise.all(stagingSnapshot.docs.map(async (snapshot) => {
    const data = snapshot.data();
    const chunks = await getDocs(query(
      collection(firestore, workspacePath(workspaceId) + '/routeMasterBatches/' + snapshot.id + '/chunks'),
      orderBy('chunkIndex', 'asc'),
      limit(51),
    ));
    const latestChunkActivityAt = chunks.docs.reduce((latest, chunk) =>
      Math.max(latest, Number(chunk.data().createdAt) || 0), 0);
    const lastActivityAt = Math.max(
      Number(data.lastActivityAt) || 0,
      Number(data.createdAt) || 0,
      latestChunkActivityAt,
    );
    return {
      ...data,
      id: snapshot.id,
      lastActivityAt,
      cleanupSupported: chunks.size <= 50,
      stale: snapshot.id !== activeBatchId
        && lastActivityAt > 0
        && currentTime - lastActivityAt >= STALE_ROUTE_MASTER_BATCH_MS,
    };
  }))).sort((left, right) => left.lastActivityAt - right.lastActivityAt);
  const committedBatches = committedSnapshot.docs.map((snapshot) => ({
    ...snapshot.data(),
    id: snapshot.id,
  }));
  return {
    activeBatchId,
    activeCount: Number(meta?.count) || 0,
    committedBatches,
    stagingBatches,
    stagingScanTruncated: stagingSnapshot.size >= 100,
  };
}

export async function reactivateRouteMasterBatch(
  workspaceId: string,
  user: User,
  batchId: string,
  expectedCurrentBatchId: string | null,
): Promise<{ activeBatchId: string; count: number }> {
  await assertWorkspaceAdmin(workspaceId, user);
  if (!batchId.trim()) throw new FirebaseRepositoryError('route_master_batch_required', 'Batch tujuan wajib dipilih.');
  const batchRef = doc(firestore, workspacePath(workspaceId) + '/routeMasterBatches', batchId);
  const metaRef = doc(firestore, workspacePath(workspaceId) + '/routeMasterMeta/main');
  const chunksQuery = query(
    collection(firestore, workspacePath(workspaceId) + '/routeMasterBatches/' + batchId + '/chunks'),
    orderBy('chunkIndex', 'asc'),
    limit(60),
  );
  const initialBatch = await getDoc(batchRef);
  if (!initialBatch.exists() || initialBatch.data().status !== 'committed') {
    throw new FirebaseRepositoryError('route_master_batch_not_recoverable', 'Hanya batch Route Master berstatus committed yang dapat diaktifkan kembali.');
  }
  const stagedChunks = await getDocs(chunksQuery);
  if (!stagedChunks.size || stagedChunks.size > 50) {
    throw new FirebaseRepositoryError('route_master_batch_invalid', 'Jumlah chunk batch lama tidak valid untuk recovery otomatis.');
  }
  const targetCount = Number(initialBatch.data().count) || 0;
  const expectedFingerprint = typeof initialBatch.data().fingerprint === 'string'
    ? initialBatch.data().fingerprint
    : undefined;

  const result = await runTransaction(firestore, async (transaction) => {
    const [latestBatch, latestMeta] = await Promise.all([
      transaction.get(batchRef),
      transaction.get(metaRef),
    ]);
    const latestChunks = await Promise.all(stagedChunks.docs.map((item) => transaction.get(item.ref)));
    if (!latestBatch.exists() || latestBatch.data().status !== 'committed') {
      throw new FirebaseRepositoryError('route_master_batch_not_recoverable', 'Batch tujuan berubah dan tidak lagi berstatus committed.');
    }
    const activeValue = latestMeta.exists() && typeof latestMeta.data().currentBatchId === 'string'
      ? latestMeta.data().currentBatchId
      : '';
    const activeBatchId = activeValue || null;
    if (activeBatchId !== expectedCurrentBatchId) {
      throw new FirebaseRepositoryError('route_master_conflict', 'Route Master aktif berubah sebelum recovery. Muat ulang daftar batch.');
    }
    if (activeBatchId === batchId) {
      throw new FirebaseRepositoryError('route_master_batch_already_active', 'Batch yang dipilih sudah menjadi batch aktif.');
    }
    const validation = validateRouteMasterChunkSet(
      latestChunks.map((item) => ({
        chunkIndex: item.exists() ? Number(item.data().chunkIndex) : Number.NaN,
        items: item.exists() ? item.data().items : null,
      })),
      targetCount,
      expectedFingerprint,
    );
    if (!validation.valid) {
      throw new FirebaseRepositoryError('route_master_batch_invalid', 'Batch lama tidak lolos pemeriksaan integritas: ' + validation.errors.join(' '));
    }

    const target = latestBatch.data();
    const activatedAt = now();
    transaction.set(metaRef, {
      ...(latestMeta.exists() ? latestMeta.data() : {}),
      currentBatchId: batchId,
      count: validation.count,
      fileName: String(target.sourceFileName || 'Recovered Route Master'),
      sheetName: String(target.sourceSheetName || 'Previous committed batch'),
      systemKeyColumn: String(target.systemKeyColumn || ''),
      routeSegmentColumn: String(target.routeSegmentColumn || ''),
      updatedAt: activatedAt,
      updatedBy: user.uid,
      updatedByName: user.displayName || user.email || '',
      recoveredFromBatchId: activeBatchId,
    });
    transaction.update(batchRef, {
      lastActivatedAt: activatedAt,
      lastActivatedBy: user.uid,
    });
    return { activeBatchId: batchId, count: validation.count };
  });
  recordBatchWrite(2);
  return result;
}

export async function cleanupStaleRouteMasterBatch(
  workspaceId: string,
  user: User,
  batchId: string,
  expectedLastActivityAt: number,
): Promise<{ deletedChunks: number }> {
  await assertWorkspaceAdmin(workspaceId, user);
  if (!batchId.trim() || !Number.isFinite(expectedLastActivityAt)) {
    throw new FirebaseRepositoryError('route_master_cleanup_input_invalid', 'Identitas batch staging untuk cleanup tidak valid.');
  }
  const batchRef = doc(firestore, workspacePath(workspaceId) + '/routeMasterBatches', batchId);
  const metaRef = doc(firestore, workspacePath(workspaceId) + '/routeMasterMeta/main');
  const chunksQuery = query(
    collection(firestore, workspacePath(workspaceId) + '/routeMasterBatches/' + batchId + '/chunks'),
    orderBy('chunkIndex', 'asc'),
    limit(60),
  );
  const initialChunks = await getDocs(chunksQuery);
  if (initialChunks.size > 50) {
    throw new FirebaseRepositoryError('route_master_cleanup_chunk_limit', 'Batch memiliki lebih dari 50 chunk; cleanup otomatis dibatalkan untuk pemeriksaan manual.');
  }

  const deletedChunks = await runTransaction(firestore, async (transaction) => {
    const [latestBatch, latestMeta] = await Promise.all([
      transaction.get(batchRef),
      transaction.get(metaRef),
    ]);
    const latestChunks = await Promise.all(initialChunks.docs.map((item) => transaction.get(item.ref)));
    if (!latestBatch.exists() || latestBatch.data().status !== 'staging') {
      throw new FirebaseRepositoryError('route_master_cleanup_not_staging', 'Hanya batch berstatus staging yang boleh dibersihkan.');
    }
    const activeValue = latestMeta.exists() && typeof latestMeta.data().currentBatchId === 'string'
      ? latestMeta.data().currentBatchId
      : '';
    if (activeValue === batchId) {
      throw new FirebaseRepositoryError('route_master_cleanup_active', 'Batch aktif tidak dapat dibersihkan.');
    }
    if (latestChunks.some((item) => !item.exists())) {
      throw new FirebaseRepositoryError('route_master_cleanup_conflict', 'Isi batch berubah ketika cleanup berlangsung. Muat ulang daftar recovery.');
    }
    const lastChunkActivityAt = latestChunks.reduce((latest, item) =>
      item.exists() ? Math.max(latest, Number(item.data().createdAt) || 0) : latest, 0);
    const actualActivityAt = Math.max(
      Number(latestBatch.data().lastActivityAt) || 0,
      lastChunkActivityAt,
      Number(latestBatch.data().createdAt) || 0,
    );
    if (actualActivityAt !== expectedLastActivityAt) {
      throw new FirebaseRepositoryError('route_master_conflict', 'Batch mendapat aktivitas baru sejak daftar recovery dimuat. Cleanup dibatalkan.');
    }
    if (now() - actualActivityAt < STALE_ROUTE_MASTER_BATCH_MS) {
      throw new FirebaseRepositoryError('route_master_cleanup_too_recent', 'Batch staging belum melewati masa aman 24 jam sejak aktivitas terakhir.');
    }
    for (const item of initialChunks.docs) transaction.delete(item.ref);
    transaction.delete(batchRef);
    return initialChunks.size;
  });
  recordBatchWrite(deletedChunks + 1);
  return { deletedChunks };
}

export async function createWorkspaceRestoreOperation(
  workspaceId: string,
  user: User,
  input: {
    kind: RestoreOperationKind;
    sourceFileName?: string;
    selectedSections?: string[];
    message?: string;
    targetBatchId?: string;
  },
): Promise<{ id: string; createdAt: number }> {
  await assertWorkspaceAdmin(workspaceId, user);
  const allowedKinds: RestoreOperationKind[] = [
    'selective-restore',
    'reactivate-route-master',
    'cleanup-stale-route-master',
  ];
  if (!allowedKinds.includes(input.kind)) {
    throw new FirebaseRepositoryError('restore_operation_kind_invalid', 'Jenis aktivitas restore tidak dikenali.');
  }
  const id = newId();
  const createdAt = now();
  await setDoc(doc(firestore, workspacePath(workspaceId) + '/restoreOperations', id), {
    id,
    kind: input.kind,
    status: 'running',
    stage: 'starting',
    message: String(input.message || 'Recovery operation started').slice(0, 300),
    sourceFileName: String(input.sourceFileName || '').slice(0, 180),
    selectedSections: (input.selectedSections || []).filter((item) => ['settings', 'routeMaster'].includes(item)).slice(0, 2),
    targetBatchId: String(input.targetBatchId || '').slice(0, 120),
    createdAt,
    updatedAt: createdAt,
    createdBy: user.uid,
    createdByName: user.displayName || user.email || '',
    events: [{ at: createdAt, stage: 'starting', message: String(input.message || 'Recovery operation started').slice(0, 300) }],
  });
  return { id, createdAt };
}

export async function updateWorkspaceRestoreOperation(
  workspaceId: string,
  user: User,
  operationId: string,
  update: {
    status: RestoreOperationStatus;
    stage?: string;
    message?: string;
    errors?: string[];
    warnings?: string[];
    stagedBatchId?: string | null;
    activeBatchId?: string | null;
    settingsRolledBack?: boolean;
    deletedChunks?: number;
  },
): Promise<void> {
  await assertWorkspaceAdmin(workspaceId, user);
  const statuses: RestoreOperationStatus[] = ['running', 'completed', 'failed', 'partial', 'needs-review'];
  if (!operationId.trim() || !statuses.includes(update.status)) {
    throw new FirebaseRepositoryError('restore_operation_update_invalid', 'Pembaruan aktivitas restore tidak valid.');
  }
  const reference = doc(firestore, workspacePath(workspaceId) + '/restoreOperations', operationId);
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists() || snapshot.data().createdBy !== user.uid || snapshot.data().status !== 'running') {
      throw new FirebaseRepositoryError('restore_operation_not_updatable', 'Aktivitas restore tidak ditemukan, bukan milik Admin ini, atau sudah final.');
    }
    const current = snapshot.data();
    const updatedAt = now();
    const stage = String(update.stage || current.stage || 'running').slice(0, 80);
    const message = String(update.message || current.message || '').slice(0, 300);
    const events = Array.isArray(current.events) ? [...current.events] : [];
    if ((update.stage || update.status !== 'running' || update.message) && events.length < 30) {
      events.push({ at: updatedAt, stage, message, status: update.status });
    }
    const patch: Record<string, unknown> = {
      status: update.status,
      stage,
      message,
      updatedAt,
      events,
      errors: (update.errors || []).filter((item) => typeof item === 'string').slice(0, 10).map((item) => item.slice(0, 500)),
      warnings: (update.warnings || []).filter((item) => typeof item === 'string').slice(0, 10).map((item) => item.slice(0, 500)),
    };
    if (update.stagedBatchId !== undefined) patch.stagedBatchId = update.stagedBatchId;
    if (update.activeBatchId !== undefined) patch.activeBatchId = update.activeBatchId;
    if (update.settingsRolledBack !== undefined) patch.settingsRolledBack = update.settingsRolledBack;
    if (update.deletedChunks !== undefined) patch.deletedChunks = update.deletedChunks;
    if (update.status !== 'running') patch.finishedAt = updatedAt;
    transaction.update(reference, patch);
  });
  recordBatchWrite(1);
}

export async function getWorkspaceRestoreOperations(
  workspaceId: string,
  user: User,
): Promise<Array<Record<string, unknown> & { id: string }>> {
  await assertWorkspaceAdmin(workspaceId, user);
  const snapshot = await getDocs(query(
    collection(firestore, workspacePath(workspaceId) + '/restoreOperations'),
    orderBy('createdAt', 'desc'),
    limit(30),
  ));
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
}

const WORKSPACE_INTEGRITY_MAX_MEMBERS = 200;
const WORKSPACE_INTEGRITY_MAX_INCIDENTS = 100;
const WORKSPACE_INTEGRITY_MAX_KEYS = 300;
const WORKSPACE_INTEGRITY_HISTORY_INCIDENTS = 25;
const WORKSPACE_INTEGRITY_HISTORY_ROWS = 100;
const WORKSPACE_INTEGRITY_MAX_REPAIRS = 50;

export async function getWorkspaceIntegrityHistory(
  workspaceId: string,
  user: User,
): Promise<Array<Record<string, unknown> & { id: string }>> {
  await assertWorkspaceAdmin(workspaceId, user);
  const snapshot = await getDocs(query(
    collection(firestore, workspacePath(workspaceId) + '/integrityRuns'),
    orderBy('createdAt', 'desc'),
    limit(20),
  ));
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
}

export async function scanWorkspaceIntegrity(
  workspaceId: string,
  user: User,
): Promise<{
  report: ReturnType<typeof buildWorkspaceIntegrityReport> & { runId: string };
  history: Array<Record<string, unknown> & { id: string }>;
}> {
  await assertWorkspaceAdmin(workspaceId, user);
  const base = workspacePath(workspaceId);
  const [workspaceSnapshot, memberSnapshot, settingsSnapshot, incidentSnapshot, keySnapshot, metaSnapshot, operationsSnapshot] = await Promise.all([
    getDoc(doc(firestore, base)),
    getDocs(query(collection(firestore, base + '/members'), orderBy(documentId(), 'asc'), limit(WORKSPACE_INTEGRITY_MAX_MEMBERS))),
    getDoc(doc(firestore, settingsPath(workspaceId))),
    getDocs(query(collection(firestore, incidentsPath(workspaceId)), orderBy(documentId(), 'asc'), limit(WORKSPACE_INTEGRITY_MAX_INCIDENTS))),
    getDocs(query(collection(firestore, base + '/incidentKeys'), orderBy(documentId(), 'asc'), limit(WORKSPACE_INTEGRITY_MAX_KEYS))),
    getDoc(doc(firestore, base + '/routeMasterMeta/main')),
    getDocs(query(collection(firestore, base + '/restoreOperations'), orderBy('createdAt', 'desc'), limit(30))),
  ]);

  const incidentTargets = incidentSnapshot.docs.slice(0, WORKSPACE_INTEGRITY_HISTORY_INCIDENTS);
  const history = await Promise.all(incidentTargets.map(async (incident) => {
    const incidentPath = incidentsPath(workspaceId) + '/' + incident.id;
    const [auditSnapshot, versionSnapshot] = await Promise.all([
      getDocs(query(collection(firestore, incidentPath + '/audit'), orderBy('createdAt', 'desc'), limit(WORKSPACE_INTEGRITY_HISTORY_ROWS))),
      getDocs(query(collection(firestore, incidentPath + '/versions'), orderBy('createdAt', 'desc'), limit(WORKSPACE_INTEGRITY_HISTORY_ROWS))),
    ]);
    return {
      incidentId: incident.id,
      audit: auditSnapshot.docs.map((item) => ({ id: item.id, data: item.data() })),
      versions: versionSnapshot.docs.map((item) => ({ id: item.id, data: item.data() })),
      auditTruncated: auditSnapshot.size >= WORKSPACE_INTEGRITY_HISTORY_ROWS,
      versionsTruncated: versionSnapshot.size >= WORKSPACE_INTEGRITY_HISTORY_ROWS,
    };
  }));

  const meta = metaSnapshot.exists() ? metaSnapshot.data() : null;
  const activeBatchId = typeof meta?.currentBatchId === 'string' ? meta.currentBatchId : '';
  let batch: { id: string; data: Record<string, unknown> } | null = null;
  let chunks: Array<{ id: string; data: Record<string, unknown> }> = [];
  let chunksTruncated = false;
  if (activeBatchId) {
    const batchSnapshot = await getDoc(doc(firestore, base + '/routeMasterBatches', activeBatchId));
    if (batchSnapshot.exists()) {
      batch = { id: batchSnapshot.id, data: batchSnapshot.data() };
      const chunkSnapshot = await getDocs(query(
        collection(firestore, base + '/routeMasterBatches/' + activeBatchId + '/chunks'),
        orderBy('chunkIndex', 'asc'),
        limit(51),
      ));
      chunks = chunkSnapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
      chunksTruncated = chunkSnapshot.size >= 51;
    }
  }

  const snapshot: WorkspaceIntegritySnapshot = {
    workspaceId,
    workspace: {
      exists: workspaceSnapshot.exists(),
      data: workspaceSnapshot.exists()
        ? { ...workspaceSnapshot.data(), id: workspaceSnapshot.id }
        : {},
    },
    members: memberSnapshot.docs.map((item) => ({ id: item.id, data: item.data() })),
    membersTruncated: memberSnapshot.size >= WORKSPACE_INTEGRITY_MAX_MEMBERS,
    settings: {
      exists: settingsSnapshot.exists(),
      data: settingsSnapshot.exists() ? settingsSnapshot.data() : {},
    },
    incidents: incidentSnapshot.docs.map((item) => ({ id: item.id, data: item.data() })),
    incidentsTruncated: incidentSnapshot.size >= WORKSPACE_INTEGRITY_MAX_INCIDENTS,
    incidentKeys: keySnapshot.docs.map((item) => ({ id: item.id, data: item.data() })),
    incidentKeysTruncated: keySnapshot.size >= WORKSPACE_INTEGRITY_MAX_KEYS,
    history,
    routeMaster: {
      meta,
      batch,
      chunks,
      chunksTruncated,
    },
    restoreOperations: operationsSnapshot.docs.map((item) => ({ id: item.id, data: item.data() })),
    restoreOperationsTruncated: operationsSnapshot.size >= 30,
  };

  const report = buildWorkspaceIntegrityReport(snapshot, now());
  const runId = newId();
  const createdAt = report.scannedAt;
  const historyRef = doc(firestore, base + '/integrityRuns', runId);
  const historyRecord = {
    id: runId,
    kind: 'scan',
    status: report.status,
    createdAt,
    createdBy: user.uid,
    createdByName: user.displayName || user.email || '',
    counts: report.counts,
    coverage: report.coverage,
    findingCount: report.findings.length,
    repairsAvailable: report.repairs.length,
    findings: report.findings.slice(0, 25).map((item) => ({
      id: item.id,
      category: item.category,
      severity: item.severity,
      title: item.title,
    })),
  };
  await setDoc(historyRef, historyRecord);
  const savedHistory = await getWorkspaceIntegrityHistory(workspaceId, user);
  return {
    report: { ...report, runId },
    history: savedHistory.length ? savedHistory : [historyRecord],
  };
}

export async function applyWorkspaceIntegrityRepairs(
  workspaceId: string,
  user: User,
  requested: WorkspaceIntegrityRepair[],
): Promise<{
  runId: string;
  applied: number;
  skipped: number;
  errors: string[];
  history: Array<Record<string, unknown> & { id: string }>;
}> {
  await assertWorkspaceAdmin(workspaceId, user);
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > WORKSPACE_INTEGRITY_MAX_REPAIRS) {
    throw new FirebaseRepositoryError('integrity_repair_plan_invalid', 'Repair plan harus berisi 1 sampai 50 operasi yang valid.');
  }

  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];
  const operations: Array<Record<string, unknown>> = [];

  for (const operation of requested) {
    try {
      if (operation.kind === 'create-incident-key') {
        const incidentId = String(operation.incidentId || '').trim();
        const normalizedKey = String(operation.normalizedKey || '').trim();
        if (!incidentId || !normalizedKey || normalizeKey(normalizedKey) !== normalizedKey) {
          throw new FirebaseRepositoryError('integrity_repair_input_invalid', 'Identitas incident key untuk pembuatan index tidak valid.');
        }
        const incidentRef = doc(firestore, incidentsPath(workspaceId), incidentId);
        const keyRef = incidentKeyRef(workspaceId, normalizedKey);
        const outcome = await runTransaction(firestore, async (transaction) => {
          const [incidentSnapshot, keySnapshot] = await Promise.all([
            transaction.get(incidentRef),
            transaction.get(keyRef),
          ]);
          if (!incidentSnapshot.exists()) {
            throw new FirebaseRepositoryError('integrity_repair_conflict', 'Incident tujuan tidak ditemukan lagi.');
          }
          const data = incidentSnapshot.data();
          if (Number(data.deletedAt) > 0 || String(data.normalizedIncidentId || '') !== normalizedKey) {
            throw new FirebaseRepositoryError('integrity_repair_conflict', 'Incident berubah sejak hasil scan; index tidak dibuat.');
          }
          if (keySnapshot.exists()) return 'skipped';
          transaction.set(keyRef, {
            incidentId,
            normalizedKey,
            active: true,
          });
          return 'applied';
        });
        if (outcome === 'applied') applied += 1;
        else skipped += 1;
      } else if (operation.kind === 'delete-orphan-incident-key') {
        const keyId = String(operation.keyId || '').trim();
        const incidentId = String(operation.incidentId || '').trim();
        const normalizedKey = String(operation.normalizedKey || '').trim();
        if (!keyId || !incidentId || !normalizedKey) {
          throw new FirebaseRepositoryError('integrity_repair_input_invalid', 'Identitas index orphan untuk penghapusan tidak valid.');
        }
        const keyRef = doc(firestore, workspacePath(workspaceId) + '/incidentKeys', keyId);
        const incidentRef = doc(firestore, incidentsPath(workspaceId), incidentId);
        const outcome = await runTransaction(firestore, async (transaction) => {
          const [keySnapshot, incidentSnapshot] = await Promise.all([
            transaction.get(keyRef),
            transaction.get(incidentRef),
          ]);
          if (!keySnapshot.exists()) return 'skipped';
          const keyData = keySnapshot.data();
          if (String(keyData.incidentId || '') !== incidentId
            || String(keyData.normalizedKey || '') !== normalizedKey) {
            throw new FirebaseRepositoryError('integrity_repair_conflict', 'Index berubah sejak hasil scan; penghapusan dibatalkan.');
          }
          const orphaned = !incidentSnapshot.exists()
            || Number(incidentSnapshot.data().deletedAt) > 0
            || String(incidentSnapshot.data().normalizedIncidentId || '') !== normalizedKey;
          if (!orphaned) return 'skipped';
          transaction.delete(keyRef);
          return 'applied';
        });
        if (outcome === 'applied') applied += 1;
        else skipped += 1;
      } else {
        throw new FirebaseRepositoryError('integrity_repair_kind_invalid', 'Jenis repair tidak didukung.');
      }
      operations.push({ id: operation.id, kind: operation.kind, status: applied + skipped > 0 ? 'checked' : 'checked' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Repair gagal diproses.';
      errors.push(String(operation.id || operation.kind || 'operation') + ': ' + message);
      operations.push({ id: operation.id, kind: operation.kind, status: 'failed', message });
    }
  }

  const runId = newId();
  const createdAt = now();
  await setDoc(doc(firestore, workspacePath(workspaceId) + '/integrityRuns', runId), {
    id: runId,
    kind: 'repair',
    status: errors.length ? 'partial' : 'completed',
    createdAt,
    createdBy: user.uid,
    createdByName: user.displayName || user.email || '',
    applied,
    skipped,
    errorCount: errors.length,
    errors: errors.slice(0, 20),
    operations: operations.slice(0, WORKSPACE_INTEGRITY_MAX_REPAIRS),
  });
  const history = await getWorkspaceIntegrityHistory(workspaceId, user);
  return { runId, applied, skipped, errors, history };
}

export async function exportWorkspaceBackup(workspaceId: string, user: User): Promise<WorkspaceBackupBundle> {
  const memberSnapshot = await getDoc(doc(firestore, membersPath(workspaceId), user.uid));
  if (!memberSnapshot.exists() || memberSnapshot.data().status !== 'active' || memberSnapshot.data().role !== 'admin') {
    throw new FirebaseRepositoryError('admin_required', 'Export workspace hanya tersedia untuk Admin aktif.');
  }

  async function readAll(path: string): Promise<Array<Record<string, unknown> & { id: string }>> {
    const rows: Array<Record<string, unknown> & { id: string }> = [];
    let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
    while (true) {
      const reference = collection(firestore, path);
      const pageQuery: Query<DocumentData> = cursor
        ? query(reference, orderBy(documentId()), startAfter(cursor), limit(400))
        : query(reference, orderBy(documentId()), limit(400));
      const snapshot: QuerySnapshot<DocumentData> = await getDocs(pageQuery);
      rows.push(...snapshot.docs.map((item: QueryDocumentSnapshot<DocumentData>) => ({ ...item.data(), id: item.id })));
      if (snapshot.size < 400) break;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
    return rows;
  }

  const [members, incidents, settingsSnapshot, routeMasterMetaSnapshot] = await Promise.all([
    readAll(membersPath(workspaceId)),
    readAll(incidentsPath(workspaceId)),
    getDoc(doc(firestore, settingsPath(workspaceId))),
    getDoc(doc(firestore, workspacePath(workspaceId) + '/routeMasterMeta/main')),
  ]);

  const history: Array<{ incidentId: string; audit: unknown[]; versions: unknown[] }> = [];
  for (const incident of incidents) {
    const incidentId = incident.id;
    const [audit, versions] = await Promise.all([
      readAll(auditPath(workspaceId, incidentId)),
      readAll(versionsPath(workspaceId, incidentId)),
    ]);
    history.push({ incidentId, audit, versions });
  }

  let routeMaster: Array<{ systemKey: string; routeSegment: string }> = [];
  if (routeMasterMetaSnapshot.exists()) {
    const batchId = String(routeMasterMetaSnapshot.data().currentBatchId || '');
    if (batchId) {
      const chunks = await getDocs(query(
        collection(firestore, workspacePath(workspaceId) + '/routeMasterBatches/' + batchId + '/chunks'),
        orderBy('chunkIndex', 'asc'),
        limit(60),
      ));
      routeMaster = chunks.docs.flatMap((chunk) =>
        Array.isArray(chunk.data().items) ? chunk.data().items : [],
      ) as Array<{ systemKey: string; routeSegment: string }>;
    }
  }

  const settings = settingsSnapshot.exists()
    ? { ...defaultSettings, ...settingsSnapshot.data(), id: settingsSnapshot.id }
    : { ...defaultSettings };

  return createWorkspaceBackupBundle(workspaceId, {
    settings,
    members,
    incidents,
    routeMaster,
    history,
  });
}

export async function startRouteMasterImport(workspaceId: string, user: User): Promise<string> {
  const batchId = newId();
  const createdAt = now();
  await setDoc(doc(firestore, workspacePath(workspaceId) + '/routeMasterBatches', batchId), {
    createdAt,
    lastActivityAt: createdAt,
    createdBy: user.uid,
    createdByName: user.displayName || user.email || '',
    status: 'staging',
  });
  return batchId;
}

export async function addRouteMasterChunk(
  workspaceId: string,
  batchId: string,
  chunkIndex: number,
  items: Array<{ systemKey: string; routeSegment: string }>,
  user: User,
): Promise<void> {
  if (!batchId.trim() || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= 50
    || !Array.isArray(items) || items.length < 1 || items.length > 400) {
    throw new FirebaseRepositoryError('route_master_chunk_invalid', 'Chunk Route Master tidak valid. Maksimal 400 mapping per chunk dan 50 chunk per batch.');
  }
  const batchRef = doc(firestore, workspacePath(workspaceId) + '/routeMasterBatches', batchId);
  const chunkRef = doc(firestore, workspacePath(workspaceId) + '/routeMasterBatches/' + batchId + '/chunks', String(chunkIndex).padStart(4, '0'));
  await runTransaction(firestore, async (transaction) => {
    const batchSnapshot = await transaction.get(batchRef);
    if (!batchSnapshot.exists() || batchSnapshot.data().status !== 'staging') {
      throw new FirebaseRepositoryError('route_master_staging_not_found', 'Batch staging tidak tersedia atau sudah tidak menerima chunk.');
    }
    // Always advance the heartbeat, even when two writes land in the same millisecond.
    const activityAt = Math.max(now(), (Number(batchSnapshot.data().lastActivityAt) || 0) + 1);
    transaction.set(chunkRef, {
      chunkIndex,
      items,
      createdAt: activityAt,
      createdBy: user.uid,
    });
    transaction.update(batchRef, { lastActivityAt: activityAt });
  });
  recordBatchWrite(2);
}

export async function verifyRouteMasterImport(
  workspaceId: string,
  batchId: string,
  expectedCount: number,
  expectedFingerprint: string,
): Promise<{ verifiedCount: number; chunkCount: number }> {
  if (!batchId.trim() || !expectedFingerprint.trim()) {
    throw new FirebaseRepositoryError('route_master_verify_input_invalid', 'Data verifikasi Route Master tidak lengkap.');
  }
  const batchRef = doc(firestore, workspacePath(workspaceId) + '/routeMasterBatches', batchId);
  const batchSnapshot = await getDoc(batchRef);
  if (!batchSnapshot.exists() || batchSnapshot.data().status !== 'staging') {
    throw new FirebaseRepositoryError('route_master_staging_not_found', 'Batch staging Route Master tidak ditemukan atau sudah tidak berstatus staging.');
  }
  const chunks = await getDocs(
    query(
      collection(firestore, workspacePath(workspaceId) + '/routeMasterBatches/' + batchId + '/chunks'),
      orderBy('chunkIndex', 'asc'),
      limit(60),
    ),
  );
  const validation = validateRouteMasterChunkSet(
    chunks.docs.map((item) => ({
      chunkIndex: Number(item.data().chunkIndex),
      items: item.data().items,
    })),
    expectedCount,
    expectedFingerprint,
  );
  if (!validation.valid) {
    throw new FirebaseRepositoryError('route_master_staging_invalid', validation.errors.join(' '));
  }
  return { verifiedCount: validation.count, chunkCount: validation.chunkCount };
}

export async function commitRouteMasterImport(
  workspaceId: string,
  user: User,
  batchId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const expectedCount = typeof metadata.totalCount === 'number' ? metadata.totalCount : 0;
  const expectedFingerprint = typeof metadata.expectedFingerprint === 'string'
    ? metadata.expectedFingerprint
    : undefined;
  if (!batchId.trim() || !Number.isInteger(expectedCount)
    || expectedCount < 1 || expectedCount > 20000
    || (Object.prototype.hasOwnProperty.call(metadata, 'expectedFingerprint') && !expectedFingerprint)) {
    throw new FirebaseRepositoryError('route_master_invalid_count', 'Jumlah mapping atau fingerprint Route Master tidak valid.');
  }

  const batchRef = doc(firestore, workspacePath(workspaceId) + '/routeMasterBatches', batchId);
  const metaRef = doc(firestore, workspacePath(workspaceId) + '/routeMasterMeta/main');
  const chunksQuery = query(
    collection(firestore, workspacePath(workspaceId) + '/routeMasterBatches/' + batchId + '/chunks'),
    orderBy('chunkIndex', 'asc'),
    limit(60),
  );
  const hasExpectedCurrentBatch = Object.prototype.hasOwnProperty.call(metadata, 'expectedCurrentBatchId');
  const expectedCurrentBatchId = hasExpectedCurrentBatch
    ? (typeof metadata.expectedCurrentBatchId === 'string' && metadata.expectedCurrentBatchId
      ? metadata.expectedCurrentBatchId
      : null)
    : undefined;
  const {
    totalCount: _totalCount,
    expectedFingerprint: _expectedFingerprint,
    expectedCurrentBatchId: _expectedCurrentBatchId,
    ...publicMetadata
  } = metadata;

  const initialBatchSnapshot = await getDoc(batchRef);
  if (!initialBatchSnapshot.exists() || initialBatchSnapshot.data().status !== 'staging') {
    throw new FirebaseRepositoryError('route_master_staging_not_found', 'Batch staging Route Master sudah tidak tersedia.');
  }
  const initialActivityAt = Number(initialBatchSnapshot.data().lastActivityAt)
    || Number(initialBatchSnapshot.data().createdAt)
    || 0;
  const stagedChunkRefs = await getDocs(chunksQuery);
  await runTransaction(firestore, async (transaction) => {
    // The web SDK transaction API reads document references, not queries.
    // Resolve the staged chunk references first, then re-read each chunk inside
    // the transaction so changed or deleted chunk contents cannot slip through.
    const [latestBatch, latestMeta] = await Promise.all([
      transaction.get(batchRef),
      transaction.get(metaRef),
    ]);
    const latestChunks = await Promise.all(stagedChunkRefs.docs.map((item) => transaction.get(item.ref)));
    if (!latestBatch.exists() || latestBatch.data().status !== 'staging') {
      throw new FirebaseRepositoryError('route_master_staging_not_found', 'Batch staging Route Master sudah tidak tersedia.');
    }
    const latestActivityAt = Number(latestBatch.data().lastActivityAt)
      || Number(latestBatch.data().createdAt)
      || 0;
    if (latestActivityAt !== initialActivityAt) {
      throw new FirebaseRepositoryError('route_master_conflict', 'Batch Route Master menerima perubahan setelah verifikasi awal. Ulangi verifikasi sebelum commit.');
    }

    const validation = validateRouteMasterChunkSet(
      latestChunks.map((item) => ({
        chunkIndex: item.exists() ? Number(item.data().chunkIndex) : Number.NaN,
        items: item.exists() ? item.data().items : null,
      })),
      expectedCount,
      expectedFingerprint,
    );
    if (!validation.valid) {
      throw new FirebaseRepositoryError('route_master_staging_invalid', validation.errors.join(' '));
    }

    const activeBatchValue = latestMeta.exists() && typeof latestMeta.data().currentBatchId === 'string'
      ? latestMeta.data().currentBatchId
      : '';
    const activeBatchId = activeBatchValue || null;
    if (expectedCurrentBatchId !== undefined && activeBatchId !== expectedCurrentBatchId) {
      throw new FirebaseRepositoryError(
        'route_master_conflict',
        'Route Master aktif berubah selama restore berlangsung. Batch lama tetap aktif; muat ulang sebelum mencoba lagi.',
      );
    }

    // Batch status and active pointer are switched atomically with an optimistic
    // concurrency check. The previous committed batch is intentionally retained.
    const committedAt = now();
    transaction.update(batchRef, {
      status: 'committed',
      committedAt,
      lastActivityAt: committedAt,
      count: validation.count,
      fingerprint: expectedFingerprint || null,
      sourceFileName: String(publicMetadata.fileName || ''),
      sourceSheetName: String(publicMetadata.sheetName || ''),
      systemKeyColumn: String(publicMetadata.systemKeyColumn || ''),
      routeSegmentColumn: String(publicMetadata.routeSegmentColumn || ''),
      committedBy: user.uid,
      committedByName: user.displayName || user.email || '',
    });
    transaction.set(metaRef, {
      ...publicMetadata,
      count: validation.count,
      currentBatchId: batchId,
      updatedAt: now(),
      updatedBy: user.uid,
      updatedByName: user.displayName || user.email || '',
    });
  });
  recordBatchWrite(2);
}

export async function createInvite(
  workspaceId: string,
  user: User,
  email: string,
  role: Role,
): Promise<string> {
  const codeBytes = new Uint8Array(18);
  crypto.getRandomValues(codeBytes);
  const code = [...codeBytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  await setDoc(doc(firestore, 'workspaceInvites', code), {
    workspaceId,
    email: email.trim().toLowerCase(),
    role: role === 'supervisor' ? 'supervisor' : 'operator',
    status: 'pending',
    createdAt: now(),
    expiresAt: Timestamp.fromMillis(now() + 7 * 24 * 60 * 60 * 1000),
    createdBy: user.uid,
  });
  return code;
}

export async function getInvite(code: string, user: User | null): Promise<{ status: string; error?: string }> {
  if (!user) return { status: 'Login required' };
  const snapshot = await getDoc(doc(firestore, 'workspaceInvites', code));
  if (!snapshot.exists()) throw new FirebaseRepositoryError('invite_not_found', 'Undangan tidak ditemukan.');
  const invite = snapshot.data();
  if (invite.status !== 'pending') throw new FirebaseRepositoryError('invite_revoked', 'Undangan sudah digunakan atau dicabut.');
  const inviteExpiresAt = invite.expiresAt instanceof Timestamp
      ? invite.expiresAt.toMillis()
      : Number(invite.expiresAt);
    if (!Number.isFinite(inviteExpiresAt) || inviteExpiresAt < now()) {
      throw new FirebaseRepositoryError('invite_expired', 'Undangan sudah kedaluwarsa.');
    }
  if (String(invite.email).toLowerCase() !== String(user.email || '').toLowerCase()) {
    throw new FirebaseRepositoryError('invite_not_allowed', 'Undangan hanya berlaku untuk email yang dituju.');
  }
  return { status: 'Invitation ready' };
}

export async function joinWorkspace(code: string, user: User): Promise<void> {
  const inviteRef = doc(firestore, 'workspaceInvites', code);
  await runTransaction(firestore, async (transaction) => {
    const inviteSnapshot = await transaction.get(inviteRef);
    if (!inviteSnapshot.exists()) throw new FirebaseRepositoryError('invite_not_found', 'Undangan tidak ditemukan.');
    const invite = inviteSnapshot.data();
    if (invite.status !== 'pending') throw new FirebaseRepositoryError('invite_revoked', 'Undangan tidak lagi aktif.');
    const inviteExpiresAt = invite.expiresAt instanceof Timestamp
      ? invite.expiresAt.toMillis()
      : Number(invite.expiresAt);
    if (!Number.isFinite(inviteExpiresAt) || inviteExpiresAt < now()) {
      throw new FirebaseRepositoryError('invite_expired', 'Undangan sudah kedaluwarsa.');
    }
    if (String(invite.email).toLowerCase() !== String(user.email || '').toLowerCase()) {
      throw new FirebaseRepositoryError('invite_not_allowed', 'Undangan hanya berlaku untuk email yang dituju.');
    }

    const workspaceId = String(invite.workspaceId || '');
    const memberRef = doc(firestore, membersPath(workspaceId), user.uid);
    const userRef = doc(firestore, 'users', user.uid);
    const [memberSnapshot, userSnapshot] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(userRef),
    ]);

    if (memberSnapshot.exists() && memberSnapshot.data().status !== 'removed') {
      throw new FirebaseRepositoryError('account_already_has_workspace', 'Akun sudah menjadi anggota aktif workspace ini.');
    }
    if (userSnapshot.exists() && String(userSnapshot.data().workspaceId || '') !== workspaceId) {
      throw new FirebaseRepositoryError('account_already_has_workspace', 'Akun sudah terhubung ke workspace lain.');
    }

    const joinedAt = now();
    const role: Role = invite.role === 'supervisor' ? 'supervisor' : 'operator';
    const name = user.displayName || user.email?.split('@')[0] || 'NOC User';
    const memberData = {
      userId: user.uid,
      workspaceId,
      role,
      email: user.email || '',
      name,
      joinedAt,
      status: 'active',
      inviteCode: code,
    };

    if (memberSnapshot.exists()) {
      transaction.update(memberRef, {
        role,
        email: memberData.email,
        name,
        joinedAt,
        status: 'active',
        inviteCode: code,
        removedAt: null,
      });
    } else {
      transaction.set(memberRef, {
        ...memberData,
        createdAt: joinedAt,
      });
    }

    if (userSnapshot.exists()) {
      transaction.update(userRef, {
        name,
        photoURL: user.photoURL || '',
        updatedAt: joinedAt,
      });
    } else {
      transaction.set(userRef, {
        uid: user.uid,
        workspaceId,
        role,
        email: user.email || '',
        name,
        photoURL: user.photoURL || '',
        createdAt: joinedAt,
        updatedAt: joinedAt,
      });
    }

    transaction.update(inviteRef, {
      status: 'joined',
      joinedAt,
      joinedBy: user.uid,
    });
  });
}

export async function updateMemberRole(
  workspaceId: string,
  memberId: string,
  role: Role,
): Promise<void> {
  if (role === 'admin') throw new FirebaseRepositoryError('admin_role_assignment_blocked', 'Role Admin tidak diberikan melalui undangan atau perubahan role biasa.');
  await setDoc(doc(firestore, membersPath(workspaceId), memberId), { role }, { merge: true });
}

export async function removeMember(workspaceId: string, memberId: string): Promise<void> {
  await setDoc(doc(firestore, membersPath(workspaceId), memberId), {
    status: 'removed',
    removedAt: now(),
  }, { merge: true });
}

export function subscribeToWorkspace(
  workspaceId: string,
  onIncident: (kind: 'incident.saved' | 'incident.deleted', incident: Incident) => void,
  onSettings: (settings: SettingsData) => void,
  onMembersChanged: () => void,
): Unsubscribe {
  const unsubscribers: Unsubscribe[] = [];
  const incidentQuery = query(collection(firestore, incidentsPath(workspaceId)), orderBy('updatedAt', 'desc'), limit(100));
  recordListenerStart();
  unsubscribers.push(onSnapshot(incidentQuery, (snapshot) => {
    recordListenerSnapshot(snapshot.size);
    snapshot.docChanges().forEach((change) => {
      const incident = normalizeIncidentSnapshot(change.doc.data(), change.doc.id);
      if (change.type === 'removed') {
        // A limited query can evict a still-existing document when newer incidents arrive.
        // Verify before telling the UI that the document was permanently deleted.
        void getDoc(doc(firestore, incidentsPath(workspaceId), incident.id)).then((current) => {
          if (!current.exists()) onIncident('incident.deleted', incident);
        });
        return;
      }
      onIncident('incident.saved', incident);
    });
  }));
  recordListenerStart();
  unsubscribers.push(onSnapshot(doc(firestore, settingsPath(workspaceId)), (snapshot) => {
    recordListenerSnapshot(snapshot.exists() ? 1 : 0);
    if (snapshot.exists()) onSettings({ ...defaultSettings, ...snapshot.data() } as SettingsData);
  }));
  recordListenerStart();
  unsubscribers.push(onSnapshot(query(collection(firestore, membersPath(workspaceId)), limit(100)), (snapshot) => {
    recordListenerSnapshot(snapshot.size);
    onMembersChanged();
  }));
  return () => unsubscribers.forEach((unsubscribe) => { unsubscribe(); recordListenerStop(); });
}

export async function searchIncidents(workspaceId: string, term: string): Promise<Incident[]> {
  const clean = term.trim().toLowerCase();
  if (clean.length < 2) return [];
  const snapshot = await getDocs(
    query(collection(firestore, incidentsPath(workspaceId)), orderBy('updatedAt', 'desc'), limit(100)),
  );
  return snapshot.docs
    .map((item) => normalizeIncidentSnapshot(item.data(), item.id))
    .filter((incident) => {
      const haystack = [
        incident.incidentId,
        incident.mduTicket,
        incident.linkA,
        incident.linkB,
        incident.systemKey,
        incident.routeSegment,
        incident.picName,
        incident.picArea,
        incident.rootCause,
        incident.b2bTitle,
      ].join(' ').toLowerCase();
      return haystack.includes(clean);
    })
    .slice(0, 40);
}

export async function removeWorkspaceSubscription(): Promise<void> {
  // Firestore listeners are attached through onSnapshot and detached by unsubscribe callbacks.
}

export type IncidentCursor = QueryDocumentSnapshot<DocumentData>;
