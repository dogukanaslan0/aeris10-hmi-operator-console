/**
 * TargetList — Sortable + Filterable target table.
 * =============================================================================
 * Row click toggles the global selection (clicking the selected row clears
 * it). Threat severity carries a column-level colour cue plus an ASCII glyph
 * for non-colour readers.
 *
 * Quick filter chips (ALL · CRIT · CLOSING · <500m) sit above the header so
 * operators in engagement mode cut to relevant targets in one click rather
 * than sorting through dozens. Live counts on each chip telegraph "what's
 * waiting" without the operator having to switch filters to find out.
 *
 * Pinned targets (★) stay anchored and visible regardless of the active
 * filter — a critical pinned target is never hidden by a "<500m" view.
 */

import { useMemo, useState } from 'react';

import { useTargetStore } from '../../stores/radarStore';
import type { RadarTarget, ThreatLevel } from '../../types/radar';

type SortKey =
  | 'range_m'
  | 'azimuth_deg'
  | 'doppler_mps'
  | 'snr_db'
  | 'threat_level';

type SortDir = 'asc' | 'desc';

type FilterId = 'all' | 'crit' | 'closing' | 'near';

interface FilterDef {
  id: FilterId;
  label: string;
  tone?: 'critical' | 'caution' | 'info';
  test: (t: RadarTarget) => boolean;
}

const FILTERS: readonly FilterDef[] = [
  { id: 'all', label: 'ALL', test: () => true },
  {
    id: 'crit',
    label: 'CRIT',
    tone: 'critical',
    test: (t) => t.threat_level === 'critical' || t.threat_level === 'warning',
  },
  {
    id: 'closing',
    label: 'CLOSING',
    tone: 'caution',
    test: (t) => t.doppler_mps < 0,
  },
  {
    id: 'near',
    label: '<500m',
    tone: 'info',
    test: (t) => t.range_m < 500,
  },
];

const THREAT_ORDER: Record<ThreatLevel, number> = {
  nominal: 0,
  caution: 1,
  warning: 2,
  critical: 3,
};

const THREAT_GLYPH: Record<ThreatLevel, string> = {
  nominal: '✓',
  caution: '◇',
  warning: '◆',
  critical: '⬣',
};

export function TargetList() {
  const targets = useTargetStore((s) => s.targets);
  const selectedId = useTargetStore((s) => s.selectedTargetId);
  const selectTarget = useTargetStore((s) => s.selectTarget);
  const pinnedTargetIds = useTargetStore((s) => s.pinnedTargetIds);
  const togglePinTarget = useTargetStore((s) => s.togglePinTarget);

  const [sortKey, setSortKey] = useState<SortKey>('range_m');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filter, setFilter] = useState<FilterId>('all');

  // Sort the full target set
  const sorted = useMemo(() => {
    const arr = Array.from(targets.values());
    const dirMul = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => dirMul * compare(a, b, sortKey));
    return arr;
  }, [targets, sortKey, sortDir]);

  // Live count per filter — shown on each chip so operators see "what's there"
  const counts = useMemo(() => {
    const c: Record<FilterId, number> = {
      all: 0, crit: 0, closing: 0, near: 0,
    };
    for (const t of sorted) {
      for (const f of FILTERS) {
        if (f.test(t)) c[f.id] += 1;
      }
    }
    return c;
  }, [sorted]);

  // Apply active filter, but ALWAYS surface pinned targets (operator intent
  // overrides any view filter — never hide a pinned target by accident).
  const filterDef = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const filtered = useMemo(() => {
    return sorted.filter(
      (t) => filterDef.test(t) || pinnedTargetIds.has(t.id),
    );
  }, [sorted, filterDef, pinnedTargetIds]);

  function toggleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  // ── Filter chip row — always rendered so chips don't pop in/out ──────────
  const filterRow = (
    <div className="target-list__filter-row" role="group" aria-label="Target list filters">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          className="target-list__filter-chip"
          data-active={filter === f.id || undefined}
          data-tone={f.tone}
          onClick={() => setFilter(f.id)}
          aria-pressed={filter === f.id}
        >
          {f.label}
          {counts[f.id] > 0 && (
            <span className="target-list__filter-count">{counts[f.id]}</span>
          )}
        </button>
      ))}
    </div>
  );

  if (sorted.length === 0) {
    return (
      <div className="target-list">
        {filterRow}
        <div className="target-list__empty">No targets detected</div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="target-list">
        {filterRow}
        <div className="target-list__empty">
          No targets match <strong>{filterDef.label}</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="target-list">
      {filterRow}

      <div className="target-list__header">
        <span></span>
        <span>TGT</span>
        <Header
          label="RANGE"
          active={sortKey === 'range_m'}
          dir={sortDir}
          onClick={() => toggleSort('range_m')}
        />
        <Header
          label="AZ"
          active={sortKey === 'azimuth_deg'}
          dir={sortDir}
          onClick={() => toggleSort('azimuth_deg')}
        />
        <Header
          label="VEL"
          active={sortKey === 'doppler_mps'}
          dir={sortDir}
          onClick={() => toggleSort('doppler_mps')}
        />
        <Header
          label="SNR"
          active={sortKey === 'snr_db'}
          dir={sortDir}
          onClick={() => toggleSort('snr_db')}
        />
        <Header
          label="THREAT"
          active={sortKey === 'threat_level'}
          dir={sortDir}
          onClick={() => toggleSort('threat_level')}
        />
      </div>

      <div className="target-list__body">
        {filtered.map((target) => (
          <button
            key={target.id}
            type="button"
            className="target-list__row"
            data-selected={target.id === selectedId}
            data-threat={target.threat_level}
            onClick={() => selectTarget(target.id === selectedId ? null : target.id)}
            aria-pressed={target.id === selectedId}
          >
            <span
              className="target-list__pin-btn"
              data-pinned={pinnedTargetIds.has(target.id)}
              onClick={(e) => {
                e.stopPropagation();
                togglePinTarget(target.id);
              }}
              title={pinnedTargetIds.has(target.id) ? 'Unpin Target' : 'Pin Target'}
            >
              {pinnedTargetIds.has(target.id) ? '★' : '☆'}
            </span>
            <span>{shortId(target.id)}</span>
            <span>{formatRange(target.range_m)}</span>
            <span>{target.azimuth_deg.toFixed(0)}°</span>
            <span>{formatDoppler(target.doppler_mps)}</span>
            <span>{target.snr_db.toFixed(0)}</span>
            <span className="target-list__threat">
              {THREAT_GLYPH[target.threat_level]} {shortThreat(target.threat_level)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function shortThreat(level: ThreatLevel): string {
  switch (level) {
    case 'nominal': return 'NOM';
    case 'caution': return 'CAUT';
    case 'warning': return 'WARN';
    case 'critical': return 'CRIT';
  }
}

interface HeaderProps {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}

function Header(props: HeaderProps) {
  return (
    <button
      type="button"
      className="target-list__header-cell"
      data-active={props.active}
      data-dir={props.dir === 'asc' ? '▲' : '▼'}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function compare(a: RadarTarget, b: RadarTarget, key: SortKey): number {
  if (key === 'threat_level') {
    return THREAT_ORDER[a.threat_level] - THREAT_ORDER[b.threat_level];
  }
  return a[key] - b[key];
}

export function shortId(id: string): string {
  if (id.startsWith('node-') || id.startsWith('mock-')) {
    const parts = id.split('-');
    if (parts.length >= 3) {
      const num = parts[parts.length - 1];
      const type = parts[parts.length - 2];
      const prefix =
        type.includes('bird') ? 'BRD' :
        type.includes('drone') ? 'DRN' :
        type.includes('aircraft') ? 'AIR' :
        type.includes('vehicle') ? 'VEH' :
        type.toUpperCase().slice(0, 3);

      if (/^\d+$/.test(num)) {
        return `${prefix}-${num}`;
      }
    }
    return id.replace('mock-', '').replace('node-', '').toUpperCase();
  }
  const tail = id.split('-').pop() ?? id;
  return tail.slice(0, 6).toUpperCase();
}

export function formatRange(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)}km`;
  return `${m.toFixed(0)}m`;
}

export function formatDoppler(mps: number): string {
  const sign = mps > 0 ? '+' : '';
  return `${sign}${mps.toFixed(1)}m/s`;
}
