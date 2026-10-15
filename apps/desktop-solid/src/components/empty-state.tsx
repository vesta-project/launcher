import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { Icon } from './icon';
import './empty-state.css';

export interface EmptyStateProps {
  icon: string;
  title: string;
  description?: string;
  children?: JSX.Element;
}

/** Centered message for pages or lists with nothing to show yet. */
export function EmptyState(props: EmptyStateProps) {
  return (
    <div data-vesta="empty-state">
      <span data-vesta="empty-state-icon">
        <Icon name={props.icon} size={22} />
      </span>
      <h2 data-vesta="empty-state-title">{props.title}</h2>
      <Show when={props.description}>
        <p data-vesta="empty-state-description">{props.description}</p>
      </Show>
      {props.children}
    </div>
  );
}
