import { Button } from '@vesta/ui';
import { For, Show, createMemo, createSignal, onCleanup, onSettled } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';

/** "14:52", from the code's expiry; ticks once a second while a code is shown. */
function useCountdown(expiresAt: () => number | undefined) {
  const [now, setNow] = createSignal(Date.now(), { name: 'welcomeAuthClock' });
  onSettled(() => {
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


export function DeviceCode(props: { code: string; expiresAt?: number; copy: () => Promise<boolean>; openPage: () => Promise<void>; retry?: () => void; cancel: () => void }) {
  const [copied, setCopied] = createSignal(false, { name: 'welcomeCodeCopied' });
  const countdown = useCountdown(() => props.expiresAt);
  const expired = () => countdown()?.left === 0;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));
  const copy = async () => {
    if (!(await props.copy())) return;
    setCopied(true);
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopied(false), 2000);
  };
  const copyAndOpen = async () => {
    await copy();
    await props.openPage();
  };


  return (
    <div data-vesta="welcome-auth-code">
      {/* The code reads as tiles, one per character, so it is easy to copy by eye too. */}
      <button
        type="button"
        data-vesta="welcome-code"
        data-expired={expired() ? '' : undefined}
        data-copied={copied() ? '' : undefined}
        aria-label={t('welcome.auth-copy-code', { code: props.code })}
        disabled={expired()}
        onClick={() => void copy()}
      >
        <span data-vesta="welcome-code-tiles" aria-hidden="true">
          <For each={[...props.code.replace(/[^\w]/g, '')]}>
            {(char) => <span data-vesta="welcome-code-tile">{char}</span>}
          </For>
        </span>
        <span data-vesta="welcome-code-hint">
          <Icon name={copied() ? 'icons/controls/check' : 'icons/actions/copy'} size={12} />
          {copied() ? t('welcome.auth-copied') : t('welcome.auth-copy')}
        </span>
      </button>
      <p data-vesta="welcome-auth-where">
        {t('welcome.auth-move-paste')} <strong>microsoft.com/link</strong>
      </p>

      <Show
        when={!expired()}
        fallback={
          <div data-vesta="welcome-actions" data-align="center">
            <Show when={props.retry}><Button tone="accent" onClick={() => props.retry?.()}>
              {t('welcome.auth-new-code')}
            </Button></Show>
            <Button variant="ghost" onClick={() => props.cancel()}>
              {t('common.cancel')}
            </Button>
          </div>
        }
      >
        <div data-vesta="welcome-actions" data-align="center">
          <Button
            tone="accent"
            icon={<Icon name="icons/actions/external-link" size={14} />}
            onClick={() => void copyAndOpen()}
          >
            {t('welcome.auth-copy-open')}
          </Button>
          <Button variant="ghost" onClick={() => props.cancel()}>
            {t('common.cancel')}
          </Button>
        </div>
      </Show>

      <p data-vesta="welcome-auth-waiting" aria-live="polite">
        <Show
          when={!expired()}
          fallback={<span>{t('welcome.auth-expired')}</span>}
        >
          <span data-vesta="welcome-spinner" aria-hidden="true" />
          <span>{t('welcome.auth-waiting')}</span>
          <Show when={countdown()}>
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
