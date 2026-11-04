import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  History,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import { api } from './platform/firebase-client';
import {
  formatIntegrityStatus,
  type WorkspaceIntegrityFinding,
  type WorkspaceIntegrityRepair,
  type WorkspaceIntegrityReport,
} from './workspace-integrity';
import './workspace-integrity.css';

type IntegrityRun = Record<string, unknown> & { id: string };
type ScanReport = WorkspaceIntegrityReport & { runId: string };
type ScanResponse = { report: ScanReport; history: IntegrityRun[] };
type RepairResponse = {
  runId: string;
  applied: number;
  skipped: number;
  errors: string[];
  history: IntegrityRun[];
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Permintaan integrity diagnostics gagal diproses.';
}

function runDate(value: unknown): string {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toLocaleString('id-ID')
    : 'Waktu tidak tersedia';
}

function severityLabel(severity: string): string {
  return severity === 'critical' ? 'Critical' : 'Warning';
}

function repairLabel(repair: WorkspaceIntegrityRepair): string {
  return repair.kind === 'create-incident-key'
    ? 'Buat kembali index incident'
    : 'Hapus index orphan';
}

function FindingRow({ finding }: { finding: WorkspaceIntegrityFinding }) {
  return (
    <article className={'integrity-finding integrity-' + finding.severity}>
      <span className="integrity-finding-icon">
        {finding.severity === 'critical' ? <ShieldAlert size={17} /> : <AlertTriangle size={17} />}
      </span>
      <div className="integrity-finding-copy">
        <div className="integrity-finding-title">
          <strong>{finding.title}</strong>
          <span>{severityLabel(finding.severity)}</span>
        </div>
        <p>{finding.detail}</p>
        <small>{finding.category.replace(/-/g, ' ')}{finding.entityId ? ' · ' + finding.entityId : ''}</small>
      </div>
    </article>
  );
}

export default function WorkspaceIntegrityPanel() {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [history, setHistory] = useState<IntegrityRun[]>([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [plan, setPlan] = useState<WorkspaceIntegrityRepair[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<RepairResponse | null>(null);
  const [error, setError] = useState('');

  async function runScan() {
    setScanBusy(true);
    setError('');
    try {
      const response = await api.get<ScanResponse>('/api/workspace-integrity/scan');
      setReport(response.data.report);
      setHistory(response.data.history || []);
      setPlan([]);
      setConfirming(false);
    } catch (scanError) {
      setError(errorText(scanError));
    } finally {
      setScanBusy(false);
    }
  }

  function prepareRepairPlan() {
    if (!report?.repairs.length) return;
    setPlan(report.repairs);
    setConfirming(false);
    setError('');
  }

  async function executeRepairs() {
    if (!plan.length || repairBusy) return;
    setRepairBusy(true);
    setError('');
    try {
      const response = await api.post<RepairResponse>('/api/workspace-integrity/repair', {
        operations: plan,
      });
      setResult(response.data);
      setHistory(response.data.history || []);
      setPlan([]);
      setConfirming(false);
      await runScan();
    } catch (repairError) {
      setError(errorText(repairError));
    } finally {
      setRepairBusy(false);
    }
  }

  return (
    <section className="panel settings-panel workspace-integrity-panel">
      <div className="panel-head integrity-panel-head">
        <div>
          <div className="integrity-eyebrow"><ShieldCheck size={14} /> ADMIN DIAGNOSTICS</div>
          <h2>Workspace Data Integrity</h2>
          <p>Audit relasi data workspace, deteksi index orphan, validasi audit/version, dan periksa batch Route Master.</p>
        </div>
        <button className="integrity-primary-button" type="button" onClick={() => void runScan()} disabled={scanBusy || repairBusy}>
          <RefreshCw size={15} className={scanBusy ? 'integrity-spin' : ''} />
          {scanBusy ? 'Scanning…' : report ? 'Run scan again' : 'Run diagnostics'}
        </button>
      </div>

      <div className="integrity-safety-note">
        <ShieldCheck size={16} />
        <span>Scan tidak mengubah data operasional. Hanya ringkasan diagnosis yang dicatat ke audit history. Repair selalu melalui dry-run, konfirmasi, dan pemeriksaan ulang transaksional.</span>
      </div>

      {error && <div className="integrity-error" role="alert"><AlertTriangle size={16} />{error}</div>}

      {report ? (
        <>
          <div className="integrity-status-row">
            <div className={'integrity-overall integrity-overall-' + report.status}>
              {report.status === 'healthy'
                ? <CheckCircle2 size={17} />
                : report.status === 'critical'
                  ? <ShieldAlert size={17} />
                  : <AlertTriangle size={17} />}
              <div><strong>{formatIntegrityStatus(report.status)}</strong><small>Scan {runDate(report.scannedAt)}</small></div>
            </div>
            <div className="integrity-run-id">Run ID <code>{report.runId}</code></div>
          </div>

          <div className="integrity-metrics">
            <div className="integrity-metric metric-critical"><span>Critical</span><strong>{report.counts.critical}</strong></div>
            <div className="integrity-metric metric-warning"><span>Warning</span><strong>{report.counts.warning}</strong></div>
            <div className="integrity-metric metric-healthy"><span>Healthy checks</span><strong>{report.counts.healthy}</strong></div>
          </div>

          <div className="integrity-coverage">
            <div className="integrity-section-heading"><strong>Scan coverage</strong><span>{report.coverage.partial ? 'Partial scan' : 'Bounded scan complete'}</span></div>
            <div className="integrity-coverage-grid">
              <div><strong>{report.coverage.membersScanned}</strong><small>Members</small></div>
              <div><strong>{report.coverage.incidentsScanned}</strong><small>Incidents</small></div>
              <div><strong>{report.coverage.incidentKeysScanned}</strong><small>Incident keys</small></div>
              <div><strong>{report.coverage.historyIncidentsScanned}</strong><small>History checked</small></div>
              <div><strong>{report.coverage.routeMasterChunksScanned}</strong><small>Route chunks</small></div>
              <div><strong>{report.coverage.restoreOperationsScanned}</strong><small>Restore ops</small></div>
            </div>
            {report.coverage.partial && <small className="integrity-coverage-warning">Sebagian koleksi mencapai batas scan. Jangan anggap hasil parsial sebagai bukti bahwa seluruh workspace bersih.</small>}
          </div>

          <div className="integrity-findings-section">
            <div className="integrity-section-heading">
              <strong>Diagnostic findings</strong>
              <span>{report.findings.length} temuan</span>
            </div>
            {report.findings.length ? (
              <div className="integrity-findings-list">
                {report.findings.map((finding) => <FindingRow key={finding.id} finding={finding} />)}
              </div>
            ) : (
              <div className="integrity-empty"><CheckCircle2 size={20} /><strong>Semua pemeriksaan yang dicakup lolos.</strong><small>Tidak ada temuan pada data yang berhasil discan.</small></div>
            )}
          </div>

          {report.repairs.length > 0 && (
            <div className="integrity-repair-area">
              <div className="integrity-repair-copy">
                <div><Wrench size={16} /><strong>{report.repairs.length} safe repair candidate</strong></div>
                <p>Hanya index incident yang hilang atau terbukti orphan. Tidak ada perubahan otomatis pada incident, audit, version, member, atau Route Master.</p>
              </div>
              <button type="button" className="integrity-secondary-button" onClick={prepareRepairPlan} disabled={repairBusy}>
                <ClipboardCheck size={15} /> Build dry-run plan
              </button>
            </div>
          )}

          {plan.length > 0 && (
            <div className="integrity-plan">
              <div className="integrity-section-heading">
                <strong>Dry-run repair plan</strong>
                <button type="button" className="integrity-close-button" onClick={() => { setPlan([]); setConfirming(false); }} disabled={repairBusy} aria-label="Cancel repair plan"><X size={16} /></button>
              </div>
              <p>{plan.length} operasi akan diperiksa ulang di Firestore sebelum dieksekusi. Operasi yang sudah berubah akan dilewati atau ditolak.</p>
              <div className="integrity-plan-list">
                {plan.map((item) => <div key={item.id}><span>{repairLabel(item)}</span><code>{item.incidentId || item.keyId}</code></div>)}
              </div>
              {!confirming ? (
                <button type="button" className="integrity-danger-button" onClick={() => setConfirming(true)} disabled={repairBusy}>
                  Review & confirm repairs
                </button>
              ) : (
                <div className="integrity-confirm">
                  <strong>Konfirmasi eksekusi repair</strong>
                  <p>Perintah ini akan membuat atau menghapus dokumen index incident yang sudah diverifikasi. Data incident dan riwayatnya tidak diubah.</p>
                  <div>
                    <button type="button" className="integrity-secondary-button" onClick={() => setConfirming(false)} disabled={repairBusy}>Kembali</button>
                    <button type="button" className="integrity-danger-button" onClick={() => void executeRepairs()} disabled={repairBusy}>
                      {repairBusy ? 'Repair berjalan…' : 'Confirm & execute'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="integrity-empty integrity-empty-start">
          <ClipboardCheck size={22} />
          <strong>Belum ada hasil diagnosis</strong>
          <small>Jalankan scan untuk membaca struktur workspace dan membangun daftar temuan.</small>
        </div>
      )}

      {result && (
        <div className="integrity-repair-result">
          <strong>Repair execution selesai</strong>
          <div><span>Applied</span><b>{result.applied}</b><span>Skipped</span><b>{result.skipped}</b><span>Errors</span><b>{result.errors.length}</b></div>
          {result.errors.map((item, index) => <small key={index}>{item}</small>)}
        </div>
      )}

      <div className="integrity-history">
        <div className="integrity-section-heading"><strong><History size={15} /> Diagnosis & repair history</strong><span>{history.length} record terbaru</span></div>
        {history.length ? history.slice(0, 10).map((run) => (
          <div className="integrity-history-row" key={run.id}>
            <span className={'integrity-history-kind ' + (run.kind === 'repair' ? 'repair' : 'scan')}>{run.kind === 'repair' ? 'Repair' : 'Scan'}</span>
            <div><strong>{String(run.status || 'unknown')}</strong><small>{runDate(run.createdAt)} · {String(run.createdByName || 'Admin')}</small></div>
            <code>{run.id}</code>
            {run.kind === 'scan' && <small>{Number(run.findingCount || 0)} findings</small>}
            {run.kind === 'repair' && <small>{Number(run.applied || 0)} applied · {Number(run.errorCount || 0)} errors</small>}
          </div>
        )) : <small className="integrity-history-empty">Riwayat akan muncul setelah scan atau repair pertama.</small>}
      </div>
    </section>
  );
}
