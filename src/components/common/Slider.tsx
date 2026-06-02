/**
 * Slider — Ghost-Protocol range input with track fill + drag preview.
 * =============================================================================
 * Themed with the Dust Gaku palette. Native `<input type="range">` underneath
 * — keyboard accessibility, screen reader support, focus management all free.
 *
 * Visual layers on top of the native control:
 *
 *   1. Filled track  — gradient stops at the live value (CSS var --slider-pct)
 *   2. Hollow thumb  — ring outlined in the tone color, hollow centre
 *   3. Drag preview  — floating callout pinned above the thumb while pointer
 *                      is down; matches the tone (cyan / amber / violet / …)
 *   4. Range bounds  — small min / max labels underneath, formatted with the
 *                      same `format` callback as the live value for unit parity
 *
 * Backward compatible: every existing call site (BeamControl, RadarConfig)
 * keeps working — `showRange` defaults to `true` so operators get the extra
 * context for free.
 */

import { useState } from 'react';

import './Slider.css';

export type SliderTone =
  | 'info'
  | 'nominal'
  | 'caution'
  | 'critical'
  | 'violet';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Override the value formatter. Receives the raw number. */
  format?: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
  tone?: SliderTone;
  /** Show min / max labels under the track. Default: true. */
  showRange?: boolean;
}

export function Slider(props: SliderProps) {
  const step = props.step ?? 1;
  const showRange = props.showRange ?? true;
  const [isDragging, setIsDragging] = useState(false);

  const range = props.max - props.min;
  const pct = range > 0 ? Math.max(0, Math.min(1, (props.value - props.min) / range)) : 0;
  const pctCss = `${(pct * 100).toFixed(3)}%`;

  const formatValue = (v: number): string => {
    if (props.format !== undefined) return props.format(v);
    return `${v.toFixed(precisionFor(step))}${props.unit ?? ''}`;
  };

  const formatted = formatValue(props.value);

  return (
    <div
      className="aeris-slider"
      data-tone={props.tone ?? 'info'}
      data-dragging={isDragging || undefined}
      data-disabled={props.disabled || undefined}
      style={{ '--slider-pct': pctCss } as React.CSSProperties}
    >
      <div className="aeris-slider__head">
        <span className="aeris-slider__label">{props.label}</span>
        <span className="aeris-slider__value" aria-hidden>
          {formatted}
        </span>
      </div>

      <div className="aeris-slider__track-wrap">
        <span className="aeris-slider__drag-preview" aria-hidden>
          {formatted}
        </span>

        <span className="aeris-slider__track" aria-hidden>
          <span className="aeris-slider__track-fill" />
        </span>

        <input
          type="range"
          className="aeris-slider__input"
          min={props.min}
          max={props.max}
          step={step}
          value={props.value}
          onChange={(event) => props.onChange(parseFloat(event.target.value))}
          onPointerDown={(event) => {
            if (props.disabled === true) return;
            setIsDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            setIsDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={() => setIsDragging(false)}
          onBlur={() => setIsDragging(false)}
          disabled={props.disabled}
          aria-label={props.label}
          aria-valuemin={props.min}
          aria-valuemax={props.max}
          aria-valuenow={props.value}
          aria-valuetext={formatted}
        />
      </div>

      {showRange && (
        <div className="aeris-slider__range" aria-hidden>
          <span className="aeris-slider__range-min">{formatValue(props.min)}</span>
          <span className="aeris-slider__range-tick" />
          <span className="aeris-slider__range-max">{formatValue(props.max)}</span>
        </div>
      )}
    </div>
  );
}

function precisionFor(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}
