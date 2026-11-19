import { Button } from '@vesta/ui';
import { For, Show, createEffect, createSignal, onCleanup, onSettled, untrack } from 'solid-js';
import { onboarding } from '../../features/onboarding';
import { tour } from '../../features/onboarding/tour';
import { setting } from '../../features/settings/config';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { route } from '../router';
import { transitionTo } from '../transition';
import './tour.css';

type Placement = 'right' | 'bottom';
interface TourStep {
  id: string;
  title: MessageId;
  body: MessageId;
  /** Everything to light up together; none (or none on screen) shows a centred card instead. */
  targets?: string[];
  placement?: Placement;
}

const railLink = (href: string) => `[data-vesta="rail"] a[data-vesta="rail-button"][href="#${href}"]`;

/** Decided once when the tour opens, so step numbers never shift underneath it. */
function buildSteps(): TourStep[] {
  return [
    { id: 'welcome', title: 'tour.welcome-title', body: 'tour.welcome-body' },
    { id: 'library', title: 'tour.library-title', body: 'tour.library-body', targets: ['[data-vesta="library-grid"][data-library-surface="main"]'], placement: 'bottom' },
    { id: 'create', title: 'tour.create-title', body: 'tour.create-body', targets: [railLink('/create')], placement: 'right' },
    { id: 'browse', title: 'tour.browse-title', body: 'tour.browse-body', targets: [railLink('/browse')], placement: 'right' },
    ...(setting('servers_in_rail')
      ? [{ id: 'servers', title: 'tour.servers-title', body: 'tour.servers-body', targets: [railLink('/servers')], placement: 'right' } as TourStep]
      : []),
    {
      id: 'status', title: 'tour.status-title', body: 'tour.status-body', placement: 'bottom',
      targets: ['[data-vesta="titlebar"] [data-vesta="status-pill"]', '[data-vesta="titlebar"] [data-vesta="titlebar-status-item"]'],
    },
    onboarding.guest()
      ? { id: 'guest', title: 'tour.guest-title', body: 'tour.guest-body', targets: ['[data-vesta="titlebar-guest"]'], placement: 'bottom' }
      : { id: 'account', title: 'tour.account-title', body: 'tour.account-body', targets: ['[data-vesta="rail-account"]'], placement: 'right' },
    { id: 'settings', title: 'tour.settings-title', body: 'tour.settings-body', targets: [railLink('/settings')], placement: 'right' },
    { id: 'finish', title: 'tour.finish-title', body: 'tour.finish-body' },
  ];
}

interface Box { x: number; y: number; w: number; h: number }
interface Layout { spot: Box; card: { x: number; y: number }; centred: boolean }

const MARGIN = 12;
const GAP = 14;
const PAD = 6;
const MIN_SPOT = 30;

/** The union of every visible target, clipped to the window; undefined when nothing is showing. */
function measure(selectors: string[] | undefined): Box | undefined {
  if (!selectors) return undefined;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const selector of selectors) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      left = Math.min(left, rect.left); top = Math.min(top, rect.top);
      right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
    }
  }
  if (left === Infinity) return undefined;
  // Small targets (the idle status dot) still get a comfortable ring around their centre.
  const grow = (low: number, high: number) => {
    const missing = MIN_SPOT - (high - low) - PAD * 2;
    return missing > 0 ? [low - missing / 2, high + missing / 2] : [low, high];
  };
  [left, right] = grow(left, right);
  [top, bottom] = grow(top, bottom);
  left = Math.max(left - PAD, 4); top = Math.max(top - PAD, 4);
  right = Math.min(right + PAD, innerWidth - 4); bottom = Math.min(bottom + PAD, innerHeight - 4);
  if (right - left < 4 || bottom - top < 4) return undefined;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function place(spot: Box, placement: Placement, card: { w: number; h: number }) {
  let x: number, y: number;
  if (placement === 'right') {
    x = spot.x + spot.w + GAP;
    y = spot.y + spot.h / 2 - card.h / 2;
  } else {
    x = spot.x + spot.w / 2 - card.w / 2;
    y = spot.y + spot.h + GAP;
    // Too tall to sit below: above, or failing that tucked inside the bottom of the spot.
    if (y + card.h > innerHeight - MARGIN) y = spot.y - GAP - card.h;
    if (y < MARGIN) y = Math.min(spot.y + spot.h, innerHeight) - card.h - MARGIN * 2;
  }
  return {
    x: Math.round(Math.min(Math.max(x, MARGIN), innerWidth - card.w - MARGIN)),
    y: Math.round(Math.min(Math.max(y, MARGIN), innerHeight - card.h - MARGIN)),
  };
}

const sameLayout = (a: Layout | undefined, b: Layout) =>
  !!a && a.centred === b.centred && a.card.x === b.card.x && a.card.y === b.card.y &&
  Math.abs(a.spot.x - b.spot.x) < 0.5 && Math.abs(a.spot.y - b.spot.y) < 0.5 &&
  Math.abs(a.spot.w - b.spot.w) < 0.5 && Math.abs(a.spot.h - b.spot.h) < 0.5;

/** The first-visit tour over the live shell. Mounted by the Shell; shows while `tour.open()`. */
export function Tour() {
  return <Show when={tour.open()}><TourOverlay /></Show>;
}

function TourOverlay() {
  const steps = untrack(buildSteps);
  const index = () => Math.min(tour.step() ?? 0, steps.length - 1);
  const step = () => steps[index()];
  const pointed = steps.filter((entry) => entry.targets);
  const [layout, setLayout] = createSignal<Layout>(undefined as unknown as Layout, { name: 'tourLayout' });
  /** Set a frame after the first placement, so the spot and card glide between steps but never in from the corner. */
  const [placed, setPlaced] = createSignal(false, { name: 'tourPlaced' });
  let card: HTMLDivElement | undefined;
  let primary: HTMLButtonElement | undefined;

  const go = (next: number) => {
    if (next >= steps.length) tour.end();
    else tour.go(next);
  };

  onSettled(() => {
    // The tour talks about the library, so it starts there whatever page setup ended on.
    if (route().page !== 'library' || route().section) transitionTo('/library');
    let frame = 0;
    let focused = -1;
    // Targets move as the shell settles, demo cards rise and the window resizes, so the
    // spotlight follows them every frame; the signal only changes when something moved.
    const tick = () => {
      const current = step();
      const spot = measure(current.targets);
      const size = { w: card?.offsetWidth ?? 320, h: card?.offsetHeight ?? 160 };
      const next: Layout = spot
        ? { spot, card: place(spot, current.placement ?? 'bottom', size), centred: false }
        : {
            spot: { x: innerWidth / 2, y: innerHeight / 2, w: 0, h: 0 },
            card: { x: Math.round((innerWidth - size.w) / 2), y: Math.round((innerHeight - size.h) / 2) },
            centred: true,
          };
      if (!sameLayout(layout(), next)) {
        setLayout(next);
      } else if (!placed()) setPlaced(true);
      if (focused !== index() && primary) {
        focused = index();
        primary.focus({ preventScroll: true });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); tour.end(); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); go(index() + 1); }
      else if (event.key === 'ArrowLeft' && index() > 0) { event.preventDefault(); go(index() - 1); }
      else if (event.key === 'Tab' && card) {
        // Keep focus on the tour's own buttons; the app underneath is only on show.
        const buttons = [...card.querySelectorAll<HTMLElement>('button')];
        const at = buttons.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey, true);
    };
  });
  onCleanup(() => {
    // Hand focus back to the page rather than leaving it on a removed button.
    document.querySelector<HTMLElement>('#scene')?.focus({ preventScroll: true });
  });
  // Styles elsewhere in the shell key on the step (tour.css); an `html:has()` would restyle
  // the whole document on every DOM change.
  createEffect(
    () => step().id,
    (id) => {
      document.documentElement.dataset.tourStep = id;
      return () => delete document.documentElement.dataset.tourStep;
    },
  );

  const spotStyle = () => {
    const box = layout()?.spot;
    return box ? { translate: `${box.x}px ${box.y}px`, width: `${box.w}px`, height: `${box.h}px` } : undefined;
  };
  const position = () => pointed.findIndex((entry) => entry.id === step().id);

  return (
    <div data-vesta="tour" data-ready={layout() ? '' : undefined} data-placed={placed() ? '' : undefined} data-centred={layout()?.centred ? '' : undefined}>
      <div data-vesta="tour-spot" style={spotStyle()} aria-hidden="true" />
      <div
        ref={(element: HTMLDivElement) => (card = element)}
        data-vesta="tour-card"
        data-step={step().id}
        role="dialog"
        aria-modal="true"
        aria-label={t('tour.label')}
        aria-describedby="tour-body"
        style={layout() ? { translate: `${layout().card.x}px ${layout().card.y}px` } : undefined}
      >
        <Show when={step()} keyed>
          {(current) => (
            <div data-vesta="tour-content">
              <Show when={position() >= 0}>
                <ol data-vesta="tour-dots" aria-label={t('tour.progress', { count: position() + 1, total: pointed.length })}>
                  <For each={pointed}>
                    {(_, at) => <li data-vesta="tour-dot" data-state={at() < position() ? 'done' : at() === position() ? 'current' : undefined} />}
                  </For>
                </ol>
              </Show>
              <h2 data-vesta="tour-title">{t(current.title)}</h2>
              <p data-vesta="tour-body" id="tour-body">{t(current.body)}</p>
              <div data-vesta="tour-actions">
                <Show when={current.id !== 'finish'}>
                  <Button size="sm" variant="ghost" class="tour-skip" onClick={() => tour.end()}>{t('tour.skip')}</Button>
                </Show>
                <span data-vesta="tour-actions-spacer" />
                <Show when={index() > 0}>
                  <Button size="sm" variant="ghost" onClick={() => go(index() - 1)}>{t('tour.back')}</Button>
                </Show>
                <Button
                  ref={(element: HTMLButtonElement) => (primary = element)}
                  size="sm"
                  tone="accent"
                  onClick={() => go(index() + 1)}
                >
                  {current.id === 'welcome' ? t('tour.start') : current.id === 'finish' ? t('tour.done') : t('tour.next')}
                </Button>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
