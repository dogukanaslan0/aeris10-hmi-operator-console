/**
 * useKeyboardShortcuts — global keyboard handler with shortcut overlay state.
 * =============================================================================
 * Bindings:
 *
 *   ?         Toggle shortcut overlay
 *   Esc       Close overlay / clear target selection
 *   r         Reset range scale to default (NEXUS_MAX_RANGE_M)
 *   t         Focus first target list row
 *   1-4       Jump focus to command-panel sections
 *
 * Honours input/textarea focus — never steals keys while the operator is
 * typing in a slider or annotation field.
 */

import { useEffect, useState } from 'react';

import { useTargetStore } from '../stores/radarStore';
import { useSystemStore } from '../stores/systemStore';
import { RADAR_CONSTANTS } from '../types/radar';

export interface KeyboardShortcut {
  key: string;
  label: string;
  description: string;
  category: 'navigation' | 'selection' | 'display' | 'help';
}

export const SHORTCUTS: readonly KeyboardShortcut[] = [
  { key: '?', label: '?', description: 'Toggle this shortcut overlay', category: 'help' },
  { key: 'Esc', label: 'Esc', description: 'Clear selection / close overlay', category: 'selection' },
  { key: 'Ctrl+K', label: 'Ctrl+K', description: 'Toggle Command Palette', category: 'navigation' },
  { key: 'Alt+1', label: 'Alt+1', description: 'Watch Layout (Collapsed sidebar)', category: 'display' },
  { key: 'Alt+2', label: 'Alt+2', description: 'Engagement Layout (Standard view)', category: 'display' },
  { key: 'Alt+3', label: 'Alt+3', description: 'Diagnostic Layout (Expanded telemetry)', category: 'display' },
  { key: 'r', label: 'R', description: 'Reset range scale (Nexus default)', category: 'display' },
  { key: 't', label: 'T', description: 'Focus first target in the list', category: 'navigation' },
];

export interface UseKeyboardShortcutsResult {
  overlayOpen: boolean;
  openOverlay: () => void;
  closeOverlay: () => void;
}

export function useKeyboardShortcuts(): UseKeyboardShortcutsResult {
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const t = e.target as Element | null;
      // Skip when focus is inside a form field (preserves slider arrow-key navigation).
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        if (e.key !== 'Escape') return;
      }

      // Toggle overlay — '?' (Shift+/) or literal '?'
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setOverlayOpen((o) => !o);
        return;
      }

      if (e.key === 'Escape') {
        if (overlayOpen) {
          setOverlayOpen(false);
        } else {
          useTargetStore.getState().selectTarget(null);
        }
        return;
      }

      // ── Command Palette (Ctrl+K / Cmd+K) ───────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const sys = useSystemStore.getState();
        sys.setCommandPaletteOpen(!sys.commandPaletteOpen);
        return;
      }

      // ── Layout Presets (Alt+1 / Alt+2 / Alt+3) ─────────────────────────────
      if (e.altKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
        e.preventDefault();
        const sys = useSystemStore.getState();
        const preset =
          e.key === '1' ? 'watch' :
          e.key === '2' ? 'engagement' :
          'diagnostic';
        sys.setLayoutPreset(preset);
        return;
      }

      // Don't intercept modified keys (operator browser shortcuts still work).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 'r':
          useSystemStore
            .getState()
            .setRadarRangeScale(RADAR_CONSTANTS.NEXUS_MAX_RANGE_M);
          break;

        case 't': {
          const firstRow = document.querySelector<HTMLElement>(
            '.target-list__row',
          );
          firstRow?.focus();
          break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [overlayOpen]);

  return {
    overlayOpen,
    openOverlay: () => setOverlayOpen(true),
    closeOverlay: () => setOverlayOpen(false),
  };
}
