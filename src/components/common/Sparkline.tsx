/**
 * Sparkline — zero-dependency SVG mini line chart.
 * =============================================================================
 * Used by PACurrentGrid (16 channels). Picked over Recharts to avoid pulling
 * ~120 KB of gzipped bundle for what amounts to a polyline + a marker dot.
 *
 *   <Sparkline
 *     data={[280, 285, 290, ...]}
 *     min={100}
 *     max={600}
 *     thresholds={[{ value: 450, color: '#ffb800' }]}
 *     alertThreshold={500}
 *   />
 *
 * Pass `min`/`max` to pin the Y axis; omit them for auto-fit. `thresholds`
 * draws horizontal reference lines (e.g. nominal envelope). `alertThreshold`
 * triggers a pulsing red border when the latest value crosses it.
 */

import './Sparkline.css';

export interface SparklineThreshold {
  value: number;
  color: string;
}

export interface SparklineProps {
  data: readonly number[];
  min?: number;
  max?: number;
  width?: number;
  height?: number;
  color?: string;
  thresholds?: readonly SparklineThreshold[];
  alertThreshold?: number;
}

export function Sparkline(props: SparklineProps) {
  const W = props.width ?? 60;
  const H = props.height ?? 22;
  const stroke = props.color ?? 'var(--accent-cyan)';
  const data = props.data;

  if (data.length < 2) {
    return (
      <svg
        className="aeris-sparkline"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        aria-hidden
      />
    );
  }

  let lo = props.min;
  let hi = props.max;
  if (lo === undefined || hi === undefined) {
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (const v of data) {
      if (v < dataMin) dataMin = v;
      if (v > dataMax) dataMax = v;
    }
    lo = lo ?? dataMin;
    hi = hi ?? dataMax;
  }
  const range = Math.max(hi - lo, 1e-6);

  const xStep = W / (data.length - 1);
  let points = '';
  for (let i = 0; i < data.length; i += 1) {
    const x = (i * xStep).toFixed(1);
    const y = (H - ((data[i] - lo) / range) * H).toFixed(1);
    points += `${i === 0 ? '' : ' '}${x},${y}`;
  }

  const latest = data[data.length - 1];
  const latestY = H - ((latest - lo) / range) * H;
  const alerted =
    props.alertThreshold !== undefined && latest > props.alertThreshold;

  return (
    <svg
      className={`aeris-sparkline${alerted ? ' aeris-sparkline--alert' : ''}`}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {props.thresholds?.map((t, i) => {
        const ty = H - ((t.value - lo) / range) * H;
        return (
          <line
            key={i}
            x1={0}
            y1={ty}
            x2={W}
            y2={ty}
            stroke={t.color}
            strokeWidth={0.5}
            strokeDasharray="2 2"
            opacity={0.55}
          />
        );
      })}

      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      <circle cx={W - 0.5} cy={latestY} r={1.5} fill={stroke} />
    </svg>
  );
}
