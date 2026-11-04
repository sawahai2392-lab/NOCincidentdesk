export type EscalationContact = {
  name: string;
  role: string;
  email: string;
};

export type EscalationCoordinator = EscalationContact & {
  key: string;
  area: string;
};

export type EscalationRule = {
  level: 1 | 2 | 3 | 4;
  hours: number;
  greeting: string;
  target: EscalationContact | null;
  ccAdd: EscalationContact[];
};

export const ESCALATION_COORDINATORS: EscalationCoordinator[] = [
  { key: 'all-jabotabek', area: 'All Jabotabek', name: 'Jaka Nugraha', role: 'Regional Coordinator', email: 'Jaka.Nugraha@mandau.id' },
  { key: 'jakarta', area: 'Jakarta', name: 'Suhendra', role: 'Regional Coordinator', email: 'suhendra.putra@mandau.id' },
  { key: 'bekasi-karawang', area: 'Bekasi-Karawang', name: 'Anjar Setiawan', role: 'Regional Coordinator', email: 'anjar.setiawan@mandau.id' },
  { key: 'depok-bogor-sukabumi', area: 'Depok-Bogor-Sukabumi', name: 'M. Adityo Permadi', role: 'Regional Coordinator', email: 'adityo.permadi@mandau.id' },
  { key: 'tangerang-banten', area: 'Tangerang-Banten', name: 'Kelik Budi Purwanto', role: 'Regional Coordinator', email: 'kelik.purwanto@mandau.id' },
];

export const ESCALATION_RULES: EscalationRule[] = [
  {
    level: 1,
    hours: 2,
    greeting: 'Dear Regional Coordinator',
    target: null,
    ccAdd: [
      { name: 'Helpdesk IFT', role: 'MOD Helpdesk', email: 'helpdesk@raiagrid.co.id' },
      { name: 'Arfan Dadi', role: 'HD Manager', email: 'Arfan.dadi@mandau.id' },
      { name: 'NOC Shift Leader', role: 'Shift Leader', email: 'Shift.leader1@mandau.id' },
    ],
  },
  {
    level: 2,
    hours: 4,
    greeting: 'Dear Zone Manager Area',
    target: { name: 'Jefri Fernando', role: 'Zone Manager', email: 'Jefri.fernando@mandau.id' },
    ccAdd: [
      { name: 'Joe Maruli Tua Sinagga', role: 'Manager of Quality Management', email: 'joe.sinaga@raiagrid.co.id' },
      { name: 'Wahyu Purnomo Sidi', role: 'Region Manager JABO & West Java', email: 'wahyu.sidi@raiagrid.co.id' },
    ],
  },
  {
    level: 3,
    hours: 6,
    greeting: 'Dear General Manager',
    target: { name: 'Fathul Fikri', role: 'General Manager', email: 'fathul.fikri@mandau.id' },
    ccAdd: [
      { name: 'Muhamad Ade Kurniawan', role: 'Head of Network Operation Assurance', email: 'muhamad.kurniawan@raiagrid.co.id' },
      { name: 'Norman', role: 'Head of Regional Network Operation', email: 'norman@raiagrid.co.id' },
      { name: 'I Gede Hendrawan', role: 'Deputy GM', email: 'hendrawan@mandau.id' },
    ],
  },
  {
    level: 4,
    hours: 8,
    greeting: 'Dear Account Director',
    target: { name: 'Jau Sheilla Ivon', role: 'Account Director', email: 'ella@mandau.id' },
    ccAdd: [
      { name: 'Yose Navirianto', role: 'VP of Network Operation', email: 'yose.navirianto@raiagrid.co.id' },
    ],
  },
];
