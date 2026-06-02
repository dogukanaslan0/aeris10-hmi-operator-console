/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : Console Primary Header & Layout Selector (TopBar)
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.0.0 (Nexus Active Deployment)
 * ============================================================================
 */

import { useEffect, useState } from 'react';

import { useSystemStore } from '../../stores/systemStore';
import { useTargetStore } from '../../stores/radarStore';
import { useTelemetryStore } from '../../stores/telemetryStore';
import { useRadarWebSocket } from '../../hooks/useRadarWebSocket';
import type { WebSocketHookStatus } from '../../hooks/useRadarWebSocket';
import { WS_URL } from '../../lib/wsConfig';
import { deriveDataConfidence } from '../../lib/confidence';
import type { ConnectionState, GpsFixQuality, RadarTarget } from '../../types/radar';

import {
  IconClock,
  IconGps,
  IconLink,
  IconPower,
  IconScan,
  IconShield,
  IconWaveform,
  IconWifi,
} from '../icons';
import { StatusDot } from '../common/StatusDot';
import { StatusOrb } from '../common/StatusOrb';
import { Sparkline } from '../common/Sparkline';
import { Odometer } from '../common/Odometer';
import { shortId, formatRange, formatDoppler } from '../command/TargetList';

import './TopBar.css';

export function TopBar() {
  const system = useSystemStore((s) => s.current);
  const ws = useRadarWebSocket(WS_URL);

  const connection = deriveConnection(system?.connection, ws.status);

  return (
    <div className="topbar">
      <div className="topbar__brand">
        <span className="topbar__brand-mark" aria-hidden>
          <img src="/aeris_10_logo.png" alt="AERIS-10 Logo" className="topbar__brand-logo-img" />
        </span>
        <div className="topbar__brand-text">
          <div className="topbar__brand-header">
            <span className="topbar__brand-name">AERIS-10</span>
            <span className="topbar__brand-ver">v1.0</span>
          </div>
          <span className="topbar__brand-tag">RADAR · C2 TERMINAL</span>
        </div>
      </div>

      <div className="topbar__divider" />

      <ConnectionBadge state={connection} />
      <DataConfidenceBadge />

      <div className="topbar__divider" />

      <TargetSparkline />

      <PinnedTargetsHeader />

      <div className="topbar__spacer" />

      <LayoutSelector3D />

      <div className="topbar__spacer" />

      <UptimeReadout seconds={system?.uptime_s ?? 0} />
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const desc = describeConnection(state);

  return (
    <div
      className="topbar__badge"
      data-tone={desc.tone}
      role="status"
      aria-label={`Connection ${desc.label.toLowerCase()}`}
    >
      <span className="topbar__badge-icon">
        <StatusDot tone={desc.tone} pulse={desc.pulse} glow={desc.glow} size={9} />
      </span>
      <span className="topbar__badge-icon-glyph" aria-hidden>
        {desc.icon}
      </span>
      <span className="topbar__badge-label">{desc.label}</span>
    </div>
  );
}

function DataConfidenceBadge() {
  const system = useSystemStore((s) => s.current);
  const telemetry = useTelemetryStore((s) => s.current);
  const ws = useRadarWebSocket(WS_URL);
  const confidence = deriveDataConfidence({
    system,
    telemetry,
    wsStatus: ws.status,
    shouldUseMock: ws.shouldUseMock,
  });

  return (
    <div
      className="topbar__confidence"
      data-tone={confidence.tone}
      title={confidence.reason}
      role="status"
      aria-label={`Data confidence ${confidence.label.toLowerCase()}`}
    >
      <span className="topbar__confidence-score">{confidence.score}</span>
      <span className="topbar__confidence-text">
        <span className="topbar__confidence-label">DATA</span>
        <span className="topbar__confidence-state">{confidence.label}</span>
      </span>
    </div>
  );
}



function UptimeReadout({ seconds }: { seconds: number }) {
  return (
    <div className="topbar__metric topbar__metric--uptime">
      <span className="topbar__metric-icon" aria-hidden>
        <IconClock size={13} />
      </span>
      <span className="topbar__metric-label">UP</span>
      <span className="topbar__metric-value topbar__metric-value--big">
        <Odometer value={formatDuration(seconds)} />
      </span>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const GPS_FIX_LABELS: Record<GpsFixQuality, string> = {
  0: 'NO FIX',
  1: 'GPS',
  2: 'DGPS',
  3: 'RTK',
};

interface ConnectionDescriptor {
  icon: React.ReactNode;
  label: string;
  tone: 'nominal' | 'info' | 'caution' | 'critical' | 'violet' | 'dim';
  pulse?: boolean;
  glow?: boolean;
}

function describeConnection(state: ConnectionState): ConnectionDescriptor {
  switch (state) {
    case 'DISCONNECTED':
      return { icon: <IconWifi size={13} />, label: 'OFFLINE', tone: 'dim' };
    case 'CONNECTING':
      return { icon: <IconLink size={13} />, label: 'CONNECTING', tone: 'info', pulse: true };
    case 'OCXO_WARMUP':
      return { icon: <IconPower size={13} />, label: 'WARMING', tone: 'violet', pulse: true };
    case 'ARMED':
      return { icon: <IconShield size={13} />, label: 'ARMED', tone: 'info', glow: true };
    case 'SCANNING':
      return { icon: <IconScan size={13} />, label: 'SCANNING', tone: 'nominal', pulse: true, glow: true };
    case 'FAULT':
      return { icon: <IconWaveform size={13} />, label: 'FAULT', tone: 'critical', pulse: true };
    case 'MOCK':
      return { icon: <IconWaveform size={13} />, label: 'MOCK', tone: 'caution' };
  }
}

function deriveConnection(
  systemConnection: ConnectionState | undefined,
  wsStatus: WebSocketHookStatus,
): ConnectionState {
  if (systemConnection !== undefined) return systemConnection;
  if (wsStatus === 'connecting' || wsStatus === 'open') return 'CONNECTING';
  return 'DISCONNECTED';
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function TargetSparkline() {
  const [history, setHistory] = useState<number[]>(() => new Array(24).fill(0));
  const currentCount = useTargetStore((s) => s.targets.size);

  // Sample the track count on a slow fixed cadence (1 Hz) instead of subscribing
  // to the 60 Hz target stream. The targets Map identity churns every frame, so
  // a raw subscription fired setHistory 60×/s — re-rendering the whole header at
  // 60 Hz and squeezing the sparkline into a meaningless 0.4 s window
  // (24 samples / 60 Hz). One sample per second yields a readable ~24 s trend.
  // `currentCount` above subscribes to the `.size` primitive, so the live number
  // still updates the instant a track is gained or lost.
  useEffect(() => {
    const id = window.setInterval(() => {
      const size = useTargetStore.getState().targets.size;
      setHistory((prev) => {
        const next = [...prev, size];
        if (next.length > 24) next.shift();
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="topbar__metric topbar__metric--sparkline">
      <span className="topbar__metric-label">TRACKS</span>
      <span className="topbar__metric-value">{currentCount}</span>
      <div className="topbar__sparkline-wrapper">
        <Sparkline data={history} width={50} height={14} color="var(--accent-cyan)" />
      </div>
    </div>
  );
}

function PinnedTargetsHeader() {
  const pinnedTargetIds = useTargetStore((s) => s.pinnedTargetIds);
  const targets = useTargetStore((s) => s.targets);
  const targetHistory = useTargetStore((s) => s.targetHistory);
  const togglePinTarget = useTargetStore((s) => s.togglePinTarget);
  const selectTarget = useTargetStore((s) => s.selectTarget);
  const selectedTargetId = useTargetStore((s) => s.selectedTargetId);

  if (pinnedTargetIds.size === 0) return null;

  return (
    <>
      <div className="topbar__divider" />
      <div className="topbar__pinned-targets">
        {Array.from(pinnedTargetIds).map((id) => {
          const activeTarget = targets.get(id);
          const history = targetHistory.get(id);
          const lastTarget = activeTarget || (history && history.length > 0 ? history[history.length - 1] : null);
          
          if (!lastTarget) return null;

          const isLost = !activeTarget;
          
          return (
            <PinnedTargetCard
              key={id}
              target={lastTarget}
              isLost={isLost}
              isSelected={selectedTargetId === id}
              onSelect={() => selectTarget(selectedTargetId === id ? null : id)}
              onUnpin={() => togglePinTarget(id)}
            />
          );
        })}
      </div>
    </>
  );
}

interface PinnedTargetCardProps {
  target: RadarTarget;
  isLost: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onUnpin: () => void;
}

function PinnedTargetCard({
  target,
  isLost,
  isSelected,
  onSelect,
  onUnpin,
}: {
  target: RadarTarget;
  isLost: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onUnpin: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isLost) return;

    // Set initial elapsed time
    setElapsed((Date.now() - target.timestamp_ms) / 1000);

    const interval = setInterval(() => {
      const sec = (Date.now() - target.timestamp_ms) / 1000;
      setElapsed(sec);
    }, 100);

    return () => clearInterval(interval);
  }, [isLost, target.timestamp_ms]);

  const displayId = shortId(target.id);
  const displayRange = formatRange(target.range_m);
  const displayAzimuth = `${target.azimuth_deg.toFixed(0)}°`;
  const displayVelocity = formatDoppler(target.doppler_mps);

  return (
    <button
      type="button"
      className={`topbar__pin-card ${isLost ? 'topbar__pin-card--lost' : ''} ${isSelected ? 'topbar__pin-card--selected' : ''}`}
      onClick={onSelect}
      data-threat={target.threat_level}
    >
      <div className="topbar__pin-card-header">
        <span className="topbar__pin-card-id">{displayId}</span>
        <span
          className="topbar__pin-card-unpin"
          onClick={(e) => {
            e.stopPropagation();
            onUnpin();
          }}
          title="Unpin Track"
        >
          ×
        </span>
      </div>
      <div className="topbar__pin-card-body">
        {isLost ? (
          <span className="topbar__pin-card-lost-text">
            LOST {elapsed.toFixed(1)}s AGO
          </span>
        ) : (
          <span className="topbar__pin-card-metrics">
            {displayRange} · {displayAzimuth} · {displayVelocity}
          </span>
        )}
      </div>
    </button>
  );
}

function LayoutSelector3D() {
  const currentPreset = useSystemStore((s) => s.layoutPreset);
  const setLayoutPreset = useSystemStore((s) => s.setLayoutPreset);

  const presets = [
    { id: 'watch', label: 'WATCH', subtitle: 'SURVEY', key: 'Alt+1' },
    { id: 'engagement', label: 'ENGAGE', subtitle: 'THREAT', key: 'Alt+2' },
    { id: 'diagnostic', label: 'DIAG', subtitle: 'HEALTH', key: 'Alt+3' },
  ] as const;

  return (
    <div className="layout-3d-selector">
      {presets.map((p) => {
        const isActive = currentPreset === p.id;
        return (
          <button
            key={p.id}
            type="button"
            className="layout-3d-btn"
            data-active={isActive ? "true" : "false"}
            onClick={() => setLayoutPreset(p.id)}
            title={`Switch to ${p.label} Preset (${p.key})`}
          >
            <span className="layout-3d-btn__glint" />
            <span className="layout-3d-btn__led" />
            <div className="layout-3d-btn__content">
              <span className="layout-3d-btn__label">{p.label}</span>
              <span className="layout-3d-btn__sub">{p.subtitle}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
