import { useRadarWebSocket } from '../../hooks/useRadarWebSocket';
import { deriveDataConfidence } from '../../lib/confidence';
import { WS_URL } from '../../lib/wsConfig';
import { useTargetStore } from '../../stores/radarStore';
import { useSystemStore } from '../../stores/systemStore';
import { useTelemetryStore } from '../../stores/telemetryStore';
import { shortId } from '../command/TargetList';

import './MissionModeRail.css';

const MODE_COPY = {
  watch: {
    label: 'WATCH',
    posture: 'SURVEY',
  },
  engagement: {
    label: 'ENGAGE',
    posture: 'THREAT',
  },
  diagnostic: {
    label: 'DIAG',
    posture: 'HEALTH',
  },
} as const;

export function MissionModeRail() {
  const mode = useSystemStore((s) => s.layoutPreset);
  const system = useSystemStore((s) => s.current);
  const telemetry = useTelemetryStore((s) => s.current);
  const alarms = useTelemetryStore((s) => s.alarms);
  const targets = useTargetStore((s) => s.targets);
  const selectedTargetId = useTargetStore((s) => s.selectedTargetId);
  const ws = useRadarWebSocket(WS_URL);

  const profile = MODE_COPY[mode];
  const criticalTargets = Array.from(targets.values()).filter(
    (target) => target.threat_level === 'critical' || target.threat_level === 'warning',
  ).length;
  const activeAlarms = alarms.filter((alarm) => !alarm.acknowledged).length;
  const confidence = deriveDataConfidence({
    system,
    telemetry,
    wsStatus: ws.status,
    shouldUseMock: ws.shouldUseMock,
  });

  return (
    <div className="mission-rail" data-mode={mode} data-tone={confidence.tone}>
      {/* Dynamic top glowing Operational Accent bar */}
      <div className="mission-rail__accent-bar" />

      <div className="mission-rail__mode">
        <span className="mission-rail__label">{profile.label}</span>
        <span className="mission-rail__posture">{profile.posture}</span>
      </div>
      
      <Metric label="TRK" value={targets.size.toString()} />
      
      <Metric 
        label="CRIT" 
        value={criticalTargets.toString()} 
        tone={criticalTargets > 0 ? 'critical' : 'dim'} 
        led={criticalTargets > 0 ? 'red-flash' : 'none'}
      />
      
      <Metric 
        label="ALM" 
        value={activeAlarms.toString()} 
        tone={activeAlarms > 0 ? 'critical' : 'dim'} 
        led={activeAlarms > 0 ? 'red-flash' : 'none'}
      />
      
      <Metric 
        label="SEL" 
        value={selectedTargetId === null ? 'NONE' : shortId(selectedTargetId)} 
        tone={selectedTargetId === null ? 'dim' : 'info'} 
        led={selectedTargetId === null ? 'none' : 'cyan-steady'}
      />
      
      <div className="mission-rail__confidence" data-tone={confidence.tone} title={confidence.reason}>
        <span className="mission-rail__confidence-score">{confidence.score}</span>
        <span className="mission-rail__confidence-label">{confidence.label}</span>
      </div>
    </div>
  );
}

function Metric(props: {
  label: string;
  value: string;
  tone?: 'critical' | 'info' | 'dim';
  led?: 'red-flash' | 'cyan-steady' | 'none';
}) {
  return (
    <div className="mission-rail__metric" data-tone={props.tone}>
      <div className="mission-rail__metric-header">
        <span className="mission-rail__metric-label">{props.label}</span>
        {props.led && props.led !== 'none' && (
          <span className={`mission-rail__led mission-rail__led--${props.led}`} aria-hidden />
        )}
      </div>
      <span className="mission-rail__metric-value">{props.value}</span>
    </div>
  );
}
