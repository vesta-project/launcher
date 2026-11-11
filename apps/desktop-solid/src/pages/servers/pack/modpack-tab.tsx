import { isContentEntry } from '../../../features/servers/content-kind';
import { Badge, Button, Tab, TabList, TabPanel, Tabs } from '@vesta/ui';
import { For, Show, createMemo, type Component } from 'solid-js';
import { Dynamic } from '@solidjs/web';
import { route } from '../../../app/router';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import {
  clientSubTabs, resolveSubTab, type ModpackSubTab,
} from '../../../features/servers/modpack-area-model';
import { modpackPick } from '../../../features/servers/modpack-handoff';
import type { ServerSnapshot } from '../../../features/servers/native';
import { formatNumber, t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import { ModpackAreaContext, createModpackArea, useModpackArea } from './area';
import { ClientLinkButton } from './client-link';
import { ClientModePanel } from './client-mode';
import { ModpackContent } from './content';
import { ModpackFiles } from './files';
import { FirstRun } from './first-run';
import { PlayOnServerCard, offersClientPack } from './get-modpack';
import { ModpackDraftStatus } from './header';
import { InstallJobBanner } from './install-job';
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
 * Server → Modpack: what players get. Nothing, the server's own modpack, or a custom pack laid
 * out like an instance (header, then Overview, Content, Files and Versions). The server's own
 * modpack link lives in Settings → Software (see SoftwareModpack), like an instance's linked pack
 * replaces its Versions page.
 */
export function ModpackTab(props: { snapshot: ServerSnapshot }) {
  const area = createModpackArea(() => props.snapshot);
  return (
    <ModpackAreaContext value={area}>
      <div data-vesta="modpack">
        <Show when={area.gates().edit} fallback={<PlayerView />}>
          {/* A server modpack install keeps running elsewhere; say so and link to it. */}
          <InstallJobBanner />
          <EditorView />
        </Show>

        <Show when={area.gates().edit && area.workspace() ? modpackPick(area.id()) : undefined} keyed>
          {(pick) => <ProviderPickDialog pick={pick} />}
        </Show>
      </div>
    </ModpackAreaContext>
  );
}

/** Without pack.edit the workspace is not readable: players only get the pack. */
function PlayerView() {
  const area = useModpackArea();
  return (
    <div data-vesta="modpack-scroll">
      <Show when={area.gates().download} fallback={<EmptyState variant="inline" icon="icons/content/modpack" title={t('server-pack.no-access')} />}>
        <Show when={offersClientPack(area.snapshot())} fallback={<EmptyState variant="inline" icon="icons/content/modpack" title={t('server-pack.play-none')} />}>
          <PlayOnServerCard snapshot={area.snapshot()} />
        </Show>
      </Show>
    </div>
  );
}

/** The client pack editor once the workspace is read. */
function EditorView() {
  const area = useModpackArea();
  return (
    <Show when={area.workspace()} fallback={
      <div data-vesta="modpack-scroll">
        <ServerErrorNote error={area.error()} onRetry={() => void area.reload()} />
        <Show when={!area.error()}><EmptyState variant="inline" icon="icons/content/modpack" title={t('server-pack.loading')} /></Show>
      </div>
    }>
      <div data-vesta="modpack-section" data-section="client">
        <ClientPack />
      </div>
    </Show>
  );
}

/**
 * What players get. Only Custom has a workspace: one row of sections (the server header is the
 * page header; the pack's identity lives in its Overview). Other modes are one panel.
 */
function ClientPack() {
  const area = useModpackArea();
  // Same tabs keep the same array, so a reloaded workspace does not remount the open pane.
  const tabs = createMemo(() => clientSubTabs(area.clientMode(), area.kind(), area.gates().edit), {
    name: 'modpack:client-tabs',
    equals: (a, b) => a.length === b.length && a.every((tab, index) => tab.id === b[index]!.id && tab.state === b[index]!.state),
  });
  const active = () => resolveSubTab(route().detail === 'pack' ? route().item : undefined, tabs());
  const count = (tab: ModpackSubTab) => {
    const manifest = area.workspace()?.draft.manifest;
    if (!manifest) return undefined;
    if (tab === 'content') return manifest.entries.filter(isContentEntry).length;
    if (tab === 'files') return (manifest.overrideFiles ?? []).filter((file) => !file.trashed && file.sha256 !== null).length;
    return undefined;
  };
  return (
    <Show when={tabs().length} fallback={<div data-vesta="modpack-scroll"><div data-vesta="modpack-client"><ClientModePanel /></div></div>}>
      <Show when={area.kind() !== 'none'} fallback={
        <div data-vesta="modpack-scroll"><div data-vesta="modpack-client"><ClientModePanel /><FirstRun section="client" /></div></div>
      }>
        <Tabs size="sm" value={active()} onChange={(tab) => area.open(tab as ModpackSubTab)} class="modpack-tabs">
          <div data-vesta="modpack-tabbar">
            <TabList aria-label={t('server-pack.client-sections')}>
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
            <ModpackDraftStatus />
            <ClientLinkButton />
          </div>
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
