/**
 * AlarmFeed — Advanced Alarm Log with Active/History tabs, filtering, and Mass-ACK.
 * =============================================================================
 * Section 4.5-E. High situational awareness tactical display:
 *
 *   - Tab 1: ACTIVE (unacknowledged safety events).
 *   - Tab 2: AUDIT LOG (complete historical logs for post-incident audits).
 *
 * Functional additions:
 *   - Mass-ACK: "ACK ALL" button to clear active queues instantly in high-fatigue events.
 *   - Severity Filtering: Rapid sorting between ALL, CRITICAL, and WARNING.
 *   - Cinematic Heartbeat indicators: Glowing pulsing status indicators for critical events.
 */

import { useEffect, useRef, useState } from 'react';

import { useTelemetryStore } from '../../stores/telemetryStore';
import { useTargetStore } from '../../stores/radarStore';
import { useRadarWebSocket } from '../../hooks/useRadarWebSocket';
import { WS_URL } from '../../lib/wsConfig';
import {
  isSoundEnabled,
  playAlertBeep,
  setSoundEnabled,
} from '../../lib/sound';
import type { AlarmEvent, AlarmSeverity } from '../../types/radar';

const MAX_DISPLAY = 40;
const OPERATOR_NAME = 'OPERATOR';

const SEVERITY_GLYPH: Record<AlarmSeverity, string> = {
  info: 'ⓘ',
  warning: '◆',
  critical: '⬣',
};

export function AlarmFeed() {
  const alarms = useTelemetryStore((s) => s.alarms);
  const acknowledgeAlarm = useTelemetryStore((s) => s.acknowledgeAlarm);
  const { send } = useRadarWebSocket(WS_URL);

  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled());

  // Sound cue — beep when the unacknowledged-critical count increases.
  // Tracks the *active* set so re-ack'ing or history scrubbing doesn't fire.
  const prevCritCountRef = useRef<number>(0);
  const prevWarnCountRef = useRef<number>(0);
  const firstRunRef = useRef<boolean>(true);
  useEffect(() => {
    const critActive = alarms.filter(
      (a) => a.severity === 'critical' && !a.acknowledged,
    ).length;
    const warnActive = alarms.filter(
      (a) => a.severity === 'warning' && !a.acknowledged,
    ).length;
    // Skip first render so existing alarms don't re-beep on mount.
    if (!firstRunRef.current) {
      if (critActive > prevCritCountRef.current) {
        playAlertBeep('critical');
      } else if (warnActive > prevWarnCountRef.current) {
        playAlertBeep('warning');
      }
    }
    prevCritCountRef.current = critActive;
    prevWarnCountRef.current = warnActive;
    firstRunRef.current = false;
  }, [alarms]);

  function toggleSound(): void {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) {
      // Confirmation beep so the operator hears their action.
      playAlertBeep('info');
    }
  }

  function ack(alarmId: string, category: string, source: string): void {
    acknowledgeAlarm(alarmId, OPERATOR_NAME);
    send({ type: 'ACK_ALARM', alarm_id: alarmId, operator: OPERATOR_NAME });
    
    // Auto-select target on the radar canvas if it is a target threat alarm
    if (category === 'TARGET_THREAT') {
      useTargetStore.getState().selectTarget(source);
    }
  }

  function ackAll(): void {
    const unacked = alarms.filter((a) => !a.acknowledged);
    for (const alarm of unacked) {
      acknowledgeAlarm(alarm.id, OPERATOR_NAME);
      send({ type: 'ACK_ALARM', alarm_id: alarm.id, operator: OPERATOR_NAME });
    }
  }

  // 1. Filter by Active vs History
  const tabFiltered = alarms.filter((a) => {
    if (activeTab === 'active') return !a.acknowledged;
    return true; // history shows all
  });

  // 2. Filter by Severity
  const severityFiltered = tabFiltered.filter((a) => {
    if (severityFilter === 'critical') return a.severity === 'critical';
    if (severityFilter === 'warning') return a.severity === 'warning';
    return true;
  });

  const slice = severityFiltered.slice(0, MAX_DISPLAY);
  const unackedCount = alarms.filter((a) => !a.acknowledged).length;

  return (
    <div className="alarm-feed-container">
      {/* Tab Switch & Mass ACK */}
      <div className="alarm-feed__toolbar">
        <div className="alarm-feed__tabs">
          <button
            type="button"
            className="alarm-feed__tab"
            data-active={activeTab === 'active'}
            onClick={() => setActiveTab('active')}
          >
            ACTIVE {unackedCount > 0 && <span className="alarm-feed__tab-count">{unackedCount}</span>}
          </button>
          <button
            type="button"
            className="alarm-feed__tab"
            data-active={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
          >
            AUDIT LOG
          </button>
        </div>
        
        <div className="alarm-feed__toolbar-actions">
          <button
            type="button"
            className="alarm-feed__sound-btn"
            data-active={soundOn || undefined}
            onClick={toggleSound}
            title={soundOn ? 'Mute alarm beep' : 'Enable alarm beep'}
            aria-label={soundOn ? 'Mute alarm sound' : 'Enable alarm sound'}
            aria-pressed={soundOn}
          >
            {soundOn ? '♪ ON' : '♪ OFF'}
          </button>
          {activeTab === 'active' && unackedCount > 0 && (
            <button
              type="button"
              className="alarm-feed__ack-all-btn"
              onClick={ackAll}
              title="Acknowledge all active alarms"
            >
              ACK ALL
            </button>
          )}
        </div>
      </div>

      {/* Severity Filter Bar */}
      <div className="alarm-feed__filters">
        <span className="alarm-feed__filter-label">FILTER:</span>
        <button
          type="button"
          className="alarm-feed__filter-btn"
          data-active={severityFilter === 'all'}
          onClick={() => setSeverityFilter('all')}
        >
          ALL
        </button>
        <button
          type="button"
          className="alarm-feed__filter-btn"
          data-tone="critical"
          data-active={severityFilter === 'critical'}
          onClick={() => setSeverityFilter('critical')}
        >
          CRIT
        </button>
        <button
          type="button"
          className="alarm-feed__filter-btn"
          data-tone="caution"
          data-active={severityFilter === 'warning'}
          onClick={() => setSeverityFilter('warning')}
        >
          WARN
        </button>
      </div>

      {/* Alarm Log list */}
      <div className="alarm-feed" role="log" aria-live="polite" aria-relevant="additions">
        {slice.length === 0 ? (
          <div className="alarm-feed__empty">
            {activeTab === 'active' ? 'No active alarms' : 'No records logged'}
          </div>
        ) : (
          slice.map((alarm) => (
            <article
              key={alarm.id}
              className="alarm-feed__item"
              data-severity={alarm.severity}
              data-acked={alarm.acknowledged}
              style={{ cursor: alarm.category === 'TARGET_THREAT' ? 'pointer' : 'default' }}
              onClick={(e) => {
                // If they clicked the ACK button, let the button handle it
                if ((e.target as HTMLElement).closest('.alarm-feed__ack')) return;
                if (alarm.category === 'TARGET_THREAT') {
                  useTargetStore.getState().selectTarget(alarm.source);
                }
              }}
            >
              <div className="alarm-feed__head">
                <span className="alarm-feed__cat">
                  <span className="alarm-feed__glyph" data-tone={alarm.severity}>
                    {SEVERITY_GLYPH[alarm.severity]}
                  </span>{' '}
                  {alarm.category} · {alarm.source}
                </span>
                <span className="alarm-feed__time">
                  {formatTime(alarm.timestamp_ms)}
                </span>
              </div>

              <div className="alarm-feed__msg">{alarm.message}</div>
              <IncidentStack alarm={alarm} />

              {alarm.acknowledged ? (
                <div className="alarm-feed__footer">
                  <span className="alarm-feed__acked-by">
                    ✓ ACK · {alarm.acknowledged_by ?? OPERATOR_NAME}
                  </span>
                  {alarm.acknowledged_at_ms !== null && (
                    <span className="alarm-feed__acked-time">
                      {formatTime(alarm.acknowledged_at_ms)}
                    </span>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="alarm-feed__ack"
                  onClick={() => ack(alarm.id, alarm.category, alarm.source)}
                  aria-label={`Acknowledge alarm ${alarm.source}`}
                >
                  ACK
                </button>
              )}
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function IncidentStack({ alarm }: { alarm: AlarmEvent }) {
  const profile = getIncidentProfile(alarm);
  const observed = formatObserved(alarm);

  return (
    <div className="alarm-feed__incident">
      <div className="alarm-feed__incident-row">
        <span>POSTURE</span>
        <strong>{profile.posture}</strong>
      </div>
      <div className="alarm-feed__incident-row">
        <span>OBSERVED</span>
        <strong>{observed}</strong>
      </div>
      <div className="alarm-feed__incident-action">
        <span>ACTION</span>
        <strong>{profile.action}</strong>
      </div>
    </div>
  );
}

function getIncidentProfile(alarm: AlarmEvent): {
  posture: string;
  action: string;
} {
  switch (alarm.category) {
    case 'TARGET_THREAT':
      return {
        posture: alarm.severity === 'critical' ? 'INTERCEPT' : 'TRACK',
        action: 'FOCUS TRACK / MAINTAIN LOCK',
      };
    case 'PA_CURRENT':
      return {
        posture: 'RF HEALTH',
        action: 'CHECK PA BIAS / REDUCE DUTY',
      };
    case 'THERMISTOR':
      return {
        posture: 'THERMAL',
        action: 'VERIFY COOLING / LOWER TX',
      };
    case 'FRAME_DROP':
      return {
        posture: 'LINK QUALITY',
        action: 'CHECK USB / SERIAL PATH',
      };
    case 'CONNECTION':
      return {
        posture: 'LINK',
        action: 'RESTORE UPSTREAM',
      };
    case 'GPS':
      return {
        posture: 'NAV',
        action: 'VERIFY FIX / HOLD GEO',
      };
    case 'OCXO':
      return {
        posture: 'CLOCK',
        action: 'HOLD SCAN UNTIL LOCK',
      };
    case 'AGC_SATURATION':
      return {
        posture: 'RECEIVER',
        action: 'LOWER GAIN / WATCH SAT',
      };
    case 'SYSTEM':
      return {
        posture: 'SYSTEM',
        action: 'INSPECT STATE',
      };
  }
}

function formatObserved(alarm: AlarmEvent): string {
  if (alarm.value === null) return 'EVENT';
  const unit = unitForAlarm(alarm);
  const value = `${alarm.value.toFixed(alarm.value % 1 === 0 ? 0 : 1)}${unit}`;
  if (alarm.threshold === null) return value;
  return `${value} / LIM ${alarm.threshold.toFixed(alarm.threshold % 1 === 0 ? 0 : 1)}${unit}`;
}

function unitForAlarm(alarm: AlarmEvent): string {
  switch (alarm.category) {
    case 'THERMISTOR':
      return 'C';
    case 'PA_CURRENT':
      return 'mA';
    case 'AGC_SATURATION':
      return '%';
    case 'FRAME_DROP':
      return '%';
    case 'TARGET_THREAT':
      return 'm/s';
    default:
      return '';
  }
}
