import { Button, Popover, Tooltip, mergeElementProps, type Placement } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { Icon } from '../../components/icon';
import {
  ACCOUNT_TYPE_GUEST,
  accounts,
  accountsLoaded,
  activeAccount,
  addAccount,
  removeAccount,
  switchAccount,
  usePlayerHead,
  type Account,
} from './accounts';
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
 * old launcher's sidebar: the player's head in a small bordered tile.
 */
export function AccountMenu(props: AccountMenuProps) {
  const [open, setOpen] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const others = () => accounts().filter((account) => account.uuid !== activeAccount()?.uuid);
  const isGuest = () => activeAccount()?.account_type === ACCOUNT_TYPE_GUEST;

  const copyUuid = async () => {
    const uuid = activeAccount()?.uuid;
    if (!uuid) return;
    await navigator.clipboard.writeText(uuid);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const run = async (action: () => Promise<void>) => {
    if (busy()) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      console.error('Account action failed:', error);
    } finally {
      setBusy(false);
    }
  };

  const choose = (account: Account) => {
    // Expired accounts need a fresh login; the sign-in flow handles that.
    if (account.is_expired) return void run(addAccount).then(() => setOpen(false));
    void run(() => switchAccount(account.uuid)).then(() => setOpen(false));
  };

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement={props.placement ?? 'right-start'}
      class="account-popover"
      trigger={(popoverProps) => (
        <Tooltip
          content="Profile"
          placement="right"
          disabled={open()}
          trigger={(tooltipProps) => (
            <button
              {...mergeElementProps<Record<string, unknown>>(popoverProps, tooltipProps)}
              type="button"
              data-vesta="profile-button"
              data-open={open() ? '' : undefined}
              aria-label={`Account: ${activeAccount()?.username ?? 'loading'}`}
            >
              <Head uuid={() => activeAccount()?.uuid} size={40} />
              <Show when={!accountsLoaded()}>
                <span data-vesta="profile-spinner" aria-hidden="true" />
              </Show>
            </button>
          )}
        />
      )}
    >
      <Show when={activeAccount()}>
        {(account) => (
          <>
            <div data-vesta="account-top">
              <span data-vesta="account-face">
                <Head uuid={() => account().uuid} size={45} />
              </span>
              <div data-vesta="account-copy">
                <strong>{account().username}</strong>
                <small>{account().account_type} account{account().is_expired ? ' · Expired' : ''}</small>
              </div>
            </div>

            <div data-vesta="account-actions">
              <button type="button" data-vesta="account-line" onClick={() => { setOpen(false); props.onManage?.(); }}>
                <Icon name="icons/content/skin-icon" size={14} />
                <span>Manage skin and account</span>
                <Icon name="icons/controls/chevron-right" size={14} />
              </button>
              <button type="button" data-vesta="account-line" onClick={() => void copyUuid()}>
                <Icon name="icons/actions/copy" size={14} />
                <span>{copied() ? 'UUID copied' : 'Copy player UUID'}</span>
              </button>
              <Show when={!isGuest()}>
                <button
                  type="button"
                  data-vesta="account-line"
                  data-tone="danger"
                  disabled={busy()}
                  onClick={() => void run(() => removeAccount(account().uuid)).then(() => setOpen(false))}
                >
                  <Icon name="icons/actions/close" size={14} />
                  <span>Log out</span>
                </button>
              </Show>
            </div>

            <div data-vesta="account-divider" />
            <span data-vesta="account-section-title">Other accounts</span>
            <div data-vesta="account-list">
              <For each={others()} fallback={<span data-vesta="account-empty">No other accounts</span>}>
                {(other) => (
                  <button type="button" data-vesta="account-line" disabled={busy()} onClick={() => choose(other)}>
                    <span data-vesta="account-face" data-size="small">
                      <Head uuid={() => other.uuid} size={22} />
                    </span>
                    <span>{other.username}</span>
                    <Show when={other.is_expired}>
                      <span data-vesta="account-expired">Expired</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <Button size="sm" variant="ghost" tone="accent" icon={<Icon name="icons/actions/add" size={14} />} onClick={() => void run(addAccount).then(() => setOpen(false))}>
              Add Microsoft account
            </Button>
          </>
        )}
      </Show>
    </Popover>
  );
}
