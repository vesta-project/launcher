import { Show } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { modpackPick } from '../../../features/servers/modpack-handoff';
import type { ServerSnapshot } from '../../../features/servers/native';
import { packJobPhase } from '../../../features/servers/pack-install-store';
import { SettingsColumns } from '../settings-parts';
import { ModpackAreaContext, createModpackArea, useModpackArea } from './area';
import { FirstRun } from './first-run';
import { InstallJobPanel, showsJobPanel } from './install-job';
import { InstallOnServerDialog } from './install-on-server';
import { ProviderPickDialog } from './provider-pick';
import { ServerModpack } from './server-modpack';
import './modpack.css';

/**
 * Settings → Software, modpack-aware, laid out in two columns. Like an instance linked to a
 * modpack, a linked server shows its modpack (identity, version, updates, owned content) in
 * place of the version pickers: the pack decides the software. An install or review in progress
 * shows here too, so reopening the section after leaving finds the same live job. Unlinked, a
 * compact Modpack card sits above the pickers.
 *
 * `aside` (Java) is always beside the main column; `unlinkedAside` (custom JAR) only while no
 * modpack decides the software.
 */
export function SoftwareModpack(props: { snapshot: ServerSnapshot; aside: JSX.Element; unlinkedAside: JSX.Element; children: JSX.Element }) {
  const area = createModpackArea(() => props.snapshot);
  return (
    <ModpackAreaContext value={area}>
      <Show when={area.gates().edit} fallback={<SettingsColumns aside={<>{props.aside}{props.unlinkedAside}</>}>{props.children}</SettingsColumns>}>
        <SoftwareModpackBody aside={props.aside} unlinkedAside={props.unlinkedAside}>{props.children}</SoftwareModpackBody>
        <Show when={area.workspace() ? modpackPick(area.id()) : undefined} keyed>
          {(pick) => <ProviderPickDialog pick={pick} />}
        </Show>
      </Show>
    </ModpackAreaContext>
  );
}

function SoftwareModpackBody(props: { aside: JSX.Element; unlinkedAside: JSX.Element; children: JSX.Element }) {
  const area = useModpackArea();
  const phase = () => packJobPhase(area.id());
  const linked = () => area.link().phase !== 'unlinked';
  const view = () => showsJobPanel(phase()) ? 'job' : area.install() ? 'review' : area.workspace() && linked() ? 'linked' : 'unlinked';
  return (
    <Show when={view() === 'unlinked'} fallback={
      <SettingsColumns aside={props.aside}>
        <div data-vesta="software-modpack" data-linked={linked() ? '' : undefined}>
          <Show when={view() === 'job'} fallback={
            <Show when={area.install()} keyed fallback={<ServerModpack />}>
              {(request) => <InstallOnServerDialog request={request} />}
            </Show>
          }>
            <InstallJobPanel />
          </Show>
        </div>
      </SettingsColumns>
    }>
      <SettingsColumns aside={<>{props.aside}{props.unlinkedAside}</>}>
        <Show when={area.workspace()}><FirstRun section="server" /></Show>
        {props.children}
      </SettingsColumns>
    </Show>
  );
}
