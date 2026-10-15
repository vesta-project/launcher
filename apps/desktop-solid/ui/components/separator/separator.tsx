import { Separator as KobalteSeparator } from '@kobalte/core/separator';
import type { JSX } from '@solidjs/web';
import './separator.css';

export interface SeparatorProps {
  /** Defaults to `horizontal`. */
  orientation?: 'horizontal' | 'vertical';
  class?: string;
  style?: JSX.CSSProperties;
}

/** Visual divider for grouping content. Prefer this over a raw `<hr>`. */
export function Separator(props: SeparatorProps) {
  return (
    <KobalteSeparator
      data-vesta="separator"
      orientation={props.orientation ?? 'horizontal'}
      class={props.class}
      style={props.style}
    />
  );
}
