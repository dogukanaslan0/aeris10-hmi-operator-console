/**
 * BootSequence — system-initialization theater.
 * =============================================================================
 * Plays once on mount, ~2.2 s total. While it runs, the underlying PanelLayout
 * has already started bringing up WebSocket + mock engine in the background,
 * so by the time the curtain lifts, the first frame is usually painted.
 *
 * Stage progression is derived from elapsed time (one rAF tick), not from
 * real hardware events — this is theatre, not a true bring-up sequence. The
 * staged checklist mirrors the genuine STM32 init order so the operator gets
 * a faithful mental model of "what's happening under the hood".
 *
 * Auto-dismisses via `onComplete` callback. The parent (App.tsx) animates
 * the unmount with a fade-out.
 */

import { useEffect, useState } from 'react';

import { IconCheck } from '../icons';

import './BootSequence.css';

interface Stage {
  label: string;
  /** Time in ms at which this stage is considered "done". */
  doneAtMs: number;
}

const STAGES: readonly Stage[] = [
  { label: 'FPGA bitstream verified',         doneAtMs: 221 },
  { label: 'STM32 handshake [23,46,158,237]', doneAtMs: 443 },
  { label: 'OCXO lock acquired',              doneAtMs: 664 },
  { label: 'Phased array calibration',        doneAtMs: 886 },
  { label: 'Operator profile loaded',         doneAtMs: 1107 },
];

const TOTAL_DURATION_MS = 1230;
const FADE_OUT_MS = 200;

export interface BootSequenceProps {
  onComplete: () => void;
}

export function BootSequence(props: BootSequenceProps) {
  const [elapsed, setElapsed] = useState(0);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const start = performance.now();
    let rafId = 0;
    let timeoutId = 0;

    const tick = (now: number): void => {
      const ms = now - start;
      setElapsed(ms);
      if (ms < TOTAL_DURATION_MS) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        setFadingOut(true);
        timeoutId = window.setTimeout(props.onComplete, FADE_OUT_MS);
      }
    };
    rafId = window.requestAnimationFrame(tick);

    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      if (timeoutId !== 0) window.clearTimeout(timeoutId);
    };
  }, [props.onComplete]);

  const progress = Math.min(1, elapsed / TOTAL_DURATION_MS);

  return (
    <div
      className="boot-seq"
      data-fading={fadingOut || undefined}
      role="status"
      aria-live="polite"
      aria-busy={!fadingOut}
    >
      <div className="boot-seq__substrate" aria-hidden />

      <div className="boot-seq__card">
        <span className="boot-seq__bracket boot-seq__bracket--tl" aria-hidden />
        <span className="boot-seq__bracket boot-seq__bracket--tr" aria-hidden />
        <span className="boot-seq__bracket boot-seq__bracket--bl" aria-hidden />
        <span className="boot-seq__bracket boot-seq__bracket--br" aria-hidden />

        <header className="boot-seq__head">
          <span className="boot-seq__brand-mark" aria-hidden>
            <img src="/aeris_10_logo.png" alt="AERIS-10 Logo" className="boot-seq__brand-logo-img" />
          </span>
          <div className="boot-seq__brand-text">
            <span className="boot-seq__eyebrow">INITIALIZING</span>
            <h1 className="boot-seq__title">AERIS-10</h1>
            <span className="boot-seq__sub">
              C2 TERMINAL · GHOST PROTOCOL · v1.0.0
            </span>
          </div>
        </header>

        <div className="boot-seq__progress" aria-hidden>
          <div className="boot-seq__progress-track">
            <div
              className="boot-seq__progress-bar"
              style={{ width: `${(progress * 100).toFixed(2)}%` }}
            />
            <div className="boot-seq__progress-grid" />
          </div>
          <span className="boot-seq__progress-readout">
            <span className="boot-seq__progress-num">
              {Math.round(progress * 100).toString().padStart(2, '0')}
            </span>
            <span className="boot-seq__progress-unit">%</span>
          </span>
        </div>

        <ul className="boot-seq__stages">
          {STAGES.map((stage, i) => {
            const done = elapsed >= stage.doneAtMs;
            const active = !done && (i === 0 || elapsed >= STAGES[i - 1].doneAtMs);
            return (
              <li
                key={i}
                className="boot-seq__stage"
                data-done={done || undefined}
                data-active={active || undefined}
              >
                <span className="boot-seq__stage-glyph">
                  {done ? (
                    <IconCheck size={11} strokeWidth={2} />
                  ) : active ? (
                    <span className="boot-seq__stage-spinner" />
                  ) : (
                    <span className="boot-seq__stage-bullet" />
                  )}
                </span>
                <span className="boot-seq__stage-label">{stage.label}</span>
                <span className="boot-seq__stage-time">
                  {done ? 'OK' : active ? '··' : ''}
                </span>
              </li>
            );
          })}
        </ul>

        <footer className="boot-seq__foot">
          <span>X-BAND · 10.5 GHz · PLFM</span>
          <span className="boot-seq__foot-divider" />
          <span>SECURE · LOCAL</span>
        </footer>
      </div>
    </div>
  );
}
