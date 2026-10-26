import { Badge, Checkbox } from '@vesta/ui';
import { For, Show } from 'solid-js';
import { EmptyLine } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import {
  destinations,
  MODPACK_TARGET_READY,
  type Destination,
  type DependencyRow,
  type DestinationState,
  type ServerTarget,
  type TargetReason,
  type TargetStates,
} from '../../features/browse/install-targets';
import { initials, serverArt } from '../../features/servers/art';
import { softwareName } from '../../features/servers/hosting-model';
import type { SoftwareId } from '../../features/servers/hosting-native';
import { serverIcon } from '../../features/servers/store';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';

export const reasonMessage = (reason: TargetReason) => `browse.target-reason-${reason}` as MessageId;

const connectionLabels: Record<ServerTarget['connection'], MessageId> = {
  online: 'browse.server-online',
  connecting: 'browse.server-connecting',
  offline: 'browse.server-offline',
  access: 'browse.server-access',
};

const destinationLabels: Record<Destination, { title: MessageId; help: MessageId; icon: string }> = {
  server: { title: 'browse.target-server', help: 'browse.target-server-help', icon: 'icons/content/server' },
  modpack: { title: 'browse.target-modpack', help: 'browse.target-modpack-help', icon: 'icons/content/modpack' },
  both: { title: 'browse.target-both', help: 'browse.target-both-help', icon: 'icons/content/layers' },
};

export const blockedReason = (state: DestinationState) => (state.available ? undefined : state.reason);

export const serverImage = (target: Pick<ServerTarget, 'id' | 'serverId' | 'name'>) =>
  serverIcon(target.id) ?? serverArt(target.serverId, initials(target.name));

export function softwareText(software: ServerTarget['software']): string {
  if (software === undefined) return t('browse.server-software-checking');
  return softwareName(software as SoftwareId | null) ?? t('browse.server-software-unknown');
}

/** One server in the picker's Servers section. */
export function ServerRow(props: { target: ServerTarget; state: DestinationState | 'checking'; onChoose: () => void }) {
  const status = () => (props.state === 'checking' ? 'checking' : props.state.available ? 'ready' : 'incompatible');
  const reason = () => (props.state === 'checking' ? undefined : blockedReason(props.state));
  return (
    <li data-vesta="browse-picker-row" data-status={status()}>
      <button
        type="button"
        data-vesta="browse-picker-choice"
        disabled={status() !== 'ready'}
        onClick={() => props.onChoose()}
      >
        <img data-vesta="browse-picker-icon" src={serverImage(props.target)} alt="" decoding="async" />
        <span data-vesta="browse-picker-text">
          <strong>{props.target.name}</strong>
          <span>
            {[
              props.target.minecraftVersion,
              props.target.connection === 'online' || props.target.software !== undefined
                ? softwareText(props.target.software)
                : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span data-vesta="browse-picker-connection" data-state={props.target.connection}>
          {t(connectionLabels[props.target.connection])}
        </span>
        {/* A connection problem is already said by the connection label. */}
        <Show when={reason() !== props.target.connection}>
          <span data-vesta="browse-picker-status" data-status={status()}>
            <Show
              when={reason()}
              fallback={t(status() === 'checking' ? 'browse.status-checking' : 'browse.server-choose')}
            >
              {(why) => t(reasonMessage(why()))}
            </Show>
          </span>
        </Show>
      </button>
    </li>
  );
}

/** On the server, in the modpack, or both. */
export function TargetStep(props: {
  target: ServerTarget;
  states: TargetStates;
  suggested: Destination;
  selected: Destination;
  onSelect: (destination: Destination) => void;
}) {
  return (
    <div data-vesta="browse-target-step">
      <div data-vesta="browse-target-server">
        <img data-vesta="browse-picker-icon" src={serverImage(props.target)} alt="" decoding="async" />
        <span data-vesta="browse-picker-text">
          <strong>{props.target.name}</strong>
          <span>
            {props.target.minecraftVersion} · {softwareText(props.target.software)}
          </span>
        </span>
      </div>
      <div data-vesta="browse-target-options" role="radiogroup" aria-label={t('browse.picker-title-any')}>
        <For each={destinations}>
          {(destination) => {
            const state = () => props.states[destination];
            const labels = () => destinationLabels[destination];
            return (
              <button
                type="button"
                role="radio"
                data-vesta="browse-target-option"
                aria-checked={props.selected === destination ? 'true' : 'false'}
                data-selected={props.selected === destination ? '' : undefined}
                disabled={!state().available}
                onClick={() => props.onSelect(destination)}
              >
                <Icon name={labels().icon} size={16} />
                <span data-vesta="browse-target-option-text">
                  <strong>
                    {t(labels().title)}
                    <Show when={props.suggested === destination && state().available}>
                      <Badge size="sm" tone="accent">
                        {t('browse.target-suggested')}
                      </Badge>
                    </Show>
                  </strong>
                  <span>{t(labels().help)}</span>
                  <Show when={blockedReason(state())}>
                    {(reason) => <span data-vesta="browse-target-reason">{t(reasonMessage(reason()))}</span>}
                  </Show>
                </span>
              </button>
            );
          }}
        </For>
      </div>
      <Show when={!MODPACK_TARGET_READY && props.target.canEditPack}>
        <p data-vesta="browse-target-note">
          <Icon name="icons/status/info" size={12} />
          {t('browse.target-reason-modpack-coming')}
        </p>
      </Show>
    </div>
  );
}

/** The dependencies the resolver returned; required ones stay ticked, optional ones are a choice. */
export function DependencyStep(props: {
  rows: DependencyRow[] | undefined;
  error: string | undefined;
  onToggle: (index: number, selected: boolean) => void;
}) {
  return (
    <div data-vesta="browse-deps-step">
      <p data-vesta="browse-deps-help">{t('browse.deps-description')}</p>
      <Show when={props.error}>{(message) => <EmptyLine>{t('browse.deps-failed', { message: message() })}</EmptyLine>}</Show>
      <Show when={!props.rows && !props.error}>
        <EmptyLine>{t('browse.deps-loading')}</EmptyLine>
      </Show>
      <Show when={props.rows?.length === 0}>
        <EmptyLine>{t('browse.deps-none')}</EmptyLine>
      </Show>
      <Show when={props.rows?.length}>
        <ul data-vesta="browse-deps-list">
          <For each={props.rows ?? []}>
            {(row, index) => (
              <li data-vesta="browse-deps-row">
                <Checkbox
                  size="sm"
                  label={row.project.name}
                  description={row.version?.version_number}
                  checked={row.selected}
                  disabled={row.required || !!row.installed}
                  onChange={(checked) => props.onToggle(index(), checked)}
                />
                <Badge size="sm" tone={row.installed ? 'success' : row.required ? 'accent' : 'neutral'}>
                  {t(row.installed ? 'browse.deps-installed' : row.required ? 'browse.deps-required' : 'browse.deps-optional')}
                </Badge>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
