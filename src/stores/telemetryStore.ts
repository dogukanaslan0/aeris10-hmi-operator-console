/**
 * Telemetry Store — medium-rate, ~12 Hz update cadence.
 * =============================================================================
 * Owns: current TelemetryData, sparkline history windows (thermistors + PA
 * currents), and the alarm feed.
 *
 * Why a separate store from targets:
 *   A 60 Hz target update MUST NOT cause the thermistor panel or PA grid to
 *   re-render. Keeping these in distinct stores guarantees that — there is no
 *   shared subscriber path between them.
 *
 * Alarm retention:
 *   - Newest at index 0.
 *   - Acknowledged alarms remain in the array (operator audit trail).
 *   - Hard cap at MAX_ALARMS to avoid unbounded growth in long sessions.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type {
  AlarmEvent,
  PACurrentChannels,
  TelemetryStoreState,
  ThermistorChannels,
} from '../types/radar';
import { RADAR_CONSTANTS } from '../types/radar';

const MAX_ALARMS = 500;
/** Within this window, repeated (category, source) alarms are suppressed.
 *  Hardware that's continuously over a threshold should appear once, not 60
 *  times a second. Operator visibility re-opens after the window passes. */
const ALARM_DEDUPE_WINDOW_MS = 1_500;

export const useTelemetryStore = create<TelemetryStoreState>()(
  subscribeWithSelector((set) => ({
    // ── State ────────────────────────────────────────────────────────────────
    current: null,
    thermistorHistory: [] as ThermistorChannels[],
    paCurrentHistory: [] as PACurrentChannels[],
    alarms: [] as AlarmEvent[],

    // ── Actions ──────────────────────────────────────────────────────────────

    updateTelemetry: (telemetry) =>
      set((state) => {
        const thermistorNext = [...state.thermistorHistory, telemetry.thermistors_c];
        if (thermistorNext.length > RADAR_CONSTANTS.TELEMETRY_HISTORY) {
          thermistorNext.splice(
            0,
            thermistorNext.length - RADAR_CONSTANTS.TELEMETRY_HISTORY,
          );
        }

        const paNext = [...state.paCurrentHistory, telemetry.pa_currents_ma];
        if (paNext.length > RADAR_CONSTANTS.TELEMETRY_HISTORY) {
          paNext.splice(0, paNext.length - RADAR_CONSTANTS.TELEMETRY_HISTORY);
        }

        return {
          current: telemetry,
          thermistorHistory: thermistorNext,
          paCurrentHistory: paNext,
        };
      }),

    pushAlarm: (alarm) =>
      set((state) => {
        // Dedupe: if a same-(category, source) alarm landed within the window,
        // drop the new one. Acknowledged duplicates still suppress — the
        // operator made an explicit choice; don't keep re-asking.
        for (const existing of state.alarms) {
          if (
            existing.category === alarm.category &&
            existing.source === alarm.source
          ) {
            if (alarm.timestamp_ms - existing.timestamp_ms < ALARM_DEDUPE_WINDOW_MS) {
              return state;
            }
            break; // alarms[] is newest-first; further matches are even older
          }
        }
        const next = [alarm, ...state.alarms];
        if (next.length > MAX_ALARMS) {
          next.length = MAX_ALARMS;
        }
        return { alarms: next };
      }),

    acknowledgeAlarm: (alarmId, operator) =>
      set((state) => {
        const index = state.alarms.findIndex((a) => a.id === alarmId);
        if (index === -1) return state;
        if (state.alarms[index].acknowledged) return state;

        const next = state.alarms.slice();
        next[index] = {
          ...next[index],
          acknowledged: true,
          acknowledged_at_ms: Date.now(),
          acknowledged_by: operator,
        };
        return { alarms: next };
      }),

    clearAlarms: () => set({ alarms: [] }),
  })),
);
