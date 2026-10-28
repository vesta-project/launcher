import { Badge, Button, Tab, TabList, TabPanel, Tabs } from '@vesta/ui';
import { For, Show, createMemo, type Component } from 'solid-js';
import { Dynamic } from '@solidjs/web';
import { route } from '../../../app/router';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import { modpackSubTabs, resolveSubTab, type ModpackSubTab } from '../../../features/servers/modpack-area-model';
import { modpackPick } from '../../../features/servers/modpack-handoff';
import type { ServerSnapshot } from '../../../features/servers/native';
import { formatNumber, t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import { ModpackAreaContext, createModpackArea, useModpackArea } from './area';
import { ModpackContent } from './content';
import { ModpackFiles } from './files';
import { FirstRun } from './first-run';
import { GetModpack } from './get-modpack';
import { ModpackHeader } from './header';
import { InstallOnServerDialog } from './install-on-server';
import { ModpackOverview } from './overview';
import { ProviderPickDialog } from './provider-pick';
import { ModpackVersions } from './versions';
import './modpack.css';

const views: Record<ModpackSubTab, Component> = {
  overview: ModpackOverview,
  content: ModpackContent,
  files: ModpackFiles,
  versions: ModpackVersions,
};

/**
 * Server → Modpack: the pack players get, laid out like an instance (header, then Overview,
 * Content, Files and Versions). A server without a pack starts with the three ways to get one.
 */
export function ModpackTab(props: { snapshot: ServerSnapshot }) {
  const area = createModpackArea(() => props.snapshot);
  return (
    <ModpackAreaContext value={area}>
      <div data-vesta="modpack">
        <Show when={area.gates().edit} fallback={<PlayerView />}>
          <EditorView />
        </Show>
        <Show when={area.install()} keyed>{(request) => <InstallOnServerDialog request={request} />}</Show>
        <Show when={area.gates().edit && area.workspace() ? modpackPick(area.id()) : undefined} keyed>
          {(pick) => <ProviderPickDialog pick={pick} />}
        </Show>
      </div>
    </ModpackAreaContext>
  );
}

/** Without pack.edit the draft is not readable: players only get the pack. */
function PlayerView() {
  const area = useModpackArea();
  return (
    <div data-vesta="modpack-scroll">
      <Show when={area.gates().download} fallback={<EmptyState variant="inline" icon="icons/content/modpack" title={t('server-pack.no-access')} />}>
        <GetModpack />
      </Show>
    </div>
  );
}

function EditorView() {
  const area = useModpackArea();
  // Same tabs keep the same array, so a reloaded workspace does not remount the open pane.
  const tabs = createMemo(() => modpackSubTabs(area.kind(), area.gates().edit), {
    name: 'modpack:tabs',
    equals: (a, b) => a.length === b.length && a.every((tab, index) => tab.id === b[index]!.id && tab.state === b[index]!.state),
  });
  const active = () => resolveSubTab(route().detail === 'pack' ? route().item : undefined, tabs());
  const count = (tab: ModpackSubTab) => {
    const manifest = area.workspace()?.draft.manifest;
    if (!manifest) return undefined;
    if (tab === 'content') return manifest.entries.length;
    if (tab === 'files') return (manifest.overrideFiles ?? []).filter((file) => !file.trashed && file.sha256 !== null).length;
    return undefined;
  };
  return (
    <Show when={area.workspace()} fallback={
      <div data-vesta="modpack-scroll">
        <ServerErrorNote error={area.error()} onRetry={() => void area.reload()} />
        <Show when={!area.error()}><EmptyState variant="inline" icon="icons/content/modpack" title={t('server-pack.loading')} /></Show>
      </div>
    }>
      <Show when={area.kind() !== 'none'} fallback={<div data-vesta="modpack-scroll"><FirstRun /></div>}>
        <ModpackHeader />
        <Tabs size="sm" value={active()} onChange={(tab) => area.open(tab as ModpackSubTab)} class="modpack-tabs">
          <TabList aria-label={t('server-pack.sections')}>
            <For each={tabs()}>
              {(tab) => (
                <Tab value={tab.id} icon={<Icon name={tab.icon} />} badge={
                  tab.state === 'locked' ? <Icon name="icons/security/lock" size={12} label={t('server-pack.customize-first')} />
                    : tab.state === 'read-only' ? <Badge size="sm" variant="soft">{t('server-pack.read-only')}</Badge>
                      : count(tab.id) !== undefined ? <span data-vesta="instance-tab-count">{formatNumber(count(tab.id)!)}</span> : undefined
                }>
                  {t(tab.label)}
                </Tab>
              )}
            </For>
          </TabList>
          <For each={tabs()}>
            {(tab) => (
              <Show when={active() === tab.id}>
                <TabPanel forceMount value={tab.id} class="modpack-pane">
                  <Show when={tab.state !== 'locked'} fallback={<CustomizeFirst />}>
                    <Dynamic component={views[tab.id]} />
                  </Show>
                </TabPanel>
              </Show>
            )}
          </For>
        </Tabs>
      </Show>
    </Show>
  );
}

function CustomizeFirst() {
  const area = useModpackArea();
  return (
    <div data-vesta="modpack-scroll">
      <EmptyState variant="inline" icon="icons/security/lock" title={t('server-pack.files-locked-title')} description={t('server-pack.files-locked-description')}>
        <Button size="sm" variant="outline" icon={<Icon name="icons/actions/edit" />} onClick={() => area.open('overview')}>{t('server-pack.customize')}</Button>
      </EmptyState>
    </div>
  );
}
