import { incidentSlaState, type Incident, type SettingsData } from './domain.ts';

export type SlaNoticeStage = 'due_soon' | 'overdue' | 'escalated' | 'critical';

export interface SlaNotice {
  incidentId: string;
  fingerprint: string;
  label: string;
  stage: SlaNoticeStage;
  level: 1 | 2 | 3;
  ageMinutes: number;
  limitMinutes: number;
  remainingMinutes: number;
  title: string;
  body: string;
}

const incidentLabel = (incident: Incident) => incident.identityMode === 'b2b'
  ? (incident.b2bTitle || incident.incidentId || 'B2B incident')
  : (incident.incidentId || `${incident.linkA || 'Link A'} ↔ ${incident.linkB || 'Link B'}`);

export function getSlaNotice(
  incident: Incident,
  settings: SettingsData,
  now = Date.now(),
): SlaNotice | null {
  if (incident.deletedAt || (incident.status !== 'Open' && incident.status !== 'Monitoring')) return null;

  const safeIncident = {
    ...incident,
    progress: Array.isArray(incident.progress) ? incident.progress : [],
  };
  const sla = incidentSlaState(safeIncident, settings, now);
  if (!Number.isFinite(sla.limitMinutes) || sla.limitMinutes <= 0) return null;

  const ratio = sla.ageMinutes / sla.limitMinutes;
  const remainingMinutes = sla.limitMinutes - sla.ageMinutes;
  let stage: SlaNoticeStage | null = null;
  let level: 1 | 2 | 3 = 1;

  if (ratio >= 3 || (incident.severity === 'Critical' && ratio >= 2)) {
    stage = 'critical';
    level = 3;
  } else if (ratio >= 2) {
    stage = 'escalated';
    level = 2;
  } else if (ratio >= 1) {
    stage = 'overdue';
    level = 1;
  } else if (remainingMinutes <= Math.max(2, Math.ceil(sla.limitMinutes * 0.25))) {
    stage = 'due_soon';
    level = 1;
  }

  if (!stage) return null;

  const label = incidentLabel(incident);
  const title = stage === 'due_soon'
    ? `SLA hampir terlewat · ${label}`
    : stage === 'overdue'
      ? `SLA terlewat · ${label}`
      : stage === 'escalated'
        ? `Eskalasi L2 · ${label}`
        : `Eskalasi L3 · ${label}`;
  const body = stage === 'due_soon'
    ? `Sisa SLA ${remainingMinutes} menit. Perbarui progress atau lakukan eskalasi sesuai kondisi.`
    : stage === 'overdue'
      ? `SLA terlewat ${Math.max(0, sla.ageMinutes - sla.limitMinutes)} menit. Update terakhir ${sla.ageMinutes} menit lalu.`
      : stage === 'escalated'
        ? `Usia update mencapai ${sla.ageMinutes} menit atau 2× batas SLA. Perlu perhatian Supervisor.`
        : `Usia update mencapai ${sla.ageMinutes} menit dan masuk level eskalasi tertinggi. Perlu perhatian segera.`;

  return {
    incidentId: incident.id,
    fingerprint: [incident.id, sla.lastUpdateAt, stage].join(':'),
    label,
    stage,
    level,
    ageMinutes: sla.ageMinutes,
    limitMinutes: sla.limitMinutes,
    remainingMinutes,
    title,
    body,
  };
}
