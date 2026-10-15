import { Skeleton as KobalteSkeleton } from '@kobalte/core/skeleton';
import type { JSX } from '@solidjs/web';
import './skeleton.css';

export interface SkeletonProps {
  /** Pixel width, or a CSS length via `style`. Defaults to full width. */
  width?: number;
  /** Pixel height. Defaults to one control-md line. */
  height?: number;
  /** Roundness in px. Prefer `circle` for avatars. */
  radius?: number;
  /** Make a circle (sets equal width/height and full rounding). */
  circle?: boolean;
  /** Pulse animation. Defaults to true. */
  animate?: boolean;
  /** When false the skeleton hides (for swap-with-content patterns). Defaults to true. */
  visible?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
}

export function Skeleton(props: SkeletonProps) {
  return (
    <KobalteSkeleton
      data-vesta="skeleton"
      class={props.class}
      style={props.style}
      width={props.width}
      height={props.height ?? (props.circle ? undefined : 16)}
      radius={props.radius}
      circle={props.circle}
      animate={props.animate ?? true}
      visible={props.visible ?? true}
    />
  );
}
