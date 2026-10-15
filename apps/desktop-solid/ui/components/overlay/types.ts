import type { JSX } from '@solidjs/web';

export type Placement =
  | 'top' | 'top-start' | 'top-end'
  | 'bottom' | 'bottom-start' | 'bottom-end'
  | 'left' | 'left-start' | 'left-end'
  | 'right' | 'right-start' | 'right-end';

/**
 * Props an overlay passes to its trigger: ref, ARIA state and event handlers.
 * Spread them onto any library control, e.g.
 * `trigger={(props) => <Button {...props}>Options</Button>}`.
 */
export type TriggerProps = Record<string, unknown>;

export type TriggerRender = (props: TriggerProps) => JSX.Element;
