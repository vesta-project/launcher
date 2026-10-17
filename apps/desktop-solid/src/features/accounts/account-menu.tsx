import { Button, IconButton, Popover, type Placement } from '@vesta/ui';
import { For, Show, createSignal, createUniqueId, onCleanup } from 'solid-js';
import { Icon } from '../../components/icon';
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
import { copyText } from '../../platform/clipboard';
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
  /** Called for "Manage skin and account"; the shell decides where that goes. */
  onManage?: () => void;
}

/**
 * The profile button and its account popover. The button is carried over from the
 * launcher sidebar: the player's head with a subtle inset outline.
 */
export function AccountMenu(props: AccountMenuProps) {
  const switchLabel = createUniqueId();
  const [open, setOpen] = createSignal(false, { name: 'accountPopupOpen' });
  const [copied, setCopied] = createSignal(false, { name: 'accountUuidCopied' });
  const [busy, setBusy] = createSignal(false, { name: 'accountActionPending' });
  const [error, setError] = createSignal<'action' | 'copy' | undefined>(undefined, { name: 'accountActionError' });
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copyTimer));

  const changeOpen = (value: boolean) => {
    setOpen(value);
    setCopied(false);
    setError(undefined);
    clearTimeout(copyTimer);
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
  const choose = (account: Account) => {
    if (account.is_expired) return signIn();
    if (account.uuid === activeAccount()?.uuid) return;
    void run(() => switchAccount(account.uuid));
  };
  const copyUuid = async () => {
    const uuid = activeAccount()?.uuid;
    if (!uuid) return;
    try {
      await copyText(uuid);
      setCopied(true);
      setError(undefined);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => setCopied(false), 1600);
    } catch { setError('copy'); }
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
          data-tip={t('account.profile')}
          aria-label={t('account.trigger', { name: activeAccount()?.username ?? t('account.profile') })}
        >
          <Head uuid={() => activeAccount()?.uuid} size={40} />
          <Show when={!accountsLoaded()}><span data-vesta="profile-spinner" aria-hidden="true" /></Show>
        </button>
      )}
    >
      <div data-vesta="account-top">
        <Show when={activeAccount()} fallback={
          <div data-vesta="account-copy"><strong>{t('account.profile')}</strong><small>{t('account.empty-title')}</small></div>
        }>
          {(account) => <>
            <span data-vesta="account-face"><Head uuid={() => account().uuid} size={45} /></span>
            <div data-vesta="account-copy">
              <strong>{account().username}</strong>
              <small>{account().is_expired ? t('account.expired') : t('account.status', { name: account().account_type })}</small>
            </div>
          </>}
        </Show>
        <IconButton variant="ghost" size="sm" class="account-close" tooltip={false} label={t('account.close')} icon={<Icon name="icons/actions/close" size={12} />} onClick={() => changeOpen(false)} />
      </div>
      <Show when={activeAccount()} fallback={
        <p data-vesta="account-empty" role="status">{t(accountsLoaded() ? 'account.empty-description' : 'account.loading')}</p>
      }>
        {(account) => <>
          <button type="button" data-vesta="account-uuid" data-tip={t(copied() ? 'account.uuid-copied' : 'account.copy-uuid')} aria-label={t('account.copy-uuid')} disabled={busy()} onClick={() => void copyUuid()}>
            <code>{account().uuid}</code>
            <Icon name={copied() ? 'icons/controls/check' : 'icons/actions/copy'} size={14} />
          </button>
          <span data-vesta="account-copy-status" role="status">{copied() ? t('account.uuid-copied') : ''}</span>
          <div data-vesta="account-actions">
            <Button size="sm" variant="ghost" disabled={busy() || !props.onManage} onClick={() => { changeOpen(false); props.onManage?.(); }}>
              {t('account.manage-short')}
            </Button>
            <Show when={account().account_type !== ACCOUNT_TYPE_GUEST}>
              <Button size="sm" variant="ghost" tone="danger" disabled={busy()} onClick={() => void run(() => removeAccount(account().uuid))}>
                {t('account.log-out')}
              </Button>
            </Show>
          </div>
          <div data-vesta="account-divider" />
          <span data-vesta="account-section-title" id={switchLabel}>{t('account.switch')}</span>
          <div data-vesta="account-list" role="group" aria-labelledby={switchLabel} aria-busy={busy() ? "true" : "false"}>
            <For each={accounts()}>{(other) => (
              <button type="button" data-vesta="account-line" data-current={other.uuid === activeAccount()?.uuid ? '' : undefined}
                disabled={busy()} onClick={() => choose(other)} aria-label={t('account.trigger', { name: other.username })}
                aria-pressed={other.uuid === activeAccount()?.uuid ? "true" : "false"}>
                <span data-vesta="account-face" data-size="small"><Head uuid={() => other.uuid} size={24} /></span>
                <span>{other.username}</span>
                <Show when={other.is_expired}><span data-vesta="account-expired">{t('account.expired')}</span></Show>
                <Show when={other.uuid === activeAccount()?.uuid}><Icon name="icons/controls/check" size={16} label={t('account.active')} /></Show>
              </button>
            )}</For>
          </div>
        </>}
      </Show>
      <Show when={accountsError()}>
        <div data-vesta="account-load-error" role="alert">
          <span>{t('account.load-failed')}</span>
          <Button size="sm" variant="ghost" onClick={() => void refreshAccounts(true)}>{t('common.retry')}</Button>
        </div>
      </Show>
      <Show when={error()}><p role="alert" data-vesta="account-action-error">{t(error() === 'copy' ? 'account.copy-failed' : 'account.action-failed')}</p></Show>
      <button type="button" data-vesta="account-line" data-action="add-account" disabled={busy()} onClick={signIn}>
        <Icon name="icons/actions/add" size={16} /><span>{t('account.add')}</span>
      </button>
    </Popover>
  );
}
