import type { JSX } from '@solidjs/web';
import { children, Show } from 'solid-js';
import type { Tone } from '../../foundation/types';
import './badge.css';

export type BadgeVariant = 'soft' | 'solid' | 'outline';

export interface BadgeProps {
  /** Semantic colour. Defaults to `neutral`. */
  tone?: Tone;
  /** Fill treatment. Defaults to `soft`. */
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  /** Icon before the label. */
  icon?: JSX.Element;
  title?: string;
  class?: string;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
}

/**
 * Small static label for a status or count. It is a plain span: Kobalte's badge
 * only adds `role="status"`, which would make every badge a live region and
 * announce each one in a list as it renders.
 */
export function Badge(props: BadgeProps) {
  // Slots are resolved once; reading a JSX prop twice would create it twice.
  const icon = children(() => props.icon);
  const label = children(() => props.children);

  return (
    <span
      data-vesta="badge"
      data-tone={props.tone ?? 'neutral'}
      data-variant={props.variant ?? 'soft'}
      data-size={props.size ?? 'md'}
      title={props.title}
      class={props.class}
      style={props.style}
    >
      <Show when={icon()}>
        <span data-vesta="badge-icon" aria-hidden="true">
          {icon()}
        </span>
      </Show>
      <span data-vesta="badge-label">{label()}</span>
    </span>
  );
}
