/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : Global Tactical Command Palette Interface (Ctrl+K)
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.0.0 (Nexus Active Deployment)
 * ============================================================================
 */

import { useEffect, useRef, useState } from 'react';
import { useSystemStore } from '../../stores/systemStore';
import { useTargetStore } from '../../stores/radarStore';
import { useTelemetryStore } from '../../stores/telemetryStore';
import { useRadarWebSocket } from '../../hooks/useRadarWebSocket';
import { WS_URL } from '../../lib/wsConfig';
import { shortId } from './TargetList';
import { IconSearch } from '../icons';

import './CommandPalette.css';

interface CommandOption {
  id: string;
  category: string;
  phrase: string;
  description: string;
  action: () => void;
  shortcutHint?: string;
}

export function CommandPalette() {
  const open = useSystemStore((s) => s.commandPaletteOpen);
  const setOpen = useSystemStore((s) => s.setCommandPaletteOpen);
  const config = useSystemStore((s) => s.config);
  const setConfig = useSystemStore((s) => s.setConfig);
  const setLayoutPreset = useSystemStore((s) => s.setLayoutPreset);

  const targetsMap = useTargetStore((s) => s.targets);
  const selectTarget = useTargetStore((s) => s.selectTarget);
  
  const alarms = useTelemetryStore((s) => s.alarms);
  const acknowledgeAlarm = useTelemetryStore((s) => s.acknowledgeAlarm);
  
  const { send } = useRadarWebSocket(WS_URL);

  const [input, setInput] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const targets = Array.from(targetsMap.values());

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setInput('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open, setOpen]);

  if (!open) return null;

  // ── Commands Compilation ───────────────────────────────────────────────────
  const options: CommandOption[] = [];

  const cleanInput = input.trim().toLowerCase();

  // 1. Alarm Commands
  const unackedCount = alarms.filter((a) => !a.acknowledged).length;
  if (unackedCount > 0) {
    options.push({
      id: 'ack-all',
      category: 'ALARM',
      phrase: 'ack',
      description: `Acknowledge all active alarms (${unackedCount} active)`,
      shortcutHint: 'Enter to clear all',
      action: () => {
        const unacked = alarms.filter((a) => !a.acknowledged);
        for (const alarm of unacked) {
          acknowledgeAlarm(alarm.id, 'OPERATOR');
          send({ type: 'ACK_ALARM', alarm_id: alarm.id, operator: 'OPERATOR' });
        }
      },
    });
  }

  // 2. Beam Steering Commands
  // If operator types "steer <number>", dynamically compile the target angle option
  const steerMatch = cleanInput.match(/^steer\s*(\d+)?$/);
  if (steerMatch) {
    const angle = steerMatch[1] ? parseInt(steerMatch[1], 10) : null;
    const boundedAngle = angle !== null ? Math.min(360, Math.max(0, angle)) : null;

    options.push({
      id: 'steer-angle',
      category: 'STEERING',
      phrase: input,
      description: boundedAngle !== null 
        ? `Steer phased array antenna beam to ${boundedAngle}° azimuth`
        : 'Steer phased array antenna beam... (e.g. steer 120)',
      shortcutHint: boundedAngle !== null ? 'Enter to steer' : undefined,
      action: () => {
        if (boundedAngle !== null) {
          setConfig({ azimuth_start_deg: boundedAngle });
        }
      },
    });
  } else {
    options.push({
      id: 'steer-base',
      category: 'STEERING',
      phrase: 'steer',
      description: 'Steer phased array antenna beam to a specific azimuth angle',
      shortcutHint: 'steer <0-360>',
      action: () => {
        setInput('steer ');
        inputRef.current?.focus();
      },
    });
  }

  // 3. Target Locks
  // If operator types "go <something>", filter active targets
  const goMatch = cleanInput.match(/^go\s*(.*)$/);
  if (goMatch) {
    const filterText = goMatch[1].trim();
    const matchedTargets = targets.filter(t => {
      if (!filterText) return true;
      const idStr = shortId(t.id).toLowerCase();
      const classStr = t.classification.toLowerCase();
      return idStr.includes(filterText) || classStr.includes(filterText);
    });

    for (const target of matchedTargets.slice(0, 5)) {
      const tgtShortId = shortId(target.id);
      options.push({
        id: `go-target-${target.id}`,
        category: 'TARGET',
        phrase: `go ${tgtShortId.toLowerCase()}`,
        description: `Lock sensor beam and track TGT-${tgtShortId} (${target.classification.toUpperCase()})`,
        shortcutHint: 'Enter to lock',
        action: () => {
          selectTarget(target.id);
        },
      });
    }
  } else {
    options.push({
      id: 'go-base',
      category: 'TARGET',
      phrase: 'go',
      description: 'Lock sensor tracking and focus detail overlay on target',
      shortcutHint: 'go <target-id>',
      action: () => {
        setInput('go ');
        inputRef.current?.focus();
      },
    });
  }

  // 4. Layout Presets
  options.push({
    id: 'layout-watch',
    category: 'LAYOUT',
    phrase: 'layout watch',
    description: 'Set Watch layout preset (Collapses sidebars, expands PPI radar)',
    shortcutHint: 'Alt+1',
    action: () => setLayoutPreset('watch'),
  });
  options.push({
    id: 'layout-engagement',
    category: 'LAYOUT',
    phrase: 'layout engagement',
    description: 'Set Engagement layout preset (Standard balanced operator view)',
    shortcutHint: 'Alt+2',
    action: () => setLayoutPreset('engagement'),
  });
  options.push({
    id: 'layout-diagnostic',
    category: 'LAYOUT',
    phrase: 'layout diagnostic',
    description: 'Set Diagnostic layout preset (Expanded sidebars for telemetries)',
    shortcutHint: 'Alt+3',
    action: () => setLayoutPreset('diagnostic'),
  });

  // 5. Scan Controls
  options.push({
    id: 'scan-start',
    category: 'SYSTEM',
    phrase: 'start',
    description: 'Initiate radar transmitter scanning sweep',
    action: () => send({ type: 'START_SCAN' }),
  });
  options.push({
    id: 'scan-stop',
    category: 'SYSTEM',
    phrase: 'stop',
    description: 'Freeze / cease active radar transmitter scanning sweep',
    action: () => send({ type: 'STOP_SCAN' }),
  });

  // 6. Range scale
  options.push({
    id: 'reset-scale',
    category: 'DISPLAY',
    phrase: 'reset scale',
    description: 'Reset radar range scale overlay zoom factor to default (1.5 km)',
    shortcutHint: 'R key',
    action: () => useSystemStore.getState().setRadarRangeScale(1536),
  });

  // ── Fuzzy Filtering ────────────────────────────────────────────────────────
  const filteredOptions = options.filter((opt) => {
    if (!cleanInput) return true;
    
    // Exact match triggers
    if (cleanInput.startsWith('steer') && opt.id === 'steer-angle') return true;
    if (cleanInput.startsWith('go') && opt.id.startsWith('go-target-')) return true;

    // Standard filter
    return (
      opt.phrase.toLowerCase().includes(cleanInput) ||
      opt.category.toLowerCase().includes(cleanInput) ||
      opt.description.toLowerCase().includes(cleanInput)
    );
  });

  // Key handlers
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((idx) => (idx + 1) % Math.max(1, filteredOptions.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((idx) => (idx - 1 + filteredOptions.length) % Math.max(1, filteredOptions.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const activeOpt = filteredOptions[selectedIndex];
      if (activeOpt) {
        activeOpt.action();
        setOpen(false);
      }
    }
  };

  return (
    <div className="cmd-palette-backdrop">
      <div ref={containerRef} className="cmd-palette" role="dialog" aria-modal="true" aria-label="Command Palette">
        <div className="cmd-palette__input-wrapper">
          <span className="cmd-palette__search-icon" aria-hidden>
            <IconSearch size={16} />
          </span>
          <input
            ref={inputRef}
            type="text"
            className="cmd-palette__input"
            placeholder="Type tactical command... (e.g. 'ack', 'steer 140', 'go drn', 'layout watch')"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="cmd-palette__esc-tag">ESC</kbd>
        </div>

        <div className="cmd-palette__results">
          {filteredOptions.length === 0 ? (
            <div className="cmd-palette__empty">No matching command found</div>
          ) : (
            filteredOptions.map((opt, idx) => (
              <button
                key={opt.id}
                type="button"
                className="cmd-palette__option"
                data-selected={idx === selectedIndex || undefined}
                onClick={() => {
                  opt.action();
                  setOpen(false);
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div className="cmd-palette__option-content">
                  <span className="cmd-palette__option-badge" data-category={opt.category}>
                    {opt.category}
                  </span>
                  <div className="cmd-palette__option-text">
                    <span className="cmd-palette__option-phrase">{opt.phrase || '/'}</span>
                    <span className="cmd-palette__option-desc">{opt.description}</span>
                  </div>
                </div>
                {opt.shortcutHint && (
                  <span className="cmd-palette__option-shortcut">{opt.shortcutHint}</span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="cmd-palette__footer">
          <span>↑↓ to navigate</span>
          <span>·</span>
          <span>↵ to execute</span>
          <span>·</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
