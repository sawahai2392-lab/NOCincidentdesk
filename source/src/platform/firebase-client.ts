import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { firebaseAuth, firestore } from './firebase';
import {
  getCurrentIdToken,
  getCurrentNocUser,
  registerWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signOutCurrentUser,
} from './firebase-auth';
import {
  addRouteMasterChunk,
  bootstrapWorkspace,
  commitRouteMasterImport,
  createIncident,
  createInvite,
  createVersion,
  duplicateIncident,
  ensureWorkspace,
  getInvite,
  getRouteMaster,
  joinWorkspace,
  loadIncidentPage,
  purgeIncident,
  readAudit,
  readVersions,
  removeMember,
  restoreIncident,
  restoreVersion,
  saveIncident,
  saveSettings,
  searchIncidents,
  softDeleteIncident,
  startRouteMasterImport,
  subscribeToWorkspace,
  updateMemberRole,
  FirebaseRepositoryError,
} from './firebase-repositories';
import type { Incident, Role } from '../domain';

type ApiResult<T = Record<string, unknown>> = { data: T };
type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

class FirebaseApiError extends Error {
  code: string;
  status: number;
  response: { status: number; data: { error: string; message: string; current?: Incident } };

  constructor(code: string, message: string, status = 400, current?: Incident) {
    super(message);
    this.name = 'FirebaseApiError';
    this.code = code;
    this.status = status;
    this.response = {
      status,
      data: { error: code, message, ...(current ? { current } : {}) },
    };
  }
}

function apiError(error: unknown): FirebaseApiError {
  if (error instanceof FirebaseApiError) return error;
  if (error instanceof FirebaseRepositoryError) {
    const status = error.code === 'revision_conflict' ? 409
      : error.code.includes('not_found') ? 404
      : error.code.includes('required') || error.code.includes('invalid') ? 400
      : 403;
    return new FirebaseApiError(error.code, error.message, status, error.current);
  }
  const authError = error as { code?: string; message?: string };
  const code = authError?.code || 'firebase_request_failed';
  const messageByCode: Record<string, string> = {
    'auth/invalid-credential': 'Email atau password tidak sesuai.',
    'auth/email-already-in-use': 'Email sudah terdaftar.',
    'auth/weak-password': 'Password minimal 6 karakter. Gunakan password yang lebih kuat.',
    'auth/invalid-email': 'Format email tidak valid.',
    'auth/popup-blocked': 'Popup login diblokir browser. Izinkan popup lalu coba lagi.',
    'auth/popup-closed-by-user': 'Login dibatalkan.',
    'auth/network-request-failed': 'Koneksi ke Firebase terputus. Periksa jaringan.',
    'permission-denied': 'Akses ditolak oleh Firestore Security Rules.',
    'unavailable': 'Firebase sementara tidak tersedia. Coba lagi.',
  };
  return new FirebaseApiError(code, messageByCode[code] || authError?.message || 'Permintaan Firebase gagal.', 400);
}

async function context() {
  const user = firebaseAuth.currentUser;
  if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);
  return ensureWorkspace(user);
}

function ok<T>(data: T): ApiResult<T> {
  return { data };
}

function unavailable(feature: string): never {
  throw new FirebaseApiError(
    'spark_feature_unavailable',
    feature + ' tidak tersedia pada konfigurasi Firebase Spark-only. Fitur ini dinonaktifkan agar project tidak membutuhkan Blaze.',
    501,
  );
}

async function getRequest(path: string): Promise<ApiResult> {
  if (path === '/api/bootstrap') {
    const user = firebaseAuth.currentUser;
    if (!user) throw new FirebaseApiError('auth_required', 'Sesi login tidak ditemukan.', 401);
    return ok(await bootstrapWorkspace(user));
  }

  if (path === '/api/route-master') {
    const { profile } = await context();
    return ok(await getRouteMaster(profile.workspaceId));
  }

  if (path === '/api/integrations/gemini/status') {
    return ok({ configured: false, provider: 'Google Gemini', model: 'disabled-on-spark' });
  }

  if (path === '/api/operations/alerts/summary') {
    return ok({ unreadCount: 0 });
  }

  const inviteMatch = path.match(/^\/api\/invites\/([^/]+)$/);
  if (inviteMatch) {
    return ok(await getInvite(decodeURIComponent(inviteMatch[1]), firebaseAuth.currentUser));
  }

  const versionsMatch = path.match(/^\/api\/incidents\/([^/]+)\/versions$/);
  if (versionsMatch) {
    const { profile } = await context();
    return ok({ versions: await readVersions(profile.workspaceId, decodeURIComponent(versionsMatch[1])) });
  }

  const auditMatch = path.match(/^\/api\/incidents\/([^/]+)\/audit$/);
  if (auditMatch) {
    const { profile } = await context();
    return ok({ audit: await readAudit(profile.workspaceId, decodeURIComponent(auditMatch[1])) });
  }

  const intelligenceMatch = path.match(/^\/api\/incidents\/([^/]+)\/intelligence$/);
  if (intelligenceMatch) {
    const { profile } = await context();
    const snapshot = await getDocs(
      query(collection(firestore, 'workspaces', profile.workspaceId, 'incidents'), limit(100)),
    );
    const items = snapshot.docs.map((item) => ({ ...item.data(), id: item.id })) as Incident[];
    const incident = items.find((item) => item.id === decodeURIComponent(intelligenceMatch[1]));
    return ok({
      parent: incident?.parentIncidentId ? items.find((item) => item.id === incident.parentIncidentId) || null : null,
      children: items.filter((item) => item.parentIncidentId === incident?.id),
      related: [],
      scanTruncated: snapshot.size >= 100,
    });
  }

  if (path === '/api/operations/health') {
    return ok({ status: 'available', mode: 'spark-client', activeCount: 0, overdueCount: 0, staleCount: 0 });
  }

  if (path === '/api/operations/alerts') {
    return ok({ items: [], unreadCount: 0, sparkLimitations: true });
  }

  if (path.startsWith('/api/incidents/') && path.includes('/attachments/')) {
    unavailable('Shared file attachment');
  }

  throw new FirebaseApiError('endpoint_not_migrated', 'Endpoint belum dipindahkan ke Firestore: ' + path, 501);
}

async function postRequest(path: string, body: Record<string, unknown> = {}): Promise<ApiResult> {
  const user = firebaseAuth.currentUser;
  const joinBeforeWorkspace = path.match(/^\/api\/invites\/([^/]+)\/join$/);
  if (joinBeforeWorkspace) {
    if (!user) throw new FirebaseApiError('auth_required', 'Masuk dahulu menggunakan email undangan.', 401);
    await joinWorkspace(decodeURIComponent(joinBeforeWorkspace[1]), user);
    return ok({ joined: true });
  }
  const { profile } = await context();

  if (path === '/api/incidents') {
    if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);
    const incident = await createIncident(profile.workspaceId, user, body as Partial<Incident>);
    return ok({ incident });
  }

  if (path === '/api/incidents/page') {
    const result = await loadIncidentPage(profile.workspaceId, String(body.nextToken || ''));
    return ok(result);
  }

  if (path === '/api/incidents/search') {
    return ok({ items: await searchIncidents(profile.workspaceId, String(body.query || '')) });
  }

  if (path === '/api/invites') {
    if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      throw new FirebaseApiError('invite_email_required', 'Email undangan tidak valid.');
    }
    const role: Role = body.role === 'supervisor' ? 'supervisor' : 'operator';
    const code = await createInvite(profile.workspaceId, user, email, role);
    return ok({ code, expiresInDays: 7 });
  }

  const duplicateMatch = path.match(/^\/api\/incidents\/([^/]+)\/duplicate$/);
  if (duplicateMatch) {
    if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);
    const incident = await duplicateIncident(profile.workspaceId, user, decodeURIComponent(duplicateMatch[1]));
    return ok({ incident });
  }

  const restoreMatch = path.match(/^\/api\/incidents\/([^/]+)\/undelete$/);
  if (restoreMatch) {
    if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);
    const incident = await restoreIncident(profile.workspaceId, user, decodeURIComponent(restoreMatch[1]));
    return ok({ incident });
  }

  const versionRestoreMatch = path.match(/^\/api\/incidents\/([^/]+)\/restore\/([^/]+)$/);
  if (versionRestoreMatch) {
    if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);
    const incident = await restoreVersion(
      profile.workspaceId,
      user,
      decodeURIComponent(versionRestoreMatch[1]),
      decodeURIComponent(versionRestoreMatch[2]),
    );
    return ok({ incident });
  }

  const versionMatch = path.match(/^\/api\/incidents\/([^/]+)\/versions$/);
  if (versionMatch) {
    if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);
    const incidentId = decodeURIComponent(versionMatch[1]);
    const target = await getDoc(doc(firestore, 'workspaces', profile.workspaceId, 'incidents', incidentId));
    if (!target.exists()) throw new FirebaseApiError('incident_not_found', 'Incident tidak ditemukan.', 404);
    const incident = { ...target.data(), id: incidentId } as Incident;
    await createVersion(profile.workspaceId, user, incident, String(body.label || 'Manual snapshot'));
    return ok({ created: true });
  }

  if (path === '/api/route-master/import/start') {
    if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);
    return ok({ batchId: await startRouteMasterImport(profile.workspaceId, user) });
  }

  const chunkMatch = path.match(/^\/api\/route-master\/import\/chunk$/);
  if (chunkMatch) {
    if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);
    await addRouteMasterChunk(
      profile.workspaceId,
      String(body.batchId || ''),
      Number(body.chunkIndex || 0),
      Array.isArray(body.items) ? body.items as Array<{ systemKey: string; routeSegment: string }> : [],
      user,
    );
    return ok({ saved: true });
  }

  if (path === '/api/route-master/import/commit') {
    if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);
    await commitRouteMasterImport(profile.workspaceId, user, String(body.batchId || ''), body);
    return ok({ committed: true });
  }

  if (path === '/api/subscriptions' || path === '/api/subscriptions/remove') {
    return ok({ connected: true });
  }

  if (path.startsWith('/api/geotag/extract') || path.startsWith('/api/import/ai-extract')) {
    unavailable('Server-side AI extraction');
  }
  if (path.includes('/attachments')) unavailable('Shared file attachment');

  if (path.includes('/copilot')) unavailable('Server-side AI copilot');

  if (path.startsWith('/api/operations/alerts/')) {
    return ok({ updated: true, unreadCount: 0 });
  }

  if (path === '/api/operations/alerts/read-all') {
    return ok({ updated: true, unreadCount: 0 });
  }

  if (path === '/api/risk/forecast' || path === '/api/risk/context' || path === '/api/reliability') {
    return ok({ items: [], forecast: [], context: [], trend: [], brief: 'Analitik lanjutan dinonaktifkan pada mode Firebase Spark-only.' });
  }

  throw new FirebaseApiError('endpoint_not_migrated', 'Endpoint belum dipindahkan ke Firestore: ' + path, 501);
}

async function putRequest(path: string, body: Record<string, unknown> = {}): Promise<ApiResult> {
  const user = firebaseAuth.currentUser;
  const { profile } = await context();
  if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);

  if (path === '/api/settings') {
    return ok({ settings: await saveSettings(profile.workspaceId, user, body as never) });
  }

  const incidentMatch = path.match(/^\/api\/incidents\/([^/]+)$/);
  if (incidentMatch) {
    const incident = await saveIncident(profile.workspaceId, user, {
      ...body,
      id: decodeURIComponent(incidentMatch[1]),
    } as Incident);
    return ok({ incident });
  }

  const memberMatch = path.match(/^\/api\/members\/([^/]+)$/);
  if (memberMatch) {
    await updateMemberRole(profile.workspaceId, decodeURIComponent(memberMatch[1]), body.role as Role);
    return ok({ updated: true });
  }

  throw new FirebaseApiError('endpoint_not_migrated', 'Endpoint belum dipindahkan ke Firestore: ' + path, 501);
}

async function deleteRequest(path: string): Promise<ApiResult> {
  const user = firebaseAuth.currentUser;
  const { profile } = await context();
  if (!user) throw new FirebaseApiError('auth_required', 'Silakan masuk terlebih dahulu.', 401);

  const purgeMatch = path.match(/^\/api\/incidents\/([^/]+)\/purge$/);
  if (purgeMatch) {
    await purgeIncident(profile.workspaceId, decodeURIComponent(purgeMatch[1]));
    return ok({ deleted: true });
  }

  const incidentMatch = path.match(/^\/api\/incidents\/([^/]+)$/);
  if (incidentMatch) {
    const incident = await softDeleteIncident(profile.workspaceId, user, decodeURIComponent(incidentMatch[1]));
    return ok({ incident });
  }

  const memberMatch = path.match(/^\/api\/members\/([^/]+)$/);
  if (memberMatch) {
    await removeMember(profile.workspaceId, decodeURIComponent(memberMatch[1]));
    return ok({ removed: true });
  }

  if (path.includes('/attachments/')) unavailable('Shared file attachment');

  throw new FirebaseApiError('endpoint_not_migrated', 'Endpoint belum dipindahkan ke Firestore: ' + path, 501);
}

export const api = {
  async get<T = Record<string, unknown>>(path: string): Promise<ApiResult<T>> {
    try { return await getRequest(path) as ApiResult<T>; } catch (error) { throw apiError(error); }
  },
  async post<T = Record<string, unknown>>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> {
    try { return await postRequest(path, body) as ApiResult<T>; } catch (error) { throw apiError(error); }
  },
  async put<T = Record<string, unknown>>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> {
    try { return await putRequest(path, body) as ApiResult<T>; } catch (error) { throw apiError(error); }
  },
  async delete<T = Record<string, unknown>>(path: string): Promise<ApiResult<T>> {
    try { return await deleteRequest(path) as ApiResult<T>; } catch (error) { throw apiError(error); }
  },
};

export const auth = {
  async signIn(): Promise<{ user: Awaited<ReturnType<typeof signInWithGoogle>> }> {
    return { user: await signInWithGoogle() };
  },
  async signInWithEmail(email: string, password: string) {
    return { user: await signInWithEmail(email, password) };
  },
  async registerWithEmail(name: string, email: string, password: string) {
    return { user: await registerWithEmail(name, email, password) };
  },
  getUser: getCurrentNocUser,
  getAccessToken: getCurrentIdToken,
  signOut: signOutCurrentUser,
};

export const invitesClient = {
  getPendingCode(): string | null {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('invite') || params.get('inviteCode') || localStorage.getItem('noc-pending-invite');
    if (code) localStorage.setItem('noc-pending-invite', code);
    return code;
  },
  clearPendingCode() {
    localStorage.removeItem('noc-pending-invite');
    const params = new URLSearchParams(window.location.search);
    params.delete('invite');
    params.delete('inviteCode');
    const next = window.location.pathname + (params.size ? '?' + params.toString() : '') + window.location.hash;
    window.history.replaceState({}, '', next);
  },
  buildJoinUrl(code: string, options: { path?: string } = {}) {
    const url = new URL(options.path || '/', window.location.origin);
    url.searchParams.set('invite', code);
    return url.toString();
  },
};

export const image = {
  async resizeIfNeeded(
    file: File,
    options: { maxDimension?: number; maxPixels?: number; quality?: number; mimeType?: string } = {},
  ): Promise<{ data: string; mimeType: string }> {
    const mimeType = options.mimeType || 'image/jpeg';
    const bitmap = await createImageBitmap(file);
    const maxDimension = options.maxDimension || 2200;
    const maxPixels = options.maxPixels || 3600000;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height), Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      throw new Error('Canvas image processing is unavailable in this browser.');
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = canvas.toDataURL(mimeType, options.quality ?? 0.92);
    return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType };
  },
};

export const notifications = {
  async subscribe(): Promise<void> {
    if (!('Notification' in window)) {
      throw new FirebaseApiError('notification_not_supported', 'Browser ini tidak mendukung notifikasi.');
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new FirebaseApiError('notification_permission_denied', 'Izin notifikasi belum diberikan.');
    }
  },
};

export const ws = {
  connect() {
    const callbacks: Array<(message: unknown) => void> = [];
    let unsubscribe: (() => void) | null = null;
    let closed = false;
    const ready = (async () => {
      const user = firebaseAuth.currentUser;
      if (!user) throw new FirebaseApiError('auth_required', 'Login diperlukan untuk realtime.', 401);
      const { profile } = await ensureWorkspace(user);
      unsubscribe = subscribeToWorkspace(
        profile.workspaceId,
        (kind, incident) => {
          const data = kind === 'incident.deleted'
            ? { kind, id: incident.id, incident }
            : { kind, incident };
          callbacks.forEach((callback) => callback({
            type: 'entity.update',
            payload: { entity_type: 'workspace', entity_id: profile.workspaceId, data },
          }));
        },
        (settings) => callbacks.forEach((callback) => callback({
          type: 'entity.update',
          payload: {
            entity_type: 'workspace',
            entity_id: profile.workspaceId,
            data: { kind: 'settings.saved', settings },
          },
        })),
        () => callbacks.forEach((callback) => callback({
          type: 'entity.update',
          payload: {
            entity_type: 'workspace',
            entity_id: profile.workspaceId,
            data: { kind: 'member.saved' },
          },
        })),
      );
      if (closed) unsubscribe();
    })();
    return {
      ready,
      connectionId: null as string | null,
      onMessage(callback: (message: unknown) => void) { callbacks.push(callback); },
      disconnect() {
        closed = true;
        unsubscribe?.();
        unsubscribe = null;
      },
    };
  },
};
