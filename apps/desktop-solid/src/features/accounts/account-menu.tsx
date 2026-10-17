import { Button, Popover, type Placement } from '@vesta/ui';
import { For, Show, createSignal, createUniqueId } from 'solid-js';
import {
  ACCOUNT_TYPE_GUEST,
  accounts,
  accountsLoaded,
  accountsError,
  activeAccount,
  addAccount,
  removeAccount,
  refreshAccounts,
  switchAccount,
  usePlayerHead,
  type Account,
} from './accounts';
import { t } from '../../localization';
import './account-menu.css';

/** A player's head as a square image, with the old launcher's grey gradient while unavailable. */
function Head(props: { uuid: () => string | undefined; size: number }) {
  const url = usePlayerHead(() => props.uuid());
  return (
    <span
      data-vesta="account-head"
      data-loaded={url() ? '' : undefined}
      style={{ '--head-size': `${props.size}px`, '--head-image': url() ? `url(${url()})` : 'none' } as never}
      aria-hidden="true"
    />
  );
}

export interface AccountMenuProps {
  /** Where the popover opens relative to the button. */
  placement?: Placement;
  /** Called for "Manage skins & account"; the shell decides where that goes. */
  onManage?: () => void;
}

/**
 * The profile button and its account popover. The button is carried over from the
 * launcher sidebar: the player's head with a subtle inset outline.
 */
export function AccountMenu(props: AccountMenuProps) {
  const switchLabel = createUniqueId();
  const [open, setOpen] = createSignal(false, { name: 'accountPopupOpen' });
  const [busy, setBusy] = createSignal(false, { name: 'accountActionPending' });
  const [error, setError] = createSignal<'action' | undefined>(undefined, { name: 'accountActionError' });
  const changeOpen = (value: boolean) => {
    setOpen(value);
    setError(undefined);
    if (value) void refreshAccounts();
  };
  const run = async (action: () => Promise<void>) => {
    if (busy()) return;
    setBusy(true);
    setError(undefined);
    try { await action(); changeOpen(false); }
    catch (reason) { console.error('Account action failed:', reason); setError('action'); }
    finally { setBusy(false); }
  };
  const signIn = () => {
    changeOpen(false);
    // Let the popover restore focus before the sign-in dialog acquires it.
    queueMicrotask(() => void addAccount());
  };
  const others = () => accounts().filter((account) => account.uuid !== activeAccount()?.uuid);
  const choose = (account: Account) => {
    if (account.is_expired) return signIn();
    void run(() => switchAccount(account.uuid));
  };
  return (
    <Popover
      title={t('account.profile')}
      open={open()}
      onOpenChange={changeOpen}
      placement={props.placement ?? 'right-start'}
      class="account-popover"
      trigger={(popoverProps) => (
        <button
          {...popoverProps}
          type="button"
          data-vesta="profile-button"
          data-open={open() ? '' : undefined}
          title={t('account.profile')}
          aria-label={t('account.trigger', { name: activeAccount()?.username ?? t('account.profile') })}
        >
          <Head uuid={() => activeAccount()?.uuid} size={40} />
          <Show when={!accountsLoaded()}><span data-vesta="profile-spinner" aria-hidden="true" /></Show>
        </button>
      )}
    >
      <Show
        when={activeAccount()}
        fallback={
          <p data-vesta="account-empty" role="status">
            {t(accountsLoaded() ? 'account.empty-description' : 'account.loading')}
          </p>
        }
      >
        {(account) => (
          <div data-vesta="account-top">
            <span data-vesta="account-face">
              <Head uuid={() => account().uuid} size={32} />
            </span>
            <div data-vesta="account-copy">
              <strong>{account().username}</strong>
              <small data-tone={account().is_expired ? 'danger' : undefined}>
                {account().is_expired
                  ? t('account.expired')
                  : account().account_type === ACCOUNT_TYPE_GUEST
                    ? t('account.guest')
                    : t('account.status', { name: account().account_type })}
              </small>
            </div>
          </div>
        )}
      </Show>
      <Show when={others().length}>
        <span data-vesta="account-section-title" id={switchLabel}>
          {t('account.switch')}
        </span>
        <div data-vesta="account-list" role="group" aria-labelledby={switchLabel} aria-busy={busy() ? 'true' : 'false'}>
          <For each={others()}>
            {(other) => (
              <button
                type="button"
                data-vesta="account-line"
                disabled={busy()}
                onClick={() => choose(other)}
                aria-label={t('account.trigger', { name: other.username })}
              >
                <span data-vesta="account-face" data-size="small">
                  <Head uuid={() => other.uuid} size={20} />
                </span>
                <span>{other.username}</span>
                <Show when={other.is_expired}>
                  <span data-vesta="account-expired">{t('account.expired')}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={accountsError()}>
        <div data-vesta="account-load-error" role="alert">
          <span>{t('account.load-failed')}</span>
          <Button size="sm" variant="ghost" onClick={() => void refreshAccounts(true)}>
            {t('common.retry')}
          </Button>
        </div>
      </Show>
      <Show when={error()}>
        <p role="alert" data-vesta="account-action-error">
          {t('account.action-failed')}
        </p>
      </Show>
      <div data-vesta="account-divider" />
      <button type="button" data-vesta="account-line" data-action="add-account" disabled={busy()} onClick={signIn}>
        <span>{t('account.add')}</span>
      </button>
      <button
        type="button"
        data-vesta="account-line"
        disabled={busy() || !props.onManage}
        onClick={() => {
          changeOpen(false);
          props.onManage?.();
        }}
      >
        <span>{t('account.manage')}</span>
      </button>
      <Show when={activeAccount() && activeAccount()?.account_type !== ACCOUNT_TYPE_GUEST}>
        <button
          type="button"
          data-vesta="account-line"
          data-tone="danger"
          disabled={busy()}
          onClick={() => {
            const uuid = activeAccount()?.uuid;
            if (uuid) void run(() => removeAccount(uuid));
          }}
        >
          <span>{t('account.log-out')}</span>
        </button>
      </Show>
    </Popover>
  );
}
