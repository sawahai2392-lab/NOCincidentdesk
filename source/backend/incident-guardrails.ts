export type GuardRole = 'admin' | 'supervisor' | 'operator';

type AnyIncident = Record<string, any>;
type AnySettings = Record<string, any>;

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const timeValue = (value: unknown) => { const parsed = Date.parse(clean(value)); return Number.isFinite(parsed) ? parsed : 0; };

export const normalizeIncidentKey = (value: unknown) => clean(value).toLowerCase().replace(/\s+/g, '');
export const incidentKeyHash = (value: string) => { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); };

const progressCore = (row: AnyIncident) => ({ id: clean(row?.id), date: clean(row?.date), time: clean(row?.time), text: clean(row?.text), pic: clean(row?.pic), milestone: clean(row?.milestone) });
const progressRows = (value: unknown) => Array.isArray(value) ? value : [];
const progressIds = (value: unknown) => progressRows(value).map(row => clean(row?.id));

export const progressHistoryChangeIsValid = (beforeValue: unknown, afterValue: unknown) => {
  const beforeIds = progressIds(beforeValue);
  const afterIds = progressIds(afterValue);
  if (beforeIds.some(id => !id) || new Set(beforeIds).size !== beforeIds.length) return false;
  if (afterIds.some(id => !id) || new Set(afterIds).size !== afterIds.length) return false;

  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);
  const retainedBefore = beforeIds.filter(id => afterSet.has(id));
  const retainedAfter = afterIds.filter(id => beforeSet.has(id));
  if (retainedBefore.length !== retainedAfter.length || retainedBefore.some((id, index) => id !== retainedAfter[index])) return false;

  const firstNewIndex = afterIds.findIndex(id => !beforeSet.has(id));
  if (firstNewIndex >= 0 && afterIds.slice(firstNewIndex).some(id => beforeSet.has(id))) return false;
  return true;
};

export const progressDeletionCount = (beforeValue: unknown, afterValue: unknown) => {
  const afterSet = new Set(progressIds(afterValue));
  return progressIds(beforeValue).filter(id => !afterSet.has(id)).length;
};

export const progressHasEdits = (beforeValue: unknown, afterValue: unknown) => {
  const afterById = new Map(progressRows(afterValue).map(row => [clean(row?.id), row]));
  return progressRows(beforeValue).some(row => {
    const nextRow = afterById.get(clean(row?.id));
    return Boolean(nextRow) && JSON.stringify(progressCore(row)) !== JSON.stringify(progressCore(nextRow));
  });
};

export const statusTransitionError = (current: AnyIncident, next: AnyIncident, role: GuardRole) => {
  if (current.status === next.status) return '';
  const allowed: Record<string, string[]> = { Draft: ['Open', 'Cancel'], Open: ['Monitoring', 'Resolved', 'Cancel'], Monitoring: ['Open', 'Resolved', 'Cancel'], Resolved: ['Closed', 'Open'], Closed: ['Open'], Cancel: ['Open'] };
  if (!(allowed[current.status] || []).includes(next.status)) return 'invalid_status_transition';
  const operatorAllowed = (current.status === 'Draft' && next.status === 'Open') || (current.status === 'Open' && next.status === 'Monitoring') || (current.status === 'Monitoring' && next.status === 'Open');
  if (role === 'operator' && !operatorAllowed) return 'supervisor_required_to_close';
  if ((current.status === 'Resolved' || current.status === 'Closed' || current.status === 'Cancel') && next.status === 'Open' && !clean(next.reopenReason)) return 'reopen_reason_required';
  return '';
};

export const validateIncidentServer = (incident: AnyIncident, current?: AnyIncident) => {
  if (incident.status !== 'Draft') {
    const b2b = clean(incident.identityMode).toLowerCase() === 'b2b';
    if (b2b) {
      if (!clean(incident.b2bTitle)) return 'b2b_title_required';
    } else {
      const hasLegacyIdentity = Boolean(current && (clean(current.incidentId) || (clean(current.group) && clean(current.linkA) && clean(current.linkB))));
      if (!clean(incident.titleOverride) && !hasLegacyIdentity) return 'title_required';
    }
  }
  const occurAt = timeValue(incident.occurTime);
  const dispatchAt = timeValue(incident.dispatchTime);
  const closedAt = timeValue(incident.closedTime);
  if (dispatchAt && occurAt && dispatchAt < occurAt) return 'dispatch_before_occur';
  const progress = Array.isArray(incident.progress) ? incident.progress : [];
  const latestProgressAt = progress.reduce((latest: number, row: AnyIncident) => Math.max(latest, timeValue(clean(row.date) + 'T' + clean(row.time))), 0);
  if (closedAt && latestProgressAt && closedAt < latestProgressAt) return 'closed_before_latest_progress';
  if (incident.status === 'Resolved' || incident.status === 'Closed') {
    if (!progress.some((row: AnyIncident) => /normal|closed|clear|recovered|recovery/i.test(clean(row.text)))) return 'recovery_update_required';
  }
  if (incident.status === 'Closed') {
    if (!closedAt) return 'closed_time_required';
    const checklist = incident.checklist || {};
    if (!['statementWag', 'ticketStatus', 'photo', 'rfo', 'closedEmail'].every(key => Boolean(checklist[key]))) return 'closing_checklist_incomplete';
    if (!clean(incident.closingEvidenceNote)) return 'closing_evidence_required';
  }
  if (current && current.deletedAt) return 'incident_in_trash';
  return '';
};

const ignored = new Set(['updatedAt', 'updatedBy', 'revision', 'geoCoordinates']);
export const changedFieldNames = (before?: AnyIncident, after?: AnyIncident) => {
  if (!before && after) return ['created'];
  if (before && !after) return ['deleted'];
  if (!before || !after) return [];
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(key => !ignored.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])).slice(0, 40);
};

export const incidentSlaState = (incident: AnyIncident, settings: AnySettings, now = Date.now()) => {
  const progress = Array.isArray(incident.progress) ? incident.progress : [];
  const lastProgressAt = progress.reduce((latest: number, row: AnyIncident) => Math.max(latest, timeValue(clean(row.date) + 'T' + clean(row.time))), 0) || timeValue(incident.occurTime) || Number(incident.createdAt) || now;
  const key = incident.severity === 'Critical' ? 'slaCriticalMinutes' : incident.severity === 'Major' ? 'slaMajorMinutes' : 'slaMinorMinutes';
  const limitMinutes = Math.max(5, Number(settings[key]) || (incident.severity === 'Critical' ? 15 : incident.severity === 'Major' ? 30 : 60));
  const ageMinutes = Math.max(0, Math.floor((now - lastProgressAt) / 60000));
  const active = incident.status === 'Open' || incident.status === 'Monitoring';
  return { active, overdue: active && ageMinutes >= limitMinutes, ageMinutes, limitMinutes, lastProgressAt, dueAt: lastProgressAt + limitMinutes * 60000 };
};
