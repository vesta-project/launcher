import { Button } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';

/** "14:52", from the code's expiry; ticks once a second while a code is shown. */
function useCountdown(expiresAt: () => number | undefined) {
  const [now, setNow] = createSignal(Date.now(), { name: 'welcomeAuthClock' });
  createEffect(expiresAt, (expiry) => {
    if (expiry === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  });
  return createMemo(
    () => {
      const end = expiresAt();
      if (end === undefined) return undefined;
      const left = Math.max(0, Math.round((end - now()) / 1000));
      return { left, text: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
    },
    { name: 'welcomeAuthCountdown' },
  );
}


export function createDeviceCode(expiresAt: () => number | undefined, copyCode: () => Promise<boolean>, openPage: () => Promise<void>) {
  const [copied, setCopied] = createSignal(false, { name: 'welcomeCodeCopied' });
  const countdown = useCountdown(expiresAt);
  const expired = () => countdown()?.left === 0;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));
  const copy = async () => {
    if (!(await copyCode())) return;
    setCopied(true);
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopied(false), 2000);
  };
  const copyAndOpen = async () => {
    await copy();
    await openPage();
  };
  return { copied, countdown, expired, copy, copyAndOpen };
}

type DeviceCodeState = ReturnType<typeof createDeviceCode>;

export function DeviceCode(props: { code: string; state: DeviceCodeState }) {
  return (
    <div data-vesta="welcome-auth-code">
      {/* The code reads as tiles, one per character, so it is easy to copy by eye too. */}
      <button
        type="button"
        data-vesta="welcome-code"
        data-expired={props.state.expired() ? '' : undefined}
        data-copied={props.state.copied() ? '' : undefined}
        aria-label={t('welcome.auth-copy-code', { code: props.code })}
        disabled={props.state.expired()}
        onClick={() => void props.state.copy()}
      >
        <span data-vesta="welcome-code-tiles" aria-hidden="true">
          <For each={[...props.code.replace(/[^\w]/g, '')]}>
            {(char) => <span data-vesta="welcome-code-tile">{char}</span>}
          </For>
        </span>
        <span data-vesta="welcome-code-hint">
          <Icon name={props.state.copied() ? 'icons/controls/check' : 'icons/actions/copy'} size={12} />
          {props.state.copied() ? t('welcome.auth-copied') : t('welcome.auth-copy')}
        </span>
      </button>
      <p data-vesta="welcome-auth-where">
        {t('welcome.auth-move-paste')} <strong>microsoft.com/link</strong>
      </p>

      <p data-vesta="welcome-auth-waiting" aria-live="polite">
        <Show
          when={!props.state.expired()}
          fallback={<span>{t('welcome.auth-expired')}</span>}
        >
          <span data-vesta="welcome-spinner" aria-hidden="true" />
          <span>{t('welcome.auth-waiting')}</span>
          <Show when={props.state.countdown()}>
            {(time) => (
              <span data-vesta="welcome-auth-timer" data-low={time().left < 30 ? '' : undefined}>
                {t('welcome.auth-expires', { time: time().text })}
              </span>
            )}
          </Show>
        </Show>
      </p>
    </div>
  );
}

export function DeviceCodeActions(props: { state: DeviceCodeState; retry: () => void; cancel: () => void }) {
  return (
    <>
      <Button variant="ghost" onClick={props.cancel}>{t('common.cancel')}</Button>
      <Show when={!props.state.expired()} fallback={<Button tone="accent" onClick={props.retry}>{t('welcome.auth-new-code')}</Button>}>
        <Button tone="accent" icon={<Icon name="icons/actions/external-link" size={14} />} onClick={() => void props.state.copyAndOpen()}>
          {t('welcome.auth-copy-open')}
        </Button>
      </Show>
    </>
  );
}
