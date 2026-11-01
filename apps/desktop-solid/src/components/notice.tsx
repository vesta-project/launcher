/**
 * Notice: the one way a page or section reports a problem.
 *
 * Rule:
 * - One notice per page or section. Several failing reads that share a cause show one notice,
 *   not one per control: pass the same `cause` and they collapse to the first one mounted in
 *   the nearest `NoticeGroup` (or `scope`). Notices inside a dialog only collapse with each other.
 * - The message sits on the left and the action (Retry) at the far end of the same row; when
 *   the row is too narrow the action wraps to its own line, still at the end.
 * - `section` (default) is a tinted band for the top of a page or panel. `inline` is bare text
 *   for a slot inside a form or list, so it fits the space it's given.
 * - Keep the message to one sentence. Codes, files and raw details go in `details`.
 */
import type { JSX } from '@solidjs/web';
import { Show, createContext, createEffect, createSignal, onCleanup, useContext } from 'solid-js';
import { Button } from '@vesta/ui';
import { Icon } from './icon';
import './notice.css';

type Tone = 'danger' | 'warning' | 'neutral';

const icons: Record<Tone, string> = { danger: 'icons/status/error', warning: 'icons/controls/warning', neutral: 'icons/status/info' };

interface Entry { cause: string; scope: Element | null; id: symbol }

/** Shared dedupe registry for one page or section. */
export interface NoticeRegistry {
  entries: () => readonly Entry[];
  add: (entry: Entry) => void;
  remove: (id: symbol) => void;
}

export function createNoticeRegistry(): NoticeRegistry {
  const [entries, setEntries] = createSignal<readonly Entry[]>([], { name: 'notice:entries' });
  return {
    entries,
    add: (entry) => setEntries((list) => [...list, entry]),
    remove: (id) => setEntries((list) => list.filter((entry) => entry.id !== id)),
  };
}

const NoticeContext = createContext<NoticeRegistry | undefined>(undefined);

const useNoticeRegistry = () => {
  try { return useContext(NoticeContext); }
  catch { return undefined; }
};

/** Notices with the same `cause` inside this group show once. */
export function NoticeGroup(props: { children: JSX.Element; registry?: NoticeRegistry }) {
  return <NoticeContext value={props.registry ?? createNoticeRegistry()}>{props.children}</NoticeContext>;
}

/** A stable string for an error, so equal failures share one notice. */
export function noticeCause(error: unknown): string | undefined {
  if (error == null || error === '') return undefined;
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const value = error as { code?: unknown; reason?: unknown; message?: unknown };
    return [value.code, value.reason, value.message].filter((part) => part != null).join(':') || undefined;
  }
  return String(error);
}

export interface NoticeProps {
  /** One sentence. */
  children: JSX.Element;
  tone?: Tone;
  variant?: 'section' | 'inline';
  /** Equal causes in one group collapse to a single notice. */
  cause?: string;
  /** Overrides the group from context; a server workspace passes its own. */
  scope?: NoticeRegistry;
  /** The recovery step, e.g. Retry. Sits at the end of the row. */
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** Extra controls after the action, e.g. a second button. */
  actions?: JSX.Element;
  /** Codes, files and raw details under the message. */
  details?: JSX.Element;
  role?: 'alert' | 'status';
  class?: string;
}

export function Notice(props: NoticeProps) {
  const context = useNoticeRegistry();
  const registry = () => props.scope ?? context;
  const id = Symbol('notice');
  let element: HTMLDivElement | undefined;
  createEffect(
    () => ({ registry: registry(), cause: props.cause }),
    (current) => {
      if (!current.registry || !current.cause) return;
      const scope = element?.closest('[role="dialog"]') ?? null;
      current.registry.add({ cause: current.cause, scope, id });
      return () => current.registry!.remove(id);
    },
    { name: 'notice:register' },
  );
  onCleanup(() => registry()?.remove(id));
  const hidden = () => {
    const list = registry()?.entries();
    if (!list || !props.cause) return false;
    const mine = list.find((entry) => entry.id === id);
    if (!mine) return false;
    return list.find((entry) => entry.cause === mine.cause && entry.scope === mine.scope)?.id !== id;
  };
  const tone = () => props.tone ?? 'danger';
  return (
    <div
      ref={(node: HTMLDivElement) => { element = node; }}
      data-vesta="notice"
      data-tone={tone()}
      data-variant={props.variant ?? 'section'}
      class={props.class}
      role={props.role ?? (tone() === 'neutral' ? 'status' : 'alert')}
      hidden={hidden()}
    >
      <Icon name={icons[tone()]} size={14} />
      <div data-vesta="notice-body">
        <div data-vesta="notice-message">{props.children}</div>
        <Show when={props.details}>
          <div data-vesta="notice-details">{props.details}</div>
        </Show>
      </div>
      <Show when={props.action || props.actions}>
        <div data-vesta="notice-actions">
          <Show when={props.action}>
            {(action) => (
              <Button size="sm" variant="outline" disabled={action().disabled} onClick={() => action().onClick()}>
                {action().label}
              </Button>
            )}
          </Show>
          {props.actions}
        </div>
      </Show>
    </div>
  );
}
