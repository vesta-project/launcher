import { Button, Checkbox, Progress, Select, TextField } from '@vesta/ui';
import { For, Match, Show, Switch, createMemo, createSignal, onSettled, untrack } from 'solid-js';
import { transitionTo } from '../../app/transition';
import { Board } from '../../components/board';
import { Icon } from '../../components/icon';
import { SoftwareMark } from '../../components/software-mark';
import { activeAccount } from '../../features/accounts/accounts';
import { minecraftVersions } from '../../features/instances/versions';
import {
  DEFAULT_SOFTWARE, NAME_LIMIT, SETUP_SOFTWARE, choiceProblem, needsReplan, phaseText, releaseVersions, reviewSize, setupReason, setupRow,
  type SetupChoice,
} from '../../features/servers/first-server-model';
import { firstServer, installFirstServer, prepareFirstServer, resumeFirstServer, retryFirstServer } from '../../features/servers/first-server-store';
import { formatElapsed } from '../../features/servers/pack-install-job';
import { serverModpackPath } from '../../features/servers/modpack-area-model';
import { softwareIcon } from '../../features/servers/software-flow';
import { useServersClock } from '../../features/servers/store';
import { t } from '../../localization';
import { ServerErrorNote } from './parts';
import './pack/modpack.css';

/**
 * `/servers/add/setup/<id>`: the first server on a freshly installed Vesta Host. Choose what to
 * run, watch it install, then land on a ready server. The job lives in a per-server store, so
 * leaving and coming back finds the same progress.
 */
export function FirstServerSetup(props: { connectionId: string }) {
  const id = () => props.connectionId;
  const state = () => firstServer(id());
  onSettled(() => resumeFirstServer(id()));
  return (
    <Board class="servers-board">
      <div data-vesta="server-add">
        <nav data-vesta="server-add-steps" aria-label={t('servers.first.title')}>
          <ol>
            <For each={setupRow(state().step, state().failedAt ?? 'install')}>
              {(row, index) => (
                <li data-state={row.state === 'done' ? 'done' : row.state === 'current' || row.state === 'failed' ? 'current' : 'next'} aria-current={row.state === 'current' ? 'step' : undefined}>
                  <span>{index() + 1}</span>{t(row.label)}
                </li>
              )}
            </For>
          </ol>
        </nav>
        <Switch>
          <Match when={state().step === 'choose'}><Choose connectionId={id()} /></Match>
          <Match when={state().step === 'review'}><Review connectionId={id()} /></Match>
          <Match when={state().step === 'ready'}><Ready connectionId={id()} /></Match>
          <Match when={state().step === 'failed'}><Failed connectionId={id()} /></Match>
          <Match when={true}><Working connectionId={id()} /></Match>
        </Switch>
      </div>
    </Board>
  );
}

function Choose(props: { connectionId: string }) {
  // The form seeds once from the last choice (Back from review, or Choose again).
  const previous = () => untrack(() => firstServer(props.connectionId).choice);
  const versions = createMemo(() => releaseVersions(minecraftVersions()), { name: 'first-server:versions' });
  const owner = () => activeAccount()?.username;
  const [name, setName] = createSignal(previous()?.name ?? (owner() ? t('servers.first.name-default', { name: owner()! }) : t('servers.first.name-fallback')), { name: 'first-server:name' });
  const [software, setSoftware] = createSignal(previous()?.software ?? DEFAULT_SOFTWARE, { name: 'first-server:software' });
  const [version, setVersion] = createSignal(previous()?.version ?? '', { name: 'first-server:version' });
  const [more, setMore] = createSignal(SETUP_SOFTWARE.some((entry) => entry.more && entry.id === previous()?.software), { name: 'first-server:more' });
  const chosenVersion = () => version() || versions()[0] || '';
  const choice = (): SetupChoice => ({ name: name(), software: software(), version: chosenVersion() });
  const problem = () => choiceProblem(choice());
  const shown = () => SETUP_SOFTWARE.filter((entry) => !entry.more || more());
  const submit = (event: Event) => { event.preventDefault(); if (!problem()) void prepareFirstServer(props.connectionId, choice()); };
  return (
    <form data-vesta="server-add-panel" onSubmit={submit}>
      <h1>{t('servers.first.title')}</h1>
      <p>{t('servers.first.description')}</p>
      <TextField label={t('servers.first.name')} value={name()} onChange={setName}
        error={!name().trim() ? t('servers.first.name-empty') : name().trim().length > NAME_LIMIT ? t('servers.first.name-long') : undefined} spellcheck={false} autocomplete="off" />
      <fieldset data-vesta="first-server-software">
        <legend>{t('servers.first.software')}</legend>
        <For each={shown()}>
          {(entry) => (
            <label data-vesta="first-server-choice" data-selected={software() === entry.id ? '' : undefined}>
              <input type="radio" name="software" value={entry.id} checked={software() === entry.id} onChange={() => setSoftware(entry.id)} />
              <SoftwareMark software={entry.id} icon={softwareIcon[entry.id]} />
              <span><strong>{t(entry.label)}</strong><small>{t(entry.help)}</small></span>
            </label>
          )}
        </For>
        <Show when={!more()}>
          <Button size="sm" variant="ghost" onClick={() => setMore(true)}>{t('servers.first.software-more')}</Button>
        </Show>
      </fieldset>
      <Select label={t('servers.first.version')} value={chosenVersion()} onChange={setVersion}
        options={versions().map((value, index) => ({ value, label: index === 0 ? t('servers.first.version-latest', { version: value }) : value }))} />
      <p data-vesta="server-muted">{t('servers.first.later')}</p>
      <footer>
        <Button variant="ghost" onClick={() => transitionTo('/servers')}>{t('servers.first.later-action')}</Button>
        <Button type="submit" tone="accent" disabled={!!problem()}>{t('servers.first.continue')}</Button>
      </footer>
    </form>
  );
}

function Working(props: { connectionId: string }) {
  const now = useServersClock();
  const state = () => firstServer(props.connectionId);
  return (
    <div data-vesta="server-add-panel" role="status" aria-live="polite">
      <h1>{t(state().step === 'finishing' ? 'servers.first.finishing-title' : state().step === 'installing' ? 'servers.first.installing-title' : 'servers.first.preparing-title', { name: state().choice?.name ?? '' })}</h1>
      <div data-vesta="pack-job-progress">
        <div data-vesta="pack-job-progress-line">
          <span data-vesta="pack-job-stage">{t(phaseText(state().step, state().job?.phase))}</span>
          <span data-vesta="pack-job-spacer" />
          <Show when={state().startedAt}>{(started) => <span data-vesta="pack-job-elapsed">{t('server-pack.job-elapsed', { time: formatElapsed(now() - started()) })}</span>}</Show>
        </div>
        {/* The host reports phases, not percentages: an honest moving bar. */}
        <Progress size="sm" aria-label={t(phaseText(state().step, state().job?.phase))} />
      </div>
      <p data-vesta="pack-job-hint">{t('servers.first.leave')}</p>
    </div>
  );
}

function Review(props: { connectionId: string }) {
  const state = () => firstServer(props.connectionId);
  const review = () => state().job?.review;
  const [acknowledged, setAcknowledged] = createSignal(false, { name: 'first-server:ack' });
  const warnings = () => review()?.warnings ?? [];
  return (
    <div data-vesta="server-add-panel">
      <h1>{t('servers.first.review-title')}</h1>
      <Show when={review()}>
        {(value) => (
          <dl data-vesta="server-add-facts">
            <dt>{t('servers.first.name')}</dt><dd>{value().name}</dd>
            <dt>{t('servers.first.software')}</dt><dd>{SETUP_SOFTWARE.find((entry) => entry.id === value().software) ? t(SETUP_SOFTWARE.find((entry) => entry.id === value().software)!.label) : value().software ?? '—'}</dd>
            <dt>{t('servers.first.version')}</dt><dd>{value().minecraftVersion}</dd>
            <Show when={reviewSize(value().bytes)}>{(size) => <><dt>{t('servers.first.download')}</dt><dd>{t('servers.first.download-size', { size: size(), count: value().files })}</dd></>}</Show>
          </dl>
        )}
      </Show>
      <Show when={warnings().length}>
        <div data-vesta="server-callout" data-tone="warning">
          <p>{t('servers.first.warnings', { count: warnings().length })}</p>
          <Checkbox size="sm" checked={acknowledged()} onChange={setAcknowledged} label={t('servers.first.warnings-ack')} />
        </div>
      </Show>
      <p data-vesta="server-muted">{t('servers.first.eula-note')}</p>
      <footer>
        <Button variant="ghost" onClick={() => retryFirstServer(props.connectionId)}>{t('common.back')}</Button>
        <Button tone="accent" disabled={warnings().length > 0 && !acknowledged()} onClick={() => void installFirstServer(props.connectionId, warnings().length > 0)}>{t('servers.first.install')}</Button>
      </footer>
    </div>
  );
}

function Failed(props: { connectionId: string }) {
  const state = () => firstServer(props.connectionId);
  const reason = () => state().error?.reason ?? state().job?.error ?? null;
  const message = () => setupReason(reason());
  return (
    <div data-vesta="server-add-panel">
      <h1>{t('servers.first.failed-title')}</h1>
      <Show when={message()} fallback={<ServerErrorNote error={state().error} />}>
        {(text) => <p data-vesta="server-callout" data-tone="danger" role="alert">{t(text())}</p>}
      </Show>
      <footer>
        <Button variant="ghost" onClick={() => transitionTo('/servers')}>{t('servers.done.all-servers')}</Button>
        <Button tone="accent" icon={<Icon name="icons/actions/reload" />} onClick={() => retryFirstServer(props.connectionId)}>
          {t(needsReplan(reason()) || state().failedAt === 'prepare' ? 'servers.first.choose-again' : 'server-pack.job-try-again')}
        </Button>
      </footer>
    </div>
  );
}

function Ready(props: { connectionId: string }) {
  const state = () => firstServer(props.connectionId);
  const server = () => state().server;
  const id = () => server()?.connection.id ?? props.connectionId;
  return (
    <div data-vesta="server-add-panel">
      <span data-vesta="server-add-done-icon"><Icon name="icons/controls/success" size={28} /></span>
      <h1>{t('servers.first.ready-title', { name: server()?.connection.name ?? state().choice?.name ?? '' })}</h1>
      <p>{t('servers.first.ready-description')}</p>
      <ul data-vesta="first-server-next">
        <li><Icon name="icons/actions/play" size={16} /><span>{t('servers.first.next-start')}</span></li>
        <li><Icon name="icons/content/people" size={16} /><span>{t('servers.first.next-invite')}</span></li>
        <li><Icon name="icons/content/modpack" size={16} /><span>{t('servers.first.next-modpack')}</span></li>
      </ul>
      <footer>
        <Button variant="ghost" onClick={() => transitionTo(serverModpackPath(id()))}>{t('servers.first.add-modpack')}</Button>
        <Button tone="accent" onClick={() => transitionTo(`/servers/${id()}`)}>{t('servers.open')}</Button>
      </footer>
    </div>
  );
}
