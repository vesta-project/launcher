import type { JSX } from '@solidjs/web';
import type { ControlSize } from '../foundation/types';

/** Kobalte's visually hidden input style, so the native input sits where Kobalte's would. */
const hidden: JSX.CSSProperties = {
  border: '0', clip: 'rect(0 0 0 0)', 'clip-path': 'inset(50%)', height: '1px', margin: '0 -1px -1px 0',
  overflow: 'hidden', padding: '0', position: 'absolute', width: '1px', 'white-space': 'nowrap',
};

export interface NativeChoiceProps {
  kind: 'checkbox' | 'switch';
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  value?: string;
  size?: ControlSize;
  id?: string;
  class?: string;
  style?: JSX.CSSProperties;
  'aria-label'?: string;
  /** The visible control (track and thumb, or box and tick). */
  children: JSX.Element;
}

/**
 * A bare, controlled checkbox or switch on a native input, for rows that render many of them
 * (resource lists, tables). Same DOM hooks and root states as the Kobalte version, so it looks
 * identical, at a fraction of the cost: no context, no presence, no polymorphic layers.
 * The checked state always follows the prop; a click asks the owner to change it.
 */
export function NativeChoice(props: NativeChoiceProps) {
  return (
    <label
      data-vesta={props.kind}
      data-tone="accent"
      data-size={props.size ?? 'md'}
      data-checked={props.checked ? '' : undefined}
      data-disabled={props.disabled ? '' : undefined}
      class={props.class}
      style={props.style}
    >
      <input
        type="checkbox"
        role={props.kind === 'switch' ? 'switch' : undefined}
        style={hidden}
        id={props.id}
        name={props.name}
        value={props.value}
        checked={props.checked}
        disabled={props.disabled}
        aria-label={props['aria-label']}
        onChange={(event) => {
          const next = event.currentTarget.checked;
          // Controlled: stay on the prop until the owner changes it.
          event.currentTarget.checked = props.checked;
          props.onChange?.(next);
        }}
      />
      {props.children}
    </label>
  );
}
