export type Role = 'admin' | 'supervisor' | 'operator';
export type IncidentStatus = 'Draft' | 'Open' | 'Monitoring' | 'Resolved' | 'Closed' | 'Cancel';

export interface Profile {
  id: string;
  userId: string;
  workspaceId: string;
  role: Role;
  email: string;
  name: string;
}

export interface Member extends Profile {
  joinedAt: number;
}

export interface Impact {
  id: string;
  text?: string;
  linkA?: string;
  linkB?: string;
  incidentId?: string;
  recovered: boolean;
}

export interface ProgressItem {
  id: string;
  date: string;
  time: string;
  text: string;
  pic: string;
  milestone: string;
  createdAt?: number;
  createdBy?: string;
  editedAt?: number;
  editedBy?: string;
  editCount?: number;
  autoparseBatchId?: string;
  autoparseDayOffset?: number;
}

export interface Attachment {
  id: string;
  path: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
  uploadedBy: string;
}

export interface GeoCoordinate {
  id: string;
  latitude: number;
  longitude: number;
  normalized: string;
  sourceName: string;
  rawCoordinate: string;
  extractedAt: number;
  extractedBy: string;
  confidence?: 'high' | 'medium';
  verified?: boolean;
  verifiedAt?: number;
  verifiedBy?: string;
}

export interface IncidentCutPoint {
  id: string;
  label: string;
  coordinate: GeoCoordinate | null;
}

export interface Checklist {
  statementWag: boolean;
  ticketStatus: boolean;
  photo: boolean;
  rfo: boolean;
  closedEmail: boolean;
}

export interface Incident {
  id: string;
  identityMode: 'standard' | 'b2b';
  b2bTitle: string;
  group: string;
  status: IncidentStatus;
  severity: 'Critical' | 'Major' | 'Minor';
  condition: 'DOWN' | 'UP - Degraded';
  linkA: string;
  linkB: string;
  routeSegment: string;
  systemKey: string;
  parentIncidentId: string;
  incidentId: string;
  titleOverride: string;
  mduTicket: string;
  occurTime: string;
  dispatchTime: string;
  closedTime: string;
  picArea: string;
  picName: string;
  rootCause: string;
  cutPoint: string;
  action: string;
  reporter: string;
  internalNotes: string;
  impacts: Impact[];
  progress: ProgressItem[];
  attachments: Attachment[];
  cutPoints: IncidentCutPoint[];
  geoCoordinates: GeoCoordinate[];
  checklist: Checklist;
  closingEvidenceNote: string;
  assignedToUserId: string;
  assignedToName: string;
  acknowledgedAt: number;
  acknowledgedBy: string;
  handoverNote: string;
  handoverAt: number;
  handoverBy: string;
  reopenReason: string;
  resolvedAt: number;
  resolvedBy: string;
  deletedAt: number;
  deletedBy: string;
  deleteReason: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  revision: number;
}

export interface SettingsData {
  id?: string;
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

export interface BootstrapData {
  profile: Profile;
  members: Member[];
  incidents: Incident[];
  incidentsNextToken?: string | null;
  settings: SettingsData;
}

export interface AuditEntry {
  id: string;
  action: string;
  summary: string;
  changedFields: string[];
  fromRevision: number;
  toRevision: number;
  actorId: string;
  actorName: string;
  createdAt: number;
}

export interface IncidentVersion {
  id: string;
  label: string;
  incident: Incident;
  createdAt: number;
  createdBy: string;
  createdByName: string;
}

export const defaultSettings: SettingsData = {
  groups: ['FLP_3rd_MANDAU', 'FLP_3rd_KARAWANG', 'FLP_3rd_JABODETABEK'],
  picAreas: ['Karawang Barat', 'Mandau', 'Jabodetabek'],
  picNames: ['Dede Sopian'],
  rootCauses: ['Impact Hit by Truck', 'FO Cut', 'Hardbending', 'Power Issue', 'Under Investigation'],
  actions: ['Splicing & Jumper', 'Splicing Permanent', 'Replace Patchcord', 'Re-route Traffic', 'Monitoring'],
  progressPhrases: ['We Already Open TT', 'Team Confirm prepare Tools', 'Team OTW lokasi', 'Team tiba di lokasi', 'Team proses pengecekan', 'Team proses pencarian physical CP', 'Team proses kupas kabel kedua sisi', 'Team proses setting JC', 'Team progress penyambungan', 'Confirm link normal TT closed'],
  sites: ['KARAWANG_CITY', 'KIIC', 'KARABAINDAH'],
  slaCriticalMinutes: 15,
  slaMajorMinutes: 30,
  slaMinorMinutes: 60,
  staleUpdateMinutes: 45
};

export const newId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const localDateTime = (date = new Date()) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
};

export const localDate = (date = new Date()) => localDateTime(date).slice(0, 10);
export const localTime = (date = new Date()) => localDateTime(date).slice(11, 16);

export const emptyIncident = (reporter = ''): Omit<Incident, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'revision' | 'attachments'> => ({
  identityMode: 'standard',
  b2bTitle: '',
  group: 'FLP_3rd_MANDAU',
  status: 'Draft',
  severity: 'Critical',
  condition: 'DOWN',
  linkA: '',
  linkB: '',
  routeSegment: '',
  systemKey: '',
  parentIncidentId: '',
  incidentId: '',
  titleOverride: '',
  mduTicket: '',
  occurTime: localDateTime(),
  dispatchTime: '',
  closedTime: '',
  picArea: '',
  picName: '',
  rootCause: '',
  cutPoint: '',
  action: '',
  reporter,
  internalNotes: '',
  impacts: [],
  progress: [],
  cutPoints: [],
  geoCoordinates: [],
  checklist: { statementWag: false, ticketStatus: false, photo: false, rfo: false, closedEmail: false },
  closingEvidenceNote: '',
  assignedToUserId: '',
  assignedToName: '',
  acknowledgedAt: 0,
  acknowledgedBy: '',
  handoverNote: '',
  handoverAt: 0,
  handoverBy: '',
  reopenReason: '',
  resolvedAt: 0,
  resolvedBy: '',
  deletedAt: 0,
  deletedBy: '',
  deleteReason: ''
});

const clean = (value: string) => value.trim();
const displayDate = (isoDate: string) => {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
};

export const displayDateTime = (value: string) => value ? `${displayDate(value.slice(0, 10))} ${value.slice(11, 16)}`.trim() : '';

export const incidentTitle = (incident: Incident) => (incident.identityMode || 'standard') === 'b2b' ? clean(incident.b2bTitle || '') : clean(incident.titleOverride) || `[${clean(incident.group)}][${incident.status} - ${incident.severity}] ${incident.condition} - ${clean(incident.linkA)}<>${clean(incident.linkB)} - ${clean(incident.incidentId)}`;

const impactText = (impact: Impact) => { const free = clean(impact.text || ''); if (free) return free; const links = [clean(impact.linkA || ''), clean(impact.linkB || '')].filter(Boolean).join('<>'); return [links, clean(impact.incidentId || '')].filter(Boolean).join(' - '); };

export const formatReport = (incident: Incident, includeEmoji = true) => {
  const lines: string[] = [`*${incidentTitle(incident)}*`, ''];
  const impactRows = incident.impacts.map(impact => ({ impact, text: impactText(impact) })).filter(item => item.text);
  if (impactRows.length) {
    lines.push('*Impact Link*');
    impactRows.forEach(({ impact, text }, index) => {
      const mark = includeEmoji && impact.recovered ? '✅' : '';
      lines.push(`${index + 1}. ${text}${mark}`);
    });
    lines.push('');
  }
  const detailRows: Array<[string, string]> = [
    ['Occur Time', displayDateTime(incident.occurTime)],
    ['Dispatch Time', displayDateTime(incident.dispatchTime)],
    ['System Key', clean(incident.systemKey)],
    ['Segment Route', clean(incident.routeSegment)],
    ['Assignee', clean(incident.assignedToName)],
    ['PIC', incident.picArea && incident.picName ? `${clean(incident.picArea)} (${clean(incident.picName)})` : clean(incident.picArea || incident.picName)],
    ['Rootcause', clean(incident.rootCause)],
    ['Cut Point', clean(incident.cutPoint)],
    ['Action', clean(incident.action)]
  ];
  detailRows.filter(([, value]) => value).forEach(([label, value]) => lines.push(`${label} = ${value}`));
  lines.push('', 'Update progress :');
  let activeDate = incident.occurTime.slice(0, 10);
  const progress = [...incident.progress].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  progress.forEach(item => {
    if (item.date && item.date !== activeDate) {
      lines.push('', `*${displayDate(item.date)}*`);
      activeDate = item.date;
    }
    lines.push(`${item.time} ${clean(item.text)}`.trim());
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const fromDisplayDateTime = (value: string) => { const cleanValue=value.trim(); const local=cleanValue.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[\sT,;-]+(\d{1,2})[:.](\d{2}))?/); if(local)return `${local[3]}-${local[2].padStart(2,'0')}-${local[1].padStart(2,'0')}T${(local[4]||'00').padStart(2,'0')}:${local[5]||'00'}`; const iso=cleanValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\sT]+(\d{1,2})[:.](\d{2}))?/); return iso?`${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}T${(iso[4]||'00').padStart(2,'0')}:${iso[5]||'00'}`:''; };

const stripReportMarkup=(value:string)=>value.trim().replace(/^[\s*_~`]+/,'').replace(/[\s*_~`]+$/,'').trim();
const reportStatus=(value:string,fallback:IncidentStatus):IncidentStatus=>{const key=value.trim().toLowerCase();const map:Record<string,IncidentStatus>={draft:'Draft',open:'Open',monitoring:'Monitoring',resolved:'Resolved',closed:'Closed',cancel:'Cancel',cancelled:'Cancel',canceled:'Cancel'};return map[key]||fallback;};
const reportSeverity=(value:string,fallback:Incident['severity']):Incident['severity']=>{const key=value.trim().toLowerCase();return key==='critical'?'Critical':key==='major'?'Major':key==='minor'?'Minor':fallback;};
const reportCondition=(value:string):Incident['condition']=>/degrad/i.test(value)?'UP - Degraded':'DOWN';
const reportDateHeading=(value:string)=>{const match=stripReportMarkup(value).match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);return match?`${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`:'';};
const addReportDay=(date:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return date;const next=new Date(`${date}T00:00:00Z`);next.setUTCDate(next.getUTCDate()+1);return next.toISOString().slice(0,10);};
const reportTimeMinutes=(time:string)=>{const [hour,minute]=time.split(':').map(Number);return hour*60+minute;};
const reportAreaLike=(value:string)=>/\b(?:area|timur|barat|utara|selatan|tengah|jakarta|serang|kendal|mandau|pekalongan|semarang|karawang|cikarang|bekasi|tangerang|bandung|surabaya|medan|sumatera|jawa|bali|batam|cangkudu|dukun|kalianda)\b/i.test(value);

export const parseReport = (source: string, reporter = '') => {
  const base=emptyIncident(reporter); const parsed={...base,occurTime:'',impacts:[] as Impact[],progress:[] as ProgressItem[]}; const lines=source.split(/\r?\n/).map(line=>stripReportMarkup(line)).filter(Boolean); const titleLine=(lines[0]||'').replace(/^(?:(?:contoh|example)\s*\d*|(?:fw|fwd|title|judul))\s*:\s*/i,'').trim();
  const mduMatch=source.match(/\bMDU-(\d{4})(\d{2})(\d{2})-\d+\b/i); if(mduMatch)parsed.mduTicket=mduMatch[0]; const mduDate=mduMatch?`${mduMatch[1]}-${mduMatch[2]}-${mduMatch[3]}`:'';
  const standard=titleLine.match(/^\[([^\]]+)\]\s*\[\s*([^\]-]+?)\s*-\s*(Critical|Major|Minor)\s*\]\s*(DOWN|UP\s*-\s*DEGRADED|DEGRADED)\s*-\s*(.+?)\s*<>\s*(.+?)\s*-\s*([A-Z0-9_-]*INC-\d{8}-\d+)\s*$/i);
  const dwdmPrefix=titleLine.match(/^\[([^\]]+)\]\s+LINK\s+(DOWN|UP\s*-\s*DEGRADED|DEGRADED)\s+AT\s+DWDM\s+(.+)$/i);
  if(standard){parsed.group=standard[1].trim();parsed.status=reportStatus(standard[2],parsed.status);parsed.severity=reportSeverity(standard[3],parsed.severity);parsed.condition=reportCondition(standard[4]);parsed.linkA=standard[5].trim();parsed.linkB=standard[6].trim();parsed.incidentId=standard[7].trim();}
  else if(dwdmPrefix){const tail=dwdmPrefix[3].match(/^(.+?)\s*<>\s*(.+?)(?:,\s*)?\[\s*TT\s*:?\s*([A-Z0-9_-]*INC-\d{8}-\d+)\s*\]\s*$/i);if(tail){let left=tail[1].trim();const parts=left.split(/\s+/);if(parts.length>1&&/^[A-Za-z]{2,12}$/.test(parts[0])&&/[\d_]/.test(parts[1]))left=parts.slice(1).join(' ');parsed.group=dwdmPrefix[1].trim();parsed.condition=reportCondition(dwdmPrefix[2]);parsed.linkA=left;parsed.linkB=tail[2].trim().replace(/\s*,\s*$/,'');parsed.incidentId=tail[3].trim();}else parsed.titleOverride=titleLine;}
  else if(titleLine.includes('|')&&(/\bSR#\s*\d+/i.test(titleLine)||/IOCH\s*Case#/i.test(titleLine))){parsed.identityMode='b2b';parsed.b2bTitle=titleLine;const condition=titleLine.match(/(?:^|\|)\s*(DOWN|UP\s*-\s*DEGRADED|DEGRADED)\s*(?:\||$)/i);if(condition)parsed.condition=reportCondition(condition[1]);const sr=titleLine.match(/\bSR#\s*(\d+)/i);if(sr)parsed.incidentId=`SR#${sr[1]}`;const code=titleLine.split('|').map(part=>part.trim()).find(part=>/^[A-Z0-9][A-Z0-9_.\/-]*(?:_[A-Z0-9_.\/-]+){2,}$/i.test(part));if(code)parsed.systemKey=code;}
  else if(titleLine){parsed.titleOverride=titleLine;const fallbackTicket=titleLine.match(/\b[A-Z0-9_-]*INC-\d{8}-\d+\b/i);if(fallbackTicket)parsed.incidentId=fallbackTicket[0];if(/\b(?:DOWN|DEGRADED)\b/i.test(titleLine))parsed.condition=reportCondition(titleLine);}
  let inImpact=false;let inProgress=false;let activeDate=mduDate||parsed.occurTime.slice(0,10);let lastProgressMinute:number|null=null;
  const pushProgress=(time:string,value:string,explicitDate='')=>{const text=value.trim();if(!text)return;const minute=reportTimeMinutes(time);let date=explicitDate||activeDate||mduDate||localDate();if(!explicitDate&&lastProgressMinute!==null&&minute<lastProgressMinute&&lastProgressMinute-minute>360)date=addReportDay(date);activeDate=date;lastProgressMinute=minute;parsed.progress.push({id:newId(),date,time,text,pic:'',milestone:''});const ticket=text.match(/\bMDU-\d{8}-\d+\b/i);if(ticket&&!parsed.mduTicket)parsed.mduTicket=ticket[0];};
  const pushImpact=(value:string)=>{let raw=stripReportMarkup(value).replace(/^(?:\d+[.)]|[-•▪◦])\s*/,'').trim();const recovered=/✅\s*$/.test(raw);if(recovered)raw=raw.replace(/✅\s*$/,'').trim();if(raw)parsed.impacts.push({id:newId(),text:raw,recovered});};
  lines.slice(1).forEach(rawLine=>{const cleanLine=stripReportMarkup(rawLine);const structural=cleanLine.replace(/[*_~`]/g,'').trim();
    const impactInline=structural.match(/^(?:impact(?:ed)?(?:\s+links?)?|impact\s+link|affected(?:\s+links?)?)\s*:\s*(.+)$/i);if(impactInline){inImpact=true;inProgress=false;pushImpact(impactInline[1]);return;}
    if(/^(?:impact(?:ed)?(?:\s+links?)?|impact\s+link|affected(?:\s+links?)?)\s*:?[\s]*$/i.test(structural)){inImpact=true;inProgress=false;return;}
    if(/^(?:update(?:\s+progress)?|progress(?:\s+update)?|timeline(?:\s+update)?)\s*:?[\s]*$/i.test(structural)){inProgress=true;inImpact=false;if(!activeDate)activeDate=mduDate||parsed.occurTime.slice(0,10);return;}
    const datedUpdate=structural.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\s+(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(?:[-–—:=]\s*)?(.+)$/);if(datedUpdate){inProgress=true;inImpact=false;const date=`${datedUpdate[3]}-${datedUpdate[2].padStart(2,'0')}-${datedUpdate[1].padStart(2,'0')}`;const time=`${datedUpdate[4].padStart(2,'0')}:${datedUpdate[5]}`;pushProgress(time,datedUpdate[6],date);return;}
    const heading=reportDateHeading(structural);if(heading){if(inProgress||parsed.progress.length){activeDate=heading;lastProgressMinute=null;inProgress=true;}return;}
    const field=structural.match(/^(occur(?:rence)?\s*time|dispatch\s*time|dispacth\s*time|dispach\s*time|dispath\s*time|despatch\s*time|pic|root\s*cause|rootcause|root\s*casue|cut\s*point|cutpoint|action)\s*(?:=|:|-)?\s+(.+)$/i);if(field){inImpact=false;const key=field[1].toLowerCase().replace(/[^a-z]/g,'');const value=field[2].trim();if(key.startsWith('occur')){const parsedDate=fromDisplayDateTime(value);if(parsedDate){parsed.occurTime=parsedDate;activeDate=parsedDate.slice(0,10);lastProgressMinute=null;}}else if(/^(dispatch|dispacth|dispach|dispath|despatch)/.test(key)){const parsedDate=fromDisplayDateTime(value);if(parsedDate)parsed.dispatchTime=parsedDate;}else if(key==='pic'){const pic=value.match(/^(.+?)\s*\((.+)\)$/);if(pic){const outer=pic[1].trim();const inner=pic[2].trim();if(reportAreaLike(inner)&&!reportAreaLike(outer)){parsed.picName=outer;parsed.picArea=inner;}else{parsed.picArea=outer;parsed.picName=inner;}}else parsed.picArea=value;}else if(key.startsWith('root'))parsed.rootCause=value;else if(key.startsWith('cut'))parsed.cutPoint=value;else if(key==='action')parsed.action=value;return;}
    const progress=structural.match(/^(?:[-•▪◦]\s*)?(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(?:[-–—:=]\s*)?(.+)$/);if(progress){inProgress=true;inImpact=false;const time=`${progress[1].padStart(2,'0')}:${progress[2]}`;pushProgress(time,progress[3]);return;}
    if(inImpact){pushImpact(cleanLine);return;}
  });
  return parsed;
};

export type ParserConfidenceLevel='high'|'medium'|'low';
export interface ParserFieldConfidence{key:string;label:string;value:string;confidence:number;level:ParserConfidenceLevel;reason:string;ambiguous:boolean}
export interface ParserAnalysis{parsed:ReturnType<typeof parseReport>;overall:number;level:ParserConfidenceLevel;fields:ParserFieldConfidence[];warnings:string[];needsAi:boolean;inputKind:'title-only'|'report';stats:{timestampLines:number;parsedProgress:number}}
const parserConfidenceLevel=(score:number):ParserConfidenceLevel=>score>=.86?'high':score>=.68?'medium':'low';
export const analyzeReport=(source:string,reporter=''):ParserAnalysis=>{const parsed=parseReport(source,reporter);const sourceLines=source.split(/\r?\n/).map(line=>stripReportMarkup(line)).filter(Boolean);const first=(sourceLines[0]||'').replace(/^(?:(?:contoh|example)\s*\d*|(?:fw|fwd|title|judul))\s*:\s*/i,'').trim();const standardTitle=/^\[[^\]]+\]\s*\[\s*[^\]-]+?\s*-\s*(?:Critical|Major|Minor)\s*\]/i.test(first);const dwdmTitle=/^\[[^\]]+\]\s+LINK\s+(?:DOWN|UP\s*-\s*DEGRADED|DEGRADED)\s+AT\s+DWDM/i.test(first);const pipeTitle=first.includes('|')&&(/\bSR#\s*\d+/i.test(first)||/IOCH\s*Case#/i.test(first));const structuredIdentity=parsed.identityMode==='b2b'?Boolean(parsed.b2bTitle):Boolean(parsed.group&&parsed.linkA&&parsed.linkB&&parsed.incidentId);const titleOnly=sourceLines.length===1&&Boolean(standardTitle||dwdmTitle||pipeTitle||structuredIdentity);const exactDispatch=sourceLines.some(line=>/^dispatch\s*time\s*(?:=|:|-)/i.test(line));const typoDispatch=sourceLines.some(line=>/^(?:dispacth|dispach|dispath|despatch)\s*time\s*(?:=|:|-)/i.test(line));const occurSeen=sourceLines.some(line=>/^occur(?:rence)?\s*time\s*(?:=|:|-)/i.test(line));const picLine=sourceLines.find(line=>/^pic\s*(?:=|:|-)\s*/i.test(line))||'';const picValue=picLine.replace(/^pic\s*(?:=|:|-)\s*/i,'').trim();const picPair=picValue.match(/^(.+?)\s*\((.+)\)$/);const picAmbiguous=Boolean(picPair&&reportAreaLike(picPair[1])===reportAreaLike(picPair[2]));const rootExact=sourceLines.some(line=>/^(?:rootcause|root\s*cause)\s*(?:=|:|-)/i.test(line));const rootTypo=sourceLines.some(line=>/^root\s*casue\s*(?:=|:|-)/i.test(line));const cutSeen=sourceLines.some(line=>/^(?:cut\s*point|cutpoint)\s*(?:=|:|-)/i.test(line));const impactHeader=sourceLines.some(line=>/^(?:impact(?:ed)?(?:\s+links?)?|impact\s+link|affected(?:\s+links?)?)\s*:?(?:\s|$)/i.test(line));const timestampLines=sourceLines.filter(line=>/^(?:[-•▪◦]\s*)?\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:[-–—:=]\s*)?\S+/i.test(line)).length;const hasMdu=/\bMDU-\d{8}-\d+\b/i.test(source);const fields:ParserFieldConfidence[]=[];const add=(key:string,label:string,value:string,confidence:number,reason:string,ambiguous=false)=>fields.push({key,label,value:value.slice(0,220),confidence,level:parserConfidenceLevel(confidence),reason,ambiguous});const titleValue=parsed.identityMode==='b2b'?parsed.b2bTitle:(parsed.incidentId?[parsed.group,parsed.linkA&&parsed.linkB?`${parsed.linkA} <> ${parsed.linkB}`:'',parsed.incidentId].filter(Boolean).join(' · '):parsed.titleOverride);const titleScore=standardTitle||dwdmTitle||pipeTitle?.97:parsed.titleOverride?.56:.2;add('title','Identity / title',titleValue,titleScore,standardTitle?'Standard title dikenali':dwdmTitle?'DWDM title dikenali':pipeTitle?'Pipe/SR/IOCH title dikenali':parsed.titleOverride?'Judul disimpan sebagai fallback bebas':'Judul tidak dikenali',titleScore<.68);const occurScore=titleOnly&&!occurSeen?.94:occurSeen?(parsed.occurTime?.98:.4):.2;add('occurTime','Occur Time',parsed.occurTime||'Belum tersedia',occurScore,titleOnly&&!occurSeen?'Title-only: Occur Time memang belum tersedia dan tidak diinvent oleh parser.':occurSeen?(parsed.occurTime?'Label dan waktu terbaca':'Label ditemukan tetapi waktu gagal dibaca'):'Label Occur Time tidak ditemukan',occurScore<.68);const dispatchScore=(exactDispatch||typoDispatch)?(parsed.dispatchTime?(exactDispatch?.97:.82):.38):.72;add('dispatchTime','Dispatch Time',parsed.dispatchTime||'Tidak ada',dispatchScore,exactDispatch?'Label Dispatch exact':typoDispatch?'Typo Dispatch ditoleransi':'Dispatch tidak ditemukan',Boolean(typoDispatch));const picScore=picLine?(parsed.picArea||parsed.picName?(picAmbiguous?.64:.9):.4):.72;add('pic','PIC',[parsed.picName,parsed.picArea].filter(Boolean).join(' · ')||'Tidak ada',picScore,picAmbiguous?'Nama dan area sama-sama terlihat seperti area/nama, perlu review':picLine?'PIC terbaca dengan heuristik name-area':'PIC tidak ditemukan',picAmbiguous);const rootScore=(rootExact||rootTypo)?(parsed.rootCause?(rootExact?.95:.82):.4):.76;add('rootCause','Root Cause',parsed.rootCause||'Tidak ada',rootScore,rootTypo?'Typo Root Casue ditoleransi':rootExact?'Root Cause terbaca':'Root Cause tidak ditemukan',Boolean(rootTypo));const cutScore=cutSeen?(parsed.cutPoint?.95:.4):.76;add('cutPoint','Cut Point',parsed.cutPoint||'Tidak ada',cutScore,cutSeen?'Cut Point terbaca':'Cut Point tidak ditemukan');const mduScore=hasMdu?(parsed.mduTicket?.99:.35):.92;add('mduTicket','MDU Ticket',parsed.mduTicket||'Tidak ada',mduScore,hasMdu?'MDU ditemukan dari seluruh report':'Tidak ada pola MDU pada source');const impactScore=impactHeader?(parsed.impacts.length?.96:.38):.9;add('impacts','Impact',`${parsed.impacts.length} item`,impactScore,impactHeader?'Section Impact terdeteksi':'Tidak ada section Impact',impactHeader&&!parsed.impacts.length);const progressRatio=timestampLines?parsed.progress.length/Math.max(1,timestampLines):1;const progressScore=timestampLines?Math.max(.28,Math.min(.98,progressRatio)):(parsed.progress.length?.78:.86);const dates=new Set(parsed.progress.map(item=>item.date).filter(Boolean));add('progress','Progress timeline',`${parsed.progress.length} update · ${dates.size||0} tanggal`,progressScore,timestampLines?`${parsed.progress.length}/${timestampLines} baris bertimestamp terbaca`:'Tidak ada baris timestamp yang terdeteksi',timestampLines>parsed.progress.length);const weights:{key:string;weight:number}[]=[{key:'title',weight:2.5},{key:'occurTime',weight:2},{key:'dispatchTime',weight:1},{key:'pic',weight:1},{key:'rootCause',weight:.75},{key:'cutPoint',weight:.75},{key:'mduTicket',weight:.5},{key:'impacts',weight:.75},{key:'progress',weight:2}];const totalWeight=weights.reduce((sum,item)=>sum+item.weight,0);const overall=Math.round(weights.reduce((sum,item)=>sum+(fields.find(field=>field.key===item.key)?.confidence||0)*item.weight,0)/totalWeight*100);const warnings:string[]=[];if(titleScore<.68)warnings.push('Format judul belum dapat dipetakan dengan yakin.');if(occurScore<.68)warnings.push('Occur Time perlu diperiksa sebelum draft dibuat.');if(picAmbiguous)warnings.push('Urutan PIC name/area ambigu.');if(timestampLines>parsed.progress.length)warnings.push(`${timestampLines-parsed.progress.length} baris bertimestamp belum berhasil dipetakan.`);if(impactHeader&&!parsed.impacts.length)warnings.push('Header Impact ditemukan tetapi item Impact belum terbaca.');if(parsed.dispatchTime&&parsed.occurTime&&parsed.dispatchTime<parsed.occurTime)warnings.push('Dispatch Time terbaca lebih awal dari Occur Time.');const level=parserConfidenceLevel(overall/100);return{parsed,overall,level,fields,warnings,needsAi:overall<78||warnings.length>1||fields.some(field=>field.ambiguous),inputKind:titleOnly?'title-only':'report',stats:{timestampLines,parsedProgress:parsed.progress.length}};};

export const validateIncident = (incident: Incident, incidents: Incident[] = []) => {
  const errors: string[] = [];
  const b2b = (incident.identityMode || 'standard') === 'b2b';
  if (b2b) {
    if (!clean(incident.b2bTitle || '')) errors.push('B2B Incident Title wajib diisi.');
  } else {
    if (!clean(incident.titleOverride) && !clean(incident.incidentId)) errors.push('Judul TT wajib diisi.');
  }
  if (incident.dispatchTime && incident.occurTime && incident.dispatchTime < incident.occurTime) errors.push('Dispatch time tidak boleh lebih awal dari occur time.');
  if (incidents.some(item => item.id !== incident.id && item.incidentId.trim() && item.incidentId.trim().toLowerCase() === incident.incidentId.trim().toLowerCase())) errors.push('Incident ID ini sudah digunakan pada report lain.');
  if (incident.status === 'Resolved' || incident.status === 'Closed') {
    if (!incident.progress.some(item => /normal|closed|clear|recovered|recovery/i.test(item.text))) errors.push('Tambahkan update recovery yang mengonfirmasi link normal atau TT closed.');
  }
  if (incident.status === 'Closed') {
    if (!incident.closedTime) errors.push('Closed time wajib diisi untuk status Closed.');
    if (!Object.values(incident.checklist).every(Boolean)) errors.push('Semua closing checklist wajib dikonfirmasi.');
    if (!clean(incident.closingEvidenceNote)) errors.push('Referensi bukti penutupan wajib diisi.');
  }
  const latestProgress = [...incident.progress].sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`))[0];
  if (incident.closedTime && latestProgress && incident.closedTime < `${latestProgress.date}T${latestProgress.time}`) errors.push('Closed time tidak boleh lebih awal dari update terakhir.');
  return errors;
};


const dateTimeMs = (value: string) => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0; };

export const latestProgressAt = (incident: Incident) => incident.progress.reduce((latest, item) => Math.max(latest, dateTimeMs((item.date || '') + 'T' + (item.time || ''))), 0) || dateTimeMs(incident.occurTime) || incident.createdAt;

export const incidentSlaState = (incident: Incident, settings: SettingsData, now = Date.now()) => {
  const limitMinutes = incident.severity === 'Critical' ? settings.slaCriticalMinutes : incident.severity === 'Major' ? settings.slaMajorMinutes : settings.slaMinorMinutes;
  const lastUpdateAt = latestProgressAt(incident);
  const ageMinutes = Math.max(0, Math.floor((now - lastUpdateAt) / 60000));
  const active = incident.status === 'Open' || incident.status === 'Monitoring';
  return { active, overdue: active && ageMinutes >= limitMinutes, ageMinutes, limitMinutes, lastUpdateAt, dueAt: lastUpdateAt + limitMinutes * 60000 };
};

export const incidentResolutionMinutes = (incident: Incident) => {
  const startedAt = dateTimeMs(incident.occurTime) || incident.createdAt;
  return incident.resolvedAt && startedAt ? Math.max(0, Math.round((incident.resolvedAt - startedAt) / 60000)) : null;
};

export const availableStatusOptions = (incident: Incident, role: Role): IncidentStatus[] => {
  if (role === 'operator') {
    if (incident.status === 'Draft') return ['Draft', 'Open'];
    if (incident.status === 'Open') return ['Open', 'Monitoring'];
    if (incident.status === 'Monitoring') return ['Monitoring', 'Open'];
    return [incident.status];
  }
  const transitions: Record<IncidentStatus, IncidentStatus[]> = { Draft: ['Draft', 'Open', 'Cancel'], Open: ['Open', 'Monitoring', 'Resolved', 'Cancel'], Monitoring: ['Monitoring', 'Open', 'Resolved', 'Cancel'], Resolved: ['Resolved', 'Closed', 'Open'], Closed: ['Closed', 'Open'], Cancel: ['Cancel', 'Open'] };
  return transitions[incident.status];
};

export const bytesLabel = (size: number) => size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;

export const statusTone = (status: IncidentStatus) => status === 'Closed' ? 'success' : status === 'Resolved' ? 'cyan' : status === 'Monitoring' ? 'warning' : status === 'Open' ? 'danger' : status === 'Cancel' ? 'cancel' : 'muted';

export const roleLabel = (role: Role) => role === 'admin' ? 'Admin' : role === 'supervisor' ? 'Supervisor' : 'Operator';
