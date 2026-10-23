// The workflow's steps as an ordered column of compact cards. Click a card to open its
// details; drag a card (or use its grip with the keyboard) to reorder; add steps between
// cards or at the end. Jumps reference step ids, so reordering never rewrites them.
import { Badge, Button, IconButton, Menu, MenuItem } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { For, Show, createSignal, createUniqueId, onCleanup } from 'solid-js';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import {
  BOUNDS, dragShift, dropTarget, incomingJumps, keyboardTarget, stepNotes, stepProblemCount, type DraftStep, type Problem,
} from '../../../features/servers/automation-model';
import type { ActionKind } from '../../../features/servers/native-automation';
import { ACTION_ORDER, actionIcons, actionLabels, stepText } from '../tabs/automation-shared';

/** `slot` is the distance one step takes up, so the others can slide by exactly that much. */
interface Drag { from: number; dy: number; to: number; slot: number }

const DRAG_THRESHOLD = 5;
const EDGE = 48;

export function StepFlow(props: {
  steps: DraftStep[];
  selected: number | null;
  problems: readonly Problem[];
  disabled: boolean;
  onSelect: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onInsert: (at: number, kind: ActionKind) => void;
  /** Details shown under the selected card when the pane is too narrow for a side panel. */
  inlineDetails?: (index: number) => JSX.Element;
}) {
  const hint = createUniqueId();
  const [drag, setDrag] = createSignal<Drag | null>(null, { name: 'server-automation-flow:drag' });
  const [grabbed, setGrabbed] = createSignal<{ index: number; origin: number } | null>(null, { name: 'server-automation-flow:grabbed' });
  const [announcement, setAnnouncement] = createSignal('', { name: 'server-automation-flow:announcement' });
  let list: HTMLOListElement | undefined;
  let suppressClick = false;
  let stopDrag: (() => void) | undefined;
  onCleanup(() => stopDrag?.());

  const full = () => props.steps.length >= BOUNDS.steps[1];
  const label = (index: number) => {
    const step = props.steps[index];
    return step ? t('server-automation.step-label', { count: index + 1, name: stepText(step.action) }) : '';
  };
  const focusGrip = (index: number) => queueMicrotask(() => list?.querySelectorAll<HTMLElement>('[data-vesta="server-automation-grip"]')[index]?.focus());
  const move = (from: number, to: number, announce = true) => {
    if (from === to) return;
    props.onReorder(from, to);
    if (announce) setAnnouncement(t('server-automation.moved', { count: to + 1, max: props.steps.length }));
  };

  // ---------------------------------------------------------------- pointer
  const pointerDown = (event: PointerEvent, index: number) => {
    if (props.disabled || event.button !== 0 || props.steps.length < 2) return;
    // Fields and menus inside the card keep their own pointer behaviour.
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [data-vesta="field"], [role="menu"]')) return;
    const startY = event.clientY;
    const scroller = list?.closest<HTMLElement>('[data-vesta="instance-settings-scroll"]') ?? null;
    const startScroll = scroller?.scrollTop ?? 0;
    let pointerY = startY;
    let started = false;
    let frame = 0;
    // Measured once when the drag starts: the other cards slide while it runs, so reading
    // their live positions would move the target under the pointer.
    let others: number[] = [];
    let slot = 0;
    const measure = () => {
      const items = [...(list?.querySelectorAll<HTMLElement>('[data-vesta="server-automation-step-item"]') ?? [])];
      const tops = items.map((item) => item.getBoundingClientRect().top);
      slot = index + 1 < tops.length ? tops[index + 1]! - tops[index]! : index > 0 ? tops[index]! - tops[index - 1]! : 0;
      others = items.flatMap((item, at) => {
        if (at === index) return [];
        const card = item.querySelector<HTMLElement>('[data-vesta="server-automation-step-card"]')!.getBoundingClientRect();
        return [card.top + card.height / 2];
      });
    };
    const update = () => {
      const scrolled = (scroller?.scrollTop ?? 0) - startScroll;
      setDrag({ from: index, dy: pointerY - startY + scrolled, to: dropTarget(others, pointerY + scrolled), slot });
    };
    const tick = () => {
      // Scroll the pane while the pointer rests near its top or bottom edge.
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        const by = pointerY < bounds.top + EDGE ? -10 : pointerY > bounds.bottom - EDGE ? 10 : 0;
        if (by) { scroller.scrollTop += by; update(); }
      }
      frame = requestAnimationFrame(tick);
    };
    const onMove = (moveEvent: PointerEvent) => {
      pointerY = moveEvent.clientY;
      if (!started) {
        if (Math.abs(pointerY - startY) < DRAG_THRESHOLD) return;
        started = true;
        measure();
        setGrabbed(null);
        setAnnouncement(t('server-automation.picked-up', { name: label(index) }));
        frame = requestAnimationFrame(tick);
      }
      moveEvent.preventDefault();
      update();
    };
    const finish = (commit: boolean) => {
      stopDrag?.();
      const current = drag();
      setDrag(null);
      if (!started) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (commit && current && current.to !== current.from) move(current.from, current.to);
      else setAnnouncement(t('server-automation.reorder-cancelled'));
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); finish(false); } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    stopDrag = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      stopDrag = undefined;
    };
  };

  // --------------------------------------------------------------- keyboard
  /** Alt+arrows move a step from its card or grip at any time. */
  const altMove = (event: KeyboardEvent, index: number) => {
    if (props.disabled || !event.altKey) return false;
    const to = keyboardTarget(index, props.steps.length, event.key);
    if (to === null) return false;
    event.preventDefault();
    move(index, to);
    focusGrip(to);
    return true;
  };
  /** The grip: Space or Enter picks the step up, arrows move it, Space/Enter drops, Escape puts it back. */
  const gripKey = (event: KeyboardEvent, index: number) => {
    if (altMove(event, index)) return;
    const held = grabbed();
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (props.disabled) return;
      if (held) { setGrabbed(null); setAnnouncement(t('server-automation.dropped', { count: index + 1, max: props.steps.length })); }
      else { setGrabbed({ index, origin: index }); setAnnouncement(t('server-automation.picked-up-keyboard', { name: label(index) })); }
      return;
    }
    if (!held) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setGrabbed(null);
      move(held.index, held.origin, false);
      setAnnouncement(t('server-automation.reorder-cancelled'));
      focusGrip(held.origin);
      return;
    }
    const to = keyboardTarget(held.index, props.steps.length, event.key);
    if (to === null) return;
    event.preventDefault();
    move(held.index, to);
    setGrabbed({ index: to, origin: held.origin });
    focusGrip(to);
  };

  /** Other steps slide aside to open the gap where the dragged one will land. */
  const shiftOf = (index: number) => {
    const current = drag();
    const by = current ? dragShift(index, current.from, current.to) : 0;
    return by && current ? { transform: `translateY(${by * current.slot}px)` } : undefined;
  };

  return (
    <div data-vesta="server-automation-flow">
      <p id={hint} hidden>{t('server-automation.reorder-hint')}</p>
      <ol ref={(element) => { list = element; }} data-vesta="server-automation-steps" aria-label={t('server-automation.steps')}>
        <For each={props.steps} keyed={false}>
          {(step, index) => {
            const problems = () => stepProblemCount(props.problems, index);
            const notes = () => stepNotes(props.steps, index);
            const incoming = () => incomingJumps(props.steps, index);
            const dragging = () => drag()?.from === index;
            return (
              <li data-vesta="server-automation-step-item" data-shifting={drag() && !dragging() ? '' : undefined} style={shiftOf(index)}>
                <div data-vesta="server-automation-step-card" data-step-index={index}
                  data-selected={props.selected === index ? '' : undefined} data-invalid={problems() ? '' : undefined}
                  data-dragging={dragging() ? '' : undefined} data-grabbed={grabbed()?.index === index ? '' : undefined}
                  style={dragging() ? { transform: `translateY(${drag()!.dy}px)` } : undefined}
                  onPointerDown={(event) => pointerDown(event, index)}
                  onClick={(event) => {
                    if (suppressClick) return;
                    if (event.target instanceof Element && event.target.closest('[data-vesta="server-automation-grip"]')) return;
                    props.onSelect(index);
                  }}>
                  <Show when={!props.disabled}>
                    <button type="button" data-vesta="server-automation-grip" aria-label={t('server-automation.reorder', { name: label(index) })}
                      aria-describedby={hint} aria-pressed={grabbed()?.index === index ? 'true' : 'false'} onKeyDown={(event) => gripKey(event, index)}
                      onBlur={() => { if (grabbed()?.index === index) setGrabbed(null); }}>
                      <Icon name="icons/controls/menu" size={12} />
                    </button>
                  </Show>
                  <span data-vesta="server-automation-step-index" aria-hidden="true">{index + 1}</span>
                  <span data-vesta="server-automation-step-kind" aria-hidden="true"><Icon name={actionIcons[step().action.kind]} size={14} /></span>
                  <button type="button" data-vesta="server-automation-step-open" aria-expanded={props.selected === index ? 'true' : 'false'}
                    aria-label={label(index)} onKeyDown={(event) => altMove(event, index)}>
                    <span data-vesta="server-automation-step-summary">{stepText(step().action)}</span>
                    <Show when={notes().length || incoming().length}>
                      <span data-vesta="server-automation-step-notes">
                        <For each={incoming()}>
                          {(jump) => <span data-tone="neutral">{t(jump.on === 'failure' ? 'server-automation.note-from-failure' : 'server-automation.note-from', { count: jump.from + 1 })}</span>}
                        </For>
                        <For each={notes()}>{(note) => <span data-tone={note.tone}>{t(note.message, note.args)}</span>}</For>
                      </span>
                    </Show>
                  </button>
                  <Show when={problems()}>
                    <Badge size="sm" variant="soft" tone="danger">{t('server-automation.problems-short', { count: problems() })}</Badge>
                  </Show>
                  <Icon name="icons/controls/chevron-right" size={12} class="server-automation-step-chevron" />
                </div>
                <Show when={props.selected === index && props.inlineDetails}>
                  <div data-vesta="server-automation-inline-details">{props.inlineDetails!(index)}</div>
                </Show>
                <Show when={!props.disabled && index < props.steps.length - 1}>
                  <div data-vesta="server-automation-gap">
                    <AddStepMenu disabled={full()} onPick={(kind) => props.onInsert(index + 1, kind)}
                      trigger={(menu) => <IconButton {...menu} size="sm" variant="ghost" label={t('server-automation.add-step-at', { count: index + 2 })} icon={<Icon name="icons/actions/add" />} disabled={full()} />} />
                  </div>
                </Show>
              </li>
            );
          }}
        </For>
      </ol>
      <Show when={!props.disabled}>
        <div data-vesta="server-automation-flow-end">
          <AddStepMenu disabled={full()} onPick={(kind) => props.onInsert(props.steps.length, kind)}
            trigger={(menu) => <Button {...menu} size="sm" variant="outline" icon={<Icon name="icons/actions/add" />} disabled={full()}>{t('server-automation.add-step')}</Button>} />
          <span data-vesta="server-muted">{t('server-automation.step-count', { count: props.steps.length, max: BOUNDS.steps[1] })}</span>
        </div>
      </Show>
      <div data-vesta="server-automation-live" aria-live="assertive" role="status">{announcement()}</div>
    </div>
  );
}

/** The kind picker for a new step. */
function AddStepMenu(props: { disabled: boolean; onPick: (kind: ActionKind) => void; trigger: Parameters<typeof Menu>[0]['trigger'] }) {
  return (
    <Menu placement="bottom-start" trigger={props.trigger}>
      <For each={ACTION_ORDER}>
        {(kind) => <MenuItem icon={<Icon name={actionIcons[kind]} />} disabled={props.disabled} onSelect={() => props.onPick(kind)}>{t(actionLabels[kind])}</MenuItem>}
      </For>
    </Menu>
  );
}

