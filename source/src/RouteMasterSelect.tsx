import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { RouteMasterPair } from './route-master-excel';

type RouteMasterSelectProps = {
  mode: 'systemKey' | 'routeSegment';
  pairs: RouteMasterPair[];
  systemKey: string;
  routeSegment: string;
  onSelect: (pair: RouteMasterPair) => void;
};

export function RouteMasterSelect({
  mode,
  pairs,
  systemKey,
  routeSegment,
  onSelect,
}: RouteMasterSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const currentValue = mode === 'systemKey' ? systemKey : routeSegment;
  const currentDetail = mode === 'systemKey' ? routeSegment : systemKey;
  const label = mode === 'systemKey' ? 'System Key' : 'Segmen Route';

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return pairs
      .filter(
        (pair) =>
          !needle ||
          pair.systemKey.toLowerCase().includes(needle) ||
          pair.routeSegment.toLowerCase().includes(needle),
      )
      .slice(0, 60);
  }, [pairs, query]);

  useEffect(() => {
    if (!open) return;

    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div
      className={`custom-select master-select ${open ? 'open' : ''}`}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type='button'
        className='select-trigger'
        aria-label={label}
        aria-haspopup='listbox'
        aria-expanded={open}
        disabled={!pairs.length}
        onClick={() => {
          setQuery('');
          setOpen((current) => !current);
        }}
      >
        <span>
          <strong>
            {currentValue || (pairs.length ? `Pilih ${label}` : 'Master data belum diimport')}
          </strong>
          <small>
            {currentDetail ||
              (pairs.length
                ? `${pairs.length.toLocaleString('id-ID')} mapping tersedia`
                : 'Import Excel dari menu Templates')}
          </small>
        </span>
        <ChevronDown size={16} />
      </button>

      {open && (
        <div className='select-menu master-select-menu' role='listbox' aria-label={label}>
          <label className='master-search'>
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Cari System Key atau Segment Route…'
            />
          </label>

          <small className='master-result-count'>
            {filtered.length === 60 ? '60 hasil teratas' : `${filtered.length} hasil`}
          </small>

          {filtered.map((pair, index) => {
            const value = mode === 'systemKey' ? pair.systemKey : pair.routeSegment;
            const detail = mode === 'systemKey' ? pair.routeSegment : pair.systemKey;
            const selected = pair.systemKey === systemKey && pair.routeSegment === routeSegment;

            return (
              <button
                type='button'
                role='option'
                aria-selected={selected}
                className={`select-option ${selected ? 'selected' : ''}`}
                key={`${pair.systemKey}-${pair.routeSegment}-${index}`}
                onClick={() => {
                  onSelect(pair);
                  setOpen(false);
                }}
              >
                <span>
                  <strong>{value}</strong>
                  <small>{detail}</small>
                </span>
                {selected && <Check size={15} />}
              </button>
            );
          })}

          {!filtered.length && (
            <div className='master-no-result'>Tidak ada mapping yang cocok.</div>
          )}
        </div>
      )}
    </div>
  );
}
