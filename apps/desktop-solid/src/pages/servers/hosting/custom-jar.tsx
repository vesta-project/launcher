import { Button, Dialog, Progress, toast } from '@vesta/ui';
import { For, Show, createEffect, createSignal, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { t } from '../../../localization';
import { customJarReview, isServerJarPath, jarPickerEntries, launchKind } from '../../../features/servers/content-model';
import { gameStopped } from '../../../features/servers/hosting-model';
import type { SoftwareJob, SoftwareState } from '../../../features/servers/hosting-native';
import { IntentMemo } from '../../../features/servers/model';
import type { CustomJarPlan } from '../../../features/servers/native-content';
import type { FileEntry, ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { ServerJavaInventory } from '../../../features/servers/native-java';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import { SettingsPanel } from '../settings-parts';
import { Hint, HostingError } from './parts';
import { sameReviewedPlan } from '../../../features/servers/review-plan';

/**
 * Owner-only: launch a JAR that is already in the server files, or return to the managed
 * software saved before. Both go plan → review what the agent reported → apply.
 */
export function CustomJarPanel(props: {
  snapshot: ServerSnapshot; state: SoftwareState; java: ServerJavaInventory | undefined; jobRunning: boolean;
  onAccepted: (job: SoftwareJob) => void;
}) {
  const now = useServersClock();
  const id = () => props.snapshot.connection.id;
  const [picking, setPicking] = createSignal(false, { name: 'server-custom-jar:picking' });
  const [plan, setPlan] = createSignal<CustomJarPlan | null>(null, { name: 'server-custom-jar:plan' });
  const [busy, setBusy] = createSignal(false, { name: 'server-custom-jar:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-custom-jar:error' });
  const intents = new IntentMemo();
  const launch = () => launchKind(props.state);
  const stopped = () => gameStopped(props.snapshot);
  const remaining = () => Math.max(0, Math.floor(((plan()?.expiresAtMs ?? 0) - now()) / 1000));
  const expired = () => !!plan() && remaining() === 0;
  const locked = () => busy() || props.jobRunning || !props.state.available || props.state.recoveryRequired;

  const prepare = async (path: string | null) => {
    setPicking(false); setBusy(true); setError(null);
    try { setPlan(await serverCommand((client) => client.customJarPlan(id(), path, props.state.revision))); }
    catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    let current = plan();
    if (!current || !stopped()) return;
    if (expired()) {
      const previous = current;
      setPlan(null);
      await prepare(previous.customJar?.path ?? null);
      current = plan();
      if (!current || !sameReviewedPlan(previous, current)) return;
    }
    const planId = current.planId;
    const intentId = intents.idFor({ planId: current.planId });
    setBusy(true); setError(null);
    try {
      const job = await serverCommand((client) => client.customJarApply(id(), planId, intentId));
      intents.settle();
      setPlan(null);
      toast.show({ title: t('server-hosting.switch-accepted'), tone: 'neutral' });
      props.onAccepted(job);
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      setError(failure);
      if (failure.code === 'confirmation_expired' || failure.code === 'stale_target') setPlan(null);
    } finally { setBusy(false); }
  };

  return (
    <SettingsPanel title={t('server-hosting.custom-jar-title')} name="custom-jar"
      description={(() => {
        const current = launch();
        return current.kind === 'custom' ? t('server-hosting.custom-jar-active', { path: current.path }) : t('server-hosting.custom-jar-description');
      })()}>
      <div data-vesta="server-software-flow" data-server-custom-jar={plan() ? 'review' : 'idle'}>
        <Show when={!plan()}>
          <div data-vesta="server-software-actions">
            <Show when={launch().kind === 'custom'} fallback={
              <Button variant="outline" icon={<Icon name="icons/content/folder" />} disabled={locked()} onClick={() => setPicking(true)}>
                {t('server-hosting.custom-jar-choose')}
              </Button>
            }>
              <Button variant="outline" icon={<Icon name="icons/content/history" />} disabled={locked()} onClick={() => void prepare(null)}>
                {t('server-hosting.custom-jar-restore')}
              </Button>
              <Button variant="ghost" disabled={locked()} onClick={() => setPicking(true)}>{t('server-hosting.custom-jar-choose-other')}</Button>
            </Show>
            <Show when={busy()}><Progress size="sm" label={t('server-hosting.preparing')} /></Show>
          </div>
          <Hint when={!stopped()}>{t('server-hosting.stop-first')}</Hint>
        </Show>

        <Show when={plan()}>
          {(current) => {
            const review = () => customJarReview(current());
            return (
              <section data-vesta="server-software-review" aria-label={t(review().path ? 'server-hosting.custom-jar-review-title' : 'server-hosting.custom-jar-restore-title')}>
                <h4>{t(review().path ? 'server-hosting.custom-jar-review-title' : 'server-hosting.custom-jar-restore-title')}</h4>
                <Show when={review().path} fallback={<p data-vesta="server-hosting-hint">{t('server-hosting.custom-jar-restore-description')}</p>}>
                  {(path) => (
                    <dl data-vesta="server-custom-jar-facts">
                      <dt>{t('server-hosting.custom-jar-path')}</dt><dd><code>{path()}</code></dd>
                      <dt>{t('server-hosting.custom-jar-main-class')}</dt>
                      <dd><Show when={review().mainClass} fallback={t('server-hosting.custom-jar-main-class-none')}>{(main) => <code>{main()}</code>}</Show></dd>
                      <dt>{t('server-hosting.custom-jar-java')}</dt>
                      <dd>
                        <Show when={props.java?.selected} fallback={t('server-hosting.custom-jar-java-unknown')}>
                          {(runtime) => t('server-hosting.custom-jar-java-current', { name: runtime().vendor, version: String(runtime().major) })}
                        </Show>
                      </dd>
                    </dl>
                  )}
                </Show>
                <p data-vesta="server-callout" data-tone="warning">{t('server-hosting.backup-first')}</p>
                <Show when={review().risks.length}>
                  <ul data-vesta="server-hosting-warnings"><For each={review().risks}>{(risk) => <li>{t(risk)}</li>}</For></ul>
                </Show>
                <Hint when={!stopped()}>{t('server-hosting.stop-first')}</Hint>
                <div data-vesta="server-software-actions">
                    <Button tone="accent" disabled={busy() || !stopped() || props.jobRunning} onClick={() => void apply()}>
                      {t(review().path ? 'server-hosting.custom-jar-apply' : 'server-hosting.custom-jar-restore')}
                    </Button>
                  <Button variant="ghost" disabled={busy()} onClick={() => { setPlan(null); setError(null); }}>{t('server-hosting.back')}</Button>
                </div>
              </section>
            );
          }}
        </Show>
        <HostingError error={error()} />
      </div>
      <Show when={picking()}>
        <JarPicker snapshot={props.snapshot} initial={launch().kind === 'custom' ? (launch() as { path: string }).path : null}
          onClose={() => setPicking(false)} onPick={(path) => void prepare(path)} />
      </Show>
    </SettingsPanel>
  );
}

const parent = (path: string) => path.split('/').slice(0, -1).join('/');
const MAX_PAGES = 5;

/** A folder browser over the server files that only lets a `.jar` inside the server root be chosen. */
function JarPicker(props: { snapshot: ServerSnapshot; initial: string | null; onClose: () => void; onPick: (path: string) => void }) {
  const id = () => props.snapshot.connection.id;
  const [folder, setFolder] = createSignal(untrack(() => (props.initial ? parent(props.initial) : '')), { name: 'server-jar-picker:folder' });
  const [entries, setEntries] = createSignal<FileEntry[] | undefined>(undefined, { name: 'server-jar-picker:entries' });
  const [selected, setSelected] = createSignal<string | null>(untrack(() => props.initial), { name: 'server-jar-picker:selected' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-jar-picker:error' });
  const join = (name: string) => (folder() ? `${folder()}/${name}` : name);

  createEffect(folder, (path) => {
    let cancelled = false;
    setEntries(undefined); setError(null);
    void (async () => {
      try {
        const items: FileEntry[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await serverCommand((client) => client.filesList(id(), path, cursor));
          items.push(...result.items);
          cursor = result.nextCursor;
          if (!cursor) break;
        }
        if (!cancelled) setEntries(jarPickerEntries(items));
      } catch (reason) { if (!cancelled) setError(reason as ServerCommandError); }
    })();
    return () => { cancelled = true; };
  }, { name: 'server-jar-picker:list' });

  const crumbs = () => (folder() ? folder().split('/') : []);
  const choice = () => { const path = selected(); return path && isServerJarPath(path) ? path : null; };
  return (
    <Dialog open size="md" closeLabel={t('nav.close')} onOpenChange={(open) => { if (!open) props.onClose(); }}
      title={t('server-hosting.custom-jar-picker-title')} description={t('server-hosting.custom-jar-picker-description')}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button tone="accent" disabled={!choice()} onClick={() => { const path = choice(); if (path) props.onPick(path); }}>{t('server-hosting.review')}</Button>
        </>
      }>
      <div data-vesta="server-jar-picker">
        <nav data-vesta="server-jar-picker-path" aria-label={t('server-hosting.custom-jar-picker-root')}>
          <button type="button" onClick={() => setFolder('')}>{t('server-hosting.custom-jar-picker-root')}</button>
          <For each={crumbs()}>
            {(segment, index) => (
              <>
                <Icon name="icons/controls/chevron-right" size={11} />
                <button type="button" onClick={() => setFolder(crumbs().slice(0, index() + 1).join('/'))}>{segment}</button>
              </>
            )}
          </For>
        </nav>
        <HostingError error={error()} />
        <ul data-vesta="server-jar-picker-list" role="listbox" aria-label={t('server-hosting.custom-jar-picker-title')}>
          <Show when={folder()}>
            <li>
              <button type="button" data-vesta="server-jar-picker-row" onClick={() => setFolder(parent(folder()))}>
                <Icon name="icons/navigation/arrow-up" size={14} /><span>{t('server-hosting.custom-jar-picker-up')}</span>
              </button>
            </li>
          </Show>
          <For each={entries() ?? []} keyed={(entry) => entry.name}>
            {(entry) => {
              const path = () => join(entry().name);
              return (
                <li>
                  <button type="button" data-vesta="server-jar-picker-row" role="option"
                    aria-selected={entry().kind === 'file' && selected() === path() ? 'true' : 'false'}
                    onClick={() => (entry().kind === 'directory' ? setFolder(path()) : setSelected(path()))}
                    onDblClick={() => { if (entry().kind === 'file' && isServerJarPath(path())) props.onPick(path()); }}>
                    <Icon name={entry().kind === 'directory' ? 'icons/content/folder' : 'icons/content/file'} size={14} />
                    <span>{entry().name}</span>
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
        <Show when={entries() && !entries()!.length}><p data-vesta="server-hosting-hint">{t('server-hosting.custom-jar-picker-empty')}</p></Show>
        <Show when={!entries() && !error()}><Progress size="sm" label={t('server-hosting.custom-jar-picker-loading')} /></Show>
      </div>
    </Dialog>
  );
}
