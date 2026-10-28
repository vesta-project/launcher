import { Popover, TextField } from '@vesta/ui';
import type { JSX } from '@solidjs/web';
import { createMemo, createSignal, For, Show, untrack } from 'solid-js';
import { EmptyLine } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import type { ResourceType } from '../../features/browse/browse-model';
import {
  buildTargetOptions,
  parseTargetValue,
  targetValue,
  type BrowseTargetRef,
  type InstanceOption,
  type ServerOption,
} from '../../features/browse/browse-targets';
import { chooseTarget, serverTarget, targetRef, type } from '../../features/browse/browse-store';
import { serverPermissions } from '../../features/browse/install-targets';
import { serverSoftware } from '../../features/browse/server-install';
import { instances } from '../../features/instances/catalog';
import { peekServerResource } from '../../features/servers/resources';
import { contentResource } from '../../features/servers/server-resources';
import { serverSnapshot, serverSnapshots } from '../../features/servers/store';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { serverImage, softwareText } from './server-target-steps';
import './target-select.css';

const connectionLabels: Record<ServerOption['connection'], MessageId> = {
  online: 'browse.server-online',
  connecting: 'browse.server-connecting',
  offline: 'browse.server-offline',
  access: 'browse.server-access',
};

/** "1.21.4 · Paper"; unreachable servers leave out software nobody could read. */
function serverMeta(option: ServerOption) {
  const software = option.software === undefined && option.unreachable ? undefined : softwareText(option.software);
  return [option.minecraftVersion, software].filter(Boolean).join(' · ');
}

/**
 * Where Browse installs to and what it scopes results by: no target, one of the instances or
 * one of the servers the user may install to or edit the pack of (offline ones stay
 * selectable, marked). A server filters by its version and software, marks what it already
 * has, and makes Install open at that server. Modpacks list servers only: a modpack otherwise
 * creates a new instance. Long lists get a search field.
 */
export function TargetSelect(props: {
  class?: string;
  'aria-label'?: string;
  /** The resource type being installed; defaults to the Browse type. */
  kind?: ResourceType;
  /** Replaces the default (route) change, e.g. on a project page that must stay put. */
  onChange?: (ref: BrowseTargetRef | undefined) => void;
}) {
  const [open, setOpen] = createSignal(false, { name: 'browseTargetOpen' });
  const [search, setSearch] = createSignal('', { name: 'browseTargetSearch' });
  const [software, setSoftware] = createSignal<Record<string, string | null>>({}, { name: 'browseTargetSoftware' });
  const kind = () => props.kind ?? type();
  const modpack = () => kind() === 'modpack';

  const softwareOf = (id: string): string | null | undefined => {
    const known = software();
    if (id in known) return known[id];
    const current = serverTarget();
    if (current?.id === id && current.software !== undefined) return current.software;
    return peekServerResource(id, contentResource)?.software;
  };
  const versionOf = (id: string) => {
    const current = serverTarget();
    return current?.id === id ? current.minecraftVersion : peekServerResource(id, contentResource)?.minecraftVersion;
  };
  const optionsFor = (query: string) =>
    buildTargetOptions({
      instances: instances().map((entry) => entry.instance),
      snapshots: serverSnapshots(),
      software: softwareOf,
      minecraftVersion: versionOf,
      kind: kind(),
      query,
    });
  const all = createMemo(() => optionsFor(''), { name: 'browseTargetAll' });
  const shown = createMemo(() => (search().trim() ? optionsFor(search()) : all()), { name: 'browseTargetShown' });

  /** Modpacks never take an instance target; a server one carries over. */
  const value = createMemo(
    () => {
      const ref = targetRef();
      return ref && !(modpack() && ref.kind === 'instance') ? targetValue(ref) : '';
    },
    { name: 'browseTargetValue' },
  );
  const selected = createMemo(
    () => {
      const current = value();
      const options = all();
      return (
        options.instances.find((option) => option.value === current) ??
        options.servers.find((option) => option.value === current)
      );
    },
    { name: 'browseTargetSelected' },
  );

  /** Software decides how a server scopes Browse; read it for reachable servers on opening. */
  const readSoftware = () => {
    const known = untrack(software);
    for (const snapshot of untrack(serverSnapshots)) {
      const id = snapshot.connection.id;
      const allowed = serverPermissions(snapshot);
      if (id in known || snapshot.state.phase !== 'online' || (!allowed.server && !allowed.modpack)) continue;
      void serverSoftware(id).then((found) => setSoftware((current) => ({ ...current, [id]: found })));
    }
  };

  const choose = (next: string) => {
    setOpen(false);
    setSearch('');
    if (next === untrack(value)) return;
    (props.onChange ?? chooseTarget)(parseTargetValue(next));
  };

  /** Arrow keys walk the options, from the search field too; Enter in it takes the first. */
  const onKeyDown = (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
    const input = event.target instanceof HTMLInputElement;
    if (input && event.key === 'Enter') {
      const first = event.currentTarget.querySelector<HTMLButtonElement>('[role="option"]');
      if (first) {
        event.preventDefault();
        first.click();
      }
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (input && (event.key === 'Home' || event.key === 'End')))
      return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (at + 1) % items.length
            : at <= 0
              ? items.length - 1
              : at - 1;
    items[next]!.focus();
  };

  const triggerLabel = () => {
    const option = selected();
    if (option) return option.name;
    const ref = parseTargetValue(value());
    if (ref?.kind === 'server') return serverSnapshot(ref.id)?.connection.name ?? ref.id;
    return t(modpack() ? 'browse.target-new-instance' : 'browse.no-instance');
  };
  const triggerIcon = (): JSX.Element => {
    const option = selected();
    if (option?.kind === 'instance') return <img data-vesta="browse-target-icon" src={option.image} alt="" decoding="async" />;
    if (option?.kind === 'server') return <img data-vesta="browse-target-icon" src={serverImage(option)} alt="" decoding="async" />;
    return (
      <span data-vesta="browse-target-icon" data-empty="">
        <Icon name={modpack() ? 'icons/actions/add' : 'icons/content/cube'} size={12} />
      </span>
    );
  };

  const Row = (row: {
    value: string;
    image: () => JSX.Element;
    name: string;
    meta?: string;
    aside?: JSX.Element;
    offline?: boolean;
  }) => (
    <button
      type="button"
      role="option"
      data-vesta="browse-target-row"
      aria-selected={row.value === value() ? 'true' : 'false'}
      data-selected={row.value === value() ? '' : undefined}
      data-offline={row.offline ? '' : undefined}
      onClick={() => choose(row.value)}
    >
      <span data-vesta="browse-target-art">{row.image()}</span>
      <span data-vesta="browse-target-text">
        <strong>{row.name}</strong>
        <Show when={row.meta}>
          <span>{row.meta}</span>
        </Show>
      </span>
      {row.aside}
      <span data-vesta="browse-target-check" aria-hidden="true">
        <Show when={row.value === value()}>
          <Icon name="icons/controls/check" size={12} />
        </Show>
      </span>
    </button>
  );

  const InstanceRow = (row: { option: InstanceOption }) => (
    <Row
      value={row.option.value}
      name={row.option.name}
      meta={`${row.option.minecraftVersion} · ${row.option.modloader}`}
      image={() => <img data-vesta="browse-target-icon" src={row.option.image} alt="" loading="lazy" decoding="async" />}
    />
  );
  const ServerRow = (row: { option: ServerOption }) => (
    <Row
      value={row.option.value}
      name={row.option.name}
      meta={serverMeta(row.option)}
      offline={row.option.unreachable}
      image={() => <img data-vesta="browse-target-icon" src={serverImage(row.option)} alt="" loading="lazy" decoding="async" />}
      aside={
        <span data-vesta="browse-target-state" data-state={row.option.connection}>
          {t(connectionLabels[row.option.connection])}
        </span>
      }
    />
  );

  return (
    <div data-vesta="field" data-size="sm" class={props.class}>
      <Popover
        open={open()}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) readSoftware();
          else setSearch('');
        }}
        placement="bottom-start"
        class="browse-target-popover"
        trigger={(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            data-vesta="field-control"
            data-target-kind={selected()?.kind ?? parseTargetValue(value())?.kind}
            aria-label={props['aria-label'] ?? t('browse.section-instance')}
            aria-haspopup="listbox"
          >
            <span data-vesta="select-value">
              <span data-vesta="field-icon" aria-hidden="true">
                {triggerIcon()}
              </span>
              <span data-vesta="select-value-text">{triggerLabel()}</span>
            </span>
            <span data-vesta="select-chevron" data-expanded={open() ? '' : undefined} aria-hidden="true">
              <Icon name="icons/controls/chevron-down" size={14} />
            </span>
          </button>
        )}
      >
        <div
          data-vesta="browse-target-menu"
          onKeyDown={onKeyDown}
          ref={(element: HTMLDivElement) =>
            // The chosen row can sit below the fold (servers come after instances).
            requestAnimationFrame(() => element.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' }))
          }
        >
          <Show when={all().searchable}>
            <TextField
              size="sm"
              aria-label={t('browse.picker-search-any')}
              placeholder={t('browse.picker-search-any')}
              icon={<Icon name="icons/content/search" size={14} />}
              value={search()}
              onChange={setSearch}
            />
          </Show>
          <div data-vesta="browse-target-list" role="listbox" aria-label={props['aria-label'] ?? t('browse.section-instance')}>
            <Show when={!search().trim()}>
              <Row
                value=""
                name={t(modpack() ? 'browse.target-new-instance' : 'browse.no-instance')}
                meta={t(modpack() ? 'browse.target-new-instance-help' : 'browse.target-any-help')}
                image={() => (
                  <span data-vesta="browse-target-icon" data-empty="">
                    <Icon name={modpack() ? 'icons/actions/add' : 'icons/content/cube'} size={14} />
                  </span>
                )}
              />
            </Show>
            <Show when={shown().instances.length}>
              <div role="group" data-vesta="browse-target-group" aria-label={t('browse.picker-instances')}>
                <h3 data-vesta="browse-target-heading" aria-hidden="true">
                  {t('browse.picker-instances')}
                </h3>
                <For each={shown().instances} keyed={(option) => option.value}>
                  {(option) => <InstanceRow option={option()} />}
                </For>
              </div>
            </Show>
            <Show when={shown().servers.length}>
              <div role="group" data-vesta="browse-target-group" aria-label={t('browse.picker-servers')}>
                <h3 data-vesta="browse-target-heading" aria-hidden="true">
                  {t('browse.picker-servers')}
                </h3>
                <For each={shown().servers} keyed={(option) => option.value}>
                  {(option) => <ServerRow option={option()} />}
                </For>
              </div>
            </Show>
            <Show when={search().trim() && !shown().instances.length && !shown().servers.length}>
              <EmptyLine>{t('browse.target-empty')}</EmptyLine>
            </Show>
          </div>
        </div>
      </Popover>
    </div>
  );
}
