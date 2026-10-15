import { Toast as KobalteToast, toaster } from '@kobalte/core/toast';
import type { JSX } from '@solidjs/web';
import { createSignal, For, Show, type Accessor } from 'solid-js';
import type { Tone } from '../../foundation/types';
import { CloseGlyph, DangerGlyph, InfoGlyph, SuccessGlyph, WarningGlyph } from '../../internal/icons';
import { Button, IconButton } from '../button/button';
import { Progress } from '../progress/progress';
import '../overlay/overlay.css';
import './toast.css';

export type ToastPlacement = 'top-start' | 'top-center' | 'top-end' | 'bottom-start' | 'bottom-center' | 'bottom-end';

export interface ToastAction {
  label: string;
  onClick: () => void;
  tone?: Tone;
  /** Close the toast after the action runs. Defaults to true. */
  dismiss?: boolean;
}

export interface ToastOptions {
  title: string;
  description?: string;
  /** Sets the status icon and progress colour. Defaults to `neutral` (no icon). */
  tone?: Tone;
  /** Replace the tone's icon, or `false` to hide it. */
  icon?: JSX.Element | false;
  /** 0–100, or `null` for indeterminate. Omit for no progress bar. */
  progress?: number | null;
  /** Text beside the progress, e.g. "3 of 12 files". Defaults to the percentage. */
  progressLabel?: string;
  /** Up to two actions; the first is the primary one. */
  actions?: ToastAction[];
  /** Auto-dismiss delay in ms. Ignored when persistent. Defaults to 5000. */
  duration?: number;
  /** Stay until dismissed. Defaults to true while progress is shown. */
  persistent?: boolean;
  /** Show the dismiss button. Defaults to true. */
  dismissible?: boolean;
  /** Announce assertively (errors that need attention). */
  urgent?: boolean;
  onDismiss?: () => void;
}

const toneIcons: Partial<Record<Tone, () => JSX.Element>> = {
  accent: InfoGlyph,
  success: SuccessGlyph,
  warning: WarningGlyph,
  danger: DangerGlyph,
};

const updaters = new Map<number, (patch: Partial<ToastOptions>) => void>();

function ToastItem(props: { toastId: number; options: Accessor<ToastOptions> }) {
  const options = () => props.options();
  const tone = () => options().tone ?? 'neutral';
  const icon = () => {
    const custom = options().icon;
    if (custom === false) return undefined;
    if (custom) return custom;
    return toneIcons[tone()]?.();
  };
  const hasProgress = () => options().progress !== undefined;
  const persistent = () => options().persistent ?? (hasProgress() && options().progress !== 100);
  const close = () => toaster.dismiss(props.toastId);

  return (
    <KobalteToast
      toastId={props.toastId}
      data-vesta="toast"
      data-tone={tone()}
      duration={options().duration ?? 5000}
      persistent={persistent()}
      priority={options().urgent ? 'high' : 'low'}
    >
      <Show when={icon()}>
        <span data-vesta="toast-icon" aria-hidden="true">
          {icon()}
        </span>
      </Show>
      <div data-vesta="toast-body">
        <KobalteToast.Title data-vesta="toast-title">{options().title}</KobalteToast.Title>
        <Show when={options().description}>
          <KobalteToast.Description data-vesta="toast-description">{options().description}</KobalteToast.Description>
        </Show>
        <Show when={hasProgress()}>
          <Progress
            size="sm"
            tone={tone() === 'neutral' ? 'accent' : tone()}
            value={options().progress ?? undefined}
            valueLabel={options().progressLabel}
            aria-label={options().title}
          />
        </Show>
        <Show when={options().actions?.length}>
          <div data-vesta="toast-actions">
            <For each={options().actions}>
              {(action, index) => (
                <Button
                  size="sm"
                  variant={index() === 0 ? 'solid' : 'ghost'}
                  // The primary action follows the toast's tone, except on errors
                  // where a red solid button would read as destructive.
                  tone={action.tone ?? (index() === 0 && tone() !== 'danger' ? tone() : 'neutral')}
                  onClick={() => {
                    action.onClick();
                    if (action.dismiss !== false) close();
                  }}
                >
                  {action.label}
                </Button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={options().dismissible !== false}>
        <KobalteToast.CloseButton
          as={(closeProps: Record<string, unknown>) => (
            <IconButton {...closeProps} icon={<CloseGlyph />} label="Dismiss" variant="ghost" size="sm" tooltip={false} />
          )}
        />
      </Show>
    </KobalteToast>
  );
}

/** Imperative toast API. Toasts appear in the matching <ToastRegion>. */
export const toast = {
  /** Show a toast and return its id. */
  show(options: ToastOptions, target?: { region?: string }): number {
    const [state, setState] = createSignal(options);
    const id = toaster.show((data) => <ToastItem toastId={data.toastId} options={state} />, { region: target?.region });
    updaters.set(id, (patch) => setState((previous) => ({ ...previous, ...patch })));
    return id;
  },
  /** Patch a visible toast in place, e.g. to advance its progress. */
  update(id: number, patch: Partial<ToastOptions>) {
    updaters.get(id)?.(patch);
  },
  dismiss(id: number) {
    toaster.dismiss(id);
    updaters.delete(id);
  },
  clear() {
    toaster.clear();
    updaters.clear();
  },
};

export interface ToastRegionProps {
  /** Screen corner or edge. Defaults to `bottom-end`. */
  placement?: ToastPlacement;
  /** Visible toasts before queueing. Defaults to 3. */
  limit?: number;
  /** Target for `toast.show(…, { region })` when several regions exist. */
  regionId?: string;
  class?: string;
  style?: JSX.CSSProperties;
}

const swipeDirections = {
  start: 'left',
  end: 'right',
  'top-center': 'up',
  'bottom-center': 'down',
} as const;

/** Where toasts stack. Render once near the app root (it positions itself). */
export function ToastRegion(props: ToastRegionProps) {
  const placement = () => props.placement ?? 'bottom-end';
  const swipe = () => {
    const value = placement();
    if (value.endsWith('center')) return swipeDirections[value as 'top-center' | 'bottom-center'];
    return swipeDirections[value.endsWith('start') ? 'start' : 'end'];
  };

  return (
    <KobalteToast.Region
      data-vesta="toast-region"
      data-placement={placement()}
      regionId={props.regionId}
      limit={props.limit ?? 3}
      swipeDirection={swipe()}
      pauseOnInteraction
      pauseOnPageIdle
      class={props.class}
      style={props.style}
    >
      <KobalteToast.List data-vesta="toast-list" />
    </KobalteToast.Region>
  );
}
