/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : Root Application Core & Composition
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.0.0 (Nexus Active Deployment)
 * ============================================================================
 */

import { useEffect, useState } from 'react';

import { useRadarWebSocket } from './hooks/useRadarWebSocket';
import { useMockEngine } from './hooks/useMockEngine';
import { useConfigSync } from './hooks/useConfigSync';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { enableStoreDebugLogs } from './stores/storeDebug';
import { WS_URL } from './lib/wsConfig';
import { useSystemStore } from './stores/systemStore';

import { PanelLayout } from './components/layout/PanelLayout';
import { TopBar } from './components/layout/TopBar';
import { StatusBar } from './components/layout/StatusBar';
import { PPICanvas } from './components/radar/PPICanvas';
import { Radar3D } from './components/radar/Radar3D';
import { CommandPanel } from './components/command/CommandPanel';
import { TelemetryPanel } from './components/telemetry/TelemetryPanel';
import { ShortcutOverlay } from './components/common/ShortcutOverlay';
import { BootSequence } from './components/common/BootSequence';
import { CommandPalette } from './components/command/CommandPalette';

export function App() {
  const ws = useRadarWebSocket(WS_URL);
  useMockEngine(ws.shouldUseMock);
  useConfigSync();
  const shortcuts = useKeyboardShortcuts();
  const [booted, setBooted] = useState(false);
  const radarMode = useSystemStore((s) => s.radarMode);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    return enableStoreDebugLogs();
  }, []);

  return (
    <>
      <PanelLayout
        booted={booted}
        topBar={<TopBar />}
        leftPanel={<CommandPanel />}
        centerPanel={radarMode === '3D' ? <Radar3D /> : <PPICanvas />}
        rightPanel={<TelemetryPanel />}
        statusBar={<StatusBar />}
      />
      {!booted && <BootSequence onComplete={() => setBooted(true)} />}
      <CommandPalette />
      <ShortcutOverlay open={shortcuts.overlayOpen} onClose={shortcuts.closeOverlay} />
    </>
  );
}
