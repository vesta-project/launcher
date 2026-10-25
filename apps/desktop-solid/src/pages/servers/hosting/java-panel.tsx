import { Badge, Button, IconButton, Menu, MenuItem, Progress, Skeleton, TextField, toast } from '@vesta/ui';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { IconTile } from '../../../components/icon-tile';
import { t } from '../../../localization';
import { gameStopped, jobActive } from '../../../features/servers/hosting-model';
import type { SoftwareJob } from '../../../features/servers/hosting-native';
import { IntentMemo } from '../../../features/servers/model';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { ServerJavaInventory } from '../../../features/servers/native-java';
import {
  customPathProblem, downloadOffers, javaGroups, javaGroupStatus, javaJobMessage, javaRejection, javaSourceMessage, type JavaRow,
} from '../../../features/servers/server-java-model';
import { serverCommand } from '../../../features/servers/store';
import { copyText, SettingsPanel } from '../settings-parts';
import { HostingError } from './parts';
import './java-panel.css';

/** Starts a Java selection or managed download and hands the accepted job to the page to follow. */
export function useJavaActions(snapshot: () => ServerSnapshot, onAccepted: (job: SoftwareJob) => void) {
  const [busy, setBusy] = createSignal<string | null>(null, { name: 'server-java:busy' });
  const intents = new IntentMemo();
  const run = async (key: string, payload: unknown, call: (intentId: string) => Promise<SoftwareJob>) => {
    setBusy(key);
    const intentId = intents.idFor(payload);
    try {
      const job = await call(intentId);
      intents.settle();
      onAccepted(job);
      return true;
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      toast.show({ title: t(javaRejection(failure.code, failure.reason)), tone: 'danger' });
      return false;
    } finally { setBusy(null); }
  };
  const id = () => snapshot().connection.id;
  return {
    busy,
    select: (runtimeId: string) => run(`select:${runtimeId}`, { select: runtimeId }, (intentId) => serverCommand((client) => client.javaSelect(id(), runtimeId, null, intentId))),
    custom: (path: string) => run('custom', { custom: path }, (intentId) => serverCommand((client) => client.javaSelect(id(), null, path, intentId))),
    download: (major: number) => run(`download:${major}`, { download: major }, (intentId) => serverCommand((client) => client.javaDownload(id(), major, intentId))),
  };
}

export type JavaActions = ReturnType<typeof useJavaActions>;

/**
 * Settings → Software → Java: like the launcher's Java page, one card per major version with
 * the runtimes found on the server computer, the one this server uses, managed downloads and
 * an allowlisted custom path.
 */
export function JavaPanel(props: {
  snapshot: ServerSnapshot;
  inventory: ServerJavaInventory | undefined;
  error: ServerCommandError | null | undefined;
  loading: boolean;
  requiredMajor: number | null;
  minecraft: string | null;
  job: SoftwareJob | undefined;
  jobRunning: boolean;
  actions: JavaActions;
  onRefresh: () => void;
}) {
  const stopped = () => gameStopped(props.snapshot);
  const groups = createMemo(() => (props.inventory ? javaGroups(props.inventory, props.requiredMajor) : []), { name: 'server-java:groups' });
  const offers = createMemo(() => (props.inventory ? downloadOffers(props.inventory, props.requiredMajor).filter((major) => !groups().some((group) => group.missing && group.major === major)) : []), { name: 'server-java:offers' });
  const locked = () => props.jobRunning || !!props.actions.busy();

  return (
    <SettingsPanel title={t('server-java.title')} description={t('server-java.help')} name="java"
      action={<IconButton size="sm" variant="ghost" label={t('server-java.rescan')} icon={<Icon name="icons/actions/refresh" />} disabled={props.loading} onClick={() => props.onRefresh()} />}>
      <div data-vesta="server-java">
        <HostingError error={props.error} onRetry={props.onRefresh} />
        <Show when={props.job}>
          {(job) => (
            <Show when={jobActive(job())} fallback={
              <p data-vesta="server-callout" data-tone={job().state === 'succeeded' ? 'success' : 'danger'}>{t(javaJobMessage(job()))}</p>
            }>
              <Progress size="sm" label={t(javaJobMessage(job()))} />
            </Show>
          )}
        </Show>
        <Show when={!stopped() && props.inventory}><p data-vesta="server-hosting-hint">{t('server-java.stop-to-change')}</p></Show>
        <Show when={props.inventory} fallback={<Show when={!props.error}><Skeleton height={120} radius={12} /></Show>}>
          <For each={groups()} keyed={(group) => group.major}>
            {(group) => (
              <section data-vesta="server-java-group" data-in-use={group().inUse ? '' : undefined} aria-label={t('server-hosting.java-version', { version: String(group().major) })}>
                <header>
                  <IconTile hook="server-java-mark" tone={group().inUse ? 'accent' : 'neutral'}>{group().major}</IconTile>
                  <div>
                    <h4>
                      {t('server-hosting.java-version', { version: String(group().major) })}
                      <Show when={group().required}><Badge size="sm" variant="soft" tone={group().inUse ? 'success' : 'warning'}>{t('server-java.required')}</Badge></Show>
                    </h4>
                    <p>{group().required && props.minecraft ? t('server-java.needed-by', { version: props.minecraft }) : t(javaGroupStatus(group()))}</p>
                  </div>
                </header>
                <ul>
                  <Show when={group().missing}>
                    <li>
                      <span data-vesta="server-java-radio" aria-hidden="true" />
                      <div>
                        <span><Badge size="sm" tone="accent">{t('server-java.source-managed')}</Badge></span>
                        <code>{t('server-java.not-installed')}</code>
                      </div>
                      <Button size="sm" tone="accent" icon={<Icon name="icons/actions/download" />} disabled={locked()}
                        onClick={() => void props.actions.download(group().major)}>
                        {props.actions.busy() === `download:${group().major}` ? t('server-java.starting') : t('server-java.download', { version: String(group().major) })}
                      </Button>
                    </li>
                  </Show>
                  <For each={group().rows} keyed={(row) => row.runtime.id}>
                    {(row) => <RuntimeRow row={row()} stopped={stopped()} locked={locked()} actions={props.actions} />}
                  </For>
                </ul>
              </section>
            )}
          </For>
          <footer data-vesta="server-java-more">
            <Show when={offers().length}>
              <div data-vesta="server-java-offers">
                <span>{t('server-java.get-managed')}</span>
                <For each={offers()}>
                  {(major) => (
                    <Button size="sm" variant="outline" icon={<Icon name="icons/actions/download" />} disabled={locked()} onClick={() => void props.actions.download(major)}>
                      {t('server-hosting.java-version', { version: String(major) })}
                    </Button>
                  )}
                </For>
              </div>
            </Show>
            <CustomPath allowed={!!props.inventory?.customPathsAllowed} disabled={locked() || !stopped()} actions={props.actions} />
          </footer>
        </Show>
      </div>
    </SettingsPanel>
  );
}

function RuntimeRow(props: { row: JavaRow; stopped: boolean; locked: boolean; actions: JavaActions }) {
  const runtime = () => props.row.runtime;
  return (
    <li data-active={props.row.selected ? '' : undefined}>
      <span data-vesta="server-java-radio" aria-hidden="true" />
      <div>
        <span>
          <Badge size="sm" tone={props.row.source === 'managed' ? 'accent' : undefined}>{t(javaSourceMessage[props.row.source])}</Badge>
          <Show when={props.row.selected}><Badge size="sm" tone="success">{t('server-java.in-use')}</Badge></Show>
          <small>{[runtime().vendor, runtime().version, runtime().arch].filter(Boolean).join(' · ')}</small>
        </span>
        <code title={runtime().path}>{runtime().path}</code>
      </div>
      <Show when={!props.row.selected}>
        <Button size="sm" variant="outline" disabled={props.locked || !props.stopped} data-tip={!props.stopped ? t('server-java.stop-first') : undefined}
          onClick={() => void props.actions.select(runtime().id)}>
          {props.actions.busy() === `select:${runtime().id}` ? t('server-java.starting') : t('server-java.use')}
        </Button>
      </Show>
      <Menu placement="bottom-end" trigger={(menuProps) => (
        <IconButton {...menuProps} size="sm" variant="ghost" tooltip={false} label={t('server-java.actions')} icon={<Icon name="icons/content/ellipsis-v" />} />
      )}>
        <MenuItem icon={<Icon name="icons/actions/copy" />} onSelect={() => copyText(runtime().path)}>{t('server-java.copy-path')}</MenuItem>
      </Menu>
    </li>
  );
}

/** A custom path is an arbitrary program, so the host must allowlist its folder first. */
function CustomPath(props: { allowed: boolean; disabled: boolean; actions: JavaActions }) {
  const [open, setOpen] = createSignal(false, { name: 'server-java:custom-open' });
  const [path, setPath] = createSignal('', { name: 'server-java:custom-path' });
  const problem = () => (path().trim() ? customPathProblem(path()) : null);
  const submit = async () => {
    if (customPathProblem(path())) return;
    if (await props.actions.custom(path().trim())) { setOpen(false); setPath(''); }
  };
  return (
    <Show when={props.allowed} fallback={<p data-vesta="server-hosting-hint" data-server-java-custom-off><Icon name="icons/security/lock" size={12} /> {t('server-java.custom-off')}</p>}>
      <Show when={open()} fallback={
        <Button size="sm" variant="ghost" icon={<Icon name="icons/content/folder" />} disabled={props.disabled} onClick={() => setOpen(true)}>{t('server-java.custom')}</Button>
      }>
        <div data-vesta="server-java-custom">
          <TextField size="sm" label={t('server-java.custom-label')} placeholder={t('server-java.custom-placeholder')} value={path()} onChange={setPath}
            description={t('server-java.custom-help')} error={problem() ? t(problem()!) : undefined} spellcheck={false} />
          <div data-vesta="server-hosting-actions">
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setPath(''); }}>{t('common.cancel')}</Button>
            <Button size="sm" tone="accent" disabled={props.disabled || !!customPathProblem(path())} onClick={() => void submit()}>{t('server-java.use')}</Button>
          </div>
        </div>
      </Show>
    </Show>
  );
}
