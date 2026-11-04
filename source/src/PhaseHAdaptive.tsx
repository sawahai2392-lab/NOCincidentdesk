import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Clock3, History, Link2, MapPin, Radio, Search } from 'lucide-react';
import { incidentSlaState, incidentTitle, type Incident, type SettingsData } from './domain';

export type AdaptiveCommand = {
  id: string;
  label: string;
  detail: string;
  group: string;
  keywords?: string;
  shortcut?: string;
  run: () => void | Promise<void>;
};

export type SectionKey =
  | 'identity'
  | 'handling'
  | 'impact'
  | 'timeline'
  | 'cutpoints'
  | 'evidence';

type AdaptiveCommandPaletteProps = {
  open: boolean;
  commands: AdaptiveCommand[];
  onClose: () => void;
};

export function AdaptiveCommandPalette({
  open,
  commands,
  onClose,
}: AdaptiveCommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('noc-command-recent') || '[]');
      return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string').slice(0, 6)
        : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();

    if (clean) {
      return commands.filter((item) =>
        `${item.label} ${item.detail} ${item.group} ${item.keywords || ''}`
          .toLowerCase()
          .includes(clean),
      );
    }

    const recentItems = recent
      .map((id) => commands.find((item) => item.id === id))
      .filter((item): item is AdaptiveCommand => Boolean(item));

    return [
      ...recentItems,
      ...commands.filter((item) => !recent.includes(item.id)),
    ];
  }, [commands, query, recent]);

  if (!open) return null;

  const execute = (command: AdaptiveCommand) => {
    const next = [command.id, ...recent.filter((id) => id !== command.id)].slice(0, 6);
    setRecent(next);
    localStorage.setItem('noc-command-recent', JSON.stringify(next));
    onClose();
    void Promise.resolve(command.run()).catch(() => {});
  };

  return (
    <div className='adaptive-command-backdrop' onClick={onClose}>
      <section
        className='adaptive-command-palette'
        role='dialog'
        aria-modal='true'
        aria-label='Command Palette'
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((value) => Math.min(filtered.length - 1, value + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((value) => Math.max(0, value - 1));
              } else if (event.key === 'Enter' && filtered[active]) {
                event.preventDefault();
                execute(filtered[active]);
              }
            }}
            placeholder='Cari command, halaman, atau action…'
          />
          <kbd>ESC</kbd>
        </header>

        <div className='adaptive-command-list'>
          {filtered.length ? (
            filtered.map((item, index) => (
              <button
                type='button'
                key={item.id}
                className={`adaptive-command-item ${index === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => execute(item)}
              >
                <span>{item.group.slice(0, 2).toUpperCase()}</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </button>
            ))
          ) : (
            <div className='adaptive-command-empty'>
              <Search size={22} />
              <strong>Tidak ada command yang cocok</strong>
              <small>Coba kata seperti incident, map, risk, import, focus, atau theme.</small>
            </div>
          )}
        </div>

        <footer>
          <span><kbd>↑</kbd><kbd>↓</kbd> pilih</span>
          <span><kbd>Enter</kbd> jalankan</span>
          <span>Recent command diprioritaskan saat pencarian kosong.</span>
        </footer>
      </section>
    </div>
  );
}

type AttentionRibbonProps = {
  incidents: Incident[];
  settings: SettingsData;
  now: number;
  onOpen: (incident: Incident) => void;
};

export function AttentionRibbon({
  incidents,
  settings,
  now,
  onOpen,
}: AttentionRibbonProps) {
  const rows = useMemo(
    () =>
      incidents
        .map((incident) => {
          const sla = incidentSlaState(incident, settings, now);
          const reasons: string[] = [];
          let score = 0;

          if (sla.overdue) {
            score += 120;
            reasons.push(`SLA overdue ${Math.max(0, sla.ageMinutes - sla.limitMinutes)}m`);
          }

          if (incident.severity === 'Critical') {
            score += 70;
            reasons.push('Critical severity');
          } else if (incident.severity === 'Major') {
            score += 25;
          }

          if (!incident.assignedToUserId) {
            score += 35;
            reasons.push('Unassigned');
          }

          if (!incident.progress.length) {
            score += 25;
            reasons.push('Belum ada progress');
          } else if (!sla.overdue && sla.ageMinutes >= Math.max(5, settings.staleUpdateMinutes)) {
            score += 30;
            reasons.push(`Update stale ${sla.ageMinutes}m`);
          }

          return { incident, score, reasons };
        })
        .filter((item) => item.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score || b.incident.updatedAt - a.incident.updatedAt,
        )
        .slice(0, 4),
    [incidents, settings, now],
  );

  if (!rows.length) return null;

  return (
    <section className='attention-ribbon'>
      <header>
        <div>
          <Radio size={15} />
          <span>
            <strong>Attention now</strong>
            <small>TT yang paling butuh mata operator saat ini</small>
          </span>
        </div>
        <b>{rows.length}</b>
      </header>

      <div>
        {rows.map((row) => (
          <button
            type='button'
            key={row.incident.id}
            className={row.score >= 100 ? 'urgent' : ''}
            onClick={() => onOpen(row.incident)}
          >
            <span>
              <b>{row.incident.severity}</b>
              <small>{row.incident.status}</small>
            </span>
            <strong>{row.incident.incidentId || incidentTitle(row.incident)}</strong>
            <p>{row.reasons.slice(0, 2).join(' · ')}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

type AdaptiveSectionNavProps = {
  incident: Incident;
  onSelect: (section: SectionKey) => void;
};

export function AdaptiveSectionNav({
  incident,
  onSelect,
}: AdaptiveSectionNavProps) {
  const identityReady =
    incident.identityMode === 'b2b'
      ? Boolean(incident.b2bTitle?.trim())
      : Boolean(incident.group && incident.linkA && incident.linkB && incident.incidentId);
  const handlingReady = Boolean(incident.occurTime && incident.picName);
  const verified = (incident.cutPoints || []).filter(
    (item) => item.coordinate && item.coordinate.verified !== false,
  ).length;
  const totalCp = (incident.cutPoints || []).length;
  const checklist = Object.values(incident.checklist || {}).filter(Boolean).length;

  const sections: Array<{
    key: SectionKey;
    label: string;
    meta: string;
    tone: 'ready' | 'warn' | 'info';
    icon: ReactNode;
  }> = [
    {
      key: 'identity',
      label: 'Identity',
      meta: identityReady ? 'Ready' : 'Incomplete',
      tone: identityReady ? 'ready' : 'warn',
      icon: <Radio size={14} />,
    },
    {
      key: 'handling',
      label: 'Handling',
      meta: handlingReady ? 'Ready' : 'Need data',
      tone: handlingReady ? 'ready' : 'warn',
      icon: <Clock3 size={14} />,
    },
    {
      key: 'impact',
      label: 'Impact',
      meta: `${incident.impacts.length} link`,
      tone: incident.impacts.length ? 'ready' : 'info',
      icon: <Link2 size={14} />,
    },
    {
      key: 'timeline',
      label: 'Timeline',
      meta: `${incident.progress.length} update`,
      tone: incident.progress.length ? 'ready' : 'warn',
      icon: <History size={14} />,
    },
    {
      key: 'cutpoints',
      label: 'Cut Points',
      meta: totalCp ? `${verified}/${totalCp} verified` : '0 CP',
      tone: totalCp && verified === totalCp ? 'ready' : totalCp ? 'warn' : 'info',
      icon: <MapPin size={14} />,
    },
    {
      key: 'evidence',
      label: 'Evidence',
      meta: `${checklist}/5`,
      tone: checklist === 5 ? 'ready' : checklist ? 'warn' : 'info',
      icon: <CheckCircle2 size={14} />,
    },
  ];

  return (
    <nav className='section-jump adaptive-section-nav' aria-label='Navigasi dan readiness section'>
      {sections.map((item, index) => (
        <button
          type='button'
          key={item.key}
          className={`is-${item.tone}`}
          onClick={() => onSelect(item.key)}
        >
          {item.icon}
          <span>{item.label}</span>
          <small>{item.meta}</small>
          <i>{String(index + 1).padStart(2, '0')}</i>
        </button>
      ))}
    </nav>
  );
}
