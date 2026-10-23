import type { JSX } from '@solidjs/web';
import { children, For, Show } from 'solid-js';
import { Icon } from './icon';
import './empty-state.css';

/** A next step offered by an empty state, e.g. a template to start from. */
export interface EmptyStateSuggestion {
  label: string;
  description?: string;
  /** Bundled icon name, e.g. `icons/content/storage`. */
  icon?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface EmptyStateProps {
  /** Bundled icon name. Optional: a title alone is often enough inline. */
  icon?: string;
  title: string;
  /** What will appear here, and how it gets here. Muted, one or two sentences. */
  description?: string;
  /**
   * - `page` (default): replaces a whole page or board. Starts where the content would,
   *   at the page gutter, rather than floating in the middle of the void.
   * - `inline`: replaces a list or panel body. Icon beside the text, aligned with the rows.
   */
  variant?: 'page' | 'inline';
  /** Choices to start from, shown as a short list of rows (best for 2–5 options). */
  suggestions?: readonly EmptyStateSuggestion[];
  /** Small heading above the suggestions, e.g. "Start from a template". */
  suggestionsLabel?: string;
  /** Actions, usually one or two Buttons, laid out in a row under the text. */
  children?: JSX.Element;
  class?: string;
}

/**
 * The surface a list or page shows before it has content. It explains what will
 * appear and offers the next step in place; it is part of the surface, not a dialog.
 */
export function EmptyState(props: EmptyStateProps) {
  // Slots are resolved once; reading a JSX prop twice would create it twice.
  const actions = children(() => props.children);
  return (
    <div data-vesta="empty-state" data-variant={props.variant ?? 'page'} class={props.class}>
      <Show when={props.icon}>
        {(icon) => (
          <span data-vesta="empty-state-icon">
            <Icon name={icon()} size={props.variant === 'inline' ? 16 : 20} />
          </span>
        )}
      </Show>
      <div data-vesta="empty-state-body">
        <h2 data-vesta="empty-state-title">{props.title}</h2>
        <Show when={props.description}>
          <p data-vesta="empty-state-description">{props.description}</p>
        </Show>
        <Show when={props.suggestions?.length}>
          <div data-vesta="empty-state-suggestions">
            <Show when={props.suggestionsLabel}>
              <span data-vesta="empty-state-suggestions-label">{props.suggestionsLabel}</span>
            </Show>
            <ul>
              <For each={props.suggestions}>
                {(suggestion) => (
                  <li>
                    <button
                      type="button"
                      data-vesta="empty-state-suggestion"
                      disabled={suggestion.disabled}
                      onClick={() => suggestion.onSelect()}
                    >
                      <Show when={suggestion.icon}>
                        {(icon) => (
                          <span data-vesta="empty-state-suggestion-icon">
                            <Icon name={icon()} size={16} />
                          </span>
                        )}
                      </Show>
                      <span data-vesta="empty-state-suggestion-text">
                        <span data-vesta="empty-state-suggestion-label">{suggestion.label}</span>
                        <Show when={suggestion.description}>
                          <span data-vesta="empty-state-suggestion-description">{suggestion.description}</span>
                        </Show>
                      </span>
                      <Icon name="icons/controls/chevron-right" size={14} class="empty-state-suggestion-chevron" />
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
        <Show when={actions()}>
          <div data-vesta="empty-state-actions">{actions()}</div>
        </Show>
      </div>
    </div>
  );
}

/**
 * The one-line empty message for menus, popovers, pickers and small lists
 * ("No notifications"). Use EmptyState when there is a next step to offer.
 */
export function EmptyLine(props: { children: JSX.Element; role?: 'status' | 'alert'; class?: string }) {
  return (
    <p data-vesta="empty-line" role={props.role} class={props.class}>
      {props.children}
    </p>
  );
}
