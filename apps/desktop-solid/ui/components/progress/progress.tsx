import { Progress as KobalteProgress } from '@kobalte/core/progress';
import type { JSX } from '@solidjs/web';
import { children, Show } from 'solid-js';
import type { Tone } from '../../foundation/types';
import './progress.css';

export interface ProgressProps {
  /** 0–100. Omit for indeterminate progress. */
  value?: number;
  /** Text above the bar, e.g. "Downloading assets". */
  label?: JSX.Element;
  /** Text after the label, e.g. "3 of 12" or "42%". */
  valueLabel?: string;
  tone?: Tone;
  size?: 'sm' | 'md';
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  class?: string;
  style?: JSX.CSSProperties;
}

export function Progress(props: ProgressProps) {
  const label = children(() => props.label);
  return (
    <KobalteProgress
      data-vesta="progress"
      data-tone={props.tone ?? 'accent'}
      data-size={props.size ?? 'md'}
      class={props.class}
      style={props.style}
      value={props.value ?? 0}
      indeterminate={props.value == null}
      getValueLabel={() => props.valueLabel ?? (props.value == null ? '' : `${Math.round(props.value)}%`)}
      aria-label={props['aria-label']}
    >
      <Show when={label() || props.valueLabel}>
        <div data-vesta="progress-header">
          <KobalteProgress.Label data-vesta="progress-label">{label()}</KobalteProgress.Label>
          <KobalteProgress.ValueLabel data-vesta="progress-value" />
        </div>
      </Show>
      <KobalteProgress.Track data-vesta="progress-track">
        <KobalteProgress.Fill data-vesta="progress-fill" />
      </KobalteProgress.Track>
    </KobalteProgress>
  );
}
