import type { JSX } from '@solidjs/web';
import { SegmentedControl } from '@vesta/ui';
import { createMemo } from 'solid-js';
import './option-cards.css';

export interface OptionCard<T extends string> {
  value: T;
  label: string;
  /** A few words, shown on hover. */
  hint?: string;
  icon?: JSX.Element;
  disabled?: boolean;
}

/**
 * Pick one of a few kinds (server software, modloader): a tall segmented control with each
 * kind's mark above its name. One row when it fits, else two even rows.
 */
export function OptionCards<T extends string>(props: {
  value: T | undefined;
  options: readonly OptionCard<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  'aria-label': string;
  /** Called with the option under the pointer or focus, e.g. to warm its data. */
  onWarm?: (value: T) => void;
}) {
  const options = createMemo(() => props.options.map((option) => ({
    value: option.value,
    label: option.label,
    tip: option.hint,
    icon: option.icon,
    disabled: option.disabled,
  })), { name: 'option-cards:options' });
  const warm = (target: EventTarget | null) => {
    const input = target instanceof Element ? target.closest('[data-vesta="segmented-item"]')?.querySelector('input') : null;
    const option = props.options.find((entry) => entry.value === input?.value);
    if (option && !option.disabled && !props.disabled) props.onWarm?.(option.value);
  };
  return (
    <div
      data-vesta="option-cards"
      style={{ '--option-count': props.options.length, '--option-row': Math.ceil(props.options.length / 2) }}
      onPointerOver={(event) => { if (event.pointerType !== 'touch') warm(event.target); }}
      onFocusIn={(event) => warm(event.target)}
    >
      <SegmentedControl
        fill
        aria-label={props['aria-label']}
        value={props.value}
        options={options()}
        onChange={(value) => props.onChange(value as T)}
        disabled={props.disabled}
      />
    </div>
  );
}
