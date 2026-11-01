import { serverCommand } from '../../../features/servers/store';
import type { PackWorkspace } from '../../../features/servers/native-pack';
import { isContentEntry } from '../../../features/servers/content-kind';
import { Badge, Button, Progress, Tab, TabList, TabPanel, Tabs } from '@vesta/ui';
import { For, Show, createMemo, createSignal, createEffect, onCleanup, type Component } from 'solid-js';
import { Dynamic } from '@solidjs/web';
import { route } from '../../../app/router';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import {
  installDecision, clientSubTabs, modpackSection, resolveSubTab, type ModpackSection, type ModpackSubTab,
} from '../../../features/servers/modpack-area-model';
import { modpackPick } from '../../../features/servers/modpack-handoff';
import type { ServerSnapshot } from '../../../features/servers/native';
import { formatNumber, t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import { ModpackAreaContext, createModpackArea, useModpackArea } from './area';
import { ClientModePanel } from './client-mode';
import { ModpackContent } from './content';
import { ModpackFiles } from './files';
import { FirstRun } from './first-run';
import { PlayOnServerCard, offersClientPack } from './get-modpack';
import { ModpackDraftStatus } from './header';
import { InstallOnServerDialog } from './install-on-server';
import { ModpackOverview } from './overview';
import { ProviderPickDialog } from './provider-pick';
import { ServerModpack } from './server-modpack';
import { ModpackVersions } from './versions';
import './modpack.css';

const views: Record<ModpackSubTab, Component> = {
  overview: ModpackOverview,
  content: ModpackContent,
  files: ModpackFiles,
  versions: ModpackVersions,
};

/**
 * Server → Modpack: two independent, optional parts, each its own sidebar entry. **Server
 * modpack** is the server installation's own link (like an instance linked to a modpack).
 * **Client pack** is what players get: nothing, the server's modpack, or a custom pack laid out
 * like an instance (header, then Overview, Content, Files and Versions).
 */
export function ModpackTab(props: { snapshot: ServerSnapshot }) {
  const area = createModpackArea(() => props.snapshot);
  return (
    <ModpackAreaContext value={area}>
      <div data-vesta="modpack">
        <Show when={area.gates().edit}><InstallJobStatus /></Show>
        <Show when={area.gates().edit} fallback={<PlayerView />}>
          <Show when={area.install()} keyed fallback={<EditorView />}>{request => <InstallOnServerDialog request={request} />}</Show>
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

/** Server modpack and Client pack are sidebar entries; the URL says which one this pane shows. */
function EditorView() {
  const area = useModpackArea();
  const section = (): ModpackSection => modpackSection(route().detail === 'pack' ? route().item : undefined);
  return (
    <Show when={area.workspace()} fallback={
      <div data-vesta="modpack-scroll">
        <ServerErrorNote error={area.error()} onRetry={() => void area.reload()} />
        <Show when={!area.error()}><EmptyState variant="inline" icon="icons/content/modpack" title={t('server-pack.loading')} /></Show>
      </div>
    }>
      <div data-vesta="modpack-section" data-section={section()}>
        <Show when={section() === 'client'} fallback={<ServerModpack />}>
          <ClientPack />
        </Show>
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

/** Agent-owned job status is read afresh when the launcher reconnects. */
function InstallJobStatus() {
  const area = useModpackArea();
  const [value, setValue] = createSignal<PackWorkspace | null>(null);
  createEffect(() => area.id(), id => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await serverCommand(api => api.packDraft(id)); if (!disposed) setValue(next); } catch { /* Reconnect polling retries without changing the job. */ }
      if (!disposed) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    onCleanup(() => { disposed = true; clearTimeout(timer); });
  });
  const job = () => value()?.installJob;
  const progress = () => value()?.installProgress;
  const stage = () => {
    switch (progress()?.stage) {
      case 'writing': return t('server-pack.install-writing');
      case 'metadata': return t('server-pack.install-metadata');
      case 'review': return t('server-pack.review-stage-review');
      case 'extract_hash': return t('server-pack.install-extracting');
      case 'archive': return t('server-pack.install-archive');
      default: return t('server-pack.install-planning');
    }
  };
  const active = () => ['queued','staging','activating'].includes(job()?.state ?? '');
  return <Show when={job()}><div data-vesta="pack-install-job" role="status">
    <Show when={active()} fallback={<span>{job()?.state === 'succeeded' ? t('server-pack.done') : t('server-pack.download-failed')}</span>}>
      <Progress value={progress()?.total ? progress()!.completed / progress()!.total * 100 : undefined}
        label={`${stage()}${progress()?.total ? ` ${progress()!.completed}/${progress()!.total}` : ''}${progress()?.bytesCompleted ? ` · ${(progress()!.bytesCompleted! / 1048576).toFixed(1)} MB` : ''}`} />
    </Show>
    <Show when={!active() && job()?.decisions?.length}><details><summary>{t('server-pack.show-changes')}</summary><ul><For each={job()?.decisions}>{decision => <li>{installDecision(decision, t)}</li>}</For></ul></details></Show>
  </div></Show>;
}
