// First server wizard on a Vesta Server: pick a folder on that machine, let it check the
// folder, review, copy (the original stays untouched), then start. The job itself lives in
// hosts-store, so closing this page never stops a copy.
import { Badge, Button, Checkbox, NumberField, Progress, TextField } from '@vesta/ui';
import { For, Match, Show, Switch, createMemo, createSignal, onSettled, untrack } from 'solid-js';
import { Board } from '../../components/board';
import { EmptyState } from '../../components/empty-state';
import { Icon } from '../../components/icon';
import { OptionCards } from '../../components/option-cards';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { openExternal } from '../../features/links/external-links';
import { formatBytes } from '../../features/settings/storage-model';
import { toServerError } from '../../features/servers/errors';
import {
  blockerFix, importBusy, importPercent, importProblem, importRootCommand, lastSegment, readCandidates, reviewSummary, warningMessage,
  type CandidateWarning, type ImportCandidate,
} from '../../features/servers/host-model';
import {
  applyImport, cancelImport, clearImport, hostCommand, importTask, loadHostServers, planImport, recheckImport, resumeImport, startImport,
  vestaHost, type ImportTask,
} from '../../features/servers/hosts-store';
import { hostConnectionId, type Folder, type ImportReview } from '../../features/servers/native-hosts';
import type { ServerCommandError } from '../../features/servers/native';
import { CommandLine, Steps, Working } from './vesta-parts';
import './vesta-server.css';

type Kind = 'import' | 'new' | 'modpack' | 'restore';
type Picked = ImportTask['folder'] & { name: string };
type WizardStep = 'kind' | 'folder' | 'review' | 'copy';

const steps = [
  { id: 'kind', label: 'vesta-server.import.step-kind' },
  { id: 'folder', label: 'vesta-server.import.step-folder' },
  { id: 'review', label: 'vesta-server.import.step-review' },
  { id: 'copy', label: 'vesta-server.import.step-copy' },
] as const satisfies readonly { id: WizardStep; label: MessageId }[];

export function HostImport(props: { hostId: string }) {
  const host = () => vestaHost(props.hostId);
  return (
    <Show when={host()} fallback={
      <Board>
        <EmptyState icon="icons/rail/servers" title={t('vesta-server.missing')}>
          <Button onClick={() => transitionTo('/servers')}>{t('servers.done.all-servers')}</Button>
        </EmptyState>
      </Board>
    }>
      {(found) => <ImportFlow hostId={props.hostId} machine={found().name} />}
    </Show>
  );
}

function ImportFlow(props: { hostId: string; machine: string }) {
  const [kind, setKind] = createSignal<Kind>('import', { name: 'host-import:kind' });
  const [choosing, setChoosing] = createSignal<'kind' | 'folder'>('kind', { name: 'host-import:choosing' });
  const task = () => importTask(props.hostId);
  const state = () => task()?.job?.state;

  // Reopened with a job in progress (or after a restart): read it once now.
  onSettled(() => { if (untrack(task)?.jobId) recheckImport(props.hostId); });

  const current = (): WizardStep | 'done' => {
    const job = task();
    if (!job) return choosing();
    switch (job.job?.state) {
      case undefined: case 'planning': case 'review': case 'blocked': return 'review';
      case 'online': return 'done';
      default: return 'copy';
    }
  };

  const pick = (folder: Picked) => void planImport(props.hostId, { folder: { token: folder.token, displayPath: folder.displayPath }, name: folder.name, gamePort: null, memoryMiB: null });
  const startOver = () => { clearImport(props.hostId); setChoosing('folder'); };

  return (
    <Board class="servers-board">
      <div data-vesta="server-add" data-wide>
        <Steps steps={steps} current={current()} />
        <Switch>
          <Match when={!task() && choosing() === 'kind'}>
            <div data-vesta="server-add-panel">
              <h1>{t('vesta-server.import.kind-title', { name: props.machine })}</h1>
              <OptionCards<Kind>
                aria-label={t('vesta-server.import.kind-title', { name: props.machine })}
                value={kind()}
                onChange={setKind}
                options={[
                  { value: 'import', label: t('vesta-server.import.kind-import'), icon: <Icon name="icons/content/folder" size={20} /> },
                  { value: 'new', label: t('vesta-server.import.kind-new'), hint: t('vesta-server.import.soon'), icon: <Icon name="icons/actions/add" size={20} />, disabled: true },
                  { value: 'modpack', label: t('vesta-server.import.kind-modpack'), hint: t('vesta-server.import.soon'), icon: <Icon name="icons/content/modpack" size={20} />, disabled: true },
                  { value: 'restore', label: t('vesta-server.import.kind-restore'), hint: t('vesta-server.import.soon'), icon: <Icon name="icons/content/history" size={20} />, disabled: true },
                ]}
              />
              <p>{t('vesta-server.import.kind-import-help')}</p>
              <footer>
                <Button variant="ghost" onClick={() => transitionTo('/servers')}>{t('common.cancel')}</Button>
                <Button tone="accent" onClick={() => setChoosing('folder')}>{t('servers.continue')}</Button>
              </footer>
            </div>
          </Match>

          <Match when={!task() && choosing() === 'folder'}>
            <FolderPicker hostId={props.hostId} machine={props.machine} onPick={pick} onBack={() => setChoosing('kind')} />
          </Match>

          <Match when={task() && !task()!.jobId && task()!.error}>
            {/* The check could not even begin. */}
            <div data-vesta="server-add-panel">
              <h1>{t('vesta-server.import.check-failed')}</h1>
              <p data-vesta="server-callout" data-tone="danger" role="alert">{t(importProblem(task()!.error))}</p>
              <footer>
                <Button variant="ghost" onClick={startOver}>{t('common.back')}</Button>
                <Button tone="accent" onClick={() => void planImport(props.hostId, { folder: task()!.folder, name: task()!.name, gamePort: null, memoryMiB: null })}>{t('vesta-server.import.check-again')}</Button>
              </footer>
            </div>
          </Match>

          <Match when={task() && (!task()!.job || state() === 'planning')}>
            <div data-vesta="server-add-panel">
              <h1>{t('vesta-server.import.checking-title', { name: task()!.name || props.machine })}</h1>
              <Working label={t('vesta-server.import.checking')} />
              <Show when={task()!.error}>{(error) => <p data-vesta="server-callout" data-tone="warning">{t(importProblem(error()))}</p>}</Show>
            </div>
          </Match>

          <Match when={(state() === 'review' || state() === 'blocked') && task()!.job!.review}>
            {(review) => <Review hostId={props.hostId} machine={props.machine} task={task()!} review={review()} onBack={startOver} />}
          </Match>

          <Match when={(state() === 'review' || state() === 'blocked') && !task()!.job!.review}>
            <div data-vesta="server-add-panel">
              <h1>{t('vesta-server.import.check-failed')}</h1>
              <footer><Button tone="accent" onClick={startOver}>{t('vesta-server.import.start-over')}</Button></footer>
            </div>
          </Match>

          <Match when={task()}>
            {(current) => <Progressing hostId={props.hostId} machine={props.machine} task={current()} onStartOver={startOver} />}
          </Match>
        </Switch>
      </div>
    </Board>
  );
}

// ------------------------------------------------------------------ folder picker

interface Browsing { rootId: string; label: string; path: string[]; token: string; displayPath: string; entries: Folder[]; cursor: string | null }

function FolderPicker(props: { hostId: string; machine: string; onPick: (folder: Picked) => void; onBack: () => void }) {
  const [candidates, setCandidates] = createSignal<ImportCandidate[] | null>(null, { name: 'host-import:candidates' });
  const [warnings, setWarnings] = createSignal<CandidateWarning[]>([], { name: 'host-import:warnings' });
  const [roots, setRoots] = createSignal<{ rootId: string; label: string; displayPath: string; readable: boolean }[] | null>(null, { name: 'host-import:roots' });
  const [browsing, setBrowsing] = createSignal<Browsing | null>(null, { name: 'host-import:browsing' });
  const [loading, setLoading] = createSignal(false, { name: 'host-import:loading' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'host-import:error' });

  const load = async () => {
    setError(null);
    const [found, shared] = await Promise.allSettled([
      hostCommand((client) => client.importCandidates(props.hostId)),
      hostCommand((client) => client.folderRoots(props.hostId)),
    ]);
    if (found.status === 'fulfilled') {
      const read = readCandidates(found.value);
      setCandidates(read.candidates);
      setWarnings(read.warnings);
    } else { setCandidates([]); setError(toServerError(found.reason)); }
    if (shared.status === 'fulfilled') setRoots(shared.value.roots);
    else { setRoots([]); if (found.status === 'fulfilled') setError(toServerError(shared.reason)); }
  };
  onSettled(() => void load());

  const list = async (next: Omit<Browsing, 'entries' | 'cursor'>, cursor: string | null = null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await hostCommand((client) => client.folderList(props.hostId, next.token, cursor));
      setBrowsing((current) => ({ ...next, displayPath: page.displayPath, entries: cursor && current ? [...current.entries, ...page.entries] : page.entries, cursor: page.nextCursor }));
    } catch (reason) { setError(toServerError(reason)); }
    finally { setLoading(false); }
  };

  const open = async (rootId: string, label: string, path: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const resolved = await hostCommand((client) => client.folderResolve(props.hostId, rootId, path.join('/')));
      await list({ rootId, label, path, token: resolved.folderToken, displayPath: resolved.displayPath });
    } catch (reason) { setError(toServerError(reason)); }
    finally { setLoading(false); }
  };

  const enter = (folder: Folder) => {
    const current = browsing();
    if (!current || !folder.folderToken) return;
    void list({ rootId: current.rootId, label: current.label, path: [...current.path, folder.name], token: folder.folderToken, displayPath: current.displayPath });
  };
  const up = () => {
    const current = browsing();
    if (!current) return;
    if (!current.path.length) setBrowsing(null);
    else void open(current.rootId, current.label, current.path.slice(0, -1));
  };
  const unavailable = () => error()?.reason === 'imports_unavailable' || error()?.code === 'unsupported';

  return (
    <div data-vesta="server-add-panel">
      <h1>{t('vesta-server.import.folder-title')}</h1>
      <p data-vesta="vesta-remote-note"><Icon name="icons/content/server" size={16} /> {t('vesta-server.import.folder-remote', { name: props.machine })}</p>

      <Show when={unavailable()}>
        <p data-vesta="server-callout" data-tone="warning">{t('vesta-server.import.unavailable')}</p>
      </Show>
      <Show when={error() && !unavailable()}>
        <div data-vesta="server-callout" data-tone="danger" role="alert">
          <p>{t(importProblem(error()))}</p>
          <Button size="sm" onClick={() => void load()}>{t('common.retry')}</Button>
        </div>
      </Show>

      <section data-vesta="vesta-machines" aria-labelledby="vesta-found-heading">
        <header><h2 id="vesta-found-heading">{t('vesta-server.import.found', { name: props.machine })}</h2></header>
        <Show when={candidates()} fallback={<Working label={t('vesta-server.import.looking')} />}>
          {(found) => (
            <Show when={found().length > 0} fallback={<p data-vesta="server-muted">{t('vesta-server.import.found-none')}</p>}>
              <ul>
                <For each={found()}>
                  {(candidate) => (
                    <li>
                      <button type="button" data-vesta="vesta-machine" disabled={!candidate.folderToken}
                        onClick={() => candidate.folderToken && props.onPick({ token: candidate.folderToken, displayPath: candidate.displayPath, name: candidate.label })}>
                        <Icon name="icons/content/folder" size={18} />
                        <span data-vesta="vesta-machine-text">
                          <strong>{candidate.label}</strong>
                          <span>{candidate.displayPath}</span>
                        </span>
                        <Show when={candidate.kind === 'amp'}><Badge variant="soft">AMP</Badge></Show>
                        <Icon name="icons/controls/chevron-right" size={16} />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          )}
        </Show>
        <For each={warnings()}>
          {(warning) => (
            <div data-vesta="server-callout" data-tone="warning">
              <p>{t(warningMessage(warning.code), { path: warning.displayPath })}</p>
              <Show when={warning.command ?? (warning.code === 'source_unreadable' && warning.displayPath ? importRootCommand(warning.displayPath) : null)}>
                {(command) => <CommandLine command={command()} />}
              </Show>
            </div>
          )}
        </For>
      </section>

      <section data-vesta="vesta-machines" aria-labelledby="vesta-browse-heading">
        <header>
          <h2 id="vesta-browse-heading">{t('vesta-server.import.browse', { name: props.machine })}</h2>
        </header>
        <Show when={browsing()} fallback={
          <Show when={roots()} fallback={<Working label={t('vesta-server.import.looking')} />}>
            {(shared) => (
              <Show when={shared().length > 0} fallback={
                <div data-vesta="vesta-hint">
                  <p>{t('vesta-server.import.no-roots')}</p>
                  <CommandLine command={importRootCommand('/path/to/server')} />
                </div>
              }>
                <ul>
                  <For each={shared()}>
                    {(root) => (
                      <li>
                        <button type="button" data-vesta="vesta-machine" disabled={!root.readable || loading()} onClick={() => void open(root.rootId, root.label, [])}>
                          <Icon name="icons/content/storage" size={18} />
                          <span data-vesta="vesta-machine-text"><strong>{root.label}</strong><span>{root.displayPath}</span></span>
                          <Icon name="icons/controls/chevron-right" size={16} />
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            )}
          </Show>
        }>
          {(current) => (
            <div data-vesta="vesta-browser" aria-busy={loading() ? 'true' : undefined}>
              <div data-vesta="vesta-browser-bar">
                <Button size="sm" variant="ghost" icon={<Icon name="icons/navigation/arrow-up" />} disabled={loading()} onClick={up}>{t('vesta-server.import.up')}</Button>
                <code>{current().displayPath}</code>
              </div>
              <ul>
                <For each={current().entries} fallback={<li><p data-vesta="server-muted">{t('vesta-server.import.empty-folder')}</p></li>}>
                  {(entry) => (
                    <li>
                      <button type="button" data-vesta="vesta-folder" disabled={!entry.readable || !entry.folderToken || loading()} onClick={() => enter(entry)}>
                        <Icon name={entry.readable ? 'icons/content/folder' : 'icons/security/folder-lock'} size={16} />
                        <span>{entry.name}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={current().cursor}>
                {(cursor) => <Button size="sm" variant="ghost" disabled={loading()} onClick={() => void list(current(), cursor())}>{t('vesta-server.import.more')}</Button>}
              </Show>
              <Button tone="accent" disabled={loading() || !current().path.length}
                onClick={() => props.onPick({ token: current().token, displayPath: current().displayPath, name: lastSegment(current().displayPath) })}>
                {t('vesta-server.import.use-folder')}
              </Button>
            </div>
          )}
        </Show>
      </section>

      <footer>
        <Button variant="ghost" onClick={props.onBack}>{t('common.back')}</Button>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------ review

const MIB = 1024 * 1024;

function Review(props: { hostId: string; machine: string; task: ImportTask; review: ImportReview; onBack: () => void }) {
  const summary = createMemo(() => reviewSummary(props.review), { name: 'host-import:summary' });
  const blocked = () => props.review.blockers.length > 0 || !props.review.confirmation;
  const [name, setName] = createSignal(untrack(() => props.task.name), { name: 'host-import:name' });
  const [port, setPort] = createSignal(untrack(() => summary().gamePort), { name: 'host-import:port' });
  const reviewedGb = untrack(() => Math.round((summary().memoryMiB / 1024) * 2) / 2);
  const [memoryGb, setMemoryGb] = createSignal(reviewedGb, { name: 'host-import:memory' });
  const [customize, setCustomize] = createSignal(false, { name: 'host-import:customize' });
  const [acknowledged, setAcknowledged] = createSignal<string[]>([], { name: 'host-import:acknowledged' });
  const [stopped, setStopped] = createSignal(false, { name: 'host-import:stopped' });
  const [eula, setEula] = createSignal(false, { name: 'host-import:eula' });

  const changed = () => name().trim() !== props.task.name || port() !== summary().gamePort || memoryGb() !== reviewedGb;
  const checkAgain = () => void planImport(props.hostId, {
    folder: props.task.folder, name: name().trim() || props.task.name,
    gamePort: port() !== summary().gamePort ? port() : props.task.request.gamePort,
    memoryMiB: memoryGb() !== reviewedGb ? Math.round(memoryGb() * 1024) : props.task.request.memoryMiB,
  });
  const allAcknowledged = () => props.review.warnings.every((code) => acknowledged().includes(code));
  const ready = () => !blocked() && !changed() && allAcknowledged() && stopped() && eula() && !props.task.sending;
  const busy = () => props.task.sending !== null;

  return (
    <div data-vesta="server-add-panel">
      <h1>{t('vesta-server.import.review-title', { name: props.task.name })}</h1>
      <dl data-vesta="server-add-facts">
        <dt>{t('vesta-server.import.software')}</dt><dd>{summary().software ?? t('vesta-server.import.unknown')}</dd>
        <dt>{t('vesta-server.import.minecraft')}</dt><dd>{summary().minecraftVersion ?? t('vesta-server.import.unknown')}</dd>
        <dt>{t('vesta-server.import.size')}</dt><dd>{formatBytes(summary().bytes)}</dd>
        <dt>{t('vesta-server.import.port')}</dt><dd>{summary().gamePort}</dd>
        <dt>{t('vesta-server.import.from')}</dt><dd><code>{props.review.source.displayPath}</code></dd>
      </dl>

      <Show when={blocked()}>
        <section data-vesta="vesta-blockers" aria-labelledby="vesta-blockers-heading">
          <h2 id="vesta-blockers-heading">{t('vesta-server.import.blocked')}</h2>
          <ul>
            <For each={props.review.blockers}>
              {(code) => {
                const fix = blockerFix(code, props.review.source.displayPath);
                return (
                  <li data-vesta="server-callout" data-tone="warning">
                    <p>{t(fix.message, { port: summary().gamePort, size: formatBytes(summary().bytes), free: formatBytes(summary().freeBytes) })}</p>
                    <Show when={fix.command}>{(command) => <CommandLine command={command()} />}</Show>
                    <Show when={fix.customize}><Button size="sm" variant="outline" onClick={() => setCustomize(true)}>{t('vesta-server.import.customize')}</Button></Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={!blocked()}>
        <dl data-vesta="server-add-facts">
          <dt>{t('vesta-server.import.name')}</dt><dd>{props.task.name}</dd>
          <dt>{t('vesta-server.import.memory')}</dt><dd>{formatBytes(summary().memoryMiB * MIB)}</dd>
          <dt>{t('vesta-server.import.java')}</dt><dd>{summary().javaMajor ? t('vesta-server.import.java-auto-version', { version: String(summary().javaMajor) }) : t('vesta-server.import.java-auto')}</dd>
        </dl>
      </Show>

      <details data-vesta="vesta-customize" open={customize()} onToggle={(event) => setCustomize(event.currentTarget.open)}>
        <summary>{t('vesta-server.import.customize')}</summary>
        <div data-vesta="vesta-customize-fields">
          <TextField label={t('vesta-server.import.name')} value={name()} onChange={setName} />
          <NumberField label={t('vesta-server.import.port')} value={port()} onChange={(value) => setPort(Number.isFinite(value) ? value : summary().gamePort)} min={1024} max={65535} formatOptions={{ useGrouping: false }} />
          <NumberField label={t('vesta-server.import.memory-gb')} value={memoryGb()} onChange={(value) => setMemoryGb(Number.isFinite(value) ? value : reviewedGb)} min={0.5} max={256} step={0.5} />
          <Show when={changed()}><p data-vesta="server-muted">{t('vesta-server.import.customize-help')}</p></Show>
        </div>
      </details>

      <Show when={!blocked()}>
        <For each={props.review.warnings}>
          {(code) => (
            <Checkbox checked={acknowledged().includes(code)} label={t(warningMessage(code), { path: props.review.source.displayPath })}
              onChange={(checked) => setAcknowledged((current) => (checked ? [...current, code] : current.filter((entry) => entry !== code)))} />
          )}
        </For>
        <p data-vesta="server-callout" data-tone="success"><Icon name="icons/security/shield-check" /> {t('vesta-server.import.untouched')}</p>
        <Checkbox checked={stopped()} onChange={setStopped} label={t('vesta-server.import.stopped')} />
        <div data-vesta="vesta-eula">
          <Checkbox checked={eula()} onChange={setEula} label={t('vesta-server.import.eula')} />
          <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); void openExternal('https://aka.ms/MinecraftEULA'); }}>{t('servers.eula.read')}</a>
        </div>
      </Show>

      <Show when={props.task.error}>{(error) => <p data-vesta="server-callout" data-tone="danger" role="alert">{t(importProblem(error()))}</p>}</Show>

      <footer>
        <Button variant="ghost" disabled={busy()} onClick={props.onBack}>{t('common.back')}</Button>
        <Show when={blocked() || changed()} fallback={
          <Button tone="accent" disabled={!ready()} onClick={() => void applyImport(props.hostId, acknowledged())}>
            {props.task.sending === 'apply' ? t('vesta-server.import.copy-starting') : t('vesta-server.import.copy')}
          </Button>
        }>
          <Button tone="accent" disabled={busy()} icon={<Icon name="icons/actions/refresh" />} onClick={checkAgain}>{t('vesta-server.import.check-again')}</Button>
        </Show>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------ copy, start, online

function Progressing(props: { hostId: string; machine: string; task: ImportTask; onStartOver: () => void }) {
  const job = () => props.task.job;
  const state = () => job()?.state;
  const percent = () => importPercent(job()?.progress);
  const progress = () => job()?.progress;
  const name = () => props.task.name || props.machine;
  const busy = () => props.task.sending !== null;
  const [opening, setOpening] = createSignal(false, { name: 'host-import:opening' });

  const open = async () => {
    const serverId = job()?.serverId;
    setOpening(true);
    try { await loadHostServers(props.hostId); } catch { /* The list catches up on its own. */ }
    finally { setOpening(false); }
    clearImport(props.hostId);
    transitionTo(serverId ? `/servers/${hostConnectionId({ hostId: props.hostId, serverId })}` : '/servers');
  };
  const finish = () => { clearImport(props.hostId); transitionTo('/servers'); };

  return (
    <div data-vesta="server-add-panel">
      <Switch>
        <Match when={state() === 'applying' || state() === 'interrupted'}>
          <h1>{t(state() === 'interrupted' ? 'vesta-server.import.paused-title' : 'vesta-server.import.copying-title', { name: name() })}</h1>
          <Progress value={percent() ?? undefined} label={t('vesta-server.import.copying')} valueLabel={percent() == null ? undefined : `${Math.floor(percent()!)}%`} />
          <Show when={progress()?.bytesTotal}>
            <p data-vesta="server-muted">{t('vesta-server.import.copied-bytes', {
              done: formatBytes(progress()!.bytesDone), total: formatBytes(progress()!.bytesTotal),
              count: progress()!.filesDone, files: progress()!.filesTotal,
            })}</p>
          </Show>
          <p>{t(state() === 'interrupted' ? 'vesta-server.import.paused-help' : 'vesta-server.import.keeps-going', { name: props.machine })}</p>
        </Match>
        <Match when={state() === 'ready'}>
          <span data-vesta="server-add-done-icon"><Icon name="icons/controls/success" size={28} /></span>
          <h1>{t('vesta-server.import.ready-title', { name: name() })}</h1>
          <p>{t('vesta-server.import.ready-help')}</p>
          <Show when={job()?.error}>{(error) => <p data-vesta="server-callout" data-tone="warning" role="alert">{t(importProblem(error()))}</p>}</Show>
        </Match>
        <Match when={state() === 'starting'}>
          <h1>{t('vesta-server.import.starting-title', { name: name() })}</h1>
          <Working label={t('vesta-server.import.starting')} />
        </Match>
        <Match when={state() === 'online'}>
          <span data-vesta="server-add-done-icon"><Icon name="icons/controls/success" size={28} /></span>
          <h1>{t('vesta-server.import.online-title')}</h1>
          <p>{t('vesta-server.import.online-help', { name: name() })}</p>
        </Match>
        <Match when={state() === 'cancelled'}>
          <h1>{t('vesta-server.import.cancelled-title')}</h1>
          <p>{t('vesta-server.import.cancelled-help')}</p>
        </Match>
        <Match when={state() === 'failed'}>
          <h1>{t('vesta-server.import.failed-title')}</h1>
          <p data-vesta="server-callout" data-tone="danger" role="alert">{t(importProblem(job()?.error ?? 'failed'))}</p>
          <p>{t('vesta-server.import.cancelled-help')}</p>
        </Match>
      </Switch>

      <Show when={props.task.error}>{(error) => <p data-vesta="server-callout" data-tone="danger" role="alert">{t(importProblem(error()))}</p>}</Show>

      <footer>
        <Switch>
          <Match when={state() === 'applying'}>
            <Button variant="ghost" disabled={busy()} onClick={() => void cancelImport(props.hostId)}>{t('vesta-server.import.cancel-copy')}</Button>
            <Button tone="accent" onClick={() => transitionTo('/servers')}>{t('vesta-server.import.close')}</Button>
          </Match>
          <Match when={state() === 'interrupted'}>
            <Button variant="ghost" disabled={busy()} onClick={() => void cancelImport(props.hostId)}>{t('vesta-server.import.cancel-copy')}</Button>
            <Button tone="accent" disabled={busy()} onClick={() => void resumeImport(props.hostId)}>{t('vesta-server.import.resume')}</Button>
          </Match>
          <Match when={state() === 'ready'}>
            <Button variant="ghost" onClick={() => transitionTo('/servers')}>{t('vesta-server.done.later')}</Button>
            <Button tone="accent" disabled={busy()} icon={<Icon name="icons/actions/play" />} onClick={() => void startImport(props.hostId)}>{t('vesta-server.import.start')}</Button>
          </Match>
          <Match when={state() === 'starting'}>
            <Button variant="ghost" onClick={() => transitionTo('/servers')}>{t('vesta-server.import.close')}</Button>
          </Match>
          <Match when={state() === 'online'}>
            <Button variant="ghost" onClick={finish}>{t('servers.done.all-servers')}</Button>
            <Button tone="accent" disabled={opening()} onClick={() => void open()}>{t('servers.open')}</Button>
          </Match>
          <Match when={!importBusy(state())}>
            <Button variant="ghost" onClick={finish}>{t('vesta-server.import.close')}</Button>
            <Button tone="accent" onClick={props.onStartOver}>{t('vesta-server.import.start-over')}</Button>
          </Match>
        </Switch>
      </footer>
    </div>
  );
}
