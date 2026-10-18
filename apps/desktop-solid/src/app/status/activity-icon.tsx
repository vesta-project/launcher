import type { JSX } from '@solidjs/web';
import { Show, createSignal } from 'solid-js';
import type { Activity } from '../../features/activity';

/** Up to two letters for an activity without an image (its short fallback, else the title's words). */
export function initialsOf(activity: Pick<Activity, 'title' | 'iconFallback'>): string {
  const short = activity.iconFallback?.trim();
  if (short && short.length <= 2) return short.toUpperCase();
  const words = activity.title.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** A stable hue per title, so stacked fallbacks are told apart without a palette. */
function hueOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

/** The instance/resource image of an activity, falling back to tinted initials. Decorative. */
export function ActivityIcon(props: { activity: Activity; size?: 'pill' | 'row' }) {
  const [broken, setBroken] = createSignal<string | undefined>(undefined, { name: 'activityIconBroken' });
  const image = () => (props.activity.icon && props.activity.icon !== broken() ? props.activity.icon : undefined);
  return (
    <span
      data-vesta="activity-icon"
      data-size={props.size ?? 'pill'}
      data-fallback={image() ? undefined : ''}
      style={{ '--activity-icon-hue': String(hueOf(props.activity.title)) } as JSX.CSSProperties}
      aria-hidden="true"
    >
      <Show when={image()} fallback={<b data-vesta="activity-icon-initials">{initialsOf(props.activity)}</b>}>
        {(src) => <img src={src()} alt="" draggable="false" onError={() => setBroken(src())} />}
      </Show>
    </span>
  );
}
