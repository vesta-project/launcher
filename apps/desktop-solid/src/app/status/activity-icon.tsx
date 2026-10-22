import type { JSX } from '@solidjs/web';
import { Show, createSignal } from 'solid-js';
import type { Activity } from '../../features/activity';
import { hueOf, initialsOf } from './activity-icon-model';
export { initialsOf } from './activity-icon-model';

/** The instance/resource image of an activity, falling back to tinted initials. Decorative. */
export function ActivityIcon(props: { activity: Activity; size?: 'pill' | 'row' }) {
  const [broken, setBroken] = createSignal<string | undefined>(undefined, { name: 'activityIconBroken' });
  const image = () => (props.activity.icon && props.activity.icon !== broken() ? props.activity.icon : undefined);
  return (
    <span
      data-vesta="activity-icon"
      data-size={props.size ?? 'pill'}
      data-fallback={image() ? undefined : ''}
      style={{ '--activity-icon-hue': String(hueOf(props.activity.title ?? '')) } as JSX.CSSProperties}
      aria-hidden="true"
    >
      <Show when={image()} fallback={<b data-vesta="activity-icon-initials">{initialsOf(props.activity)}</b>}>
        {(src) => <img src={src()} alt="" draggable="false" onError={() => setBroken(src())} />}
      </Show>
    </span>
  );
}
