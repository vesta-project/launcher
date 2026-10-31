import { Skeleton as KobalteSkeleton } from '@kobalte/core/skeleton';
import type { JSX } from '@solidjs/web';
import './skeleton.css';

export interface SkeletonProps {
  /** Pixel width, or a CSS length via `style`. Defaults to full width. */
  width?: number;
  /** Pixel height. Defaults to one control-md line. */
  height?: number;
  /** Preferred roundness in px, scaled by the theme radius factor. Prefer `circle` for avatars. */
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
      style={{
        '--skeleton-preferred-radius': props.radius === undefined ? undefined : `calc(${props.radius}px * var(--vesta-radius-factor))`,
        ...props.style,
      }}
      width={props.width}
      height={props.height ?? (props.circle ? undefined : 16)}
      circle={props.circle}
      animate={props.animate ?? true}
      visible={props.visible ?? true}
    />
  );
}
