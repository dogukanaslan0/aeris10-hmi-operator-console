/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : Core Tracks & Target Tracking Store (60Hz Hot Path)
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.0.0 (Nexus Active Deployment)
 * ============================================================================
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type {
  RadarTarget,
  TargetAnnotation,
  TargetStoreState,
} from '../types/radar';
import { RADAR_CONSTANTS } from '../types/radar';

export const useTargetStore = create<TargetStoreState>()(
  subscribeWithSelector((set) => ({
    // ── State ────────────────────────────────────────────────────────────────
    currentFrameId: null,
    targets: new Map<string, RadarTarget>(),
    targetHistory: new Map<string, RadarTarget[]>(),
    selectedTargetId: null,
    annotations: new Map<string, TargetAnnotation>(),
    pinnedTargetIds: new Set<string>(),

    // ── Actions ──────────────────────────────────────────────────────────────

    updateTargets: (incoming, frameId, frameTimestampMs) =>
      set((state) => {
        // Out-of-order / duplicate frame — drop without state churn.
        if (state.currentFrameId !== null && frameId <= state.currentFrameId) {
          return state;
        }

        const nextTargets = new Map<string, RadarTarget>();
        const nextHistory = new Map<string, RadarTarget[]>();
        const staleCutoffMs = frameTimestampMs - RADAR_CONSTANTS.STALE_TARGET_MS;

        // 1) Apply incoming detections + extend their trails.
        for (const target of incoming) {
          nextTargets.set(target.id, target);

          const previousTrail = state.targetHistory.get(target.id);
          const extendedTrail =
            previousTrail === undefined ? [target] : [...previousTrail, target];

          // Keep a much longer history (200 frames) for the selected target to record its movement path,
          // while keeping standard targets capped at TRAIL_LENGTH to conserve memory.
          const maxTrailLength = state.selectedTargetId === target.id ? 200 : RADAR_CONSTANTS.TRAIL_LENGTH;
          if (extendedTrail.length > maxTrailLength) {
            extendedTrail.splice(
              0,
              extendedTrail.length - maxTrailLength,
            );
          }
          nextHistory.set(target.id, extendedTrail);
        }

        // 2) Carry over previously seen targets that are still fresh.
        //    A target is "fresh" if its last seen timestamp is within the
        //    stale window. Trails are preserved so the UI can fade them out.
        for (const [id, target] of state.targets) {
          if (nextTargets.has(id)) continue;
          if (target.timestamp_ms < staleCutoffMs) continue;

          nextTargets.set(id, target);
          const trail = state.targetHistory.get(id);
          if (trail !== undefined) {
            nextHistory.set(id, trail);
          }
        }

        // 3) If the selected target was evicted, clear the selection so the
        //    detail panel doesn't render a dangling pointer.
        let nextSelectedId =
          state.selectedTargetId !== null && nextTargets.has(state.selectedTargetId)
            ? state.selectedTargetId
            : null;

        // 4) Auto-select critical target if one exists and nothing is currently selected,
        //    or if a target newly escalated/transitioned to 'critical' threat level in this frame.
        if (nextSelectedId === null) {
          const anyCritical = incoming.find((t) => t.threat_level === 'critical');
          if (anyCritical) {
            nextSelectedId = anyCritical.id;
          }
        } else {
          const newCritical = incoming.find(
            (t) =>
              t.threat_level === 'critical' &&
              state.targets.get(t.id)?.threat_level !== 'critical'
          );
          if (newCritical) {
            nextSelectedId = newCritical.id;
          }
        }

        return {
          currentFrameId: frameId,
          targets: nextTargets,
          targetHistory: nextHistory,
          selectedTargetId: nextSelectedId,
        };
      }),

    selectTarget: (id) =>
      set((state) => {
        if (id !== null && !state.targets.has(id)) {
          // Selecting a non-existent target is a no-op; surface in dev only.
          return state;
        }
        return { selectedTargetId: id };
      }),

    annotateTarget: (id, partial) =>
      set((state) => {
        const existing = state.annotations.get(id);
        const updated: TargetAnnotation = existing
          ? { ...existing, ...partial }
          : {
              target_id: id,
              label: '',
              priority: 1,
              locked: false,
              note: '',
              created_at_ms: Date.now(),
              ...partial,
            };

        const next = new Map(state.annotations);
        next.set(id, updated);
        return { annotations: next };
      }),

    clearStaleTargets: (nowMs) =>
      set((state) => {
        const cutoff = nowMs - RADAR_CONSTANTS.STALE_TARGET_MS;
        const nextTargets = new Map<string, RadarTarget>();
        const nextHistory = new Map<string, RadarTarget[]>();

        for (const [id, target] of state.targets) {
          if (target.timestamp_ms < cutoff) continue;
          nextTargets.set(id, target);
          const trail = state.targetHistory.get(id);
          if (trail !== undefined) nextHistory.set(id, trail);
        }

        // Nothing changed — return the existing state to keep referential
        // equality and avoid spurious subscriber fires.
        if (nextTargets.size === state.targets.size) return state;

        const nextSelectedId =
          state.selectedTargetId !== null && nextTargets.has(state.selectedTargetId)
            ? state.selectedTargetId
            : null;

        return {
          targets: nextTargets,
          targetHistory: nextHistory,
          selectedTargetId: nextSelectedId,
        };
      }),

    togglePinTarget: (id) =>
      set((state) => {
        const next = new Set(state.pinnedTargetIds);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return { pinnedTargetIds: next };
      }),
  })),
);
