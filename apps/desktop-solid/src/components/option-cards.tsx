import type { JSX } from '@solidjs/web';
import { For, Show, createUniqueId } from 'solid-js';
import './option-cards.css';

export interface OptionCard<T extends string> {
  value: T;
  label: string;
  /** A few words; the card stays one or two lines. */
  hint?: string;
  icon?: JSX.Element;
  disabled?: boolean;
}

/**
 * Pick one of a few kinds (server software, modloader): a grid of cards with an icon, the
 * name and a short hint. Native radios underneath, so arrow keys move the choice.
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
  const name = createUniqueId();
  return (
    <div data-vesta="option-cards" role="radiogroup" aria-label={props['aria-label']}>
      <For each={props.options}>
        {(option) => {
          const disabled = () => props.disabled || option.disabled;
          return (
            <label
              data-vesta="option-card"
              data-value={option.value}
              data-selected={props.value === option.value ? '' : undefined}
              data-disabled={disabled() ? '' : undefined}
              onPointerEnter={(event) => { if (event.pointerType !== 'touch' && !disabled()) props.onWarm?.(option.value); }}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={props.value === option.value}
                disabled={disabled()}
                onFocus={() => props.onWarm?.(option.value)}
                onChange={() => props.onChange(option.value)}
              />
              <Show when={option.icon}>{(icon) => <span data-vesta="option-card-icon">{icon()}</span>}</Show>
              <span data-vesta="option-card-text">
                <span data-vesta="option-card-label">{option.label}</span>
                <Show when={option.hint}>{(hint) => <span data-vesta="option-card-hint">{hint()}</span>}</Show>
              </span>
            </label>
          );
        }}
      </For>
    </div>
  );
}
