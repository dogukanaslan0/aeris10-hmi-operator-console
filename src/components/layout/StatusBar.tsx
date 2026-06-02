/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : Bottom Tactical Status Bar & Diagnostic Metrics
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.0.0 (Nexus Active Deployment)
 * ============================================================================
 */

import { useTelemetryStore } from '../../stores/telemetryStore';
import { useSystemStore } from '../../stores/systemStore';
import { useRadarWebSocket } from '../../hooks/useRadarWebSocket';
import { WS_URL } from '../../lib/wsConfig';
import { RADAR_CONSTANTS } from '../../types/radar';

import {
  IconClock,
  IconLayers,
  IconLink,
  IconScan,
  IconTarget,
  IconWaveform,
  IconShield,
  IconGps,
  IconPower,
} from '../icons';
import { StatusDot } from '../common/StatusDot';
import { Odometer } from '../common/Odometer';

import './StatusBar.css';

type SourceLabel = 'LIVE' | 'MOCK' | 'OFFLINE';
type CellTone = 'nominal' | 'info' | 'caution' | 'critical' | 'violet' | 'dim';

const GPS_FIX_LABELS: Record<number, string> = {
  0: 'NO FIX',
  1: 'GPS',
  2: 'DGPS',
  3: 'RTK',
};

export function StatusBar() {
  const telemetry = useTelemetryStore((s) => s.current);
  const system = useSystemStore((s) => s.current);
  const ws = useRadarWebSocket(WS_URL);

  const frameCount = telemetry?.frame_count ?? 0;

  // OCXO Calculations
  const ocxoWarm = system?.ocxo_warm ?? false;
  const ocxoElapsed = system?.ocxo_warmup_elapsed_s ?? 0;
  const ocxoTotal = system?.ocxo_warmup_total_s ?? 180;
  const ocxoPercent = ocxoTotal > 0 ? Math.min(100, (ocxoElapsed / ocxoTotal) * 100) : 0;
  const ocxoValue = ocxoWarm ? 'LOCKED' : `WARMING (${ocxoPercent.toFixed(0)}%)`;
  const ocxoTone: CellTone = ocxoWarm ? 'nominal' : 'violet';

  // GPS Calculations
  const gpsFix = system?.gps_fix_quality ?? 0;
  const gpsSats = system?.gps_satellites ?? 0;
  const gpsFixLabel = GPS_FIX_LABELS[gpsFix] ?? 'NO FIX';
  const gpsValue = `${gpsSats}sat · ${gpsFixLabel}`;
  const gpsTone: CellTone = gpsFix === 0 ? 'critical' : gpsFix >= 2 ? 'nominal' : 'info';
  const droppedFrames = telemetry?.dropped_frames ?? 0;
  const dropRatio = frameCount > 0 ? droppedFrames / frameCount : 0;
  const dropPercent = (dropRatio * 100).toFixed(3);
  const dropTone: CellTone =
    dropRatio > RADAR_CONSTANTS.FRAME_DROP_RATIO_WARN ? 'caution' : 'nominal';

  const dataRateBps = telemetry?.data_rate_bps ?? 0;
  const dataRateLabel =
    dataRateBps > 0 ? `${(dataRateBps / 1_000_000).toFixed(2)} Mb/s` : '—';

  const latencyMs =
    system !== null ? Math.max(0, Date.now() - system.server_timestamp_ms) : null;
  const latencyLabel = latencyMs !== null ? `${latencyMs.toFixed(0)} ms` : '—';
  const latencyTone: CellTone =
    latencyMs === null
      ? 'dim'
      : latencyMs > 2_000
        ? 'critical'
        : latencyMs > 500
          ? 'caution'
          : 'nominal';

  const source: SourceLabel = ws.shouldUseMock
    ? 'MOCK'
    : ws.status === 'open'
      ? 'LIVE'
      : 'OFFLINE';
  const sourceTone: CellTone =
    source === 'OFFLINE' ? 'critical' : source === 'MOCK' ? 'caution' : 'nominal';

  return (
    <div className="statusbar">
      <Cell
        index="01"
        icon={<IconLayers size={11} />}
        label="FRAME"
        value={<Odometer value={frameCount} />}
      />
      <Cell
        index="02"
        icon={<IconWaveform size={11} />}
        label="DROP"
        value={`${dropPercent}%`}
        tone={dropTone}
      />
      <Cell
        index="03"
        icon={<IconScan size={11} />}
        label="RATE"
        value={dataRateLabel}
      />
      <Cell
        index="04"
        icon={<IconClock size={11} />}
        label="LATENCY"
        value={latencyLabel}
        tone={latencyTone}
      />
      <Cell
        index="05"
        icon={<IconLink size={11} />}
        label="SOURCE"
        value={source}
        tone={sourceTone}
        statusDot
      />
      <div className="statusbar__spacer" />
      <Cell
        index="06"
        icon={ocxoWarm ? <IconShield size={11} /> : <IconPower size={11} />}
        label="OCXO"
        value={ocxoValue}
        tone={ocxoTone}
        align="right"
      />
      <Cell
        index="07"
        icon={<IconGps size={11} />}
        label="GPS"
        value={gpsValue}
        tone={gpsTone}
        align="right"
      />
      <Cell
        index="08"
        icon={<IconTarget size={11} />}
        label="CONN"
        value={system?.connection ?? '—'}
        align="right"
      />
    </div>
  );
}

function Cell(props: {
  index: string;
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: CellTone;
  statusDot?: boolean;
  align?: 'left' | 'right';
}) {
  return (
    <div
      className="statusbar__cell"
      data-tone={props.tone}
      data-align={props.align}
    >
      <span className="statusbar__index">{props.index}</span>
      {props.icon !== undefined && (
        <span className="statusbar__icon">{props.icon}</span>
      )}
      <span className="statusbar__label">{props.label}</span>
      {props.statusDot === true && props.tone !== undefined && (
        <StatusDot tone={props.tone} size={7} />
      )}
      <span className="statusbar__value">{props.value}</span>
    </div>
  );
}
