// Small pieces shared by the Vesta Server setup, import and settings screens.
import { IconButton } from '@vesta/ui';
import { For, Show, createSignal, createUniqueId, onCleanup, onSettled, untrack } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { copyText } from '../../platform/clipboard';
import { CODE_LENGTH, backspaceCode, canonicalCode, codeGroups, typeIntoCode } from '../../features/servers/host-model';
import { hostReach } from '../../features/servers/hosts-store';

/** A command to run on the machine, with a copy button. */
export function CommandLine(props: { command: string }) {
  const [copied, setCopied] = createSignal(false, { name: 'vesta-command:copied' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const copy = async () => {
    await copyText(props.command).catch(() => {});
    setCopied(true);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div data-vesta="vesta-command">
      <code>{props.command}</code>
      <IconButton size="sm" variant="ghost" label={copied() ? t('servers.copied') : t('vesta-server.copy-command')}
        icon={<Icon name={copied() ? 'icons/controls/check' : 'icons/actions/copy'} />} onClick={() => void copy()} />
    </div>
  );
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const SHAKE: Keyframe[] = [
  { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' },
  { transform: 'translateX(-3px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' },
];
const shake = (element: Element | undefined, scale = 1) => {
  if (!element || reducedMotion() || typeof element.animate !== 'function') return;
  element.animate(SHAKE.map((frame) => ({ transform: String(frame.transform).replace(/-?\d+px/, (px) => `${parseFloat(px) * scale}px`) })), { duration: 280, easing: 'ease-out' });
};

export type CodeInputState = 'idle' | 'checking' | 'success' | 'error';
export interface CodeInputApi {
  /** Wrong code: shake, clear every cell and put focus back on the first. */
  reject(): void;
  focus(): void;
}

/**
 * A setup or link code as segmented cells, grouped like the machine prints it. Typing moves
 * on, Backspace moves back, paste fills every cell from any reasonable form, and a complete
 * code calls `onComplete` right away.
 */
export function CodeInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  state?: CodeInputState;
  describedBy?: string;
  autofocus?: boolean;
  disabled?: boolean;
  controls?: (api: CodeInputApi) => void;
}) {
  const labelId = createUniqueId();
  const hintId = createUniqueId();
  const inputs: HTMLInputElement[] = [];
  let group: HTMLDivElement | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  const [hint, setHint] = createSignal(false, { name: 'vesta-code:hint' });
  onCleanup(() => { clearTimeout(hintTimer); clearTimeout(clearTimer); });

  const locked = () => !!props.disabled || props.state === 'checking' || props.state === 'success';
  const focusCell = (index: number) => {
    const input = inputs[Math.max(0, Math.min(index, CODE_LENGTH - 1))];
    input?.focus();
    input?.select();
  };
  // Signal writes land after this handler, so focus logic reads the value just written, not the stale prop.
  let pending: string | undefined;
  const current = () => {
    if (pending !== undefined && pending === props.value) pending = undefined;
    return pending ?? props.value;
  };
  const change = (value: string) => { pending = value; props.onChange(value); };
  const commit = (value: string, focus: number) => {
    const before = current();
    change(value);
    focusCell(focus);
    if (value.length === CODE_LENGTH && value !== before) props.onComplete?.(value);
  };
  /** Not a code character: a small shake on that cell and a quiet hint (the hint alone with reduced motion). */
  const refuse = (cell: Element | undefined) => {
    shake(cell, 0.6);
    setHint(true);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => setHint(false), 2200);
  };
  const paste = (text: string, cell: Element | undefined) => {
    const code = canonicalCode(text);
    if (!code) return refuse(cell);
    commit(code, Math.min(code.length, CODE_LENGTH - 1));
  };

  untrack(() => props.controls)?.({
    reject: () => {
      shake(group);
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { change(''); focusCell(0); }, reducedMotion() ? 0 : 320);
    },
    focus: () => focusCell(current().length),
  });

  onSettled(() => { if (untrack(() => props.autofocus)) focusCell(untrack(() => props.value.length)); });

  const onInput = (index: number, event: InputEvent & { currentTarget: HTMLInputElement }) => {
    const input = event.currentTarget;
    const previous = current()[index] ?? '';
    const typed = input.value;
    input.value = previous; // the cell shows the model, never raw input
    if (locked()) return;
    const incoming = previous && typed.length === 2 && typed.includes(previous) ? typed.replace(previous, '') : typed;
    if (!incoming) return commit(current().slice(0, index) + current().slice(index + 1), index);
    if (incoming.length > 1) return paste(incoming, input); // autofill or a fast IME burst
    const next = typeIntoCode(current(), index, incoming);
    if (!next) return refuse(input);
    commit(next.value, next.focus);
  };

  const onKeyDown = (index: number, event: KeyboardEvent) => {
    if (locked()) return;
    const move = (to: number) => { event.preventDefault(); focusCell(Math.min(to, current().length)); };
    switch (event.key) {
      case 'Backspace': {
        event.preventDefault();
        const next = backspaceCode(current(), index);
        change(next.value);
        focusCell(next.focus);
        return;
      }
      case 'Delete':
        event.preventDefault();
        change(current().slice(0, index) + current().slice(index + 1));
        return;
      case 'ArrowLeft': return move(index - 1);
      case 'ArrowRight': return move(index + 1);
      case 'Home': return move(0);
      case 'End': return move(CODE_LENGTH - 1);
    }
  };

  return (
    <div data-vesta="vesta-code-input" data-state={props.state ?? 'idle'}>
      <span id={labelId} data-vesta="vesta-code-label">{props.label}</span>
      <div ref={(element) => (group = element)} role="group" data-vesta="vesta-code-cells" aria-labelledby={labelId}
        aria-describedby={[hintId, props.describedBy].filter(Boolean).join(' ')} aria-busy={props.state === 'checking' ? 'true' : undefined}>
        <For each={codeGroups()}>
          {(cells, at) => (
            <span data-vesta="vesta-code-group">
              <Show when={at() > 0}><span data-vesta="vesta-code-dash" aria-hidden="true">-</span></Show>
              <For each={cells}>
                {(index) => (
                  <input
                    ref={(element) => (inputs[index] = element)}
                    data-vesta="vesta-code-cell"
                    data-filled={props.value[index] ? '' : undefined}
                    style={{ '--vesta-code-index': String(index) }}
                    value={props.value[index] ?? ''}
                    aria-label={t('vesta-server.code.cell', { count: index + 1, total: CODE_LENGTH })}
                    aria-invalid={props.state === 'error' ? 'true' : undefined}
                    readonly={locked()}
                    disabled={props.disabled}
                    inputmode="text"
                    autocapitalize="characters"
                    autocomplete={index === 0 ? 'one-time-code' : 'off'}
                    spellcheck={false}
                    onFocus={(event) => {
                      if (index > current().length) focusCell(current().length);
                      else event.currentTarget.select();
                    }}
                    onInput={(event) => onInput(index, event)}
                    onKeyDown={(event) => onKeyDown(index, event)}
                    onPaste={(event) => {
                      event.preventDefault();
                      if (!locked()) paste(event.clipboardData?.getData('text') ?? '', event.currentTarget);
                    }}
                  />
                )}
              </For>
            </span>
          )}
        </For>
      </div>
      <p id={hintId} data-vesta="vesta-code-note" aria-live="polite">{hint() ? t('vesta-server.code.invalid-char') : ''}</p>
    </div>
  );
}

/** Numbered steps across the top of a flow. */
export function Steps<T extends string>(props: { steps: readonly { id: T; label: MessageId }[]; current: T | 'done' }) {
  const index = () => (props.current === 'done' ? props.steps.length : props.steps.findIndex((entry) => entry.id === props.current));
  return (
    <nav data-vesta="server-add-steps" aria-label={t('servers.add-steps')}>
      <ol>
        <For each={props.steps}>
          {(entry, at) => (
            <li data-state={at() < index() ? 'done' : at() === index() ? 'current' : 'next'} aria-current={at() === index() ? 'step' : undefined}>
              <span>{at() + 1}</span>{t(entry.label)}
            </li>
          )}
        </For>
      </ol>
    </nav>
  );
}

const reachLabels = { checking: 'vesta-server.list.checking', online: 'vesta-server.list.online', offline: 'vesta-server.list.offline' } as const satisfies Record<string, MessageId>;

/** A small online or offline light for a machine, from its last servers read. */
export function Reach(props: { hostId: string }) {
  return (
    <span data-vesta="vesta-reach" data-state={hostReach(props.hostId)}>
      <span data-vesta="vesta-reach-dot" aria-hidden="true" />
      {t(reachLabels[hostReach(props.hostId)])}
    </span>
  );
}

/** Spinner plus a line of text, for waits the person can't speed up. */
export function Working(props: { label: string }) {
  return (
    <p data-vesta="vesta-working" role="status">
      <span data-vesta="vesta-spinner" aria-hidden="true" />
      <span>{props.label}</span>
    </p>
  );
}
