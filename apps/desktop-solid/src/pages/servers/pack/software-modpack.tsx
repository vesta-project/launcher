import { Show } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { modpackPick } from '../../../features/servers/modpack-handoff';
import type { ServerSnapshot } from '../../../features/servers/native';
import { packJobPhase } from '../../../features/servers/pack-install-store';
import { ModpackAreaContext, createModpackArea, useModpackArea } from './area';
import { FirstRun } from './first-run';
import { InstallJobPanel, showsJobPanel } from './install-job';
import { InstallOnServerDialog } from './install-on-server';
import { ProviderPickDialog } from './provider-pick';
import { ServerModpack } from './server-modpack';
import './modpack.css';

/**
 * Settings → Software, modpack-aware. Like an instance linked to a modpack, a linked server shows
 * its modpack (identity, version, updates, owned content) in place of the version pickers: the
 * pack decides the software. An install or review in progress shows here too, so reopening the
 * section after leaving finds the same live job. Unlinked, the pickers stay and a "Use a
 * modpack" entry sits under them.
 */
export function SoftwareModpack(props: { snapshot: ServerSnapshot; children: JSX.Element }) {
  const area = createModpackArea(() => props.snapshot);
  return (
    <ModpackAreaContext value={area}>
      <Show when={area.gates().edit} fallback={props.children}>
        <SoftwareModpackBody>{props.children}</SoftwareModpackBody>
        <Show when={area.workspace() ? modpackPick(area.id()) : undefined} keyed>
          {(pick) => <ProviderPickDialog pick={pick} />}
        </Show>
      </Show>
    </ModpackAreaContext>
  );
}

function SoftwareModpackBody(props: { children: JSX.Element }) {
  const area = useModpackArea();
  const phase = () => packJobPhase(area.id());
  const linked = () => area.link().phase !== 'unlinked';
  return (
    <div data-vesta="software-modpack" data-linked={linked() ? '' : undefined}>
      <Show when={showsJobPanel(phase())} fallback={
        <Show when={area.install()} keyed fallback={
          <Show when={area.workspace() && linked()} fallback={
            <>
              {props.children}
              <Show when={area.workspace()}><FirstRun section="server" /></Show>
            </>
          }>
            <ServerModpack />
          </Show>
        }>
          {(request) => <InstallOnServerDialog request={request} />}
        </Show>
      }>
        <InstallJobPanel />
      </Show>
    </div>
  );
}
