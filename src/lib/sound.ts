/**
 * sound.ts — minimal Web Audio alert tones for operator-facing events.
 * =============================================================================
 * Single shared AudioContext, lazy-initialised on first beep (browsers
 * require a user gesture before any audio plays — the first alarm after
 * page load will typically arrive after the operator has clicked something).
 *
 * Preference persists in localStorage (`aeris.sound`). Default = enabled.
 *
 *   import { playAlertBeep, setSoundEnabled, isSoundEnabled } from '@/lib/sound';
 *   playAlertBeep('critical');   // hi-lo double beep, ~280 ms apart
 *   playAlertBeep('warning');    // single mid tone
 *   playAlertBeep('info');       // single low tone
 *
 * No external assets — three oscillator envelopes, ~5 KB of code.
 */

let audioCtx: AudioContext | null = null;

let soundEnabled = readInitialPreference();

function readInitialPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored = window.localStorage.getItem('aeris.sound');
    return stored !== '0'; // default ON unless operator explicitly disabled
  } catch {
    return true;
  }
}

function getCtx(): AudioContext | null {
  if (audioCtx !== null) return audioCtx;
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (typeof Ctor !== 'function') return null;
  try {
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export function playAlertBeep(severity: AlertSeverity = 'critical'): void {
  if (!soundEnabled) return;
  const ctx = getCtx();
  if (ctx === null) return;

  // Autoplay policy — some browsers suspend the context until user gesture
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {
      /* ignored — gesture not yet received */
    });
  }

  const playTone = (frequency: number, startOffsetSec: number, durationSec = 0.22): void => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = 'sine';

    const start = ctx.currentTime + startOffsetSec;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
    osc.start(start);
    osc.stop(start + durationSec + 0.02);
  };

  switch (severity) {
    case 'critical':
      // Hi-lo double-beep — distinct from ambient electronics
      playTone(880, 0);
      playTone(660, 0.28);
      break;
    case 'warning':
      playTone(660, 0);
      break;
    case 'info':
      playTone(440, 0, 0.16);
      break;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('aeris.sound', enabled ? '1' : '0');
  } catch {
    /* ignored — private mode or full quota */
  }
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}
