import type { TelemetryData, SystemState } from '../types/radar';
import { RADAR_CONSTANTS } from '../types/radar';
import type { WebSocketHookStatus } from '../hooks/useRadarWebSocket';

export type DataConfidenceLevel =
  | 'trusted'
  | 'simulated'
  | 'degraded'
  | 'stale'
  | 'offline';

export type DataConfidenceTone =
  | 'nominal'
  | 'caution'
  | 'critical'
  | 'info'
  | 'dim';

export interface DataConfidenceState {
  level: DataConfidenceLevel;
  label: string;
  tone: DataConfidenceTone;
  score: number;
  reason: string;
}

interface ConfidenceInputs {
  system: SystemState | null;
  telemetry: TelemetryData | null;
  wsStatus: WebSocketHookStatus;
  shouldUseMock: boolean;
  nowMs?: number;
}

export function deriveDataConfidence(inputs: ConfidenceInputs): DataConfidenceState {
  const nowMs = inputs.nowMs ?? Date.now();
  const latencyMs =
    inputs.system === null
      ? null
      : Math.max(0, nowMs - inputs.system.server_timestamp_ms);

  if (inputs.wsStatus !== 'open' && !inputs.shouldUseMock) {
    return {
      level: 'offline',
      label: 'OFFLINE',
      tone: 'critical',
      score: 0,
      reason: 'No upstream link',
    };
  }

  if (latencyMs !== null && latencyMs > 2_000) {
    return {
      level: 'stale',
      label: 'STALE',
      tone: 'critical',
      score: 34,
      reason: `${latencyMs.toFixed(0)} ms data age`,
    };
  }

  if (inputs.shouldUseMock || inputs.system?.connection === 'MOCK') {
    return {
      level: 'simulated',
      label: 'SIMULATED',
      tone: 'caution',
      score: 62,
      reason: 'Mock engine source',
    };
  }

  const droppedFrames = inputs.telemetry?.dropped_frames ?? 0;
  const frameCount = inputs.telemetry?.frame_count ?? 0;
  const dropRatio = frameCount > 0 ? droppedFrames / frameCount : 0;
  const sensorsMissing =
    inputs.telemetry !== null &&
    inputs.telemetry.thermistors_c.every((v) => v === 0) &&
    inputs.telemetry.pa_currents_ma.every((v) => v === 0);
  const gpsMissing = (inputs.system?.gps_fix_quality ?? 0) === 0;

  if (dropRatio > RADAR_CONSTANTS.FRAME_DROP_RATIO_WARN) {
    return {
      level: 'degraded',
      label: 'DEGRADED',
      tone: 'caution',
      score: 72,
      reason: `${(dropRatio * 100).toFixed(3)}% frame drop`,
    };
  }

  if (sensorsMissing) {
    return {
      level: 'degraded',
      label: 'DEGRADED',
      tone: 'caution',
      score: 74,
      reason: 'Health sensors unavailable',
    };
  }

  if (gpsMissing) {
    return {
      level: 'degraded',
      label: 'DEGRADED',
      tone: 'caution',
      score: 78,
      reason: 'GPS fix missing',
    };
  }

  return {
    level: 'trusted',
    label: 'TRUSTED',
    tone: 'nominal',
    score: 94,
    reason: 'Live link nominal',
  };
}
