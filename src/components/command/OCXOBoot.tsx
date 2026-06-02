/**
 * OCXOBoot — Section B of the command panel.
 * =============================================================================
 * Renders only while `system.connection === 'OCXO_WARMUP'`. Surfaces the
 * countdown so the operator understands why START_SCAN is gated.
 */

import { useSystemStore } from '../../stores/systemStore';

export function OCXOBoot() {
  const system = useSystemStore((s) => s.current);

  if (system === null) return null;
  if (system.connection !== 'OCXO_WARMUP') return null;

  const elapsed = system.ocxo_warmup_elapsed_s;
  const total = system.ocxo_warmup_total_s;
  const percent = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
  const remaining = Math.max(0, total - elapsed);

  return (
    <section className="ocxo" aria-label="OCXO warm-up status">
      <h2 className="ocxo__title">
        <span className="ocxo__title-glyph" aria-hidden>
          ⟳
        </span>
        OCXO WARM-UP
      </h2>

      <div className="ocxo__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <div className="ocxo__bar" style={{ width: `${percent}%` }} />
        <span className="ocxo__percent">{percent.toFixed(0)}%</span>
      </div>

      <div className="ocxo__remaining">
        Remaining: <strong>{formatDuration(remaining)}</strong>
      </div>

      <div className="ocxo__note">
        Radar is disabled during this period.
      </div>
    </section>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
