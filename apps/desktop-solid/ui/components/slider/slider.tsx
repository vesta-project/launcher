import type { JSX } from '@solidjs/web';
import { For, children, createMemo, createSignal, createUniqueId, Show } from 'solid-js';
import type { ControlSize } from '../../foundation/types';
import '../field/field.css';
import './slider.css';

export interface SliderProps {
  /** One or more thumb values. Single-thumb: `[value]`. Range: `[min, max]`. */
  value?: number[];
  defaultValue?: number[];
  onChange?: (value: number[]) => void;
  /** Fired when the user finishes dragging a thumb. */
  onChangeEnd?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Minimum steps between adjacent thumbs. Defaults to 0. */
  minStepsBetweenThumbs?: number;
  label?: JSX.Element;
  description?: JSX.Element;
  /** Error message. When present the field is marked invalid. */
  error?: JSX.Element;
  /** Show the current value beside the label. Defaults to true when `getValueLabel` is unset. */
  showValue?: boolean;
  /** Format the value label, e.g. `(v) => `${v[0]}–${v[1]} GB``. Defaults to joined numbers. */
  getValueLabel?: (value: number[]) => string;
  size?: ControlSize;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  /** Per-thumb accessible names when there is no visible label. Overrides `aria-label` for each thumb. */
  'aria-label-thumbs'?: string[];
  class?: string;
  style?: JSX.CSSProperties;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function snap(n: number, min: number, max: number, step: number) {
  const snapped = Math.round((n - min) / step) * step + min;
  return clamp(snapped, min, max);
}

function sameValues(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Range control. Pointer math is owned here — Kobalte 2 alpha’s slider does not track
 * thumb position under Solid 2 during drag. Pattern matches vesta-launcher GameOptionsEditor:
 * local draft drives thumbs while the pointer is down. Supports one or more thumbs.
 */
export function Slider(props: SliderProps) {
  const label = children(() => props.label);
  const description = children(() => props.description);
  const error = children(() => props.error);
  const min = () => props.min ?? 0;
  const max = () => props.max ?? 100;
  const step = () => props.step ?? 1;
  const minGap = () => (props.minStepsBetweenThumbs ?? 0) * step();
  const showValue = () => props.showValue ?? true;
  const format = (vals: number[]) =>
    props.getValueLabel?.(vals) ?? (vals.length === 1 ? String(vals[0]) : vals.join(' – '));
  const isControlled = () => props.value !== undefined;

  const [draft, setDraft] = createSignal<number[] | undefined>();
  const [focusedThumb, setFocusedThumb] = createSignal(0);

  const values = createMemo(() => {
    const d = draft();
    if (d !== undefined) return d;
    if (isControlled()) return props.value!;
    return props.defaultValue ?? [min()];
  });

  /** 0–1 along the value span. */
  const ratioOf = (n: number) => {
    const span = max() - min();
    if (span <= 0) return 0;
    return clamp((n - min()) / span, 0, 1);
  };

  /**
   * Thumb travel is inset by half the handle so the grab stays inside the track
   * bounds while the bar itself stays full-bleed.
   */
  const thumbLeft = (n: number) =>
    `calc(var(--slider-thumb-size) / 2 + (100% - var(--slider-thumb-size)) * ${ratioOf(n)})`;

  const fillStyle = createMemo(() => {
    const vals = values();
    const travel = '(100% - var(--slider-thumb-size))';
    const half = 'var(--slider-thumb-size) / 2';
    if (vals.length === 1) {
      return {
        left: '0',
        width: `calc(${half} + ${travel} * ${ratioOf(vals[0]!)})`,
      };
    }
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return {
      left: `calc(${half} + ${travel} * ${ratioOf(lo)})`,
      width: `calc(${travel} * ${ratioOf(hi) - ratioOf(lo)})`,
    };
  });

  const labelId = createUniqueId();
  const descId = createUniqueId();
  const inputId = () => props.id ?? `slider-${labelId}`;

  let trackEl: HTMLDivElement | undefined;
  let dragging = false;
  let activeThumb = 0;

  const commitAt = (index: number, nextRaw: number, end: boolean) => {
    const s = step();
    const gap = minGap();
    const current = values();
    const next = current.slice();
    const lo = index === 0 ? min() : next[index - 1]! + gap;
    const hi = index === next.length - 1 ? max() : next[index + 1]! - gap;
    next[index] = snap(clamp(nextRaw, lo, hi), min(), max(), s);
    if (sameValues(current, next) && !end) return;
    setDraft(next);
    props.onChange?.(next);
    if (end) {
      if (isControlled()) setDraft(undefined);
      props.onChangeEnd?.(next);
    }
  };

  const thumbSizePx = () => {
    if (!trackEl) return 16;
    const raw = getComputedStyle(trackEl).getPropertyValue('--slider-thumb-size').trim();
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : 16;
  };

  /** Map pointer X through the inset travel range (not the full track width). */
  const valueFromClientX = (clientX: number) => {
    const rect = trackEl!.getBoundingClientRect();
    const thumb = thumbSizePx();
    const travel = rect.width - thumb;
    if (travel <= 0) return values()[activeThumb]!;
    const ratio = clamp((clientX - rect.left - thumb / 2) / travel, 0, 1);
    return min() + ratio * (max() - min());
  };

  const nearestThumb = (clientX: number) => {
    const target = valueFromClientX(clientX);
    const vals = values();
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < vals.length; i++) {
      const dist = Math.abs(vals[i]! - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  };

  const focusThumb = (index: number) => {
    setFocusedThumb(index);
    trackEl
      ?.querySelectorAll<HTMLElement>('[data-vesta=slider-thumb]')
      [index]?.focus();
  };

  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (props.disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging = true;
    activeThumb = nearestThumb(e.clientX);
    focusThumb(activeThumb);
    commitAt(activeThumb, valueFromClientX(e.clientX), false);
  };

  const onPointerMove = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (!dragging || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    commitAt(activeThumb, valueFromClientX(e.clientX), false);
  };

  const onPointerUp = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!dragging) return;
    dragging = false;
    commitAt(activeThumb, valueFromClientX(e.clientX), true);
  };

  const onKeyDown = (index: number) => (e: KeyboardEvent) => {
    if (props.disabled) return;
    const s = step();
    const page = Math.max(s, (max() - min()) / 10);
    const current = values()[index]!;
    let next: number | undefined;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = current - (e.shiftKey ? page : s);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = current + (e.shiftKey ? page : s);
        break;
      case 'Home':
        next = min();
        break;
      case 'End':
        next = max();
        break;
      case 'PageDown':
        next = current - page;
        break;
      case 'PageUp':
        next = current + page;
        break;
      default:
        return;
    }
    e.preventDefault();
    activeThumb = index;
    setFocusedThumb(index);
    commitAt(index, next, true);
  };

  return (
    <div
      data-vesta="field"
      data-size={props.size ?? 'md'}
      data-disabled={props.disabled ? '' : undefined}
      data-invalid={error() != null ? '' : undefined}
      class={props.class}
      style={props.style}
    >
      <Show when={label() || showValue()}>
        <div data-vesta="slider-header">
          <Show when={label()}>
            <label data-vesta="field-label" id={labelId} for={inputId()}>
              {label()}
            </label>
          </Show>
          <Show when={showValue()}>
            <div data-vesta="slider-value">{format(values())}</div>
          </Show>
        </div>
      </Show>
      <div data-vesta="slider-control">
        <div
          ref={(el) => {
            trackEl = el;
          }}
          data-vesta="slider-track"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div data-vesta="slider-fill" style={fillStyle()} />
          <For each={values()} keyed={false}>
            {(thumbValue, index) => (
              <span
                data-vesta="slider-thumb"
                role="slider"
                id={index === 0 ? inputId() : `${inputId()}-${index}`}
                tabindex={props.disabled ? undefined : 0}
                aria-valuemin={
                  index === 0 ? min() : values()[index - 1]! + minGap()
                }
                aria-valuemax={
                  index === values().length - 1 ? max() : values()[index + 1]! - minGap()
                }
                aria-valuenow={thumbValue()}
                aria-valuetext={String(thumbValue())}
                aria-orientation="horizontal"
                aria-disabled={props.disabled ? 'true' : undefined}
                aria-required={props.required ? 'true' : undefined}
                aria-invalid={error() != null ? 'true' : undefined}
                aria-label={
                  props['aria-label-thumbs']?.[index] ??
                  (values().length > 1
                    ? `${props['aria-label'] ?? 'Value'} ${index + 1} of ${values().length}`
                    : props['aria-label'])
                }
                aria-labelledby={
                  label() && !props['aria-label'] && !props['aria-label-thumbs']?.[index]
                    ? labelId
                    : undefined
                }
                aria-describedby={description() || error() ? descId : undefined}
                data-focused={focusedThumb() === index ? '' : undefined}
                style={{ left: thumbLeft(thumbValue()) }}
                onKeyDown={onKeyDown(index)}
                onFocus={() => setFocusedThumb(index)}
              />
            )}
          </For>
        </div>
      </div>
      <Show when={props.name}>
        <input type="hidden" name={props.name} value={values().join(',')} disabled={props.disabled} />
      </Show>
      <Show when={description()}>
        <div data-vesta="field-description" id={descId}>
          {description()}
        </div>
      </Show>
      <Show when={error()}>
        <div data-vesta="field-error" id={description() ? undefined : descId}>
          {error()}
        </div>
      </Show>
    </div>
  );
}
