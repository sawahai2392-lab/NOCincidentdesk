import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { CheckCircle2, Clock3, Copy, Download, ExternalLink, Mail, Users } from 'lucide-react';
import { ESCALATION_COORDINATORS as COORDINATORS, ESCALATION_RULES as LEVELS, type EscalationContact as Contact } from './escalation-contacts';

type IncidentLike = {
  id?: string;
  status?: string;
  severity?: string;
  condition?: string;
  identityMode?: string;
  b2bTitle?: string;
  titleOverride?: string;
  group?: string;
  linkA?: string;
  linkB?: string;
  incidentId?: string;
  mduTicket?: string;
  occurTime?: string;
  dispatchTime?: string;
  picArea?: string;
  picName?: string;
};

type Props = { incident: IncidentLike; now: number };

type BoundaryProps = { children: ReactNode };
type BoundaryState = { failed: boolean };

class EscalationBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Email escalation panel isolated an error.', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <section className='form-section escalation-email-section escalation-fallback'>
          <strong>Email escalation sementara tidak tersedia.</strong>
          <span>Incident Editor tetap aman. Reload halaman untuk mencoba lagi.</span>
        </section>
      );
    }
    return this.props.children;
  }
}

const safeText = (value: unknown, fallback = '-') => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
};

const parseOperationalDateTime = (value: string, referenceNow = Date.now()) => {
  const raw = safeText(value, '');
  if (!raw) return Number.NaN;

  if (/^\d{13}$/.test(raw)) return Number(raw);
  if (/^\d{10}$/.test(raw)) return Number(raw) * 1000;

  const localIso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/);
  if (localIso) {
    const [, year, month, day, hour, minute, second = '0'] = localIso;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
  }

  const localSlash = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[\s,T]+)(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/);
  if (localSlash) {
    const [, first, secondPart, year, hour, minute, second = '0'] = localSlash;
    const makeCandidate = (day: number, month: number) => {
      const date = new Date(Number(year), month - 1, day, Number(hour), Number(minute), Number(second));
      return date.getFullYear() === Number(year) && date.getMonth() === month - 1 && date.getDate() === day && date.getHours() === Number(hour) && date.getMinutes() === Number(minute) ? date.getTime() : Number.NaN;
    };
    const firstNumber = Number(first);
    const secondNumber = Number(secondPart);
    const candidates = [makeCandidate(firstNumber, secondNumber), makeCandidate(secondNumber, firstNumber)].filter(Number.isFinite) as number[];
    const uniqueCandidates = Array.from(new Set(candidates));
    if (uniqueCandidates.length === 1) return uniqueCandidates[0];
    if (uniqueCandidates.length > 1) {
      const futureToleranceMs = 5 * 60 * 1000;
      const pastCandidates = uniqueCandidates.filter(candidate => candidate <= referenceNow + futureToleranceMs);
      if (pastCandidates.length) return Math.max(...pastCandidates);
      return Math.min(...uniqueCandidates);
    }
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const formatDateTime = (value: string) => {
  if (!value) return '-';
  const timestamp = parseOperationalDateTime(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const durationLabel = (minutes: number) => {
  const safe = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${hours} Hrs${mins ? ` ${mins} Mins` : ''}`;
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const utf8Base64 = (value: string) => toBase64(new TextEncoder().encode(value));

const incidentNumber = (value: string) => {
  const raw = safeText(value, '');
  const match = raw.match(/INC-[A-Z0-9-]+/i);
  return match?.[0] || raw || '-';
};

const nmsLabel = (value: string) => {
  const raw = safeText(value, '');
  const match = raw.match(/([A-Z0-9_]+)-INC-/i);
  return match?.[1]?.toUpperCase() || 'FO';
};

const inferCoordinator = (incident: IncidentLike) => {
  const source = `${safeText(incident.picArea, '')} ${safeText(incident.group, '')} ${safeText(incident.linkA, '')} ${safeText(incident.linkB, '')}`.toLowerCase();
  if (/bekasi|karawang/.test(source)) return 'bekasi-karawang';
  if (/depok|bogor|sukabumi/.test(source)) return 'depok-bogor-sukabumi';
  if (/tangerang|banten/.test(source)) return 'tangerang-banten';
  if (/jakarta/.test(source)) return 'jakarta';
  if (/jabo|jabotabek/.test(source)) return 'all-jabotabek';
  return '';
};

const uniqueEmails = (contacts: Contact[], excluded = '') => {
  const seen = new Set<string>();
  const blocked = excluded.toLowerCase();
  return contacts
    .map(contact => contact.email.trim())
    .filter(email => {
      const key = email.toLowerCase();
      if (!key || key === blocked || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

function EscalationContent({ incident, now }: Props) {
  const status = safeText(incident.status, 'Draft');
  const severity = safeText(incident.severity, 'Major');
  const condition = safeText(incident.condition, 'DOWN');
  const active = !['Draft', 'Resolved', 'Closed', 'Cancel'].includes(status);
  const dispatchAt = parseOperationalDateTime(safeText(incident.dispatchTime, ''), now);
  const hasValidDispatchTime = Number.isFinite(dispatchAt);
  const durationMinutes = hasValidDispatchTime ? Math.max(0, Math.floor((now - dispatchAt) / 60000)) : 0;
  const autoLevel = active && hasValidDispatchTime ? ([...LEVELS].reverse().find(rule => durationMinutes >= rule.hours * 60)?.level || 0) : 0;
  const [coordinatorKey, setCoordinatorKey] = useState('');

  useEffect(() => {
    let stored = '';
    try {
      stored = window.localStorage.getItem(`noc-escalation-coordinator:${incident.id}`) || '';
    } catch {
      stored = '';
    }
    const validStored = COORDINATORS.some(item => item.key === stored) ? stored : '';
    setCoordinatorKey(validStored || inferCoordinator(incident));
  }, [incident.id, incident.picArea, incident.group, incident.linkA, incident.linkB]);

  const coordinator = COORDINATORS.find(item => item.key === coordinatorKey) || null;
  const levelMeta = autoLevel ? LEVELS.find(rule => rule.level === autoLevel) || null : null;
  const target = levelMeta ? (levelMeta.level === 1 ? coordinator : levelMeta.target) : null;

  const cumulativeContacts = useMemo(() => {
    if (!autoLevel) return [] as Contact[];
    const contacts: Contact[] = [];
    LEVELS.filter(rule => rule.level <= autoLevel).forEach(rule => {
      if (rule.level === 1 && coordinator) contacts.push(coordinator);
      if (rule.level > 1 && rule.level < autoLevel && rule.target) contacts.push(rule.target);
      contacts.push(...rule.ccAdd);
    });
    return contacts;
  }, [autoLevel, coordinator]);

  const cc = target ? uniqueEmails(cumulativeContacts, target.email) : [];
  const iohNumber = incidentNumber(safeText(incident.incidentId, ''));
  const linkA = safeText(incident.linkA, 'Link A');
  const linkB = safeText(incident.linkB, 'Link B');
  const ttTitle = safeText(incident.identityMode, 'standard') === 'b2b'
    ? safeText(incident.b2bTitle || incident.titleOverride, `${condition} - ${linkA}<>${linkB} - ${safeText(incident.incidentId)}`)
    : `${condition} - ${linkA}<>${linkB} - ${safeText(incident.incidentId)}`;
  const area = safeText(incident.picArea || coordinator?.area || incident.group);
  const serpo = [safeText(incident.picArea, ''), incident.picName ? `(${incident.picName})` : ''].filter(Boolean).join(' ') || '-';
  const brand = safeText(incident.group, 'MANDAU').replace(/^FLP_3rd_/i, '').toUpperCase();
  const hoursThreshold = levelMeta?.hours || 0;
  const subject = levelMeta
    ? `Escalation > ${hoursThreshold} Hours [${brand}] ${nmsLabel(safeText(incident.incidentId, ''))} Trouble Ticket ${status} - ${severity} - ${linkA}<>${linkB} - ${condition} [TT:${iohNumber}]`
    : '';
  const body = levelMeta
    ? `${levelMeta.greeting},\n\nWe would like to escalate a ${severity.toLowerCase()} issue regarding a fiber optic link outage that is currently impacting our network services. Immediate attention and support from your team are highly required to expedite the restoration process.\n\nPlease find the detailed information below:\n\nTT Number IOH\n${iohNumber}\n\nTT Number MDU\n${safeText(incident.mduTicket)}\n\nTT Title\n${ttTitle}\n\nArea\n${area}\n\nDispatch Time\n${formatDateTime(safeText(incident.dispatchTime, ''))}\n\nSerpo\n${serpo}\n\nStatus\n${status}\n\nDuration\n${durationLabel(durationMinutes)}\n\nKindly request your immediate escalation support to accelerate service restoration.\n\nBest Regards,\nNOC Mandau\nMATOA | Mapping and AI-Powered Tracking of Optical Assets`
    : '';

  const nextLevel = LEVELS.find(rule => durationMinutes < rule.hours * 60);
  const remainingMinutes = nextLevel ? Math.max(0, nextLevel.hours * 60 - durationMinutes) : 0;
  const canCompose = Boolean(levelMeta && coordinator && target);

  const chooseCoordinator = (value: string) => {
    setCoordinatorKey(value);
    try {
      const key = `noc-escalation-coordinator:${incident.id}`;
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch {
      // Selection still works for the current session if storage is unavailable.
    }
  };

  const mailRows = levelMeta ? [
    ['TT Number IOH', iohNumber],
    ['TT Number MDU', safeText(incident.mduTicket)],
    ['TT Title', ttTitle],
    ['Area', area],
    ['Dispatch Time', formatDateTime(safeText(incident.dispatchTime, ''))],
    ['Serpo', serpo],
    ['Status', status],
    ['Duration', durationLabel(durationMinutes)],
  ] : [];
  const richHtml = levelMeta ? `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:normal;color:#000000"><p style="margin:0 0 12pt 0"><b>${escapeHtml(levelMeta.greeting)}</b></p><p style="margin:0 0 12pt 0">We would like to escalate a ${escapeHtml(severity.toLowerCase())} issue regarding a fiber optic link outage that is currently impacting our network services. Immediate attention and support from your team are highly required to expedite the restoration process.</p><p style="margin:0 0 12pt 0">Please find the detailed information below:</p><p style="margin:0 0 12pt 0">&nbsp;</p><table role="presentation" border="0" cellspacing="0" cellpadding="0" width="880" style="width:660pt;margin-left:-.05pt;border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt;color:#000000">${mailRows.map(([label, value]) => `<tr style="height:15.6pt"><td width="148" nowrap style="width:111pt;background:#E7E6E6;padding:0 5.4pt;height:15.6pt"><b>${escapeHtml(label)}</b></td><td width="13" nowrap style="width:10pt;padding:0 5.4pt;height:15.6pt"><b>:</b></td><td width="719" style="width:539pt;padding:0 5.4pt;height:15.6pt"><b>${escapeHtml(value)}</b></td></tr>`).join('')}</table><p style="margin:12pt 0">Kindly request your immediate escalation support to accelerate service restoration.</p><p style="margin:0 0 12pt 0">&nbsp;</p><p style="margin:0 0 12pt 0">&nbsp;</p><p style="margin:0 0 12pt 0">Best Regards,</p><p style="margin:0 0 8pt 0"><b>NOC Mandau</b></p><p style="margin:6pt 0 0 0;font-size:10pt"><b>MATOA | Mapping and AI-Powered Tracking of Optical Assets</b></p></div>` : '';

  const copyTemplate = async () => {
    if (!body) return;
    try {
      if (richHtml && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([richHtml], { type: 'text/html' }),
            'text/plain': new Blob([body], { type: 'text/plain' }),
          }),
        ]);
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(body);
        return;
      }
    } catch {
      // Fallback below.
    }
    const textarea = document.createElement('textarea');
    textarea.value = body;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  };

  const downloadOutlookDraft = async () => {
    if (!canCompose || !target || !richHtml) return;
    const eml = `X-Unsent: 1\r\nTo: ${target.email}\r\n${cc.length ? `Cc: ${cc.join(', ')}\r\n` : ''}Subject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${utf8Base64(`<!doctype html><html><body>${richHtml}</body></html>`)}\r\n`;
    const blob = new Blob([eml], { type: 'message/rfc822;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Escalation-Level-${levelMeta?.level || 0}-${iohNumber.replace(/[^A-Za-z0-9_-]+/g, '-')}.eml`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const openOutlook = async () => {
    if (!canCompose || !target) return;
    await copyTemplate();
    const query = [cc.length ? `cc=${encodeURIComponent(cc.join(','))}` : '', `subject=${encodeURIComponent(subject)}`].filter(Boolean).join('&');
    window.location.href = `mailto:${encodeURIComponent(target.email)}?${query}`;
  };

  return (
    <section className='form-section escalation-email-section'>
      <div className='section-title escalation-title'>
        <span>ESC</span>
        <div>
          <h2>Email escalation</h2>
          <p>Level otomatis berdasarkan durasi TT. CC bertambah kumulatif di setiap level.</p>
        </div>
        <div className={`escalation-live-badge level-${autoLevel || 0}`}>
          <Clock3 size={14} />
          <b>{hasValidDispatchTime ? durationLabel(durationMinutes) : 'Dispatch Time invalid'}</b>
        </div>
      </div>

      <div className='escalation-steps'>
        {LEVELS.map(rule => {
          const reached = active && durationMinutes >= rule.hours * 60;
          const current = rule.level === autoLevel;
          return (
            <div key={rule.level} className={`escalation-step ${reached ? 'reached' : ''} ${current ? 'current' : ''}`}>
              <span>L{rule.level}</span>
              <strong>{rule.hours}h</strong>
              <small>{rule.greeting.replace('Dear ', '')}</small>
              {reached ? <CheckCircle2 size={15} /> : <i />}
            </div>
          );
        })}
      </div>

      <div className='escalation-grid'>
        <div className='escalation-config'>
          <label className='escalation-field'>
            <span>Regional Coordinator <em>required</em></span>
            <select value={coordinatorKey} onChange={event => chooseCoordinator(event.target.value)}>
              <option value=''>Pilih coordinator area…</option>
              {COORDINATORS.map(item => <option key={item.key} value={item.key}>{item.area} — {item.name}</option>)}
            </select>
            <small>Menjadi tujuan Level 1 dan otomatis tetap masuk CC pada level berikutnya.</small>
          </label>

          {levelMeta ? (
            <div className='escalation-recipient-card'>
              <div className='escalation-recipient-head'><Mail size={18} /><span><small>Level aktif</small><strong>Level {levelMeta.level} · {levelMeta.greeting.replace('Dear ', '')}</strong></span></div>
              <dl>
                <div><dt>TO</dt><dd>{target ? <><b>{target.name}</b><span>{target.email}</span></> : <span>Pilih Regional Coordinator</span>}</dd></div>
                <div><dt>CC</dt><dd><b>{cc.length} recipients</b><span>Akumulasi Level 1 → {levelMeta.level}</span></dd></div>
              </dl>
            </div>
          ) : (
            <div className='escalation-wait-card'>
              <Clock3 size={19} />
              <div>
                <strong>{active ? 'Belum masuk Level 1' : 'Eskalasi tidak aktif'}</strong>
                <p>{active && nextLevel ? `Level ${nextLevel.level} aktif dalam ${Math.floor(remainingMinutes / 60)}j ${remainingMinutes % 60}m.` : 'TT Draft, Resolved, Closed, atau Cancel tidak dieskalasi.'}</p>
              </div>
            </div>
          )}

          {levelMeta && (
            <details className='escalation-cc-list'>
              <summary><Users size={15} /> Lihat {cc.length} CC kumulatif</summary>
              <div>{cc.map(email => <code key={email}>{email}</code>)}</div>
            </details>
          )}

          <div className='escalation-actions'>
            <button type='button' className='escalation-button secondary' disabled={!levelMeta} onClick={() => void copyTemplate()}><Copy size={16} />Copy styled email</button>
            <button type='button' className='escalation-button secondary' disabled={!canCompose} onClick={() => void downloadOutlookDraft()}><Download size={16} />Outlook draft (.eml)</button>
            <button type='button' className='escalation-button primary' disabled={!canCompose} onClick={() => void openOutlook()}><ExternalLink size={16} />Open Outlook + copy HTML</button>
          </div>
          {!coordinator && levelMeta && <p className='escalation-warning'>Pilih Regional Coordinator sebelum membuka Outlook.</p>}
        </div>

        <div className='escalation-preview'>
          <div className='escalation-preview-head'><span><Mail size={16} />Email preview</span>{levelMeta && <b>Auto · Level {levelMeta.level}</b>}</div>
          {levelMeta ? (
            <div className='escalation-mail-body'>
              <small>SUBJECT</small>
              <strong className='escalation-subject'>{subject}</strong>
              <div className='outlook-message-preview'>
                <p><b>{levelMeta.greeting}</b></p>
                <p>We would like to escalate a {severity.toLowerCase()} issue regarding a fiber optic link outage that is currently impacting our network services. Immediate attention and support from your team are highly required to expedite the restoration process.</p>
                <p>Please find the detailed information below:</p>
                <div className='outlook-preview-scroll'><table className='outlook-detail-table'><tbody>{mailRows.map(([label, value]) => <tr key={label}><td><b>{label}</b></td><td><b>:</b></td><td><b>{value}</b></td></tr>)}</tbody></table></div>
                <p>Kindly request your immediate escalation support to accelerate service restoration.</p>
                <div className='outlook-signature'><p>Best Regards,</p><p><b>NOC Mandau</b></p><p><b>MATOA | Mapping and AI-Powered Tracking of Optical Assets</b></p></div>
              </div>
            </div>
          ) : (
            <div className='escalation-preview-empty'><Mail size={22} /><strong>{hasValidDispatchTime ? 'Template aktif saat TT mencapai 2 jam' : 'Dispatch Time belum valid'}</strong><p>{hasValidDispatchTime ? 'Durasi dihitung realtime dari Dispatch Time.' : 'Periksa nilai Dispatch Time. Format DD/MM/YYYY HH:mm, DD-MM-YYYY HH:mm, dan ISO didukung.'}</p></div>
          )}
        </div>
      </div>
      <p className='escalation-outlook-note'>Template sekarang mengikuti struktur Outlook .msg: Arial 11pt, tabel detail abu-abu, value bold, spacing, dan signature. Tombol Open Outlook mengisi TO/CC/Subject lalu menyalin body HTML ke clipboard; tekan Ctrl+V di compose Outlook untuk mempertahankan styling. Untuk fidelity tertinggi di Classic Outlook, gunakan Outlook draft (.eml).</p>
    </section>
  );
}

export default function EscalationEmailPanel(props: Props) {
  return <EscalationBoundary><EscalationContent {...props} /></EscalationBoundary>;
}
