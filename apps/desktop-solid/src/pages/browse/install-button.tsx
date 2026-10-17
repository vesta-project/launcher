import { Button, Tooltip } from '@vesta/ui';
import { createMemo, Show } from 'solid-js';
import { Icon } from '../../components/icon';
import type { InstallState } from '../../features/browse/browse-store';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';

const reasons = {
  vanilla: 'browse.reason-vanilla',
  loader: 'browse.reason-loader',
  'no-version': 'browse.reason-no-version',
  game: 'browse.reason-game-version',
} satisfies Record<string, MessageId>;

/**
 * The Install action shared by cards, the project header and version rows. It always reads
 * Install when there is something to do; where it goes (target, picker, pack flow, world) is
 * decided by `onRun`. `primary` makes it the page's main action.
 */
export function InstallButton(props: {
  state: () => InstallState;
  targetName: () => string | undefined;
  onRun: () => void;
  size?: 'sm' | 'md';
  primary?: boolean;
  /** Replaces the hint shown on hover while installable. */
  hint?: string;
  /** Installable in principle but not right now (another version is installing). */
  disabled?: boolean;
}) {
  const kind = () => props.state().kind;
  const label = () =>
    kind() === 'installed'
      ? t('browse.action-installed')
      : kind() === 'update'
        ? t('browse.action-update')
        : kind() === 'installing'
          ? t('browse.action-installing')
          : t('browse.action-install');
  const icon = () =>
    kind() === 'installed'
      ? 'icons/controls/check'
      : kind() === 'update'
        ? 'icons/actions/refresh'
        : 'icons/actions/download';
  const hint = () =>
    kind() === 'install'
      ? (props.hint ?? (props.targetName() ? t('browse.install-into', { title: props.targetName() as string }) : undefined))
      : undefined;
  const variant = () =>
    kind() === 'installed' ? 'ghost' : kind() === 'update' || (props.primary && kind() === 'install') ? 'solid' : 'outline';
  const button = () => (
    <Button
      size={props.size ?? 'sm'}
      variant={variant()}
      tone={kind() === 'installed' ? 'success' : kind() === 'update' || props.primary ? 'accent' : 'neutral'}
      disabled={props.disabled || kind() === 'installed' || kind() === 'installing' || kind() === 'unavailable'}
      data-busy={kind() === 'installing' ? '' : undefined}
      data-tip={hint()}
      icon={<Icon name={icon()} size={props.size === 'md' ? 14 : 12} />}
      onClick={() => props.onRun()}
    >
      {label()}
    </Button>
  );
  const unavailable = createMemo(
    () => {
      const current = props.state();
      return current.kind === 'unavailable' ? current.reason : undefined;
    },
    { name: 'browseInstallReason' },
  );
  return (
    <Show when={unavailable()} fallback={button()}>
      {(reason) => (
        <Tooltip
          content={t(reasons[reason()])}
          trigger={(triggerProps) => (
            <span {...triggerProps} data-vesta="browse-card-action-wrap" tabindex={0}>
              {button()}
            </span>
          )}
        />
      )}
    </Show>
  );
}
