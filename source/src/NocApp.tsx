// @ts-nocheck
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { read, type WorkBook } from 'xlsx';

import TextareaAutosize from 'react-textarea-autosize';
import { Toaster, toast as sonnerToast } from 'sonner';
import { api, auth, image, invitesClient, notifications, ws } from './platform/firebase-client';
import { AlertTriangle, Archive, BarChart3, Bell, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Copy, Database, Download, Edit3, Eye, FileSpreadsheet, FileText, History, LayoutDashboard, Link2, LoaderCircle, LogOut, Map as MapIcon, MapPin, Menu, Moon, MoreHorizontal, Paperclip, Plus, Radio, RotateCcw, Save, ScanLine, Search, Settings, Share2, ShieldCheck, Sun, Trash2, Upload, UserPlus, Users, WandSparkles, WifiOff, X } from 'lucide-react';
import CutPointTracker from './CutPointTracker';
import MobileActionSheet from './MobileActionSheet';
import RunningWorkspaceSwitcher, { RunningStrip, RunningTabs, type RunningItem } from './RunningWorkspace';

import AuroraEffects from './AuroraEffects';
import { GlobalIncidentSearch, ShiftHandoverCenter } from './PhaseAOps';
import { Badge, Button, CustomSelect, EmptyState, Field, ListEditor, SmartInput, type SelectOption } from './EditorPrimitives';
import { RouteMasterSelect } from './RouteMasterSelect';
import { chooseInitialMasterSheet, detectSheetHeaders, extractRouteMasterPairs, parseWorkbookSheet, worksheetRowCount, type RouteMasterPair } from './route-master-excel';


import PageErrorBoundary, { DeferredScreen } from './PageErrorBoundary';
import OperationsCenter from './PhaseDOps';
import ReliabilityCenter from './PhaseEReliability';
import RiskRadar from './PhaseFRisk';
import { CommandTopbar, IncidentHud, QuickUpdateSheet, timelineGapLabel, type DensityMode } from './PhaseGUI';
import { AdaptiveCommandPalette, AdaptiveSectionNav, AttentionRibbon, type AdaptiveCommand, type SectionKey } from './PhaseHAdaptive';
import ParserImportModal from './ParserImportModal';
import EscalationEmailPanel from './EscalationEmailPanel';
import ProgressAutoparsePanel from './ProgressAutoparsePanel';
import { shiftIsoDate } from './progress-autoparse';
import { getSlaNotice } from './sla-notifications';
import { availableStatusOptions, bytesLabel, defaultSettings, emptyIncident, formatReport, incidentResolutionMinutes, incidentSlaState, incidentTitle, localDate, localDateTime, localTime, newId, roleLabel, statusTone, validateIncident, type AuditEntry, type BootstrapData, type Incident, type IncidentStatus, type IncidentVersion, type Role, type SettingsData } from './domain';
import { clearAllIncidentRecoveries, clearIncidentRecovery, readIncidentRecovery, storeIncidentRecovery } from './incident-recovery';
import { decideRealtimeDraftUpdate, shouldApplyRemoteListUpdate } from './realtime-sync';
import { mergeIncidentPage } from './incident-pagination';
import { analyzeWorkspaceImport } from './workspace-import';
import { planSelectiveWorkspaceRestore } from './workspace-restore-plan';
import { executeSelectiveWorkspaceRestore } from './workspace-restore-execution';
import WorkspaceIntegrityPanel from './WorkspaceIntegrityPanel';
import {
    canCleanupStaleRouteMasterBatch,
    canReactivateRouteMasterBatch,
    getRestoreOperationDisplayStatus,
    restoreOperationStatusLabel,
} from './workspace-restore-recovery';
type View = 'dashboard' | 'editor' | 'archive' | 'trash' | 'tracker' | 'handover' | 'operations' | 'reliability' | 'risk' | 'settings' | 'team';
type User = {
    userId: string;
    email?: string;
    name?: string;
    picture?: string;
    emailVerified?: boolean;
};
type RouteMasterMeta = {
    currentBatchId?: string;
    count: number;
    fileName: string;
    sheetName: string;
    systemKeyColumn: string;
    routeSegmentColumn: string;
    updatedAt: number;
    updatedByName?: string;
};
type GeminiStatus = {
    configured: boolean;
    provider: string;
    model: string;
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const errorMessage = (value: unknown) => {
    const messages: Record<string, string> = {
        'auth/email-not-verified': 'Email belum diverifikasi. Tautan verifikasi baru sudah dikirim; periksa inbox dan folder spam.',
        'auth/invalid-credential': 'Email atau password tidak sesuai.',
        'auth/too-many-requests': 'Terlalu banyak percobaan masuk. Tunggu sebentar lalu coba lagi.',
        revision_conflict: 'Data di server sudah berubah. Pilih versi yang ingin dipertahankan.',
        duplicate_incident_id: 'Incident ID sudah digunakan pada incident lain.',
        invalid_status_transition: 'Perubahan status ini tidak mengikuti alur incident yang diizinkan.',
        supervisor_required_to_close: 'Hanya Supervisor atau Admin yang dapat menyelesaikan incident.',
        reopen_reason_required: 'Alasan pembukaan kembali wajib diisi.',
        progress_history_immutable: 'Urutan update timeline tidak boleh diubah dan setiap update harus memiliki ID unik.',
        title_required: 'Judul TT wajib diisi.',
        dispatch_before_occur: 'Dispatch time tidak boleh lebih awal dari occur time.',
        closed_before_latest_progress: 'Closed time tidak boleh lebih awal dari update terakhir.',
        recovery_update_required: 'Tambahkan update recovery yang mengonfirmasi link normal atau TT closed.',
        closed_time_required: 'Closed time wajib diisi.',
        closing_checklist_incomplete: 'Semua closing checklist wajib dikonfirmasi.',
        closing_evidence_required: 'Referensi bukti penutupan wajib diisi.',
        invite_email_required: 'Email penerima wajib diisi agar link undangan tidak dapat dipakai orang lain.',
        invite_not_allowed: 'Link undangan ini hanya dapat dipakai oleh email yang diundang.',
        invite_expired: 'Link undangan sudah kedaluwarsa. Minta Admin membuat link baru.',
        invite_revoked: 'Link undangan sudah dicabut oleh Admin.',
        invite_not_found: 'Link undangan tidak valid atau sudah tidak dapat digunakan. Minta Admin membuat link baru.',
        auth_required: 'Silakan masuk dengan akun yang menerima undangan terlebih dahulu.',
        account_already_has_workspace: 'Akun ini sudah terhubung ke workspace lain. Gunakan akun email yang diundang atau keluar dari workspace lama terlebih dahulu.',
        invalid_workspace_invite: 'Link undangan workspace tidak valid.',
        failed_to_join_workspace: 'Gagal menambahkan akun ke workspace. Coba lagi.',
        assignee_not_member: 'Penanggung jawab harus merupakan anggota workspace.',
        parent_self_reference: 'Incident tidak dapat menjadi parent untuk dirinya sendiri.',
        parent_cycle_detected: 'Relasi parent ini membentuk cycle. Pilih incident lain.',
        parent_incident_not_found: 'Parent incident tidak tersedia atau sudah berada di Trash.',
        incident_in_trash: 'Incident berada di Trash. Pulihkan terlebih dahulu.',
        admin_required: 'Aksi ini hanya tersedia untuk Admin.',
        permanent_purge_unavailable: 'Penghapusan permanen belum tersedia pada mode Firebase Spark-only. Incident tetap aman di Trash; audit dan version history tidak dihapus.',
        gemini_not_configured: 'Gemini API key belum dikonfigurasi.',
        gemini_api_key_invalid: 'Gemini API key ditolak.',
        coordinate_not_found: 'Koordinat tidak terlihat pada gambar.',
        coordinate_not_parsable: 'Teks koordinat ditemukan, tetapi formatnya belum dapat dibaca.'
    };
    if (value && typeof value === 'object') {
        const err = value as { message?: string; code?: string; response?: { data?: { error?: string } } };
        const code = err.response?.data?.error || err.code || '';
        return messages[code] || err.message || code || 'Terjadi kesalahan. Coba lagi.';
    }
    return 'Terjadi kesalahan. Coba lagi.';
};
type GeotagPreparedView = { data: string; mimeType: string; label: string };
const makeGeotagCrop = (bitmap: ImageBitmap, label: string, x: number, y: number, width: number, height: number, filter = 'none', target = 2500): GeotagPreparedView => { const nx = Math.max(0, Math.min(.99, x)); const ny = Math.max(0, Math.min(.99, y)); const sx = Math.floor(bitmap.width * nx); const sy = Math.floor(bitmap.height * ny); const sw = Math.max(1, Math.min(bitmap.width - sx, Math.floor(bitmap.width * Math.max(.01, width)))); const sh = Math.max(1, Math.min(bitmap.height - sy, Math.floor(bitmap.height * Math.max(.01, height)))); const desiredScale = Math.min(4, Math.max(1, target / Math.max(sw, sh))); const pixelCapScale = Math.sqrt(5600000 / Math.max(1, sw * sh)); const scale = Math.max(.55, Math.min(desiredScale, pixelCapScale)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale)); const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('crop_canvas_unavailable'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.filter = filter; ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height); ctx.filter = 'none'; const dataUrl = canvas.toDataURL('image/jpeg', .98); return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg', label }; };
const prepareGeotagViews = async (file: File): Promise<GeotagPreparedView[]> => { const full = await image.resizeIfNeeded(file, { maxDimension: 2200, maxPixels: 3600000, quality: .97, mimeType: 'image/jpeg' }); const views: GeotagPreparedView[] = []; try {
    const bitmap = await createImageBitmap(file);
    const aspect = bitmap.width / Math.max(1, bitmap.height);
    const cornerW = aspect < .8 ? .78 : aspect > 1.65 ? .5 : .64;
    const cornerH = aspect < .8 ? .34 : aspect > 1.65 ? .62 : .46;
    const contrast = 'grayscale(1) contrast(2.05) brightness(1.08)';
    const specs: Array<[string, number, number, number, number, string, number]> = [['bottom-right detail', 1 - cornerW, 1 - cornerH, cornerW, cornerH, 'none', 2700], ['bottom-right enhanced', 1 - cornerW, 1 - cornerH, cornerW, cornerH, contrast, 2700], ['top-left detail', 0, 0, cornerW, cornerH, 'none', 2700], ['top-left enhanced', 0, 0, cornerW, cornerH, contrast, 2700], ['bottom edge enhanced', 0, .70, 1, .30, contrast, 2700], ['top edge enhanced', 0, 0, 1, .30, contrast, 2700], ['bottom-left detail', 0, 1 - cornerH, cornerW, cornerH, 'none', 2600], ['bottom-left enhanced', 0, 1 - cornerH, cornerW, cornerH, contrast, 2600], ['top-right detail', 1 - cornerW, 0, cornerW, cornerH, 'none', 2600], ['top-right enhanced', 1 - cornerW, 0, cornerW, cornerH, contrast, 2600], ['right edge enhanced', .65, 0, .35, 1, contrast, 2500], ['left edge enhanced', 0, 0, .35, 1, contrast, 2500], ['middle band enhanced', 0, .32, 1, .36, contrast, 2500]];
    for (const [label, x, y, width, height, filter, target] of specs) views.push(makeGeotagCrop(bitmap, label, x, y, width, height, filter, target));
    bitmap.close();
} catch { } views.push({ data: full.data, mimeType: full.mimeType, label: 'full image' }); return views; };
const isImageFile = (file: File) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name);
const firstImageFile = (files?: FileList | null, items?: DataTransferItemList | null) => { const direct = files ? Array.from(files).find(isImageFile) : undefined; if (direct) return direct; if (items) for (const item of Array.from(items)) { if (item.kind !== 'file') continue; const file = item.getAsFile(); if (file && isImageFile(file)) return file; } return null; };



const roleOptions: SelectOption[] = [{ value: 'operator', label: 'Operator', detail: 'Membuat dan memperbarui incident' }, { value: 'supervisor', label: 'Supervisor', detail: 'Review dan menutup incident' }, { value: 'admin', label: 'Admin', detail: 'Akses penuh workspace' }];
const inviteRoleOptions = roleOptions.filter(option => option.value !== 'admin');
function App() {
    const [user, setUser] = useState<User | null>(null);
    const [data, setData] = useState<BootstrapData | null>(null);
    const [view, setView] = useState<View>(() => { const saved = localStorage.getItem('noc-last-view'); return ['dashboard', 'operations', 'reliability', 'risk', 'archive', 'tracker', 'handover', 'team'].includes(saved || '') ? saved as View : 'dashboard'; });
    const [draft, setDraft] = useState<Incident | null>(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState('');
    const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');
    const [authEmail, setAuthEmail] = useState('');
    const [authPassword, setAuthPassword] = useState('');
    const [authName, setAuthName] = useState('');
    const [authBusy, setAuthBusy] = useState(false);
    const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
    const [theme, setTheme] = useState(() => localStorage.getItem('noc-theme') || 'light');
    const [menuOpen, setMenuOpen] = useState(false);
    const [mobilePreview, setMobilePreview] = useState(false);
    const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
    const [runningSwitcherOpen, setRunningSwitcherOpen] = useState(false);
    const [runningIds, setRunningIds] = useState<string[]>([]);
    const [runningHydratedKey, setRunningHydratedKey] = useState('');
    const [importOpen, setImportOpen] = useState(false);
    const [importText, setImportText] = useState('');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [severityFilter, setSeverityFilter] = useState('All');
    const [inviteCode, setInviteCode] = useState<string | null>(null);
    const [inviteInfo, setInviteInfo] = useState<{ status?: string; error?: string } | null>(null);
    const [joinBusy, setJoinBusy] = useState(false);
    const [joinError, setJoinError] = useState('');
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<Role>('operator');
    const [inviteUrl, setInviteUrl] = useState('');
    const [settingsDraft, setSettingsDraft] = useState<SettingsData>(defaultSettings);
    const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>({ configured: false, provider: 'Google Gemini', model: 'gemini-3.6-flash' });
    const [routeMaster, setRouteMaster] = useState<RouteMasterPair[]>([]);
    const [routeMasterMeta, setRouteMasterMeta] = useState<RouteMasterMeta | null>(null);
    const [masterImportOpen, setMasterImportOpen] = useState(false);
    const [masterWorkbook, setMasterWorkbook] = useState<WorkBook | null>(null);
    const [masterBuffer, setMasterBuffer] = useState<ArrayBuffer | null>(null);
    const [masterSheetNames, setMasterSheetNames] = useState<string[]>([]);
    const [masterRowCount, setMasterRowCount] = useState(0);
    const [masterFileName, setMasterFileName] = useState('');
    const [masterSheetName, setMasterSheetName] = useState('');
    const [systemKeyColumn, setSystemKeyColumn] = useState('H');
    const [routeSegmentColumn, setRouteSegmentColumn] = useState('A');
    const [masterImportBusy, setMasterImportBusy] = useState(false);
    const [workspaceExportBusy, setWorkspaceExportBusy] = useState(false);
    const [workspaceImportReport, setWorkspaceImportReport] = useState<ReturnType<typeof analyzeWorkspaceImport> | null>(null);
    const [workspaceImportFileName, setWorkspaceImportFileName] = useState('');
    const [workspaceImportBusy, setWorkspaceImportBusy] = useState(false);
    const [workspaceImportBundle, setWorkspaceImportBundle] = useState<unknown | null>(null);
    const [workspaceRestoreSelection, setWorkspaceRestoreSelection] = useState({ settings: false, routeMaster: false });
    const [workspaceRestoreConfirmOpen, setWorkspaceRestoreConfirmOpen] = useState(false);
    const [workspaceRestoreBusy, setWorkspaceRestoreBusy] = useState(false);
    const [workspaceRestoreProgress, setWorkspaceRestoreProgress] = useState({ stage: '', completed: 0, total: 0, message: '' });
    const [workspaceRestoreResult, setWorkspaceRestoreResult] = useState<any>(null);
    const [workspaceRestoreRecovery, setWorkspaceRestoreRecovery] = useState<any>(null);
    const [workspaceRestoreRecoveryBusy, setWorkspaceRestoreRecoveryBusy] = useState(false);
    const [workspaceRestoreRecoveryAction, setWorkspaceRestoreRecoveryAction] = useState('');
    const [masterImportProgress, setMasterImportProgress] = useState(0);
    const [versions, setVersions] = useState<IncidentVersion[]>([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [geotagBusy, setGeotagBusy] = useState(false);
    const [geotagProgress, setGeotagProgress] = useState({ done: 0, total: 0 });
    const [geotagDiagnostics, setGeotagDiagnostics] = useState<string[]>([]);
    const [geotagDropTarget, setGeotagDropTarget] = useState('');
    const [timelineInput, setTimelineInput] = useState({ date: localDate(), time: localTime(), text: '', pic: '', milestone: '' });
    const [editingProgressId, setEditingProgressId] = useState('');
    const [progressEditDraft, setProgressEditDraft] = useState({ date: '', time: '', text: '', pic: '', milestone: '' });
    const [incidentsNextToken, setIncidentsNextToken] = useState<string | null>(null);
    const [remoteConflict, setRemoteConflict] = useState<Incident | null>(null);
    const [auditTrail, setAuditTrail] = useState<AuditEntry[]>([]);
    const [online, setOnline] = useState(() => navigator.onLine);
    const [clock, setClock] = useState(() => Date.now());
    const [notificationReady, setNotificationReady] = useState(() => localStorage.getItem('noc-notifications') === 'enabled');
    const [opsUnread, setOpsUnread] = useState(0);
    const [opsSignal, setOpsSignal] = useState(0);
    const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('noc-sidebar-collapsed') === 'true');
    const [density, setDensity] = useState<DensityMode>(() => { const saved = localStorage.getItem('noc-density'); return saved === 'compact' || saved === 'war' ? saved : 'comfortable'; });
    const [focusMode, setFocusMode] = useState(false);
    const [quickUpdateOpen, setQuickUpdateOpen] = useState(false);
    const [commandOpen, setCommandOpen] = useState(false);
    const masterFileRef = useRef<HTMLInputElement>(null);
    const lastSavedRef = useRef('');
    const saveTimerRef = useRef<number | null>(null);
    const saveInFlightRef = useRef<Promise<boolean> | null>(null);
    const draftRef = useRef<Incident | null>(null);
    draftRef.current = draft;
    const socketRef = useRef<ReturnType<typeof ws.connect> | null>(null);
    const slaNoticeMemoryRef = useRef<Set<string>>(new Set());
    const slaNoticeInitialRef = useRef<Set<string>>(new Set());
    const notify = (text: string, tone: 'success' | 'error' | 'info' = 'info') => { if (tone === 'success') sonnerToast.success(text); else if (tone === 'error') sonnerToast.error(text); else sonnerToast.message(text); };
    const upsertIncident = (incident: Incident) => { setData(previous => previous ? { ...previous, incidents: previous.incidents.some(item => item.id === incident.id) ? previous.incidents.map(item => item.id === incident.id ? incident : item) : [incident, ...previous.incidents] } : previous); };
    async function loadRouteMaster() { const response = await api.get('/api/route-master'); setRouteMaster((response.data.items || []) as RouteMasterPair[]); setRouteMasterMeta((response.data.meta || null) as RouteMasterMeta | null); }
    async function loadGeminiStatus() { try { const response = await api.get('/api/integrations/gemini/status'); setGeminiStatus(response.data as GeminiStatus); } catch { setGeminiStatus({ configured: false, provider: 'Google Gemini', model: 'gemini-3.6-flash' }); } }
    async function loadOpsUnread() { try { const response = await api.get('/api/operations/alerts/summary'); setOpsUnread(Number(response.data.unreadCount) || 0); } catch { setOpsUnread(0); } }
    async function loadWorkspaceRestoreRecovery() {
        if (!data || !isAdmin) return;
        setWorkspaceRestoreRecoveryBusy(true);
        try {
            const response = await api.get('/api/workspace-restore/recovery');
            setWorkspaceRestoreRecovery(response.data || null);
        } catch (err) {
            notify(errorMessage(err), 'error');
        } finally {
            setWorkspaceRestoreRecoveryBusy(false);
        }
    }
    async function loadWorkspace() {
        setLoading(true);
        try {
            const accessToken = await auth.getAccessToken();
            if (!accessToken) {
                try { await auth.signOut(); } catch { }
                setUser(null); setData(null); setAuthError('Sesi login berakhir. Silakan masuk kembali.'); return;
            }
            const response = await api.get('/api/bootstrap');
            const loaded = response.data as BootstrapData;
            setData(loaded); setIncidentsNextToken(loaded.incidentsNextToken || null); setSettingsDraft(clone({ ...defaultSettings, ...loaded.settings }));
            try { await loadRouteMaster(); } catch { setRouteMaster([]); setRouteMasterMeta(null); }
            await loadGeminiStatus(); await loadOpsUnread(); setAuthError('');
        } catch (err) {
            const authFailure = err as { message?: string; status?: number; response?: { status?: number } };
            const unauthorized = authFailure.response?.status === 401 || authFailure.status === 401 || /status code 401|unauthorized/i.test(authFailure.message || '');
            if (unauthorized) { try { await auth.signOut(); } catch { } setUser(null); setData(null); setAuthError('Sesi login berakhir. Silakan masuk kembali.'); return; }
            setAuthError(errorMessage(err));
        } finally { setLoading(false); }
    }
    useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('noc-theme', theme); }, [theme]);
    useEffect(() => { document.documentElement.dataset.density = density; localStorage.setItem('noc-density', density); }, [density]);
    useEffect(() => { localStorage.setItem('noc-sidebar-collapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
    useEffect(() => { if (view !== 'editor') { setFocusMode(false); setQuickUpdateOpen(false); } if (['dashboard', 'operations', 'reliability', 'risk', 'archive', 'tracker', 'handover', 'team'].includes(view)) localStorage.setItem('noc-last-view', view); }, [view]);
    useEffect(() => {
        if (view === 'settings' && data?.profile.role === 'admin') void loadWorkspaceRestoreRecovery();
    }, [view, data?.profile.role, data?.profile.workspaceId]);
    useEffect(() => {
        const workspaceId = data?.profile.workspaceId; const userId = data?.profile.userId; if (!workspaceId || !userId) return;
        const key = `noc-running:${workspaceId}:${userId}`;
        const activeIds = data.incidents.filter(item => !item.deletedAt && (item.status === 'Open' || item.status === 'Monitoring')).map(item => item.id);
        let next = activeIds; const stored = localStorage.getItem(key);
        if (stored !== null) { try { const parsed = JSON.parse(stored); if (Array.isArray(parsed)) next = parsed.filter((id): id is string => typeof id === 'string' && activeIds.includes(id)); } catch { } }
        setRunningIds(next); setRunningHydratedKey(key);
    }, [data?.profile.workspaceId, data?.profile.userId]);
    useEffect(() => { if (runningHydratedKey) localStorage.setItem(runningHydratedKey, JSON.stringify(runningIds)); }, [runningHydratedKey, runningIds]);
    useEffect(() => { if (!runningHydratedKey || !data) return; const active = new Set(data.incidents.filter(item => !item.deletedAt && (item.status === 'Open' || item.status === 'Monitoring')).map(item => item.id)); setRunningIds(current => { const next = current.filter(id => active.has(id)); return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next; }); }, [data?.incidents, runningHydratedKey]);
    useEffect(() => {
        let alive = true;
        void (async () => { const pendingCode = invitesClient.getPendingCode(); if (alive) setInviteCode(pendingCode); if (pendingCode) { try { const response = await api.get(`/api/invites/${pendingCode}`); if (alive) setInviteInfo({ status: response.data.status }); } catch (err) { if (alive) setInviteInfo({ error: errorMessage(err) }); } } const current = await auth.getUser(); if (!alive) return; if (current && current.emailVerified === false) { try { await auth.signOut(); } catch { } setUser(null); setAuthError('Email akun belum diverifikasi. Periksa inbox untuk tautan verifikasi sebelum masuk.'); setLoading(false); return; } setUser(current as User | null); if (current && !pendingCode) await loadWorkspace(); else setLoading(false); })();
        return () => { alive = false; };
    }, []);
    useEffect(() => {
        const workspaceId = data?.profile.workspaceId; if (!workspaceId) return;
        const connection = ws.connect(); socketRef.current = connection;
        connection.onMessage(message => {
            if (message?.type !== 'entity.update' || message.payload?.entity_type !== 'workspace' || message.payload?.entity_id !== workspaceId) return;
            const payload = message.payload.data as { kind?: string; incident?: Incident; id?: string; settings?: SettingsData; member?: BootstrapData['members'][number] };
            if (payload.kind === 'incident.saved' && payload.incident) {
                const incoming = payload.incident;
                setData(current => {
                    if (!current) return current;
                    const existing = current.incidents.find(item => item.id === incoming.id);
                    if (!shouldApplyRemoteListUpdate(existing, incoming)) return current;
                    return { ...current, incidents: existing
                        ? current.incidents.map(item => item.id === incoming.id ? incoming : item)
                        : [incoming, ...current.incidents] };
                });
                setOpsSignal(value => value + 1);
                setDraft(current => {
                    const decision = decideRealtimeDraftUpdate({
                        current,
                        incoming,
                        baselineSerialized: lastSavedRef.current,
                        saveInFlight: Boolean(saveInFlightRef.current),
                    });
                    if (decision === 'ignore' || decision === 'preserve') return current;
                    if (decision === 'conflict') {
                        setRemoteConflict(existing => !existing || existing.revision < incoming.revision ? clone(incoming) : existing);
                        return current;
                    }
                    lastSavedRef.current = JSON.stringify(incoming);
                    clearIncidentRecovery(data?.profile.workspaceId, data?.profile.userId, incoming.id);
                    return clone(incoming);
                });
            }
            if (payload.kind === 'incident.deleted' && payload.id) { setData(current => current ? { ...current, incidents: current.incidents.filter(item => item.id !== payload.id) } : current); setDraft(current => current?.id === payload.id ? null : current); setOpsSignal(value => value + 1); }
            if (payload.kind === 'ops.alerts_changed') { setOpsSignal(value => value + 1); void loadOpsUnread(); }
            if (payload.kind === 'settings.saved' && payload.settings) { const incomingSettings = payload.settings; setData(current => current ? { ...current, settings: incomingSettings } : current); setSettingsDraft(clone(incomingSettings)); setOpsSignal(value => value + 1); }
            if (payload.kind === 'routeMaster.saved') void loadRouteMaster();
            if (payload.kind === 'member.saved') void loadWorkspace();
            if (payload.kind === 'member.deleted') void loadWorkspace();
        });
        connection.ready.then(() => { if (connection.connectionId) void api.post('/api/subscriptions', { entity_type: 'workspace', entity_id: workspaceId, connection_id: connection.connectionId }); }).catch(() => notify('Realtime tidak tersambung. Data tetap dapat disimpan.', 'error'));
        return () => { if (connection.connectionId) void api.post('/api/subscriptions/remove', { entity_type: 'workspace', entity_id: workspaceId, connection_id: connection.connectionId }); connection.disconnect(); socketRef.current = null; };
    }, [data?.profile.workspaceId]);
    useEffect(() => { if (!draft || !data) return; const serialized = JSON.stringify(draft); if (serialized === lastSavedRef.current) return; setSaveState('pending'); if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); saveTimerRef.current = window.setTimeout(() => void persistDraft(draft), 900); return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); }; }, [draft]);
    useEffect(() => { const handleOnline = () => { setOnline(true); const latest = draftRef.current; if (latest && JSON.stringify(latest) !== lastSavedRef.current && remoteConflict?.id !== latest.id) void persistDraft(latest); }; const handleOffline = () => setOnline(false); const refreshClock = () => setClock(Date.now()); window.addEventListener('online', handleOnline); window.addEventListener('offline', handleOffline); document.addEventListener('visibilitychange', refreshClock); const timer = window.setInterval(refreshClock, 60000); return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); document.removeEventListener('visibilitychange', refreshClock); window.clearInterval(timer); }; }, [remoteConflict?.id]);
    useEffect(() => { if (!draft || !data) return; const serialized = JSON.stringify(draft); if (serialized === lastSavedRef.current) return; storeIncidentRecovery(draft, data.profile.workspaceId, data.profile.userId); }, [draft, data?.profile.workspaceId, data?.profile.userId]);
    useEffect(() => { const blockExit = (event: BeforeUnloadEvent) => { if (saveState === 'pending' || saveState === 'saving' || saveState === 'error') { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', blockExit); return () => window.removeEventListener('beforeunload', blockExit); }, [saveState]);
    async function completeAuthentication(nextUser: User) {
        if (nextUser.emailVerified === false) {
            try { await auth.signOut(); } catch { }
            setUser(null);
            setData(null);
            setAuthError('Email akun belum diverifikasi. Periksa inbox untuk tautan verifikasi sebelum masuk.');
            return;
        }
        setUser(nextUser);
        if (inviteCode) {
            try {
                const response = await api.get('/api/invites/' + inviteCode);
                setInviteInfo({ status: response.data.status });
            } catch (err) {
                setInviteInfo({ error: errorMessage(err) });
            }
        } else {
            await loadWorkspace();
        }
    }
    async function signIn() {
        setAuthError('');
        setAuthBusy(true);
        try {
            const result = await auth.signIn();
            await completeAuthentication(result.user as User);
        } catch (err) {
            setAuthError(errorMessage(err));
        } finally {
            setAuthBusy(false);
        }
    }
    async function signInWithPassword() {
        setAuthError('');
        setAuthBusy(true);
        try {
            const result = await auth.signInWithEmail(authEmail, authPassword);
            await completeAuthentication(result.user as User);
        } catch (err) {
            setAuthError(errorMessage(err));
        } finally {
            setAuthBusy(false);
        }
    }
    async function requestPasswordReset() {
        setAuthError('');
        if (!authEmail.trim()) {
            setAuthError('Masukkan email akun terlebih dahulu.');
            return;
        }
        setAuthBusy(true);
        try {
            await auth.requestPasswordReset(authEmail);
            notify('Permintaan pemulihan diproses. Jika email terdaftar, tautan reset akan dikirim ke inbox.', 'success');
        } catch (err) {
            setAuthError(errorMessage(err));
        } finally {
            setAuthBusy(false);
        }
    }
    async function registerWithPassword() {
        setAuthError('');
        if (authPassword.length < 12) {
            setAuthError('Gunakan password minimal 12 karakter.');
            return;
        }
        if (authName.trim().length < 2) {
            setAuthError('Nama minimal 2 karakter.');
            return;
        }
        setAuthBusy(true);
        try {
            await auth.registerWithEmail(authName, authEmail, authPassword);
            setAuthMode('signin');
            setAuthPassword('');
            notify('Akun dibuat. Tautan verifikasi sudah dikirim ke email; verifikasi dulu sebelum masuk.', 'success');
        } catch (err) {
            setAuthError(errorMessage(err));
        } finally {
            setAuthBusy(false);
        }
    }
    async function signOut() {
        if (saveState === 'saving') { notify('Draft masih disimpan. Tunggu sampai proses selesai, lalu logout lagi.', 'info'); return; }
        if (draft && JSON.stringify(draft) !== lastSavedRef.current) {
            if (!navigator.onLine) { notify('Logout dibatalkan karena draft belum tersimpan dan koneksi sedang offline.', 'error'); return; }
            if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
            const saved = await persistDraft(draft);
            if (!saved) { notify('Logout dibatalkan agar draft yang belum tersimpan tidak hilang.', 'info'); return; }
        }
        try {
            await auth.signOut();
            clearAllIncidentRecoveries();
            socketRef.current?.disconnect();
            setUser(null); setData(null); setDraft(null); setOpsUnread(0); setOpsSignal(0); setView('dashboard');
        } catch (err) {
            notify('Logout gagal: ' + errorMessage(err), 'error');
        }
    }
    async function joinWorkspace() { if (!inviteCode || joinBusy) return; setJoinBusy(true); setJoinError(''); try { await api.post(`/api/invites/${inviteCode}/join`); invitesClient.clearPendingCode(); setInviteCode(null); setInviteInfo(null); await loadWorkspace(); notify('Berhasil bergabung ke workspace NOC.', 'success'); } catch (err) { setJoinError(errorMessage(err)); } finally { setJoinBusy(false); } }
    async function persistDraft(incident: Incident): Promise<boolean> {
        if (remoteConflict?.id === incident.id) return false;
        if (!navigator.onLine) { setSaveState('pending'); return false; }

        // Autosave, reconnect, logout, and incident switching can request a save
        // at nearly the same time. Serialize writes so they cannot race on one revision.
        if (saveInFlightRef.current) {
            const previousSave = saveInFlightRef.current;
            const previousResult = await previousSave;
            const latest = draftRef.current;
            if (latest?.id === incident.id && JSON.stringify(latest) !== lastSavedRef.current) {
                return persistDraft(latest);
            }
            return previousResult;
        }

        const operation = (async (): Promise<boolean> => {
            setSaveState('saving');
            try {
                const submitted = clone(incident);
                const response = await api.put(`/api/incidents/${submitted.id}`, submitted);
                const saved = response.data.incident as Incident;
                lastSavedRef.current = JSON.stringify(saved);
                setRemoteConflict(null);

                const latest = draftRef.current;
                const hasNewerLocalEdits = latest?.id === saved.id
                    && JSON.stringify(latest) !== JSON.stringify(submitted);

                if (latest?.id === saved.id) {
                    if (hasNewerLocalEdits) {
                        // Preserve edits typed while the request was in flight, but
                        // advance their base revision to the revision just committed.
                        setDraft({
                            ...latest,
                            revision: saved.revision,
                            updatedAt: saved.updatedAt,
                            updatedBy: saved.updatedBy,
                        });
                        setSaveState('pending');
                    } else {
                        setDraft(clone(saved));
                        clearIncidentRecovery(data?.profile.workspaceId, data?.profile.userId, saved.id);
                        setSaveState('saved');
                    }
                } else {
                    clearIncidentRecovery(data?.profile.workspaceId, data?.profile.userId, saved.id);
                    setSaveState('saved');
                }

                upsertIncident(saved);
                // Do not let callers create a snapshot or switch away while edits
                // typed during this request are still waiting for autosave.
                return !hasNewerLocalEdits;
            } catch (err) {
                const payload = (err as { response?: { data?: { error?: string; current?: Incident } } }).response?.data;
                if (payload?.error === 'revision_conflict' && payload.current) setRemoteConflict(clone(payload.current));
                setSaveState('error');
                notify(errorMessage(err), 'error');
                return false;
            }
        })();

        saveInFlightRef.current = operation;
        try {
            return await operation;
        } finally {
            if (saveInFlightRef.current === operation) saveInFlightRef.current = null;
        }
    }
    async function createIncident(seed?: Partial<Incident>) { if (!user) return null; try { const payload = { ...emptyIncident(user.name || user.email || ''), ...seed }; const response = await api.post('/api/incidents', payload); const created = response.data.incident as Incident; upsertIncident(created); openIncident(created); notify('Draft incident baru dibuat.', 'success'); return created; } catch (err) { notify(errorMessage(err), 'error'); return null; } }
    function pinRunningIncident(id: string) { setRunningIds(current => current.includes(id) ? current : [...current, id]); }
    function removeRunningIncident(id: string) { setRunningIds(current => current.filter(item => item !== id)); }
    function openIncident(incident: Incident) {
        if (incident.status === 'Open' || incident.status === 'Monitoring') pinRunningIncident(incident.id);
        const serverCopy = clone(incident);
        const recovered = readIncidentRecovery(serverCopy, data.profile.workspaceId, data.profile.userId);
        const copied = recovered || serverCopy;
        if (recovered) {
            notify('Draft lokal yang belum terkirim berhasil dipulihkan.', 'info');
            if (recovered.revision !== serverCopy.revision) {
                setRemoteConflict(serverCopy);
                notify('Draft lokal berasal dari revisi lama. Pilih versi server atau duplikasi draft lokal sebelum melanjutkan.', 'error');
            } else setRemoteConflict(null);
        } else setRemoteConflict(null);
        setDraft(copied);
        lastSavedRef.current = JSON.stringify(serverCopy);
        const latest = [...copied.progress].sort((a, b) => ((b.date || '') + 'T' + (b.time || '')).localeCompare((a.date || '') + 'T' + (a.time || '')))[0];
        setTimelineInput({ date: latest?.date || copied.occurTime.slice(0, 10) || localDate(), time: localTime(), text: '', pic: copied.picName, milestone: '' });
        setEditingProgressId('');
        setProgressEditDraft({ date: '', time: '', text: '', pic: '', milestone: '' });
        setSaveState(JSON.stringify(copied) === JSON.stringify(serverCopy) ? 'saved' : 'pending');
        setView('editor'); setMobilePreview(false); setHistoryOpen(false);
    }
    async function switchIncident(incident: Incident) { if (draft?.id === incident.id) { pinRunningIncident(incident.id); setView('editor'); setRunningSwitcherOpen(false); return true; } if (draft && JSON.stringify(draft) !== lastSavedRef.current) { if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; } const saved = await persistDraft(draft); if (!saved) { notify(navigator.onLine ? 'TT saat ini belum berhasil disimpan. Pindah incident dibatalkan.' : 'Simpan TT saat ini dulu setelah koneksi kembali sebelum pindah incident.', 'error'); return false; } } openIncident(incident); setRunningSwitcherOpen(false); return true; }
    async function quickUpdateIncident(incidentId: string, value: string, picValue: string, milestoneValue = '') { const clean = value.trim(); if (!clean || !data) return false; const source = draft?.id === incidentId ? clone(draft) : clone(data.incidents.find(item => item.id === incidentId)); if (!source || source.deletedAt || (source.status !== 'Open' && source.status !== 'Monitoring')) { notify('TT ini sudah tidak aktif.', 'error'); return false; } if (!navigator.onLine) { notify('Quick Update membutuhkan koneksi agar update langsung aman tersimpan.', 'error'); return false; } const progressItem = { id: newId(), date: localDate(), time: localTime(), text: clean, pic: picValue.trim() || source.picName || '', milestone: milestoneValue.trim() }; const ticket = clean.match(/MDU-\d{8}-\d+/i); const buildNext = (base: Incident) => ({ ...base, progress: [...base.progress, progressItem], mduTicket: ticket && !base.mduTicket ? ticket[0] : base.mduTicket }); if (draft?.id === incidentId && saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; } try { let response; try { response = await api.put(`/api/incidents/${incidentId}`, buildNext(source)); } catch (err) { const conflict = (err as { response?: { data?: { error?: string; current?: Incident } } }).response?.data; if (draft?.id !== incidentId && conflict?.error === 'revision_conflict' && conflict.current) response = await api.put(`/api/incidents/${incidentId}`, buildNext(conflict.current)); else throw err; } const saved = response.data.incident as Incident; upsertIncident(saved); pinRunningIncident(saved.id); if (draft?.id === saved.id) { lastSavedRef.current = JSON.stringify(saved); clearIncidentRecovery(data?.profile.workspaceId, data?.profile.userId, saved.id); setDraft(clone(saved)); setRemoteConflict(null); setSaveState('saved'); setTimelineInput(current => ({ ...current, time: localTime(), text: '', pic: saved.picName || current.pic })); } notify('Quick Update tersimpan.', 'success'); return true; } catch (err) { notify(errorMessage(err), 'error'); return false; } }
    const updateDraft = (patch: Partial<Incident>) => setDraft(current => { if (!current) return current; const next = { ...current, ...patch }; if (typeof patch.dispatchTime === 'string' && patch.dispatchTime !== current.dispatchTime) { const dispatchDate = patch.dispatchTime.slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(dispatchDate)) { next.progress = next.progress.map(item => { if (!item.autoparseBatchId || typeof item.autoparseDayOffset !== 'number') return item; const date = shiftIsoDate(dispatchDate, item.autoparseDayOffset); return date ? { ...item, date } : item; }); } } return next; });
    function useServerConflict() { if (!remoteConflict) return; const incoming = clone(remoteConflict); lastSavedRef.current = JSON.stringify(incoming); clearIncidentRecovery(data?.profile.workspaceId, data?.profile.userId, incoming.id); setDraft(incoming); setRemoteConflict(null); setSaveState('saved'); notify('Versi server dimuat.', 'info'); }
    async function duplicateLocalConflict() { if (!draft) return; const local = clone(draft); setRemoteConflict(null); await createIncident({ ...local, id: undefined as unknown as string, status: 'Draft', incidentId: '', mduTicket: '', closedTime: '', resolvedAt: 0, resolvedBy: '', reopenReason: '', attachments: [] }); }
    async function duplicateIncident(incident: Incident) { try { const response = await api.post(`/api/incidents/${incident.id}/duplicate`); const duplicated = response.data.incident as Incident; upsertIncident(duplicated); openIncident(duplicated); notify('Incident diduplikasi sebagai draft.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } }
    async function deleteIncident(incident: Incident) { if (!window.confirm('Pindahkan ' + (incident.incidentId || 'draft incident') + ' ke Trash? Data masih dapat dipulihkan.')) return; try { const response = await api.delete('/api/incidents/' + incident.id); const deleted = response.data.incident as Incident; upsertIncident(deleted); if (draft?.id === incident.id) { setDraft(null); setView('archive'); } notify('Incident dipindahkan ke Trash.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } }
    async function restoreIncident(incident: Incident) { try { const response = await api.post('/api/incidents/' + incident.id + '/undelete'); upsertIncident(response.data.incident as Incident); notify('Incident berhasil dipulihkan.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } }
    async function purgeIncident(incident: Incident) { if (!window.confirm('Hapus permanen ' + (incident.incidentId || 'incident') + '? Lampiran dan version history tidak dapat dipulihkan.')) return; try { await api.delete('/api/incidents/' + incident.id + '/purge'); setData(current => current ? { ...current, incidents: current.incidents.filter(item => item.id !== incident.id) } : current); notify('Incident dihapus permanen.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } }
    async function loadMoreIncidents() { if (!incidentsNextToken) return; try { const response = await api.post('/api/incidents/page', { nextToken: incidentsNextToken }); const incoming = (response.data.incidents || []) as Incident[]; setData(current => current ? { ...current, incidents: mergeIncidentPage(current.incidents, incoming) } : current); setIncidentsNextToken(response.data.nextToken || null); } catch (err) { notify(errorMessage(err), 'error'); } }
    async function confirmParsedImport(seed: Partial<Incident>) { const created = await createIncident(seed); if (!created) return false; setImportText(''); setImportOpen(false); return true; }
    async function copyText(value: string, success: string) { try { await navigator.clipboard.writeText(value); } catch { const area = document.createElement('textarea'); area.value = value; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove(); } notify(success, 'success'); }
    const report = useMemo(() => draft ? formatReport(draft) : '', [draft]);
    const validationErrors = useMemo(() => draft ? validateIncident(draft, data?.incidents || []) : [], [draft, data?.incidents]);
    const masterImportPairs = useMemo(() => extractRouteMasterPairs(masterWorkbook, masterSheetName, systemKeyColumn, routeSegmentColumn), [masterWorkbook, masterSheetName, systemKeyColumn, routeSegmentColumn]);
    const workspaceRestorePlan = workspaceImportBundle && workspaceImportReport
        ? planSelectiveWorkspaceRestore(workspaceImportBundle, workspaceImportReport, workspaceRestoreSelection, data?.profile.role || 'operator')
        : null;
    async function copyReport(includeEmoji = true) { if (!draft) return; const errors = validateIncident(draft, data?.incidents || []); if (errors.length) { notify(errors[0], 'error'); return; } await copyText(formatReport(draft, includeEmoji), includeEmoji ? 'Bagan siap ditempel ke WhatsApp.' : 'Versi tanpa emoji berhasil disalin.'); }
    function exportReport() { if (!draft) return; const errors = validateIncident(draft, data?.incidents || []); if (errors.length) { notify(errors[0], 'error'); return; } const blob = new Blob([report], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${draft.incidentId || 'incident-report'}.txt`; link.click(); URL.revokeObjectURL(url); }
    async function shareReport() { if (!draft) return; const errors = validateIncident(draft, data?.incidents || []); if (errors.length) { notify(errors[0], 'error'); return; } if (navigator.share) { try { await navigator.share({ title: incidentTitle(draft), text: report }); return; } catch { return; } } window.open(`https://wa.me/?text=${encodeURIComponent(report)}`, '_blank', 'noopener,noreferrer'); }
    function impactValue(impact: Incident['impacts'][number]) { const free = impact.text || ''; if (free) return free; const links = [impact.linkA || '', impact.linkB || ''].filter(Boolean).join('<>'); return [links, impact.incidentId || ''].filter(Boolean).join(' - '); }
    function addImpact() { if (!draft) return; updateDraft({ impacts: [...draft.impacts, { id: newId(), text: '', recovered: false }] }); }
    function addProgress() { if (!draft || !timelineInput.text.trim()) { notify('Tulis deskripsi update terlebih dahulu.', 'error'); return; } const item = { id: newId(), ...timelineInput, text: timelineInput.text.trim() }; const ticket = timelineInput.text.match(/MDU-\d{8}-\d+/i); updateDraft({ progress: [...draft.progress, item], mduTicket: ticket && !draft.mduTicket ? ticket[0] : draft.mduTicket }); setTimelineInput(current => ({ ...current, time: localTime(), text: '', milestone: '' })); } function addAutoparsedProgress(items: Incident['progress']) { if (!draft || !items.length) return; const ticket = items.map(item => item.text).join('\n').match(/MDU-\d{8}-\d+/i); updateDraft({ progress: [...draft.progress, ...items], mduTicket: ticket && !draft.mduTicket ? ticket[0] : draft.mduTicket }); notify(items.length + ' progress update ditambahkan dari Autoparse.', 'success'); }
    function startProgressEdit(item: Incident['progress'][number]) { setEditingProgressId(item.id); setProgressEditDraft({ date: item.date, time: item.time, text: item.text, pic: item.pic || '', milestone: item.milestone || '' }); }
    function cancelProgressEdit() { setEditingProgressId(''); setProgressEditDraft({ date: '', time: '', text: '', pic: '', milestone: '' }); }
    function saveProgressEdit() { if (!draft || !editingProgressId) return; const current = draft.progress.find(item => item.id === editingProgressId); if (!current) { cancelProgressEdit(); notify('Update progress tidak ditemukan.', 'error'); return; } const corrected = { ...progressEditDraft, text: progressEditDraft.text.trim(), pic: progressEditDraft.pic.trim() }; if (!corrected.date || !corrected.time) { notify('Tanggal dan waktu progress wajib diisi.', 'error'); return; } if (!corrected.text) { notify('Deskripsi progress tidak boleh kosong.', 'error'); return; } const changed = current.date !== corrected.date || current.time !== corrected.time || current.text !== corrected.text || current.pic !== corrected.pic || current.milestone !== corrected.milestone; if (!changed) { cancelProgressEdit(); notify('Tidak ada perubahan pada progress.', 'info'); return; } const ticket = corrected.text.match(/MDU-\d{8}-\d+/i); updateDraft({ progress: draft.progress.map(item => item.id === editingProgressId ? { ...item, ...corrected, ...(corrected.date !== current.date ? { autoparseBatchId: '', autoparseDayOffset: undefined } : {}) } : item), mduTicket: ticket && !draft.mduTicket ? ticket[0] : draft.mduTicket }); cancelProgressEdit(); notify('Koreksi progress siap disimpan dan dicatat di audit trail.', 'success'); }
    function deleteProgressUpdate(id: string) { if (!draft) return; const target = draft.progress.find(item => item.id === id); if (!target) return; if (!window.confirm(`Hapus progress update ${target.date} ${target.time}?\n\nUpdate ini akan dihapus dari timeline.`)) return; updateDraft({ progress: draft.progress.filter(item => item.id !== id) }); if (editingProgressId === id) cancelProgressEdit(); notify('Progress update dihapus dari timeline.', 'success'); }
    function clearAllProgressUpdates() { if (!draft || !draft.progress.length) return; const count = draft.progress.length; if (!window.confirm(`Hapus seluruh ${count} progress update dari timeline?\n\nData incident lainnya tidak akan dihapus.`)) return; updateDraft({ progress: [] }); cancelProgressEdit(); notify(`${count} progress update dihapus dari timeline.`, 'success'); }
    function addCutPoint() { if (!draft) return; if ((draft.cutPoints || []).length >= 20) { notify('Maksimal 20 CP per incident.', 'error'); return; } const nextIndex = (draft.cutPoints || []).length + 1; updateDraft({ cutPoints: [...(draft.cutPoints || []), { id: newId(), label: `CP ${nextIndex}`, coordinate: null }] }); }
    function updateCutPointLabel(id: string, label: string) { if (!draft) return; updateDraft({ cutPoints: (draft.cutPoints || []).map(item => item.id === id ? { ...item, label } : item) }); }
    function removeCutPoint(id: string) { if (!draft) return; const target = (draft.cutPoints || []).find(item => item.id === id); if (target?.coordinate && !window.confirm(`Hapus ${target.label || 'CP'} beserta koordinatnya?`)) return; updateDraft({ cutPoints: (draft.cutPoints || []).filter(item => item.id !== id) }); }
    function clearCutPointCoordinate(id: string) { if (!draft) return; updateDraft({ cutPoints: (draft.cutPoints || []).map(item => item.id === id ? { ...item, coordinate: null } : item) }); }
    function updateCutPointCoordinate(id: string, axis: 'latitude' | 'longitude', value: string) { if (!draft) return; const parsed = Number(value); if (!Number.isFinite(parsed)) return; updateDraft({ cutPoints: (draft.cutPoints || []).map(item => item.id === id && item.coordinate ? { ...item, coordinate: { ...item.coordinate, [axis]: parsed, normalized: axis === 'latitude' ? parsed.toFixed(6) + ', ' + item.coordinate.longitude.toFixed(6) : item.coordinate.latitude.toFixed(6) + ', ' + parsed.toFixed(6), verified: false, verifiedAt: 0, verifiedBy: '' } } : item) }); }
    function verifyCutPointCoordinate(id: string) { if (!draft) return; const target = (draft.cutPoints || []).find(item => item.id === id)?.coordinate; if (!target || !Number.isFinite(target.latitude) || !Number.isFinite(target.longitude) || Math.abs(target.latitude) > 90 || Math.abs(target.longitude) > 180) { notify('Latitude atau longitude tidak valid.', 'error'); return; } updateDraft({ cutPoints: (draft.cutPoints || []).map(item => item.id === id && item.coordinate ? { ...item, coordinate: { ...item.coordinate, normalized: item.coordinate.latitude.toFixed(6) + ', ' + item.coordinate.longitude.toFixed(6), verified: true, verifiedAt: Date.now(), verifiedBy: data?.profile.userId || '' } } : item) }); notify('Koordinat diverifikasi dan siap tampil di peta.', 'success'); }
    async function extractCutPointCoordinateFile(cutPointId: string, file: File) { if (!draft || !isImageFile(file)) { notify('Gunakan file gambar untuk GeoTag extractor.', 'error'); return; } if (!geminiStatus.configured) { notify('GeoTag AI extractor dinonaktifkan pada Firebase Spark-only. Masukkan latitude dan longitude secara manual pada form Cut Point.', 'info'); return; } const sourceName = file.name || `clipboard-image-${Date.now()}.png`; setGeotagBusy(true); setGeotagDiagnostics([]); try { const views = await prepareGeotagViews(file); const collected: string[] = []; setGeotagProgress({ done: 0, total: views.length }); for (let index = 0; index < views.length; index += 1) { const view = views[index]; setGeotagProgress({ done: index, total: views.length }); try { const response = await api.post('/api/geotag/extract', { sourceName, images: [{ data: view.data, mimeType: view.mimeType }] }); const coordinate = response.data.coordinate as Incident['cutPoints'][number]['coordinate'] | undefined; const diagnostics = Array.isArray(response.data.diagnostics) ? response.data.diagnostics as Array<{ view?: number; mode?: string; text?: string; coordinate?: string; confidence?: string }> : []; collected.push(...diagnostics.map(item => `${sourceName} · ${view.label} · ${item.mode || 'Gemini'} · ${item.coordinate || 'no coordinate'}${item.confidence ? ` · ${item.confidence}` : ''} · raw: ${(item.text || '').replace(/\s+/g, ' ').trim().slice(0, 180)}`)); setGeotagDiagnostics(collected.slice(-30)); if (!coordinate) continue; setDraft(current => current ? { ...current, cutPoints: (current.cutPoints || []).map(item => item.id === cutPointId ? { ...item, coordinate } : item) } : current); setGeotagProgress({ done: index + 1, total: views.length }); notify(index === 0 ? 'Koordinat CP berhasil diekstrak dan siap dijadikan marker.' : `Koordinat ditemukan lewat ${view.label}.`, 'success'); return; } catch (err) { const message = errorMessage(err); if (message === 'gemini_not_configured' || message === 'gemini_api_key_invalid') { setGeminiStatus(current => ({ ...current, configured: false })); notify(message === 'gemini_api_key_invalid' ? 'Gemini API key ditolak. Perbarui key di secure vault.' : 'Gemini API key belum dikonfigurasi.', 'error'); if (isAdmin) setView('settings'); return; } const payload = (err as { response?: { data?: { diagnostics?: Array<{ view?: number; mode?: string; text?: string; coordinate?: string; confidence?: string }> } } }).response?.data; const diagnostics = Array.isArray(payload?.diagnostics) ? payload.diagnostics : []; collected.push(...diagnostics.map(item => `${sourceName} · ${view.label} · ${item.mode || 'Gemini'} · ${item.coordinate || 'no coordinate'}${item.confidence ? ` · ${item.confidence}` : ''} · raw: ${(item.text || '').replace(/\s+/g, ' ').trim().slice(0, 180)}`)); setGeotagDiagnostics(collected.slice(-30)); if (!['coordinate_not_found', 'coordinate_not_parsable', 'gemini_response_invalid'].includes(message)) throw err; } } notify('Koordinat tidak ditemukan setelah semua sudut, edge strips, center band, enhanced crops, dan full image diperiksa Gemini.', 'error'); } catch (err) { notify(errorMessage(err), 'error'); } finally { setGeotagProgress(current => ({ ...current, done: current.total })); setGeotagBusy(false); setGeotagDropTarget(''); } }
    async function extractCutPointCoordinate(cutPointId: string, event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ''; if (file) await extractCutPointCoordinateFile(cutPointId, file); }
    function handleCutPointDragOver(cutPointId: string, event: DragEvent<HTMLElement>) { event.preventDefault(); event.dataTransfer.dropEffect = geotagBusy ? 'none' : 'copy'; if (!geotagBusy) setGeotagDropTarget(cutPointId); }
    function handleCutPointDragLeave(cutPointId: string, event: DragEvent<HTMLElement>) { const nextTarget = event.relatedTarget; if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return; setGeotagDropTarget(current => current === cutPointId ? '' : current); }
    async function handleCutPointDrop(cutPointId: string, event: DragEvent<HTMLElement>) { event.preventDefault(); event.stopPropagation(); setGeotagDropTarget(''); if (geotagBusy) return; const file = firstImageFile(event.dataTransfer.files, event.dataTransfer.items); if (!file) { notify('Drag belum membawa file gambar. Dari WhatsApp Web, coba Copy image lalu Ctrl+V pada kartu CP.', 'info'); return; } await extractCutPointCoordinateFile(cutPointId, file); }
    async function handleCutPointPaste(cutPointId: string, event: ClipboardEvent<HTMLElement>) { const file = firstImageFile(event.clipboardData.files, event.clipboardData.items); if (!file) return; event.preventDefault(); if (geotagBusy) return; setGeotagDropTarget(cutPointId); await extractCutPointCoordinateFile(cutPointId, file); }
    async function loadVersions() { if (!draft) return; try { const [versionResponse, auditResponse] = await Promise.all([api.get(`/api/incidents/${draft.id}/versions`), api.get(`/api/incidents/${draft.id}/audit`)]); setVersions(versionResponse.data.versions as IncidentVersion[]); setAuditTrail((auditResponse.data.audit || []) as AuditEntry[]); setHistoryOpen(true); } catch (err) { notify(errorMessage(err), 'error'); } }
    async function createVersion() { if (!draft) return; try { const needsSave = JSON.stringify(draft) !== lastSavedRef.current; if (needsSave) { const saved = await persistDraft(draft); if (!saved) { notify('Snapshot dibatalkan karena perubahan incident belum berhasil disimpan. Tunggu autosave selesai lalu coba lagi.', 'error'); return; } } const persisted = JSON.parse(lastSavedRef.current) as Incident; if (persisted.id !== draft.id || !persisted.revision) { notify('Snapshot dibatalkan karena revision tersimpan tidak dapat diverifikasi.', 'error'); return; } await api.post(`/api/incidents/${draft.id}/versions`, { label: 'Manual snapshot', revision: persisted.revision }); await loadVersions(); notify('Version snapshot dan audit entry tersimpan secara atomik.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } }
    async function restoreVersion(version: IncidentVersion) { if (!draft || !window.confirm(`Pulihkan field incident dari version ${new Date(version.createdAt).toLocaleString('id-ID')}? Progress timeline yang sudah tercatat tetap dipertahankan sebagai riwayat immutable.`)) return; try { const response = await api.post(`/api/incidents/${draft.id}/restore/${version.id}`); const restored = response.data.incident as Incident; lastSavedRef.current = JSON.stringify(restored); setDraft(clone(restored)); upsertIncident(restored); setHistoryOpen(false); notify('Version berhasil dipulihkan. Riwayat progress tetap dipertahankan.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } }
    async function exportWorkspaceBackupFile() {
        if (!data || !isAdmin || workspaceExportBusy) return;
        setWorkspaceExportBusy(true);
        try {
            const response = await api.get<{ bundle: Record<string, unknown> }>('/api/workspace/export');
            const bundle = response.data.bundle;
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `noc-workspace-backup-${data.profile.workspaceId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            notify('Workspace backup berhasil dibuat dan diunduh.', 'success');
        } catch (err) {
            notify(errorMessage(err), 'error');
        } finally {
            setWorkspaceExportBusy(false);
        }
    }
    async function previewWorkspaceBackupImport(file?: File) {
        if (!data || !isAdmin || !file || workspaceImportBusy) return;
        setWorkspaceImportBusy(true);
        setWorkspaceImportFileName(file.name);
        setWorkspaceImportReport(null);
        setWorkspaceImportBundle(null);
        setWorkspaceRestoreSelection({ settings: false, routeMaster: false });
        setWorkspaceRestoreResult(null);
        try {
            if (file.size > 100 * 1024 * 1024) throw new Error('File backup melebihi batas 100 MiB.');
            const parsed: unknown = JSON.parse(await file.text());
            const report = analyzeWorkspaceImport(parsed, {
                workspaceId: data.profile.workspaceId,
                existingMemberIds: data.members.map(member => member.id),
                existingIncidentIds: data.incidents.map(incident => incident.id),
            });
            setWorkspaceImportBundle(parsed);
            setWorkspaceImportReport(report);
            notify(report.valid ? 'Dry-run selesai. Backup lolos pemeriksaan awal.' : 'Dry-run selesai. Ditemukan masalah yang harus diperbaiki.', report.valid ? 'success' : 'error');
        } catch (err) {
            notify(err instanceof Error ? err.message : 'File backup tidak dapat dibaca.', 'error');
        } finally {
            setWorkspaceImportBusy(false);
        }
    }
    async function executeWorkspaceBackupRestore() {
        if (!data || !isAdmin || !workspaceImportBundle || !workspaceImportReport?.valid
            || workspaceRestoreBusy || !workspaceRestorePlan?.executable) return;
        setWorkspaceRestoreBusy(true);
        setWorkspaceRestoreResult(null);
        setWorkspaceRestoreProgress({ stage: 'validating', completed: 0, total: 1, message: 'Memvalidasi pilihan restore.' });
        let operationId = '';
        try {
            const currentSettingsResponse = workspaceRestoreSelection.settings
                ? await api.get('/api/settings')
                : null;
            const currentSettings = currentSettingsResponse?.data?.settings || data.settings;
            const operation = await api.post('/api/workspace-restore/operations', {
                kind: 'selective-restore',
                sourceFileName: workspaceImportFileName,
                selectedSections: [
                    ...(workspaceRestoreSelection.settings ? ['settings'] : []),
                    ...(workspaceRestoreSelection.routeMaster ? ['routeMaster'] : []),
                ],
                message: 'Selective workspace restore dimulai.',
            });
            operationId = String(operation.data.id || '');
            if (!operationId) throw new Error('Audit record restore tidak berhasil dibuat. Tidak ada data yang diubah.');

            const result = await executeSelectiveWorkspaceRestore({
                bundle: workspaceImportBundle,
                preflight: workspaceImportReport,
                selection: workspaceRestoreSelection,
                role: data.profile.role,
                confirmed: true,
                currentSettings,
                sourceFileName: workspaceImportFileName,
            }, {
                saveSettings: async (settings, expectedUpdatedAt) => {
                    const response = await api.put('/api/settings', {
                        ...settings,
                        _expectedUpdatedAt: expectedUpdatedAt,
                    });
                    return { updatedAt: Number(response.data.settings?.updatedAt) || 0 };
                },
                startRouteMasterImport: async () => {
                    const response = await api.post('/api/route-master/import/start');
                    return String(response.data.batchId || '');
                },
                addRouteMasterChunk: async (batchId, chunkIndex, items) => {
                    await api.post('/api/route-master/import/chunk', { batchId, chunkIndex, items });
                },
                verifyStagedRouteMaster: async (batchId, expectedCount, expectedFingerprint) => {
                    const response = await api.post('/api/route-master/import/verify', {
                        batchId, expectedCount, expectedFingerprint,
                    });
                    return { verifiedCount: Number(response.data.verifiedCount) || 0 };
                },
                commitRouteMaster: async (batchId, metadata) => {
                    await api.post('/api/route-master/import/commit', { batchId, ...metadata });
                },
                readActiveRouteMaster: async () => {
                    const response = await api.get('/api/route-master');
                    return {
                        items: Array.isArray(response.data.items) ? response.data.items : [],
                        meta: response.data.meta || null,
                    };
                },
                onProgress: (progress) => setWorkspaceRestoreProgress(progress),
            });
            setWorkspaceRestoreResult({ ...result, operationId });
            try {
                await api.put(`/api/workspace-restore/operations/${encodeURIComponent(operationId)}`, {
                    status: result.status,
                    stage: result.status,
                    message: result.status === 'completed'
                        ? 'Selective restore selesai dan diverifikasi.'
                        : result.status === 'needs-review'
                            ? 'Status commit belum dapat dipastikan dan memerlukan pemeriksaan Admin.'
                            : result.status === 'partial'
                                ? 'Restore berakhir dengan keadaan parsial.'
                                : 'Selective restore gagal.',
                    errors: result.errors,
                    warnings: result.warnings,
                    stagedBatchId: result.stagedBatchId,
                    settingsRolledBack: result.settingsRolledBack,
                });
            } catch {
                notify('Restore selesai diproses, tetapi audit record gagal diperbarui. Periksa riwayat recovery.', 'error');
            }
            if (result.status === 'completed') {
                notify('Selective restore selesai. Data yang dipilih sudah diverifikasi.', 'success');
                setWorkspaceRestoreConfirmOpen(false);
            } else if (result.status === 'needs-review') {
                notify('Status commit belum dapat dipastikan. Periksa Route Master aktif sebelum mencoba lagi.', 'error');
            } else if (result.status === 'partial') {
                notify('Restore mengalami kegagalan parsial. Perlu pemeriksaan Admin.', 'error');
            } else {
                notify(result.settingsRolledBack
                    ? 'Restore gagal. Workspace Settings sebelumnya berhasil dikembalikan.'
                    : 'Restore gagal. Batch aktif tidak diganti.', 'error');
            }
            try { await loadWorkspace(); } catch { /* Keep the execution report visible when refresh is unavailable. */ }
            try { await loadWorkspaceRestoreRecovery(); } catch { /* Keep the execution report visible. */ }
        } catch (err) {
            if (operationId) {
                try {
                    await api.put(`/api/workspace-restore/operations/${encodeURIComponent(operationId)}`, {
                        status: 'failed',
                        stage: 'failed',
                        message: 'Restore tidak dapat diselesaikan.',
                        errors: [errorMessage(err)],
                    });
                } catch { /* A still-running audit row will be marked as needs-review by the recovery view after one hour. */ }
            }
            notify(errorMessage(err), 'error');
        } finally {
            setWorkspaceRestoreBusy(false);
        }
    }

    async function reactivatePreviousRouteMaster(batch: any) {
        if (!data || !isAdmin || !workspaceRestoreRecovery || workspaceRestoreRecoveryBusy || workspaceRestoreRecoveryAction) return;
        if (!canReactivateRouteMasterBatch(batch, workspaceRestoreRecovery.recovery?.activeBatchId || null)) return;
        const label = batch.sourceFileName || batch.id;
        if (!window.confirm(`Aktifkan kembali Route Master "${label}"? Batch aktif saat ini tetap disimpan untuk recovery berikutnya.`)) return;
        setWorkspaceRestoreRecoveryAction(batch.id);
        let operationId = '';
        try {
            const operation = await api.post('/api/workspace-restore/operations', {
                kind: 'reactivate-route-master',
                targetBatchId: batch.id,
                message: 'Reaktivasi batch Route Master dimulai.',
            });
            operationId = String(operation.data.id || '');
            if (!operationId) throw new Error('Audit record recovery gagal dibuat.');
            const response = await api.post('/api/route-master/recovery/reactivate', {
                batchId: batch.id,
                expectedCurrentBatchId: workspaceRestoreRecovery.recovery.activeBatchId || null,
            });
            await api.put(`/api/workspace-restore/operations/${encodeURIComponent(operationId)}`, {
                status: 'completed',
                stage: 'completed',
                message: 'Batch Route Master lama berhasil diaktifkan kembali.',
                activeBatchId: response.data.activeBatchId,
            });
            await loadRouteMaster();
            await loadWorkspaceRestoreRecovery();
            notify('Route Master berhasil dikembalikan ke batch sebelumnya.', 'success');
        } catch (err) {
            if (operationId) {
                try {
                    await api.put(`/api/workspace-restore/operations/${encodeURIComponent(operationId)}`, {
                        status: 'failed',
                        stage: 'failed',
                        message: 'Reaktivasi Route Master gagal.',
                        errors: [errorMessage(err)],
                    });
                } catch { /* Keep the original action error visible. */ }
            }
            notify(errorMessage(err), 'error');
        } finally {
            setWorkspaceRestoreRecoveryAction('');
        }
    }

    async function cleanupStaleRouteMaster(batch: any) {
        if (!data || !isAdmin || !workspaceRestoreRecovery || workspaceRestoreRecoveryAction) return;
        if (!batch.stale || batch.status !== 'staging') return;
        if (!window.confirm(`Hapus batch staging yang tidak aktif selama lebih dari 24 jam? ${batch.id}. Hanya batch staging ini dan chunk-nya yang akan dihapus.`)) return;
        setWorkspaceRestoreRecoveryAction(batch.id);
        let operationId = '';
        try {
            const operation = await api.post('/api/workspace-restore/operations', {
                kind: 'cleanup-stale-route-master',
                targetBatchId: batch.id,
                message: 'Cleanup stale Route Master staging dimulai.',
            });
            operationId = String(operation.data.id || '');
            if (!operationId) throw new Error('Audit record cleanup gagal dibuat.');
            const response = await api.post('/api/route-master/recovery/cleanup-stale', {
                batchId: batch.id,
                expectedLastActivityAt: batch.lastActivityAt,
            });
            await api.put(`/api/workspace-restore/operations/${encodeURIComponent(operationId)}`, {
                status: 'completed',
                stage: 'completed',
                message: 'Batch staging terbengkalai berhasil dibersihkan.',
                deletedChunks: Number(response.data.deletedChunks) || 0,
            });
            await loadWorkspaceRestoreRecovery();
            notify(`Staging batch dibersihkan. ${Number(response.data.deletedChunks) || 0} chunk dihapus.`, 'success');
        } catch (err) {
            if (operationId) {
                try {
                    await api.put(`/api/workspace-restore/operations/${encodeURIComponent(operationId)}`, {
                        status: 'failed',
                        stage: 'failed',
                        message: 'Cleanup staging Route Master gagal.',
                        errors: [errorMessage(err)],
                    });
                } catch { /* Keep the original action error visible. */ }
            }
            notify(errorMessage(err), 'error');
        } finally {
            setWorkspaceRestoreRecoveryAction('');
        }
    }
    async function saveSettings() { try { const response = await api.put('/api/settings', { ...settingsDraft, _expectedUpdatedAt: Number(data?.settings?.updatedAt) || 0 }); const saved = response.data.settings as SettingsData; setData(current => current ? { ...current, settings: saved } : current); setSettingsDraft(clone(saved)); notify('Master data diperbarui.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } }
    function selectMasterSheet(sheetName: string) { if (!masterBuffer) return; try { const workbook = parseWorkbookSheet(masterBuffer, sheetName); const detected = detectSheetHeaders(workbook, sheetName); setMasterWorkbook(workbook); setMasterSheetName(sheetName); setMasterRowCount(worksheetRowCount(workbook, sheetName)); setSystemKeyColumn(detected.systemKeyColumn || 'H'); setRouteSegmentColumn(detected.routeSegmentColumn || 'A'); } catch (err) { notify(`Worksheet ${sheetName} gagal dibaca: ${errorMessage(err)}`, 'error'); } }
    async function readMasterExcel(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setMasterImportBusy(true); setMasterImportProgress(0); try { const buffer = await file.arrayBuffer(); let directory: WorkBook; try { directory = read(buffer, { type: 'array', bookSheets: true, bookDeps: false, cellFormula: false, cellHTML: false, WTF: false }); } catch (err) { throw new Error(`Tahap buka workbook gagal: ${errorMessage(err)}`); } if (!directory.SheetNames.length) throw new Error('Workbook tidak memiliki worksheet.'); const sheetName = chooseInitialMasterSheet(directory.SheetNames); let workbook: WorkBook; try { workbook = parseWorkbookSheet(buffer, sheetName); } catch (err) { throw new Error(`Tahap baca worksheet ${sheetName} gagal: ${errorMessage(err)}`); } const detected = detectSheetHeaders(workbook, sheetName); const systemColumn = detected.systemKeyColumn || 'H'; const routeColumn = detected.routeSegmentColumn || 'A'; const previewPairs = extractRouteMasterPairs(workbook, sheetName, systemColumn, routeColumn); if (!previewPairs.length && /^foa active$/i.test(sheetName.trim())) throw new Error(`Worksheet ${sheetName} terbaca, tetapi pasangan ${systemColumn} ↔ ${routeColumn} kosong. Untuk file FOA Mandau gunakan System Key H dan Segment Route A.`); setMasterBuffer(buffer); setMasterSheetNames(directory.SheetNames); setMasterWorkbook(workbook); setMasterFileName(file.name); setMasterSheetName(sheetName); setSystemKeyColumn(systemColumn); setRouteSegmentColumn(routeColumn); setMasterRowCount(worksheetRowCount(workbook, sheetName)); setMasterImportOpen(true); } catch (err) { notify(errorMessage(err), 'error'); } finally { setMasterImportBusy(false); } }
    async function importRouteMaster() { if (!masterImportPairs.length) { notify('Tidak ada pasangan System Key dan Segment Route yang terbaca.', 'error'); return; } if (masterImportPairs.length > 20000) { notify('Master data dibatasi maksimal 20.000 mapping per workspace.', 'error'); return; } setMasterImportBusy(true); setMasterImportProgress(2); try { const start = await api.post('/api/route-master/import/start'); const batchId = String(start.data.batchId || ''); const chunkSize = 400; if (!batchId) throw new Error('Gagal memulai import master data.'); for (let offset = 0; offset < masterImportPairs.length; offset += chunkSize) { const items = masterImportPairs.slice(offset, offset + chunkSize); await api.post('/api/route-master/import/chunk', { batchId, chunkIndex: Math.floor(offset / chunkSize), items }); setMasterImportProgress(Math.min(92, Math.round(((offset + items.length) / masterImportPairs.length) * 90))); } await api.post('/api/route-master/import/commit', { batchId, totalCount: masterImportPairs.length, fileName: masterFileName, sheetName: masterSheetName, systemKeyColumn: systemKeyColumn.toUpperCase(), routeSegmentColumn: routeSegmentColumn.toUpperCase() }); setMasterImportProgress(100); await loadRouteMaster(); setMasterImportOpen(false); notify(`${masterImportPairs.length.toLocaleString('id-ID')} mapping berhasil disimpan ke database online.`, 'success'); } catch (err) { notify(errorMessage(err), 'error'); } finally { setMasterImportBusy(false); } }
    async function createInvite() { if (!/^\S+@\S+\.\S+$/.test(inviteEmail.trim())) { notify('Masukkan email penerima yang valid.', 'error'); return; } if (inviteRole === 'admin') { notify('Role Admin hanya dapat diberikan setelah anggota bergabung.', 'error'); return; } try { const response = await api.post('/api/invites', { email: inviteEmail.trim(), role: inviteRole }); const url = invitesClient.buildJoinUrl(response.data.code, { path: '/' }); setInviteUrl(url); notify('Link undangan aktif selama 7 hari.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } }
    async function enableNotifications() { try { await notifications.subscribe(); localStorage.setItem('noc-notifications', 'enabled'); setNotificationReady(true); notify('Izin notifikasi browser aktif saat aplikasi terbuka.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } }
    async function updateMemberRole(memberId: string, role: Role) { try { await api.put(`/api/members/${memberId}`, { role }); await loadWorkspace(); notify('Role anggota diperbarui.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } }
    async function removeMember(memberId: string, name: string) { if (!window.confirm(`Keluarkan ${name} dari workspace?`)) return; try { await api.delete(`/api/members/${memberId}`); await loadWorkspace(); notify('Anggota dikeluarkan dari workspace.', 'success'); } catch (err) { notify(errorMessage(err), 'error'); } }
    const allIncidents = useMemo(() => [...(data?.incidents || [])].sort((a, b) => b.updatedAt - a.updatedAt), [data?.incidents]);
    const sortedIncidents = useMemo(() => allIncidents.filter(item => !item.deletedAt), [allIncidents]);
    const trashIncidents = useMemo(() => allIncidents.filter(item => Boolean(item.deletedAt)), [allIncidents]);
    const filteredIncidents = useMemo(() => sortedIncidents.filter(incident => { const haystack = `${incidentTitle(incident)} ${incident.picArea} ${incident.picName} ${incident.rootCause}`.toLowerCase(); return haystack.includes(search.toLowerCase()) && (statusFilter === 'All' || incident.status === statusFilter) && (severityFilter === 'All' || incident.severity === severityFilter); }), [sortedIncidents, search, statusFilter, severityFilter]);
    const activeIncidents = useMemo(() => sortedIncidents.filter(item => item.status === 'Open' || item.status === 'Monitoring'), [sortedIncidents]);
    useEffect(() => {
        const workspaceId = data?.profile.workspaceId;
        const userId = data?.profile.userId;
        if (!data || !workspaceId || !userId) return;

        const scope = `${workspaceId}:${userId}`;
        const storageKey = `noc-sla-notice-keys:${scope}`;
        const initialKey = `noc-sla-initialized:${scope}`;
        const seen = new Set(slaNoticeMemoryRef.current);
        let firstPass = !slaNoticeInitialRef.current.has(scope);

        try {
            const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
            if (Array.isArray(stored)) stored.forEach((key) => { if (typeof key === 'string') seen.add(key); });
            firstPass = localStorage.getItem(initialKey) !== '1';
        } catch { /* Memory fallback keeps deduplication for this app session. */ }

        const notices = activeIncidents
            .map((incident) => getSlaNotice(incident, data.settings || defaultSettings, clock))
            .filter((notice): notice is NonNullable<typeof notice> => Boolean(notice))
            .filter((notice) => !seen.has(notice.fingerprint));

        if (!notices.length) {
            slaNoticeInitialRef.current.add(scope);
            try { if (firstPass) localStorage.setItem(initialKey, '1'); } catch { /* Storage may be disabled. */ }
            return;
        }

        const browserNotificationAllowed = 'Notification' in window
            && Notification.permission === 'granted'
            && document.hidden;

        // Do not mark notices as delivered while hidden if the browser cannot display them.
        // The visibility-change clock refresh will surface them as in-app toasts on return.
        if (document.hidden && !browserNotificationAllowed) return;

        const counts = notices.reduce((total, notice) => {
            total[notice.stage] = (total[notice.stage] || 0) + 1;
            return total;
        }, {} as Record<string, number>);
        const detail = [
            counts.due_soon ? `${counts.due_soon} hampir melewati SLA` : '',
            counts.overdue ? `${counts.overdue} overdue` : '',
            counts.escalated ? `${counts.escalated} eskalasi L2` : '',
            counts.critical ? `${counts.critical} eskalasi L3` : '',
        ].filter(Boolean).join(' · ');

        if (browserNotificationAllowed) {
            const title = notices.length === 1 ? notices[0].title : `NOC Desk · ${notices.length} SLA notice`;
            const body = notices.length === 1 ? notices[0].body : detail;
            try {
                const browserNotice = new Notification(title, {
                    body,
                    tag: `noc-sla-${workspaceId}`,
                    renotify: false,
                });
                browserNotice.onclick = () => window.focus();
            } catch {
                // Retry as an in-app toast when the user returns to this tab.
                return;
            }
        } else if (firstPass || notices.length > 1) {
            sonnerToast.message(`SLA Watch · ${notices.length} incident perlu perhatian`, { description: detail });
        } else {
            sonnerToast.message(notices[0].title, { description: notices[0].body });
        }

        notices.forEach((notice) => seen.add(notice.fingerprint));
        slaNoticeMemoryRef.current = seen;
        slaNoticeInitialRef.current.add(scope);
        try {
            localStorage.setItem(storageKey, JSON.stringify([...seen].slice(-300)));
            localStorage.setItem(initialKey, '1');
        } catch { /* The in-memory set still prevents duplicate notices in this session. */ }
    }, [activeIncidents, data?.profile.workspaceId, data?.profile.userId, data?.settings, clock, notificationReady]);
    const runningItems = useMemo<RunningItem[]>(() => { const activeById = new Map(activeIncidents.map(item => [item.id, item])); const severityRank: Record<string, number> = { Critical: 0, Major: 1, Minor: 2 }; return runningIds.map(id => activeById.get(id)).filter((item): item is Incident => Boolean(item)).map(incident => { const sla = incidentSlaState(incident, data?.settings || defaultSettings, clock); return { incident, overdue: sla.overdue, ageMinutes: sla.ageMinutes, limitMinutes: sla.limitMinutes, lastUpdateAt: sla.lastUpdateAt }; }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (severityRank[a.incident.severity] ?? 9) - (severityRank[b.incident.severity] ?? 9) || b.ageMinutes - a.ageMinutes); }, [activeIncidents, runningIds, data?.settings, clock]);
    const role = data?.profile.role || 'operator'; const isAdmin = role === 'admin'; const canReview = role !== 'operator';
    useEffect(() => { const handleRunningShortcut = (event: KeyboardEvent) => { const target = event.target as HTMLElement | null; const typing = Boolean(target?.closest('input,textarea,select,[contenteditable=true]')); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (event.shiftKey) setRunningSwitcherOpen(true); else setCommandOpen(true); return; } if (!typing && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && runningItems.length) { event.preventDefault(); const currentIndex = Math.max(0, runningItems.findIndex(item => item.incident.id === draft?.id)); const delta = event.key === 'ArrowDown' ? 1 : -1; const next = runningItems[(currentIndex + delta + runningItems.length) % runningItems.length]; if (next) void switchIncident(next.incident); } }; window.addEventListener('keydown', handleRunningShortcut); return () => window.removeEventListener('keydown', handleRunningShortcut); }, [runningItems, draft]);
    if (loading && !data) return <div className='splash'><div className='brand-mark'><Radio /></div><div className='loader'/><p>Menyiapkan Incident Desk…</p></div>;
    if (!user) return <div className='auth-shell'><section className='auth-story'><div className='brand-lockup'><span className='brand-mark'><Radio /></span><div><b>NOC Incident Desk</b><small>Operational reporting, without the noise.</small></div></div><div className='auth-copy'><Badge tone='cyan'><ShieldCheck size={13}/> Secure workspace</Badge><h1>Satu ruang kerja untuk setiap gangguan.</h1><p>Susun bagan, koordinasikan progress, dan kirim update yang konsisten—bahkan saat situasi sedang sibuk.</p></div><div className='auth-preview'><div className='auth-preview-top'><span>Live incident</span><Badge tone='danger'>Critical</Badge></div><strong>DOWN · KARAWANG CITY ↔ KIIC</strong><div className='mini-timeline'><i /><span><b>00:05</b> OTDR FO CUT at KM 5</span><i /><span><b>01:10</b> Physical CP ditemukan</span><i className='active'/><span><b>06:47</b> Link normal · TT closed</span></div></div></section><section className='auth-panel'><div className='auth-card'><span className='mobile-brand'><Radio /> NOC Incident Desk</span><h2>{inviteCode ? 'Undangan tim diterima' : 'Selamat datang'}</h2><p>{inviteCode ? 'Masuk untuk bergabung ke workspace NOC yang mengundang lo.' : 'Masuk untuk membuka workspace incident lo.'}</p>{inviteInfo?.error && <div className='inline-error'>{inviteInfo.error}</div>}{authError && <div className='inline-error'>{authError}</div>}<div className='firebase-auth-form'>
{authMode === 'register' && <label>Nama lengkap<input type='text' autoComplete='name' value={authName} onChange={event => setAuthName(event.target.value)} placeholder='Nama pengguna' /></label>}
<label>Email kerja<input type='email' autoComplete='email' value={authEmail} onChange={event => setAuthEmail(event.target.value)} placeholder='nama@perusahaan.com' /></label>
<label>Password<input type='password' autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={authPassword} onChange={event => setAuthPassword(event.target.value)} placeholder={authMode === 'register' ? 'Minimal 12 karakter' : 'Masukkan password'} onKeyDown={event => { if (event.key === 'Enter' && !authBusy) void (authMode === 'register' ? registerWithPassword() : signInWithPassword()); }} /></label>
<Button block variant='primary' icon={authBusy ? <LoaderCircle className='spin' size={17}/> : <ShieldCheck size={18}/>} disabled={authBusy || !authEmail.trim() || !authPassword} onClick={() => void (authMode === 'register' ? registerWithPassword() : signInWithPassword())}>{authBusy ? 'Memproses…' : authMode === 'register' ? 'Buat akun dan workspace' : 'Masuk dengan email'}</Button>
<div className='firebase-auth-divider'><span>atau</span></div>
<Button block variant='ghost' icon={<ShieldCheck size={18}/>} disabled={authBusy} onClick={() => void signIn()}>Lanjutkan dengan Google</Button>
{authMode === 'signin' && <button type='button' className='firebase-auth-toggle' disabled={authBusy || !authEmail.trim()} onClick={() => void requestPasswordReset()}>Lupa password?</button>}
<button type='button' className='firebase-auth-toggle' onClick={() => { setAuthMode(mode => mode === 'signin' ? 'register' : 'signin'); setAuthError(''); }}>{authMode === 'register' ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Buat akun'}</button>
</div><small className='legal'>Dengan melanjutkan, lo menyetujui <a href='/resources/terms-and-conditions.html' target='_blank' rel='noreferrer'>ketentuan</a> dan <a href='/resources/privacy-policy.html' target='_blank' rel='noreferrer'>kebijakan privasi</a>.</small></div></section></div>;
    if (inviteCode) return <div className='join-shell'><div className='join-card'><span className='brand-mark large'><UserPlus /></span><Badge tone={inviteInfo?.error || joinError ? 'danger' : 'cyan'}>{inviteInfo?.status || 'Invitation'}</Badge><h1>Bergabung ke workspace NOC?</h1><p>Akun <strong>{user.email || user.name}</strong> akan ditambahkan ke tim. Data workspace pribadi yang sudah ada tidak akan ditimpa.</p>{inviteInfo?.error && <div className='inline-error'>{inviteInfo.error}</div>}{joinError && <div className='inline-error'>{joinError}</div>}<div className='join-actions'><Button variant='ghost' onClick={() => { invitesClient.clearPendingCode(); setInviteCode(null); setJoinError(''); void loadWorkspace(); }} disabled={joinBusy}>Abaikan</Button><Button variant='primary' icon={joinBusy ? <LoaderCircle className='spin' size={17}/> : <UserPlus size={17}/>} onClick={() => void joinWorkspace()} disabled={Boolean(inviteInfo?.error) || joinBusy}>{joinBusy ? 'Menggabungkan…' : 'Gabung workspace'}</Button></div></div></div>;
    if (!data) return <div className='fatal-state'><h2>Workspace belum dapat dibuka</h2><p>{authError}</p><Button variant='primary' onClick={() => void loadWorkspace()}>Coba lagi</Button></div>;
    const navItems: Array<{ id: View; label: string; icon: ReactNode; hidden?: boolean }> = [{ id: 'dashboard', label: 'Ringkasan', icon: <LayoutDashboard size={18}/> }, { id: 'operations', label: 'Operations', icon: <Bell size={18}/> }, { id: 'reliability', label: 'Reliability', icon: <BarChart3 size={18}/> }, { id: 'risk', label: 'Risk Radar', icon: <ScanLine size={18}/> }, { id: 'archive', label: 'Insiden', icon: <Archive size={18}/> }, { id: 'tracker', label: 'Peta Cut Point', icon: <MapIcon size={18}/> }, { id: 'handover', label: 'Shift Handover', icon: <ClipboardCheck size={18}/> }, { id: 'trash', label: 'Trash', icon: <Trash2 size={18}/>, hidden: !isAdmin }, { id: 'settings', label: 'Template', icon: <Settings size={18}/>, hidden: !isAdmin }, { id: 'team', label: 'Tim', icon: <Users size={18}/> }];
    const commandItems: AdaptiveCommand[] = [{ id: 'search-incidents', label: 'Search all incidents', detail: 'Buka Global Incident Search di seluruh database', group: 'Action', keywords: 'search incident tt mdu system key route', shortcut: 'G', run: () => setGlobalSearchOpen(true) }, { id: 'new-incident', label: 'New incident', detail: 'Buat Draft TT baru', group: 'Action', keywords: 'create draft new tt', shortcut: 'N', run: () => void createIncident() }, { id: 'smart-import', label: 'Smart Import', detail: 'Paste title TT atau bagan untuk auto parsing', group: 'Action', keywords: 'import parser title bagan', shortcut: 'I', run: () => setImportOpen(true) }, { id: 'running-workspace', label: 'Running Workspace', detail: `${runningItems.length} TT aktif di workspace`, group: 'Action', keywords: 'running active switch', shortcut: '⇧K', run: () => setRunningSwitcherOpen(true) }, ...navItems.filter(item => !item.hidden).map(item => ({ id: `nav-${item.id}`, label: `Go to ${item.label}`, detail: `Pindah ke ${item.label}`, group: 'Navigate', keywords: `page ${item.label}`, run: () => setView(item.id) })), { id: 'density-comfort', label: 'Density: Comfort', detail: 'Layout lega untuk review', group: 'Workspace', keywords: 'density comfortable', run: () => setDensity('comfortable') }, { id: 'density-compact', label: 'Density: Compact', detail: 'Lebih banyak informasi per layar', group: 'Workspace', keywords: 'density compact', run: () => setDensity('compact') }, { id: 'density-war', label: 'Density: War Room', detail: 'Mode paling padat untuk incident ramai', group: 'Workspace', keywords: 'density war room', run: () => setDensity('war') }, { id: 'toggle-theme', label: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`, detail: 'Ubah appearance workspace', group: 'Workspace', keywords: 'theme light dark', run: () => setTheme(current => current === 'dark' ? 'light' : 'dark') }, { id: 'toggle-sidebar', label: sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar', detail: 'Atur lebar navigation rail desktop', group: 'Workspace', keywords: 'sidebar collapse expand', run: () => setSidebarCollapsed(current => !current) }, ...(draft ? [...((draft.status === 'Open' || draft.status === 'Monitoring') ? [{ id: 'quick-update-current', label: 'Quick Update current TT', detail: draft.incidentId || incidentTitle(draft), group: 'Current TT', keywords: 'progress update current', shortcut: 'U', run: () => setQuickUpdateOpen(true) } satisfies AdaptiveCommand] : []), { id: 'focus-current', label: focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode', detail: 'Hilangkan panel non-esensial saat handle TT', group: 'Current TT', keywords: 'focus editor', run: () => setFocusMode(current => !current) } satisfies AdaptiveCommand, { id: 'copy-current', label: 'Copy current bagan', detail: 'Copy formatted report setelah validation', group: 'Current TT', keywords: 'copy report whatsapp', run: () => void copyReport() } satisfies AdaptiveCommand, { id: 'versions-current', label: 'Open Versions & Audit', detail: 'Snapshot dan audit trail TT saat ini', group: 'Current TT', keywords: 'version history audit', run: () => void loadVersions() } satisfies AdaptiveCommand] : [])];
    const renderDashboard = () => { const critical = activeIncidents.filter(item => item.severity === 'Critical').length; const waiting = activeIncidents.filter(item => incidentSlaState(item, data.settings, clock).overdue).length; const resolvedToday = sortedIncidents.filter(item => item.resolvedAt && new Date(item.resolvedAt).toDateString() === new Date(clock).toDateString()).length; const resolutionSamples = sortedIncidents.map(incidentResolutionMinutes).filter((value): value is number => value !== null); const averageResolution = resolutionSamples.length ? Math.round(resolutionSamples.reduce((sum, value) => sum + value, 0) / resolutionSamples.length) : 0; return <div className='page-content dashboard-page'><header className='page-heading'><div><p className='eyebrow'>Ringkasan operasional</p><h1>Selamat bertugas, {data.profile.name.split(' ')[0]}.</h1><p>Prioritas, SLA, dan progres tim dalam satu pandangan.</p></div><div className='heading-actions'>{!notificationReady && <Button icon={<Bell size={16}/>} onClick={() => void enableNotifications()}>Aktifkan notifikasi</Button>}<Button icon={<Search size={16}/>} onClick={() => setGlobalSearchOpen(true)}>Global search</Button><Button icon={<WandSparkles size={16}/>} onClick={() => setImportOpen(true)}>Impor bagan</Button><Button variant='primary' icon={<Plus size={17}/>} onClick={() => void createIncident()}>Insiden baru</Button></div></header><section className='metric-grid'><article><span className='metric-icon danger'><Radio /></span><div><small>Insiden aktif</small><strong>{activeIncidents.length}</strong><em>{critical} kritis</em></div></article><article><span className='metric-icon warning'><Clock3 /></span><div><small>SLA update terlewat</small><strong>{waiting}</strong><em>Sesuai severity</em></div></article><article><span className='metric-icon success'><CheckCircle2 /></span><div><small>Selesai hari ini</small><strong>{resolvedToday}</strong><em>Berdasarkan resolvedAt</em></div></article><article><span className='metric-icon cyan'><FileText /></span><div><small>Rata-rata pemulihan</small><strong>{averageResolution ? `${averageResolution}m` : '—'}</strong><em>{resolutionSamples.length} sampel</em></div></article></section><AttentionRibbon incidents={activeIncidents} settings={data.settings} now={clock} onOpen={openIncident}/><RunningStrip items={runningItems} onOpen={switchIncident} onOpenSwitcher={() => setRunningSwitcherOpen(true)}/><section className='dashboard-grid'><div className='panel incident-panel'><div className='panel-head'><div><h2>Incident aktif</h2><p>Urut berdasarkan pembaruan terakhir</p></div><button className='text-action' onClick={() => setView('archive')}>Lihat semua <ChevronRight size={15}/></button></div>{activeIncidents.length ? <div className='incident-list'>{activeIncidents.slice(0, 6).map(incident => <button className='incident-row' key={incident.id} onClick={() => openIncident(incident)}><span className={`severity-bar ${incident.severity.toLowerCase()}`}/><div className='incident-main'><div><Badge tone={statusTone(incident.status)}>{incident.status}</Badge><small>{incident.severity} · {incident.condition}</small></div><strong>{incident.identityMode === 'b2b' ? (incident.b2bTitle || 'B2B tanpa judul') : <>{incident.linkA || 'Link A'} <span>↔</span> {incident.linkB || 'Link B'}</>}</strong><p>{incident.identityMode === 'b2b' ? (incident.incidentId || 'B2B free-form identity') : (incident.incidentId || 'Draft belum memiliki Incident ID')}</p></div><div className='incident-meta'><span>{new Date(incident.updatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span><small>{incident.progress.length} updates</small><ChevronRight size={17}/></div></button>)}</div> : <EmptyState icon={<Radio />} title='Belum ada incident aktif' text='Buat incident baru atau import bagan yang sudah ada.' action={<Button variant='primary' icon={<Plus size={16}/>} onClick={() => void createIncident()}>New incident</Button>}/>}</div><aside className='panel activity-panel'><div className='panel-head'><div><h2>Recent activity</h2><p>Update terbaru</p></div></div><div className='activity-list'>{sortedIncidents.slice(0, 5).map(incident => <button key={incident.id} onClick={() => openIncident(incident)}><span className={`activity-dot ${statusTone(incident.status)}`}/><div><strong>{incident.identityMode === 'b2b' ? (incident.b2bTitle || 'B2B draft') : (incident.incidentId || 'New draft')}</strong><p>{incident.progress[incident.progress.length - 1]?.text || 'Incident dibuat'}</p><small>{new Date(incident.updatedAt).toLocaleString('id-ID')}</small></div></button>)}</div></aside></section></div>; };
    const renderArchive = () => <div className='page-content archive-page'><header className='page-heading compact'><div><p className='eyebrow'>Incident registry</p><h1>Semua incident</h1><p>Cari, filter, duplikasi, dan buka kembali report.</p></div><div className='heading-actions'><Button icon={<Search size={16}/>} onClick={() => setGlobalSearchOpen(true)}>Global search</Button><Button icon={<WandSparkles size={16}/>} onClick={() => setImportOpen(true)}>Import</Button><Button variant='primary' icon={<Plus size={17}/>} onClick={() => void createIncident()}>New incident</Button></div></header><section className='panel archive-panel'><div className='filter-bar'><label className='search-box'><Search size={17}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder='Cari site, incident ID, PIC…'/></label><CustomSelect value={statusFilter} onChange={setStatusFilter} ariaLabel='Filter status incident' options={[{ value: 'All', label: 'All status' }, ...['Draft', 'Open', 'Monitoring', 'Resolved', 'Closed', 'Cancel'].map(item => ({ value: item, label: item }))]}/><CustomSelect value={severityFilter} onChange={setSeverityFilter} ariaLabel='Filter severity incident' options={[{ value: 'All', label: 'All severity' }, ...['Critical', 'Major', 'Minor'].map(item => ({ value: item, label: item }))]}/></div><div className='record-table'><div className='record-head'><span>Incident</span><span>PIC & root cause</span><span>Last update</span><span>Status</span><span /></div>{filteredIncidents.map(incident => <div className='record-row' key={incident.id}><button className='record-title' onClick={() => openIncident(incident)}><strong>{incident.identityMode === 'b2b' ? (incident.b2bTitle || 'B2B tanpa judul') : (incident.incidentId || 'Untitled draft')}</strong><small>{incident.identityMode === 'b2b' ? (incident.incidentId || 'B2B free-form identity') : `${incident.linkA || 'Link A'} ↔ ${incident.linkB || 'Link B'}`}</small></button><div><strong>{incident.picName || 'PIC belum diisi'}</strong><small>{incident.rootCause || 'Root cause belum diisi'}</small></div><div><strong>{new Date(incident.updatedAt).toLocaleDateString('id-ID')}</strong><small>{incident.progress[incident.progress.length - 1]?.time || 'No update'}</small></div><Badge tone={statusTone(incident.status)}>{incident.status}</Badge><div className='row-actions'><button title='Buka' onClick={() => openIncident(incident)}><Edit3 size={16}/></button><button title='Duplikasi' onClick={() => void duplicateIncident(incident)}><Copy size={16}/></button>{isAdmin && <button title='Hapus' className='danger-action' onClick={() => void deleteIncident(incident)}><Trash2 size={16}/></button>}</div></div>)}</div>{!filteredIncidents.length && <EmptyState icon={<Search />} title='Tidak ada hasil' text='Coba ubah kata kunci atau filter.'/>}{incidentsNextToken && <div className='load-more'><Button icon={<ChevronDown size={16}/>} onClick={() => void loadMoreIncidents()}>Muat 100 data berikutnya</Button></div>}</section></div>;
    const renderTrash = () => <div className='page-content trash-page'><header className='page-heading compact'><div><p className='eyebrow'>Pemulihan data</p><h1>Trash</h1><p>Incident tetap tersimpan dan bisa dipulihkan. Penghapusan permanen belum tersedia pada mode Firebase Spark-only.</p></div></header><section className='panel archive-panel trash-panel'>{trashIncidents.length ? <div className='record-table trash-list'><div className='record-head'><span>Incident</span><span>Alasan</span><span>Dihapus</span><span>Status</span><span /></div>{trashIncidents.map(incident => <div className='record-row trash-row' key={incident.id}><div className='record-title trash-title'><strong>{incident.identityMode === 'b2b' ? (incident.b2bTitle || 'B2B tanpa judul') : (incident.incidentId || 'Untitled draft')}</strong><small>{incident.identityMode === 'b2b' ? (incident.incidentId || 'B2B free-form identity') : `${incident.linkA || 'Link A'} ↔ ${incident.linkB || 'Link B'}`}</small></div><div className='trash-reason'><strong>{incident.deleteReason || 'Tanpa alasan khusus'}</strong><small>Dihapus oleh {data.members.find(member => member.userId === incident.deletedBy)?.name || 'Admin'}</small></div><div className='trash-deleted'><strong>{new Date(incident.deletedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</strong><small>{new Date(incident.deletedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</small></div><Badge tone='muted'>{incident.status}</Badge><div className='row-actions trash-actions'><button title='Pulihkan' aria-label={'Pulihkan ' + (incident.incidentId || 'incident')} onClick={() => void restoreIncident(incident)}><RotateCcw size={16}/></button><button disabled title='Penghapusan permanen belum tersedia pada mode Firebase Spark-only' aria-label={'Penghapusan permanen belum tersedia untuk ' + (incident.incidentId || 'incident')} className='danger-action' onClick={() => void purgeIncident(incident)}><Trash2 size={16}/></button><span className='purge-disabled-note'>Hard delete nonaktif pada mode Spark</span></div></div>)}</div> : <EmptyState icon={<Trash2 />} title='Trash kosong' text='Incident yang dipindahkan ke Trash akan muncul di sini.'/>}{incidentsNextToken && <div className='load-more'><Button onClick={() => void loadMoreIncidents()}>Muat data berikutnya</Button></div>}</section></div>;
    const renderEditor = () => {
        if (!draft) return <div className='page-content'><EmptyState icon={<FileText />} title='Pilih incident' text='Buka incident dari archive atau buat draft baru.'/></div>;
        const statusOptions = availableStatusOptions(draft, role);
        const statusSelectOptions: SelectOption[] = statusOptions.map(item => ({ value: item, label: item, detail: item === 'Draft' ? 'Belum dibagikan' : item === 'Open' ? 'Penanganan aktif' : item === 'Monitoring' ? 'Observasi stabilitas' : item === 'Resolved' ? 'Pemulihan terkonfirmasi' : item === 'Cancel' ? 'TT dibatalkan' : 'Workflow selesai' }));
        const changeStatus = (nextStatus: string) => { let reopenReason = draft.reopenReason; if ((draft.status === 'Resolved' || draft.status === 'Closed' || draft.status === 'Cancel') && nextStatus === 'Open') { const reason = window.prompt('Alasan membuka kembali incident:'); if (!reason?.trim()) return; reopenReason = reason.trim(); } if (nextStatus === 'Open' || nextStatus === 'Monitoring') pinRunningIncident(draft.id); updateDraft({ status: nextStatus as IncidentStatus, reopenReason, closedTime: nextStatus === 'Closed' && !draft.closedTime ? localDateTime() : draft.closedTime }); };
        const sortedProgress = draft.progress;
        const isB2B = (draft.identityMode || 'standard') === 'b2b';
        return <div className='editor-page'><header className='editor-header'><button className='back-button' aria-label='Kembali ke daftar incident' onClick={() => setView('archive')}><ChevronLeft size={18}/></button><div className='editor-heading'><div><Badge tone={statusTone(draft.status)}>{draft.status}</Badge><span>{isB2B ? (draft.b2bTitle || 'Untitled B2B') : (incidentTitle(draft) || 'Untitled draft')}</span></div><p>{isB2B ? 'B2B · free-form identity' : `${draft.linkA || 'Link A'} ↔ ${draft.linkB || 'Link B'}`}</p></div><div className={`save-indicator ${saveState}`}><i />{saveState === 'saving' ? 'Saving…' : saveState === 'pending' ? 'Unsaved changes' : saveState === 'error' ? 'Save failed' : 'Saved'}</div><div className='mobile-editor-actions'><button type='button' className='mobile-running-trigger' aria-label={`Buka ${runningItems.length} running TT`} onClick={() => setRunningSwitcherOpen(true)}><Radio size={14}/><span>{runningItems.length} TT</span></button><button type='button' className='mobile-editor-more' aria-label='Buka quick actions' onClick={() => setMobileActionsOpen(true)}><MoreHorizontal size={19}/></button></div><div className='editor-actions'><Button variant='ghost' icon={<History size={16}/>} onClick={() => void loadVersions()}>Versions</Button><Button icon={<Copy size={16}/>} onClick={() => void copyReport()}>Copy</Button><Button variant='primary' icon={<Share2 size={16}/>} onClick={() => void shareReport()}>Share</Button></div></header><div className={`editor-layout ${mobilePreview ? 'show-preview' : ''}`}><main className='form-canvas'><RunningTabs items={runningItems} currentId={draft.id} onOpen={switchIncident} onRemove={removeRunningIncident} onOpenSwitcher={() => setRunningSwitcherOpen(true)}/>{!online && <div className='ops-banner warning'><WifiOff size={18}/><div><strong>Mode offline</strong><p>Perubahan disimpan di perangkat dan akan dikirim saat koneksi kembali.</p></div></div>}{remoteConflict && <div className='ops-banner danger'><AlertTriangle size={18}/><div><strong>Versi lain sudah tersimpan</strong><p>Draft lokal tidak ditimpa. Muat versi server atau duplikasi draft lokal.</p></div><div className='ops-banner-actions'><Button onClick={useServerConflict}>Muat server</Button><Button variant='primary' onClick={() => void duplicateLocalConflict()}>Duplikasi draft lokal</Button></div></div>}{validationErrors.length > 0 && <div className='validation-card'><div className='validation-summary'><span><ClipboardCheck size={18}/></span><div><strong>{validationErrors.length} field perlu dilengkapi</strong><small>Selesaikan sebelum report dibagikan.</small></div></div><ul>{validationErrors.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ul></div>}<IncidentHud incident={draft} settings={data.settings} now={clock} focusMode={focusMode} onQuickUpdate={() => setQuickUpdateOpen(true)} onFocus={() => setFocusMode(current => !current)} onCopy={() => void copyReport()}/><AdaptiveSectionNav incident={draft} onSelect={(section: SectionKey) => { const selectors: Record<SectionKey, string> = { identity: '.identity-section', handling: '.handling-section', impact: '.impact-section', timeline: '.timeline-section', cutpoints: '.geotag-section', evidence: '.split-section' }; document.querySelector<HTMLElement>(selectors[section])?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}/><div className='editor-workspace-grid'><div className='editor-primary-top'><section className={`form-section identity-section ${isB2B ? 'is-b2b' : ''}`}><div className='section-title'><span>01</span><div><h2>Incident identity</h2><p>{isB2B ? 'Mode B2B · judul incident menggunakan format bebas.' : 'Mode Standard · masukkan satu judul TT secara bebas.'}</p></div><Badge tone={isB2B ? 'cyan' : draft.condition === 'DOWN' ? 'danger' : 'warning'}>{isB2B ? 'B2B' : draft.condition}</Badge></div><div className='form-grid'><div className='identity-mode-switch' role='group' aria-label='Mode incident identity'><button type='button' className={!isB2B ? 'active' : ''} aria-pressed={!isB2B} onClick={() => updateDraft({ identityMode: 'standard' })}><strong>Standard</strong><small>Structured title</small></button><button type='button' className={isB2B ? 'active' : ''} aria-pressed={isB2B} onClick={() => updateDraft({ identityMode: 'b2b' })}><strong>B2B</strong><small>Free-form title</small></button></div><Field label='Status'><CustomSelect value={draft.status} onChange={changeStatus} options={statusSelectOptions} ariaLabel='Status incident'/></Field><Field label='Severity'><CustomSelect value={draft.severity} onChange={severity => updateDraft({ severity: severity as Incident['severity'] })} options={[{ value: 'Critical', label: 'Critical', detail: 'Highest priority' }, { value: 'Major', label: 'Major', detail: 'High impact' }, { value: 'Minor', label: 'Minor', detail: 'Limited impact' }]} ariaLabel='Severity incident'/></Field><Field label='Condition'><CustomSelect value={draft.condition} onChange={condition => updateDraft({ condition: condition as Incident['condition'] })} options={[{ value: 'DOWN', label: 'DOWN', detail: 'Link unavailable' }, { value: 'UP - Degraded', label: 'UP - Degraded', detail: 'Link UP · RSL / redaman degraded' }]} ariaLabel='Kondisi link'/></Field>{isB2B ? <><Field label='B2B Incident Title' hint='Free-form · dipakai persis sebagai judul report' wide><TextareaAutosize className='b2b-title-input' minRows={3} maxRows={8} value={draft.b2bTitle || ''} onChange={event => updateDraft({ b2bTitle: event.target.value })} placeholder='Paste atau ketik judul TT B2B dalam format apa pun…'/></Field><Field label='Incident ID' hint='Optional untuk B2B'><input value={draft.incidentId} onChange={event => updateDraft({ incidentId: event.target.value })} placeholder='Optional ticket / incident reference'/></Field><Field label='MDU Ticket' hint='Optional'><input value={draft.mduTicket} onChange={event => updateDraft({ mduTicket: event.target.value })} placeholder='Optional MDU reference'/></Field></> : <><Field label='Judul TT' hint='Satu judul bebas. Tidak perlu menyusun format bertingkat.' wide><TextareaAutosize className='b2b-title-input' minRows={2} maxRows={5} value={draft.titleOverride} onChange={event => updateDraft({ titleOverride: event.target.value })} placeholder='Masukkan satu judul TT, misalnya: FO cut jalur Bandung – Tembalang'/></Field><details className='identity-advanced-fields'><summary>Metadata operasional (opsional)</summary><div className='form-grid'><Field label='Group / Region'><SmartInput value={draft.group} onChange={group => updateDraft({ group })} suggestions={data.settings.groups} ariaLabel='Group atau region' placeholder='Pilih atau ketik group'/></Field><Field label='Link A'><SmartInput value={draft.linkA} onChange={linkA => updateDraft({ linkA })} suggestions={data.settings.sites} ariaLabel='Link A' placeholder='Site A'/></Field><Field label='Link B'><SmartInput value={draft.linkB} onChange={linkB => updateDraft({ linkB })} suggestions={data.settings.sites} ariaLabel='Link B' placeholder='Site B'/></Field><Field label='Segmen Route' hint={routeMaster.length ? `${routeMaster.length.toLocaleString('id-ID')} mapping` : 'Master data kosong'}><RouteMasterSelect mode='routeSegment' pairs={routeMaster} systemKey={draft.systemKey || ''} routeSegment={draft.routeSegment || ''} onSelect={pair => updateDraft({ systemKey: pair.systemKey, routeSegment: pair.routeSegment })}/></Field><Field label='System Key' hint={routeMaster.length ? `${routeMaster.length.toLocaleString('id-ID')} mapping` : 'Master data kosong'}><RouteMasterSelect mode='systemKey' pairs={routeMaster} systemKey={draft.systemKey || ''} routeSegment={draft.routeSegment || ''} onSelect={pair => updateDraft({ systemKey: pair.systemKey, routeSegment: pair.routeSegment })}/></Field><Field label='Incident ID'><input value={draft.incidentId} onChange={event => updateDraft({ incidentId: event.target.value })} placeholder='Incident reference (optional)'/></Field><Field label='MDU Ticket' hint='Optional'><input value={draft.mduTicket} onChange={event => updateDraft({ mduTicket: event.target.value })} placeholder='MDU reference (optional)'/></Field></div></details></>}</div></section><section className='form-section handling-section'><div className='section-title'><span>02</span><div><h2>Timing & handling</h2><p>Detail operasional dan penanganan lapangan.</p></div></div><div className='form-grid'><details className='optional-incident-fields' open><summary>Detail opsional · Occurtime, Dispatch Time, PIC, Rootcause, Cut Point</summary><div className='form-grid'><Field label='Occur time'><input type='datetime-local' value={draft.occurTime} onChange={event => updateDraft({ occurTime: event.target.value })}/></Field><Field label='Dispatch time'><input type='datetime-local' value={draft.dispatchTime} onChange={event => updateDraft({ dispatchTime: event.target.value })}/></Field><Field label='Closed time' hint='Wajib jika Closed'><input type='datetime-local' value={draft.closedTime} onChange={event => updateDraft({ closedTime: event.target.value })}/></Field><Field label='Reporter'><input value={draft.reporter} onChange={event => updateDraft({ reporter: event.target.value })}/></Field><Field label='PIC Area'><SmartInput value={draft.picArea} onChange={picArea => updateDraft({ picArea })} suggestions={data.settings.picAreas} ariaLabel='PIC Area' placeholder='Pilih atau ketik area'/></Field><Field label='PIC Name'><SmartInput value={draft.picName} onChange={picName => updateDraft({ picName })} suggestions={data.settings.picNames} ariaLabel='PIC Name' placeholder='Pilih atau ketik PIC'/></Field><Field label='Penanggung jawab'><CustomSelect value={draft.assignedToUserId} onChange={assignedToUserId => { const member = data.members.find(item => item.userId === assignedToUserId); updateDraft({ assignedToUserId, assignedToName: member?.name || '' }); }} options={[{ value: '', label: 'Belum ditugaskan' }, ...data.members.map(member => ({ value: member.userId, label: member.name, detail: roleLabel(member.role) }))]} ariaLabel='Penanggung jawab incident'/></Field><Field label='Acknowledgment'><Button icon={<CheckCircle2 size={16}/>} onClick={() => updateDraft({ acknowledgedAt: Date.now(), acknowledgedBy: data.profile.userId })}>{draft.acknowledgedAt ? `Diakui ${new Date(draft.acknowledgedAt).toLocaleString('id-ID')}` : 'Akui incident'}</Button></Field><Field label='Root cause'><SmartInput value={draft.rootCause} onChange={rootCause => updateDraft({ rootCause })} suggestions={data.settings.rootCauses} ariaLabel='Root cause' placeholder='Pilih atau ketik root cause'/></Field><Field label='Action'><SmartInput value={draft.action} onChange={action => updateDraft({ action })} suggestions={data.settings.actions} ariaLabel='Action' placeholder='Pilih atau ketik action'/></Field><Field label='Cut Point Summary' hint='Teks report / detail OTDR' wide><input value={draft.cutPoint} onChange={event => updateDraft({ cutPoint: event.target.value })} placeholder='OTDR FO CUT at KM 5 From Site KIIC'/></Field></div></details><Field label='Catatan handoff' hint='Tercatat di audit trail' wide><TextareaAutosize minRows={3} maxRows={8} value={draft.handoverNote} onChange={event => updateDraft({ handoverNote: event.target.value })} placeholder='Kondisi terakhir, risiko, dan langkah berikutnya untuk shift berikut…'/></Field><Field label='Internal notes' hint='Tidak masuk ke output bagan' wide><TextareaAutosize minRows={3} maxRows={8} value={draft.internalNotes} onChange={event => updateDraft({ internalNotes: event.target.value })} placeholder='Catatan koordinasi internal…'/></Field></div></section></div><div className='editor-primary-bottom'><section className='form-section impact-section'><div className='section-title'><span>04</span><div><h2>Impact links</h2><p>Format bebas. Paste judul TT atau deskripsi impact apa adanya.</p></div><Button variant='ghost' icon={<Plus size={15}/>} onClick={addImpact}>Add impact</Button></div>{draft.impacts.length ? <div className='impact-list'>{draft.impacts.map((impact, index) => <div className='impact-row free-form-impact' key={impact.id}><span>{index + 1}</span><TextareaAutosize className='impact-free-text' minRows={2} maxRows={6} value={impactValue(impact)} onChange={event => updateDraft({ impacts: draft.impacts.map(item => item.id === impact.id ? { ...item, text: event.target.value } : item) })} placeholder='Paste judul TT / impact link dalam format apa pun…'/><label className='mini-check'><input type='checkbox' checked={impact.recovered} onChange={event => updateDraft({ impacts: draft.impacts.map(item => item.id === impact.id ? { ...item, recovered: event.target.checked } : item) })}/><span>Normal</span></label><button className='icon-button danger-action' aria-label={`Hapus impact ${index + 1}`} onClick={() => updateDraft({ impacts: draft.impacts.filter(item => item.id !== impact.id) })}><X size={16}/></button></div>)}</div> : <div className='inline-empty'><Link2 /><div><strong>Tidak ada impact tambahan</strong><p>Tambahkan judul TT atau deskripsi impact dalam format bebas.</p></div><Button icon={<Plus size={15}/>} onClick={addImpact}>Tambahkan</Button></div>}</section><section className='form-section timeline-section'><div className='section-title'><span>05</span><div><h2>Progress timeline</h2><p>Tanggal baru akan menjadi separator otomatis.</p></div><div className='timeline-header-actions'><button className='time-now' onClick={() => setTimelineInput(current => ({ ...current, date: localDate(), time: localTime() }))}><Clock3 size={14}/> Waktu sekarang</button>{draft.progress.length > 0 && <button type='button' className='time-now timeline-clear-action' title={`Hapus seluruh ${draft.progress.length} progress update`} onClick={clearAllProgressUpdates}><Trash2 size={14}/> Hapus semua</button>}</div></div><div className='quick-phrases'>{data.settings.progressPhrases.slice(0, 10).map(phrase => <button key={phrase} onClick={() => setTimelineInput(current => ({ ...current, text: phrase }))}>{phrase}</button>)}</div><ProgressAutoparsePanel dispatchTime={draft.dispatchTime} progress={draft.progress} onApply={addAutoparsedProgress}/><div className='timeline-composer'><input type='date' value={timelineInput.date} onChange={event => setTimelineInput(current => ({ ...current, date: event.target.value }))}/><input type='time' value={timelineInput.time} onChange={event => setTimelineInput(current => ({ ...current, time: event.target.value }))}/><input className='composer-text' value={timelineInput.text} onChange={event => setTimelineInput(current => ({ ...current, text: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') addProgress(); }} placeholder='Tulis update progress…'/><input value={timelineInput.pic} onChange={event => setTimelineInput(current => ({ ...current, pic: event.target.value }))} placeholder='PIC (optional)'/><Button variant='primary' icon={<Plus size={16}/>} onClick={addProgress}>Add</Button></div>{sortedProgress.length ? <div className='timeline-editor'>{sortedProgress.map((item, index) => <article data-day={index === 0 || sortedProgress[index - 1]?.date !== item.date ? item.date : ''} className={`timeline-item timeline-readonly ${editingProgressId === item.id ? 'is-editing' : ''} ${/recover|normal|recovered|closed/i.test(`${item.milestone || ''} ${item.text}`) ? 'is-recovery' : ''}`} key={item.id}><div className='timeline-readonly-rail' aria-hidden='true'><span><History size={15}/></span></div><div className='timeline-readonly-copy' data-gap={timelineGapLabel(sortedProgress[index - 1], item)}>{editingProgressId === item.id ? <div className='timeline-edit-form'><div className='timeline-edit-grid'><label className='timeline-edit-field'><span>Tanggal</span><input type='date' value={progressEditDraft.date} onChange={event => setProgressEditDraft(current => ({ ...current, date: event.target.value }))}/></label><label className='timeline-edit-field'><span>Waktu</span><input type='time' value={progressEditDraft.time} onChange={event => setProgressEditDraft(current => ({ ...current, time: event.target.value }))}/></label><label className='timeline-edit-field timeline-edit-pic'><span>PIC</span><input value={progressEditDraft.pic} onChange={event => setProgressEditDraft(current => ({ ...current, pic: event.target.value }))} placeholder='PIC (optional)'/></label><label className='timeline-edit-field'><span>Milestone</span><input value={progressEditDraft.milestone} onChange={event => setProgressEditDraft(current => ({ ...current, milestone: event.target.value }))} placeholder='Optional milestone'/></label></div><label className='timeline-edit-field timeline-edit-text'><span>Update progress</span><textarea autoFocus value={progressEditDraft.text} onChange={event => setProgressEditDraft(current => ({ ...current, text: event.target.value }))} onKeyDown={event => { if (event.key === 'Escape') cancelProgressEdit(); if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') saveProgressEdit(); }}/></label><div className='timeline-edit-actions'><small>Koreksi disimpan sebagai versi dan audit baru.</small><button className='timeline-edit-button ghost' onClick={cancelProgressEdit}><X size={14}/> Batal</button><button className='timeline-edit-button primary' onClick={saveProgressEdit}><Save size={14}/> Simpan koreksi</button></div></div> : <><div className='timeline-readonly-head'><strong>{item.date} · {item.time}{item.milestone ? <span className='timeline-milestone'>{item.milestone}</span> : null}</strong><div className='timeline-readonly-actions'>{item.pic ? <span>PIC · {item.pic}</span> : null}<button className='timeline-edit-trigger' title='Edit progress' aria-label={`Edit progress ${item.date} ${item.time}`} onClick={() => startProgressEdit(item)}><Edit3 size={13}/> Edit</button><button type='button' className='timeline-delete-trigger' title='Hapus progress update' aria-label={`Hapus progress ${item.date} ${item.time}`} onClick={() => deleteProgressUpdate(item.id)}><Trash2 size={13}/> Hapus</button></div></div><p>{item.text}</p><small>{item.createdAt ? `Tercatat ${new Date(item.createdAt).toLocaleString('id-ID')}` : 'Riwayat tersimpan'}{item.editedAt ? ` · Diedit ${new Date(item.editedAt).toLocaleString('id-ID')}` : ''} · dapat dikoreksi</small></>}</div></article>)}</div> : <div className='inline-empty'><Clock3 /><div><strong>Timeline masih kosong</strong><p>Tambahkan update pertama menggunakan composer di atas.</p></div></div>}</section><EscalationEmailPanel incident={draft} now={clock}/><section className='form-section geotag-section'>
  <div className='section-title geotag-section-title'>
    <span>06</span>
    <div className='geotag-section-heading'>
      <div className='geotag-heading-title'>
        <h2>Cut Points & GeoTag</h2>
        <span className='geotag-count-pill'>{(draft.cutPoints || []).length} / 20 CP</span>
        <span className='geotag-marker-pill'><MapPin size={12}/>{(draft.cutPoints || []).filter(item => item.coordinate && item.coordinate.verified !== false).length} marker siap</span>
      </div>
      <p>Satu incident dapat memiliki beberapa CP, dengan satu titik koordinat untuk setiap CP.</p>
    </div>
    <Button variant='primary' icon={<Plus size={15}/>} onClick={addCutPoint} disabled={geotagBusy || (draft.cutPoints || []).length >= 20}>Tambah CP</Button>
  </div>
  <div className='geotag-panel'>
    <div className='geotag-guide'>
      <span><WandSparkles size={18}/></span>
      <div>
        <strong>Alur GeoTag</strong>
        <p>Tambahkan CP, unggah foto geotag, lalu periksa koordinat sebelum marker digunakan di peta.</p>
      </div>
      <code>Foto → Gemini → [lat, lng]</code>
    </div>
    {geotagDiagnostics.length > 0 && <details className='geotag-diagnostics'>
      <summary>Gemini reading trace · {geotagDiagnostics.length} attempts</summary>
      <div>{geotagDiagnostics.map((item, index) => <code key={index + '-' + item.slice(0, 20)}>{item}</code>)}</div>
    </details>}
    {geotagBusy && <div className='geotag-progress'>
      <div><span style={{ width: (geotagProgress.total ? (geotagProgress.done / geotagProgress.total) * 100 : 0) + '%' }}/></div>
      <small>Gemini sedang membaca foto CP…</small>
    </div>}
    {(draft.cutPoints || []).length ? <div className='cut-point-list'>
      {(draft.cutPoints || []).map((cutPoint, index) => <article
        className={'cut-point-card ' + (geotagDropTarget === cutPoint.id ? 'drag-active' : '')}
        key={cutPoint.id}
        tabIndex={0}
        aria-label={(cutPoint.label || 'CP ' + (index + 1)) + ' photo drop zone'}
        onDragEnter={event => { event.preventDefault(); if (!geotagBusy) setGeotagDropTarget(cutPoint.id); }}
        onDragOver={event => handleCutPointDragOver(cutPoint.id, event)}
        onDragLeave={event => handleCutPointDragLeave(cutPoint.id, event)}
        onDrop={event => void handleCutPointDrop(cutPoint.id, event)}
        onPaste={event => void handleCutPointPaste(cutPoint.id, event)}
      >
        <div className='cut-point-head'>
          <span className='geotag-index'>CP {String(index + 1).padStart(2, '0')}</span>
          <input className='cut-point-label-input' value={cutPoint.label} onChange={event => updateCutPointLabel(cutPoint.id, event.target.value)} placeholder={'CP ' + (index + 1)} aria-label={'Label CP ' + (index + 1)}/>
          <Badge tone={cutPoint.coordinate ? cutPoint.coordinate.verified === false ? 'warning' : 'success' : 'muted'}>
            {cutPoint.coordinate ? cutPoint.coordinate.verified === false ? 'Perlu verifikasi' : 'Marker siap' : 'Tanpa koordinat'}
          </Badge>
          <button className='icon-button danger-action' type='button' title='Hapus CP' aria-label={'Hapus CP ' + (index + 1)} onClick={() => removeCutPoint(cutPoint.id)}><Trash2 size={15}/></button>
        </div>
        {cutPoint.coordinate ? <div className='cut-point-coordinate-row'>
          <div className='geotag-value'>
            <strong>{cutPoint.coordinate.normalized}</strong>
            <small>{cutPoint.coordinate.sourceName}{cutPoint.coordinate.rawCoordinate ? ' · raw: ' + cutPoint.coordinate.rawCoordinate : ''}</small>
          </div>
          <code className='leaflet-coordinate'>[{cutPoint.coordinate.latitude.toFixed(6)}, {cutPoint.coordinate.longitude.toFixed(6)}]</code>
          {cutPoint.coordinate.verified === false && <div className='coordinate-verify-fields'>
            <label>Latitude<input type='number' step='0.000001' value={cutPoint.coordinate.latitude} onChange={event => updateCutPointCoordinate(cutPoint.id, 'latitude', event.target.value)}/></label>
            <label>Longitude<input type='number' step='0.000001' value={cutPoint.coordinate.longitude} onChange={event => updateCutPointCoordinate(cutPoint.id, 'longitude', event.target.value)}/></label>
            <Button variant='primary' icon={<Check size={15}/>} onClick={() => verifyCutPointCoordinate(cutPoint.id)}>Verifikasi</Button>
          </div>}
          <button className='icon-button' type='button' title='Salin koordinat' aria-label='Salin koordinat' onClick={() => void copyText(cutPoint.coordinate!.normalized, 'Koordinat CP disalin.')}><Copy size={15}/></button>
          <label className={'button secondary geotag-pick ' + (geotagBusy ? 'disabled' : '')}>
            <ScanLine size={15}/><span>Ganti foto</span>
            <input type='file' accept='image/*' disabled={geotagBusy} onChange={event => void extractCutPointCoordinate(cutPoint.id, event)}/>
          </label>
          <button className='icon-button danger-action' type='button' title='Hapus koordinat' aria-label='Hapus koordinat' onClick={() => clearCutPointCoordinate(cutPoint.id)}><X size={15}/></button>
        </div> : <div className='cut-point-coordinate-empty'>
          <span className='cut-point-empty-icon'><MapPin size={17}/></span>
          <div>
            <strong>Koordinat belum tersedia</strong>
            <p>Unggah foto geotag untuk mengisi satu titik koordinat CP ini.</p>
          </div>
          <label className={'button secondary geotag-pick ' + (geotagBusy ? 'disabled' : '')}>
            {geotagBusy ? <LoaderCircle className='spin' size={15}/> : <ScanLine size={15}/>}
            <span>Extract coordinate</span>
            <input type='file' accept='image/*' disabled={geotagBusy} onChange={event => void extractCutPointCoordinate(cutPoint.id, event)}/>
          </label>
        </div>}
        <div className='geotag-drop-hint'>
          <Upload size={14}/>
          <div>
            <strong>{cutPoint.coordinate ? 'Drop foto untuk mengganti koordinat' : 'Drop foto untuk extract coordinate'}</strong>
            <small>Folder / WhatsApp Web · atau Copy image → Ctrl+V</small>
          </div>
        </div>
      </article>)}
    </div> : <div className='geotag-empty'>
      <span className='geotag-empty-icon'><MapPin size={22}/></span>
      <div className='geotag-empty-copy'>
        <strong>Belum ada Cut Point</strong>
        <p>Mulai dengan menambahkan CP pertama. Setiap CP menyimpan tepat satu titik koordinat.</p>
        <small>Hingga 20 CP dalam satu incident.</small>
      </div>
      <Button variant='primary' icon={<Plus size={15}/>} onClick={addCutPoint} disabled={geotagBusy || (draft.cutPoints || []).length >= 20}>Tambah CP Pertama</Button>
    </div>}
  </div>
</section><section className='form-section split-section'><div><div className='section-title simple'><span>07</span><div><h2>Attachments</h2><p>Lampiran bersama belum tersedia pada paket Firebase Spark.</p></div></div><div className='ops-banner warning'><Paperclip size={18}/><div><strong>Shared attachment dinonaktifkan</strong><p>Firebase Storage tidak digunakan pada mode Spark-only. Simpan bukti pada penyimpanan internal yang disetujui lalu cantumkan tautannya di Internal Notes.</p></div></div><div className='attachment-list'>{draft.attachments.map(attachment => <div key={attachment.id}><span className='file-icon'><Paperclip size={16}/></span><div><strong>{attachment.name}</strong><small>{bytesLabel(attachment.size)} · metadata saja, file tidak tersedia pada mode Spark</small></div></div>)}</div></div><div><div className='section-title simple'><span>08</span><div><h2>Closing checklist</h2><p>Pastikan handoff selesai sebelum incident ditutup.</p></div></div><div className='checklist'>{([['statementWag', 'Pernyataan Up di WAG'], ['ticketStatus', 'Status TT / Event'], ['photo', 'Bukti foto'], ['rfo', 'RFO'], ['closedEmail', 'Email penutupan']] as const).map(([key, label]) => <label key={key}><input type='checkbox' checked={draft.checklist[key]} onChange={event => updateDraft({ checklist: { ...draft.checklist, [key]: event.target.checked } })}/><span><CheckCircle2 size={17}/>{label}</span></label>)}</div><Field label='Referensi bukti penutupan' hint='Wajib untuk Closed' wide><TextareaAutosize minRows={3} maxRows={8} value={draft.closingEvidenceNote} onChange={event => updateDraft({ closingEvidenceNote: event.target.value })} placeholder='Nomor email, link WAG, nama lampiran, atau referensi RFO…'/></Field></div></section></div></div></main><aside className='preview-panel'><div className='preview-top'><div><Eye size={17}/><div><strong>WhatsApp Preview</strong><small>Live formatted output</small></div></div><button className='close-mobile-preview' onClick={() => setMobilePreview(false)}><X /></button></div><div className='phone-preview'><div className='chat-top'><span className='chat-avatar'><Radio /></span><div><strong>NOC Operation</strong><small>online</small></div></div><pre>{report || 'Lengkapi form untuk melihat preview.'}</pre></div><div className='preview-actions'><Button variant='primary' icon={<Copy size={16}/>} onClick={() => void copyReport()}>Copy formatted</Button><Button icon={<Share2 size={16}/>} onClick={() => void shareReport()}>Share</Button><button onClick={() => void copyReport(false)}>Copy tanpa emoji</button><button onClick={exportReport}><Download size={14}/> Download .txt</button>{draft.progress.length > 0 && <button onClick={() => { const last = draft.progress[draft.progress.length - 1]; void copyText(`${last.time} ${last.text}`, 'Update terakhir disalin.'); }}>Copy update terakhir</button>}</div></aside></div><div className='field-action-dock'><button type='button' className='primary' disabled={draft.status !== 'Open' && draft.status !== 'Monitoring'} onClick={() => setQuickUpdateOpen(true)}><Plus size={16}/><span>Update</span></button><button type='button' onClick={() => setRunningSwitcherOpen(true)}><Radio size={16}/><span>Running</span></button><button type='button' onClick={() => setMobilePreview(true)}><Eye size={16}/><span>Preview</span></button><button type='button' onClick={() => setMobileActionsOpen(true)}><MoreHorizontal size={16}/><span>More</span></button></div><button className='mobile-preview-toggle' onClick={() => setMobilePreview(current => !current)}>{mobilePreview ? <><Edit3 size={17}/> Kembali edit</> : <><Eye size={17}/> Preview bagan</>}</button><MobileActionSheet open={mobileActionsOpen} onOpenChange={setMobileActionsOpen} title={isB2B ? (draft.b2bTitle || 'B2B incident') : (draft.incidentId || 'Incident draft')} onPreview={() => setMobilePreview(true)} onCopy={() => void copyReport()} onShare={() => void shareReport()} onVersions={() => void loadVersions()} onDownload={exportReport}/><QuickUpdateSheet open={quickUpdateOpen} incident={draft} phrases={data.settings.progressPhrases} onClose={() => setQuickUpdateOpen(false)} onSubmit={(text, pic, milestone) => quickUpdateIncident(draft.id, text, pic, milestone)}/>{historyOpen && <div className='drawer-backdrop' onClick={() => setHistoryOpen(false)}><aside className='history-drawer' onClick={event => event.stopPropagation()}><div className='drawer-head'><div><History /><h2>Version history</h2></div><button onClick={() => setHistoryOpen(false)}><X /></button></div><p>Snapshot penting dapat dipulihkan tanpa menghapus version saat ini.</p><Button variant='primary' icon={<Save size={16}/>} onClick={() => void createVersion()}>Save snapshot sekarang</Button><h3 className='history-subtitle'>Snapshot</h3><div className='version-list'>{versions.map(version => <article key={version.id}><span><History size={15}/></span><div><strong>{version.label}</strong><p>{version.createdByName || 'NOC User'}</p><small>{new Date(version.createdAt).toLocaleString('id-ID')}</small></div>{canReview && <button title='Restore' onClick={() => void restoreVersion(version)}><RotateCcw size={16}/></button>}</article>)}</div><h3 className='history-subtitle'>Audit trail</h3><div className='audit-list'>{auditTrail.map(entry => <article key={entry.id}><span><ShieldCheck size={15}/></span><div><strong>{entry.summary}</strong><p>{entry.actorName} · rev {entry.fromRevision} → {entry.toRevision}</p><small>{new Date(entry.createdAt).toLocaleString('id-ID')}{entry.changedFields.length ? ` · ${entry.changedFields.join(', ')}` : ''}</small></div></article>)}</div></aside></div>}</div>;
    };
    const renderSettings = () => <div className='page-content'><header className='page-heading compact'><div><p className='eyebrow'>Workspace configuration</p><h1>Templates & master data</h1><p>Preset, integration AI, dan database referensi yang dipakai seluruh operator.</p></div><Button variant='primary' icon={<Save size={17}/>} onClick={() => void saveSettings()}>Save changes</Button></header><section className='panel settings-panel'><div className='master-db-card integration-card'><span className='master-db-icon'><WandSparkles /></span><div className='master-db-copy'><div className='master-db-title-row'><strong>Gemini GeoTag AI</strong><Badge tone={geminiStatus.configured ? 'success' : 'warning'}>{geminiStatus.configured ? 'Connected' : 'API key required'}</Badge></div><p>{geminiStatus.model} · Backend vision extractor untuk membaca watermark coordinate.</p><div className='integration-meta'><span><ShieldCheck size={12}/>Secure Vault</span><code>GEMINI_API_KEY</code><small>{geminiStatus.configured ? 'Protected · backend only' : 'Configuration required'}</small></div></div><Button className='integration-action' icon={<ShieldCheck size={16}/>} onClick={() => void loadGeminiStatus()}>Refresh status</Button></div><div className='master-db-card integration-card'><span className='master-db-icon'><Database /></span><div className='master-db-copy'><div className='master-db-title-row'><strong>System Key ↔ Segment Route database</strong><Badge tone={routeMaster.length ? 'success' : 'warning'}>{routeMaster.length ? `${routeMaster.length.toLocaleString('id-ID')} mapping` : 'Belum diimport'}</Badge></div><p>{routeMasterMeta ? `${routeMasterMeta.fileName || 'Excel master'} · ${routeMasterMeta.sheetName || 'worksheet'}` : 'Import XLS, XLSX, atau XLSB. Header akan dideteksi otomatis.'}</p><div className='integration-meta'><span><FileSpreadsheet size={12}/>Excel master</span><small>{routeMasterMeta ? `Updated ${new Date(routeMasterMeta.updatedAt).toLocaleString('id-ID')}` : 'Belum ada source aktif'}</small></div></div><Button className='integration-action' icon={<FileSpreadsheet size={16}/>} onClick={() => masterFileRef.current?.click()} disabled={masterImportBusy}>{routeMaster.length ? 'Replace Excel' : 'Import Excel'}</Button><input ref={masterFileRef} className='hidden-file-input' type='file' accept='.xls,.xlsx,.xlsb,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' onChange={event => void readMasterExcel(event)}/></div><div className='master-db-card integration-card'><span className='master-db-icon'><Download /></span><div className='master-db-copy'><div className='master-db-title-row'><strong>Workspace backup</strong><Badge tone='success'>Manual export</Badge></div><p>Unduh seluruh data workspace, termasuk incident, progress, audit trail, version history, member, settings, dan Route Master.</p><div className='integration-meta'><span><ShieldCheck size={12}/>Admin only</span><small>JSON · Maksimal 100 MiB · Tidak mengubah data Firestore</small></div></div><Button className='integration-action' icon={<Download size={16}/>} onClick={() => void exportWorkspaceBackupFile()} disabled={workspaceExportBusy}>{workspaceExportBusy ? 'Preparing…' : 'Export workspace'}</Button></div><div className='master-db-card integration-card'><span className='master-db-icon'><Upload /></span><div className='master-db-copy'><div className='master-db-title-row'><strong>Workspace backup preflight</strong><Badge tone='warning'>Dry-run only</Badge></div><p>Periksa file backup sebelum proses pemulihan. Validasi workspace, schema, duplikasi ID, dan kelengkapan data tanpa menulis ke Firestore.</p><div className='integration-meta'><span><ShieldCheck size={12}/>Admin only</span><small>JSON · Maksimal 100 MiB · Read-only</small></div>{workspaceImportReport && <div className='integration-meta'><strong>{workspaceImportReport.valid ? 'Preflight passed' : 'Preflight needs attention'}</strong><small>{workspaceImportReport.validation.counts.incidents} incidents · {workspaceImportReport.validation.counts.members} members · {workspaceImportReport.validation.counts.routeMasterPairs} route mappings</small><small>{workspaceImportReport.errors.length} errors · {workspaceImportReport.warnings.length} warnings</small>{workspaceImportReport.errors.slice(0, 4).map((item, index) => <small key={index}>• {item}</small>)}{workspaceImportReport.warnings.slice(0, 3).map((item, index) => <small key={'w'+index}>• {item}</small>)}<small><strong>Restore capability:</strong> Full restore is not supported by current client-only Spark rules.</small>{workspaceImportReport.restorePolicy.items.map(item => <small key={item.key}><strong>{item.label}:</strong> {item.capability === 'admin-writable' ? 'Admin-writable' : item.capability === 'blocked' ? 'Blocked' : 'Trusted migration required'} · {item.reason}</small>)}</div>}</div><div className='integration-action'><input className='hidden-file-input' type='file' accept='.json,application/json' onChange={event => { const file = event.target.files?.[0]; void previewWorkspaceBackupImport(file); event.target.value = ''; }}/><Button icon={<Upload size={16}/>} onClick={event => (event.currentTarget.parentElement?.querySelector('input[type=file]') as HTMLInputElement | null)?.click()} disabled={workspaceImportBusy}>{workspaceImportBusy ? 'Checking…' : 'Validate backup'}</Button></div></div><div className='workspace-restore-controls'>
{workspaceImportReport?.valid && workspaceImportBundle && <div className='integration-meta'>
<strong>Pilih bagian yang akan dipulihkan</strong>
<label className='restore-choice'><input type='checkbox' checked={workspaceRestoreSelection.settings} onChange={event => { setWorkspaceRestoreSelection(current => ({ ...current, settings: event.target.checked })); setWorkspaceRestoreResult(null); }}/> <span><strong>Workspace Settings</strong><small>Overwrite konfigurasi saat ini · 1 dokumen backup</small></span></label>
<label className='restore-choice'><input type='checkbox' checked={workspaceRestoreSelection.routeMaster} onChange={event => { setWorkspaceRestoreSelection(current => ({ ...current, routeMaster: event.target.checked })); setWorkspaceRestoreResult(null); }}/> <span><strong>Route Master</strong><small>Ganti database aktif · {workspaceImportReport.validation.counts.routeMasterPairs.toLocaleString('id-ID')} mapping dari backup</small></span></label>
<div className='restore-counts'>
<small>Settings: 1 saat ini → 1 dari backup jika dipilih.</small>
<small>Route Master: {routeMaster.length.toLocaleString('id-ID')} saat ini → {workspaceImportReport.validation.counts.routeMasterPairs.toLocaleString('id-ID')} dari backup jika dipilih.</small>
</div>
<small>Anggota, insiden, audit trail, dan version history tidak akan dipulihkan.</small>
<Button variant='primary' icon={<RotateCcw size={16}/>} disabled={!workspaceRestorePlan?.executable || workspaceRestoreBusy} onClick={() => { setWorkspaceRestoreResult(null); setWorkspaceRestoreConfirmOpen(true); }}>Review selective restore</Button>
</div>}
{workspaceRestoreResult && <div className='integration-meta restore-result'>
<strong>Hasil restore: {workspaceRestoreResult.status === 'completed' ? 'Berhasil' : workspaceRestoreResult.status === 'needs-review' ? 'Perlu pemeriksaan' : workspaceRestoreResult.status === 'partial' ? 'Parsial' : 'Gagal'}</strong>
{workspaceRestoreResult.completedSections?.length > 0 && <small>Bagian selesai: {workspaceRestoreResult.completedSections.join(', ')}</small>}
{workspaceRestoreResult.errors?.map((item, index) => <small key={'restore-error-'+index}>• {item}</small>)}
{workspaceRestoreResult.warnings?.map((item, index) => <small key={'restore-warning-'+index}>• {item}</small>)}
{workspaceRestoreResult.stagedBatchId && <small>Staging batch: {workspaceRestoreResult.stagedBatchId}</small>}
</div>}
</div>{isAdmin && <WorkspaceIntegrityPanel />}{isAdmin && <section className='panel settings-panel restore-recovery-panel'>
<div className='panel-head'><div><h2>Workspace Restore Recovery</h2><p>Pulihkan batch Route Master sebelumnya, bersihkan staging lama, dan tinjau aktivitas restore.</p></div><Button icon={<History size={16}/>} onClick={() => void loadWorkspaceRestoreRecovery()} disabled={workspaceRestoreRecoveryBusy || Boolean(workspaceRestoreRecoveryAction)}>{workspaceRestoreRecoveryBusy ? 'Memuat…' : 'Refresh recovery'}</Button></div>
{!workspaceRestoreRecovery && <div className='integration-meta'><small>{workspaceRestoreRecoveryBusy ? 'Memuat status recovery workspace…' : 'Status recovery belum tersedia. Refresh untuk memuat data.'}</small></div>}
{workspaceRestoreRecovery && <>
<div className='master-db-card integration-card'>
<span className='master-db-icon'><Database /></span>
<div className='master-db-copy'><div className='master-db-title-row'><strong>Route Master aktif</strong><Badge tone={workspaceRestoreRecovery.recovery?.activeBatchId ? 'success' : 'warning'}>{workspaceRestoreRecovery.recovery?.activeBatchId ? 'Active batch' : 'Belum tersedia'}</Badge></div>
<p>{workspaceRestoreRecovery.recovery?.activeBatchId || 'Belum ada current batch pointer'}</p>
<div className='integration-meta'><small>{Number(workspaceRestoreRecovery.recovery?.activeCount || 0).toLocaleString('id-ID')} mapping aktif</small><small>Batch committed sebelumnya tetap disimpan untuk rollback.</small></div></div>
</div>
<div className='settings-grid restore-recovery-grid'>
<div className='master-db-card integration-card restore-recovery-card'>
<div className='master-db-copy'><div className='master-db-title-row'><strong>Committed batch history</strong><Badge>{workspaceRestoreRecovery.recovery?.committedBatches?.length || 0}</Badge></div><p>Aktifkan kembali versi Route Master sebelumnya. Batch aktif saat ini tidak dihapus.</p>
<div className='restore-recovery-list'>
{(workspaceRestoreRecovery.recovery?.committedBatches || []).length ? workspaceRestoreRecovery.recovery.committedBatches.map((batch: any) => <div className='restore-recovery-row' key={batch.id}>
<div><strong>{batch.sourceFileName || batch.id}</strong><small>{batch.id}</small><small>{Number(batch.count || 0).toLocaleString('id-ID')} mapping · {batch.committedAt ? new Date(batch.committedAt).toLocaleString('id-ID') : 'Waktu commit tidak tersedia'}</small></div>
{batch.id === workspaceRestoreRecovery.recovery?.activeBatchId ? <Badge tone='success'>Aktif</Badge> : <Button variant='secondary' className='restore-recovery-action' disabled={!canReactivateRouteMasterBatch(batch, workspaceRestoreRecovery.recovery?.activeBatchId || null) || workspaceRestoreRecoveryBusy || Boolean(workspaceRestoreRecoveryAction)} onClick={() => void reactivatePreviousRouteMaster(batch)}>{workspaceRestoreRecoveryAction === batch.id ? 'Memproses…' : 'Aktifkan'}</Button>}
</div>) : <small>Belum ada batch committed yang tercatat.</small>}
</div></div>
</div>
<div className='master-db-card integration-card restore-recovery-card'>
<div className='master-db-copy'><div className='master-db-title-row'><strong>Staging cleanup</strong><Badge tone={(workspaceRestoreRecovery.recovery?.stagingBatches || []).some((batch: any) => batch.stale) ? 'warning' : 'success'}>{(workspaceRestoreRecovery.recovery?.stagingBatches || []).filter((batch: any) => batch.stale).length} stale</Badge></div><p>Hanya batch berstatus staging yang tidak memiliki aktivitas selama minimal 24 jam yang dapat dibersihkan.</p>
<div className='restore-recovery-list'>
{(workspaceRestoreRecovery.recovery?.stagingBatches || []).length ? workspaceRestoreRecovery.recovery.stagingBatches.map((batch: any) => <div className='restore-recovery-row' key={batch.id}>
<div><strong>{batch.id}</strong><small>Terakhir aktif: {batch.lastActivityAt ? new Date(batch.lastActivityAt).toLocaleString('id-ID') : 'Waktu tidak tersedia'}</small><small>{batch.stale ? 'Tidak aktif ≥ 24 jam' : 'Masih dalam masa aman'}{batch.cleanupSupported === false ? ' · Jumlah chunk melewati batas cleanup otomatis' : ''}</small></div>
{canCleanupStaleRouteMasterBatch(batch, workspaceRestoreRecovery.recovery?.activeBatchId || null) ? <Button variant='secondary' className='restore-recovery-action danger-action' disabled={workspaceRestoreRecoveryBusy || Boolean(workspaceRestoreRecoveryAction)} onClick={() => void cleanupStaleRouteMaster(batch)}>{workspaceRestoreRecoveryAction === batch.id ? 'Memproses…' : 'Bersihkan'}</Button> : batch.stale && batch.cleanupSupported === false ? <Badge tone='warning'>Manual review · 50+ chunk</Badge> : <Badge tone='muted'>Dipertahankan</Badge>}
</div>) : <small>Tidak ada staging batch yang perlu ditinjau.</small>}
</div>
{workspaceRestoreRecovery.recovery?.stagingScanTruncated && <small>Hasil staging dibatasi 100 batch. Refresh atau lakukan pemeriksaan lanjutan jika jumlah batch melebihi batas ini.</small>}
</div></div>
</div>
<div className='master-db-card integration-card restore-operation-history'>
<div className='master-db-copy'><div className='master-db-title-row'><strong>Restore activity & audit history</strong><Badge>{workspaceRestoreRecovery.operations?.length || 0} aktivitas</Badge></div><p>Riwayat selective restore, reaktivasi batch, dan cleanup staging. Running yang tidak diperbarui selama satu jam ditandai perlu pemeriksaan, tanpa mengubah status tersimpan.</p>
<div className='restore-recovery-list'>
{(workspaceRestoreRecovery.operations || []).length ? workspaceRestoreRecovery.operations.map((operation: any) => {
const displayedStatus = getRestoreOperationDisplayStatus(operation, clock);
const statusTone = displayedStatus === 'completed' ? 'success' : displayedStatus === 'failed' || displayedStatus === 'partial' ? 'danger' : displayedStatus === 'needs-review' ? 'warning' : 'cyan';
const operationLabel = operation.kind === 'selective-restore' ? 'Selective restore' : operation.kind === 'reactivate-route-master' ? 'Reaktivasi Route Master' : 'Cleanup staging';
return <div className='restore-recovery-row' key={operation.id}>
<div><strong>{operationLabel} · {operation.sourceFileName || operation.targetBatchId || operation.id}</strong><small>{operation.createdAt ? new Date(operation.createdAt).toLocaleString('id-ID') : 'Waktu tidak tersedia'} · {operation.createdByName || 'Admin'}</small><small>{(operation.selectedSections || []).join(', ') || operation.message || 'Recovery action'}</small>{operation.errors?.slice(0, 2).map((error: string, index: number) => <small key={index}>• {error}</small>)}</div>
<Badge tone={statusTone}>{restoreOperationStatusLabel(displayedStatus)}</Badge>
</div>;
}) : <small>Belum ada aktivitas restore yang tercatat.</small>}
</div></div>
</div>
</>}
</section>}<div className='settings-note'><ShieldCheck size={20}/><div><strong>Admin only</strong><p>Perubahan template dan master database langsung tersedia untuk seluruh anggota melalui realtime sync.</p></div></div><div className='settings-grid'><ListEditor label='Groups / Regions' value={settingsDraft.groups} onChange={groups => setSettingsDraft(current => ({ ...current, groups }))} hint='Satu item per baris'/><ListEditor label='PIC Areas' value={settingsDraft.picAreas} onChange={picAreas => setSettingsDraft(current => ({ ...current, picAreas }))} hint='Area tanggung jawab'/><ListEditor label='PIC Names' value={settingsDraft.picNames} onChange={picNames => setSettingsDraft(current => ({ ...current, picNames }))} hint='Nama yang sering digunakan'/><ListEditor label='Root Causes' value={settingsDraft.rootCauses} onChange={rootCauses => setSettingsDraft(current => ({ ...current, rootCauses }))} hint='Tetap bisa input manual'/><ListEditor label='Actions' value={settingsDraft.actions} onChange={actions => setSettingsDraft(current => ({ ...current, actions }))} hint='Tindakan penanganan'/><ListEditor label='Quick Progress Phrases' value={settingsDraft.progressPhrases} onChange={progressPhrases => setSettingsDraft(current => ({ ...current, progressPhrases }))} hint='Maksimal 10 tampil sebagai chip'/><ListEditor label='Sites / Link Names' value={settingsDraft.sites} onChange={sites => setSettingsDraft(current => ({ ...current, sites }))} hint='Autocomplete site'/><Field label='SLA Critical (menit)'><input type='number' min={5} max={1440} value={settingsDraft.slaCriticalMinutes} onChange={event => setSettingsDraft(current => ({ ...current, slaCriticalMinutes: Number(event.target.value) }))}/></Field><Field label='SLA Major (menit)'><input type='number' min={5} max={1440} value={settingsDraft.slaMajorMinutes} onChange={event => setSettingsDraft(current => ({ ...current, slaMajorMinutes: Number(event.target.value) }))}/></Field><Field label='SLA Minor (menit)'><input type='number' min={5} max={1440} value={settingsDraft.slaMinorMinutes} onChange={event => setSettingsDraft(current => ({ ...current, slaMinorMinutes: Number(event.target.value) }))}/></Field><Field label='Batas update basi (menit)'><input type='number' min={5} max={1440} value={settingsDraft.staleUpdateMinutes} onChange={event => setSettingsDraft(current => ({ ...current, staleUpdateMinutes: Number(event.target.value) }))}/></Field></div></section></div>;
    const renderTeam = () => <div className='page-content'><header className='page-heading compact'><div><p className='eyebrow'>Access & permissions</p><h1>Workspace team</h1><p>Role ketat, workflow tetap cepat.</p></div>{isAdmin && <Button variant='primary' icon={<UserPlus size={17}/>} onClick={() => document.getElementById('invite-panel')?.scrollIntoView({ behavior: 'smooth' })}>Invite member</Button>}</header><div className='team-layout'><section className='panel member-panel'><div className='panel-head'><div><h2>{data.members.length} anggota</h2><p>Admin mengelola akses, Supervisor melakukan review.</p></div></div><div className='member-list'>{data.members.map(member => <article key={member.id}><span className='avatar'>{member.name.slice(0, 2).toUpperCase()}</span><div className='member-name'><strong>{member.name}</strong><small>{member.email}</small></div><Badge tone={member.role === 'admin' ? 'cyan' : member.role === 'supervisor' ? 'warning' : 'muted'}>{roleLabel(member.role)}</Badge>{isAdmin && member.userId !== data.profile.userId ? <><CustomSelect compact value={member.role} onChange={nextRole => void updateMemberRole(member.id, nextRole as Role)} options={roleOptions} ariaLabel={`Role ${member.name}`}/><button className='icon-button danger-action' onClick={() => void removeMember(member.id, member.name)}><Trash2 size={16}/></button></> : <span className='you-label'>{member.userId === data.profile.userId ? 'You' : ''}</span>}</article>)}</div></section><aside className='panel invite-panel' id='invite-panel'><span className='invite-icon'><UserPlus /></span><h2>Invite anggota</h2><p>Buat link sekali pakai dengan role yang sudah ditentukan. Link aktif selama tujuh hari.</p>{isAdmin ? <><Field label='Email' hint='Wajib · link hanya dapat dipakai email ini'><input type='email' value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder='operator@company.com'/></Field><Field label='Role'><CustomSelect value={inviteRole} onChange={nextRole => setInviteRole(nextRole as Role)} options={inviteRoleOptions} ariaLabel='Role anggota baru'/></Field><Button variant='primary' icon={<Link2 size={16}/>} onClick={() => void createInvite()}>Generate invite link</Button>{inviteUrl && <div className='invite-result'><input readOnly value={inviteUrl}/><Button icon={<Copy size={15}/>} onClick={() => void copyText(inviteUrl, 'Link undangan disalin.')}>Copy</Button></div>}</> : <div className='settings-note'><ShieldCheck size={18}/><div><strong>Admin permission required</strong><p>Hubungi Admin untuk menambahkan anggota.</p></div></div>}</aside></div></div>;
    return <div className={`app-shell density-${density} ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''} ${focusMode ? 'focus-mode' : ''}`}><AuroraEffects /><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><div className='brand-lockup compact-brand'><span className='brand-mark'><Radio /></span><div><b>NOC Desk</b><small>Incident operations</small></div><button type='button' className='sidebar-collapse-toggle' aria-label={sidebarCollapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'} onClick={() => setSidebarCollapsed(current => !current)}>{sidebarCollapsed ? <ChevronRight size={15}/> : <ChevronLeft size={15}/>}</button></div><nav><small>Workspace</small>{navItems.filter(item => !item.hidden).map(item => <button key={item.id} className={view === item.id || (item.id === 'archive' && view === 'editor') ? 'active' : ''} aria-current={view === item.id || (item.id === 'archive' && view === 'editor') ? 'page' : undefined} title={sidebarCollapsed ? item.label : undefined} onClick={() => { setView(item.id); setMenuOpen(false); }}>{item.icon}<span>{item.label}</span>{item.id === 'operations' && opsUnread > 0 && <em>{Math.min(99, opsUnread)}</em>}{item.id === 'archive' && activeIncidents.length > 0 && <em>{activeIncidents.length}</em>}</button>)}</nav>{runningItems.length > 0 && <section className='sidebar-running-mini'><header><strong>Running TT</strong><span>{runningItems.length}</span></header>{runningItems.slice(0, 3).map(item => <button type='button' className={item.overdue ? 'overdue' : ''} key={item.incident.id} onClick={() => void switchIncident(item.incident)}><i /><span><strong>{item.incident.incidentId || item.incident.group || 'Active TT'}</strong><small>{item.incident.picName || item.incident.severity}</small></span><b>{item.overdue ? 'OVER' : 'LIVE'}</b></button>)}</section>}<div className='sidebar-bottom'><button className='theme-button' onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}<span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span></button><div className='profile-chip'><span>{data.profile.name.slice(0, 2).toUpperCase()}</span><div><strong>{data.profile.name}</strong><small>{roleLabel(data.profile.role)}</small></div><button onClick={() => void signOut()} title='Sign out'><LogOut size={16}/></button></div></div></aside>{menuOpen && <button className='sidebar-scrim' aria-label='Tutup menu' onClick={() => setMenuOpen(false)}/>}<main className='main-shell'>{view !== 'editor' && <CommandTopbar viewLabel={navItems.find(item => item.id === view)?.label || 'NOC Desk'} active={activeIncidents.length} critical={activeIncidents.filter(item => item.severity === 'Critical').length} overdue={activeIncidents.filter(item => incidentSlaState(item, data.settings, clock).overdue).length} opsUnread={opsUnread} density={density} onDensityChange={setDensity} onSearch={() => setCommandOpen(true)} onCreate={() => void createIncident()} onImport={() => setImportOpen(true)} onRunning={() => setRunningSwitcherOpen(true)}/>}<div className='mobile-topbar'><button aria-label='Buka menu' onClick={() => setMenuOpen(current => !current)}><Menu /></button><div><Radio /><span>{view === 'editor' ? 'Incident editor' : navItems.find(item => item.id === view)?.label || 'NOC Desk'}</span></div><button onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun /> : <Moon />}</button></div>{view === 'dashboard' && <PageErrorBoundary screenName="Dashboard"><DeferredScreen render={renderDashboard}/></PageErrorBoundary>}{view === 'operations' && <PageErrorBoundary screenName="Operations Center"><OperationsCenter signal={opsSignal} onOpenIncident={openIncident} onUnreadChange={setOpsUnread}/></PageErrorBoundary>}{view === 'reliability' && <PageErrorBoundary screenName="Reliability Analytics"><ReliabilityCenter signal={opsSignal}/></PageErrorBoundary>}{view === 'risk' && <PageErrorBoundary screenName="Risk Radar"><RiskRadar /></PageErrorBoundary>}{view === 'archive' && <PageErrorBoundary screenName="Archive"><DeferredScreen render={renderArchive}/></PageErrorBoundary>}{view === 'trash' && <PageErrorBoundary screenName="Trash"><DeferredScreen render={renderTrash}/></PageErrorBoundary>}{view === 'editor' && <PageErrorBoundary screenName="Incident Editor"><DeferredScreen render={renderEditor}/></PageErrorBoundary>}{view === 'tracker' && <PageErrorBoundary screenName="Cut Point Tracker"><CutPointTracker incidents={sortedIncidents} onOpenIncident={openIncident}/></PageErrorBoundary>}{view === 'handover' && <PageErrorBoundary screenName="Shift Handover"><ShiftHandoverCenter items={runningItems} onOpenIncident={openIncident}/></PageErrorBoundary>}{view === 'settings' && <PageErrorBoundary screenName="Settings"><DeferredScreen render={renderSettings}/></PageErrorBoundary>}{view === 'team' && <PageErrorBoundary screenName="Team Management"><DeferredScreen render={renderTeam}/></PageErrorBoundary>}</main><ParserImportModal open={importOpen} source={importText} reporter={user?.name || user?.email || ''} onSourceChange={setImportText} onClose={() => setImportOpen(false)} onConfirm={confirmParsedImport}/>{masterImportOpen && <div className='modal-backdrop' onClick={() => { if (!masterImportBusy) setMasterImportOpen(false); }}><div className='import-modal master-import-modal' onClick={event => event.stopPropagation()}><div className='modal-head'><div><span className='modal-icon'><FileSpreadsheet /></span><div><h2>Import route master database</h2><p>{masterFileName} · pilih worksheet dan pastikan mapping kolom benar sebelum disimpan.</p></div></div><button disabled={masterImportBusy} onClick={() => setMasterImportOpen(false)}><X /></button></div><div className='master-import-grid'><Field label='Worksheet'><CustomSelect value={masterSheetName} onChange={selectMasterSheet} options={masterSheetNames.map(name => ({ value: name, label: name }))} ariaLabel='Worksheet master data'/></Field><Field label='System Key column' hint='Auto-detected'><input value={systemKeyColumn} onChange={event => setSystemKeyColumn(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder='H'/></Field><Field label='Segment Route column' hint='Auto-detected'><input value={routeSegmentColumn} onChange={event => setRouteSegmentColumn(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder='A'/></Field></div><div className='master-import-summary'><div><strong>{masterImportPairs.length.toLocaleString('id-ID')}</strong><span>unique mapping terbaca</span></div><div><strong>{masterRowCount.toLocaleString('id-ID')}</strong><span>baris worksheet</span></div><div><strong>{systemKeyColumn || '—'} ↔ {routeSegmentColumn || '—'}</strong><span>kolom aktif</span></div></div><div className='master-preview-table'><div className='master-preview-head'><span>System Key</span><span>Segment Route</span></div>{masterImportPairs.slice(0, 7).map((pair, index) => <div className='master-preview-row' key={`${pair.systemKey}-${pair.routeSegment}-${index}`}><strong>{pair.systemKey}</strong><span>{pair.routeSegment}</span></div>)}{!masterImportPairs.length && <div className='master-preview-empty'>Belum ada pasangan valid dari kedua kolom ini.</div>}</div>{masterImportBusy && <div className='master-progress-wrap'><div className='master-progress'><span style={{ width: `${masterImportProgress}%` }}/></div><small>Uploading master data… {masterImportProgress}%</small></div>}<div className='modal-actions'><Button variant='ghost' onClick={() => setMasterImportOpen(false)} disabled={masterImportBusy}>Cancel</Button><Button variant='primary' icon={<Database size={16}/>} onClick={() => void importRouteMaster()} disabled={masterImportBusy || !masterImportPairs.length}>{routeMaster.length ? 'Replace database' : 'Import to database'}</Button></div></div></div>}{workspaceRestoreConfirmOpen && <div className='modal-backdrop' onClick={() => { if (!workspaceRestoreBusy) setWorkspaceRestoreConfirmOpen(false); }}>
<div className='import-modal master-import-modal' role='dialog' aria-modal='true' aria-labelledby='workspace-restore-title' onClick={event => event.stopPropagation()}>
<div className='modal-head'><div><span className='modal-icon'><ShieldCheck /></span><div><h2 id='workspace-restore-title'>Konfirmasi selective restore</h2><p>Backup: {workspaceImportFileName}</p></div></div><button type='button' disabled={workspaceRestoreBusy} onClick={() => setWorkspaceRestoreConfirmOpen(false)}><X /></button></div>
<div className='integration-meta'>
<strong>Perubahan yang akan dilakukan</strong>
{workspaceRestoreSelection.settings && <small>• Workspace Settings akan ditimpa seluruhnya dengan konfigurasi dari backup.</small>}
{workspaceRestoreSelection.routeMaster && <small>• {workspaceImportReport?.validation.counts.routeMasterPairs.toLocaleString('id-ID')} mapping Route Master akan diunggah, diverifikasi, lalu dijadikan batch aktif.</small>}
{workspaceRestoreSelection.routeMaster && <small>• Batch Route Master lama dipertahankan; pointer aktif baru diganti setelah verifikasi staging berhasil.</small>}
<strong>Data yang tidak akan disentuh</strong>
<small>Members, incidents, audit trail, dan version history tetap seperti sekarang.</small>
<small>Proses ini menulis data workspace. Pastikan file backup dan pilihan bagian sudah benar.</small>
</div>
{workspaceRestoreBusy && <div className='master-progress-wrap'><div className='master-progress'><span style={{ width: workspaceRestoreProgress.total ? Math.min(100, Math.round(workspaceRestoreProgress.completed / workspaceRestoreProgress.total * 100)) + '%' : '0%' }}/></div><small>{workspaceRestoreProgress.message || 'Menjalankan restore…'}</small></div>}
{workspaceRestoreResult && <div className='integration-meta restore-result'><strong>Status: {workspaceRestoreResult.status}</strong>{workspaceRestoreResult.errors?.map((item, index) => <small key={index}>• {item}</small>)}{workspaceRestoreResult.warnings?.map((item, index) => <small key={'w'+index}>• {item}</small>)}</div>}
<div className='modal-actions'><Button variant='ghost' onClick={() => setWorkspaceRestoreConfirmOpen(false)} disabled={workspaceRestoreBusy}>Batal</Button><Button variant='primary' icon={workspaceRestoreBusy ? <LoaderCircle className='spin' size={16}/> : <ShieldCheck size={16}/>} onClick={() => void executeWorkspaceBackupRestore()} disabled={workspaceRestoreBusy || !workspaceRestorePlan?.executable}>{workspaceRestoreBusy ? 'Memulihkan…' : 'Konfirmasi dan jalankan restore'}</Button></div>
</div></div>}<RunningWorkspaceSwitcher open={runningSwitcherOpen} onOpenChange={setRunningSwitcherOpen} items={runningItems} currentId={draft?.id} phrases={data.settings.progressPhrases} onOpenIncident={switchIncident} onQuickUpdate={quickUpdateIncident} onRemove={removeRunningIncident}/><GlobalIncidentSearch open={globalSearchOpen} onOpenChange={setGlobalSearchOpen} onOpenIncident={openIncident}/><AdaptiveCommandPalette open={commandOpen} commands={commandItems} onClose={() => setCommandOpen(false)}/><Toaster theme={theme === 'dark' ? 'dark' : 'light'} position='bottom-right' richColors closeButton expand={false} toastOptions={{ className: 'noc-toast' }}/></div>;
}
export default App;
