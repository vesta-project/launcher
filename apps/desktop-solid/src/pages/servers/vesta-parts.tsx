// Small pieces shared by the Vesta Server setup, import and settings screens.
import { IconButton, TextField } from '@vesta/ui';
import { For, createSignal, onCleanup } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { copyText } from '../../platform/clipboard';
import { canonicalCode, formatCode } from '../../features/servers/host-model';

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

/** Code entry that groups as you type and accepts a pasted line with the code in it. */
export function CodeField(props: { label: string; value: string; onChange: (value: string) => void; error?: string; description?: string; autofocus?: boolean }) {
  return (
    <div data-vesta="vesta-code-field">
      <TextField
        label={props.label}
        description={props.description}
        placeholder="XXXX-XXXX-XXXX"
        value={formatCode(props.value)}
        onChange={(value) => props.onChange(canonicalCode(value))}
        error={props.error}
        autofocus={props.autofocus}
        spellcheck={false}
        autocomplete="one-time-code"
        aria-label={props.label}
      />
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

/** Spinner plus a line of text, for waits the person can't speed up. */
export function Working(props: { label: string }) {
  return (
    <p data-vesta="vesta-working" role="status">
      <span data-vesta="vesta-spinner" aria-hidden="true" />
      <span>{props.label}</span>
    </p>
  );
}
