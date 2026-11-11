import { Metadata } from '../../../components/metadata';
import { Badge, Button, Checkbox, SegmentedControl, Switch, toast } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { EmptyState } from '../../../components/empty-state';
import { Icon } from '../../../components/icon';
import { sourceById, type ResourceVersion } from '../../../features/browse/browse-model';
import { loadVersions, peekProject, peekVersions } from '../../../features/browse/browse-projects';
import { IntentMemo } from '../../../features/servers/model';
import {
  canPublish, customizingProvider, diffChangeCount, entryFileName, needsLowerAck, publishReducer, type PublishEvent, type PublishState,
} from '../../../features/servers/modpack-area-model';
import type { ServerCommandError } from '../../../features/servers/native';
import type { PackEntry, PublishedRevision } from '../../../features/servers/native-pack';
import { serverResource, useServerResource } from '../../../features/servers/resources';
import { serverCommand } from '../../../features/servers/store';
import { formatDate, t } from '../../../localization';
import { ServerErrorNote } from '../parts';
import { useModpackArea } from './area';
/**
 * Versions, drawn like a git history. The draft is a branch off the revision players get, and
 * publishing commits it to the line. Published revisions run down one line, newest first, and the
 * oldest revision players may still join with is marked. A provider pack picks the release players
 * get instead of keeping a draft.
 */
export function ModpackVersions() {
  const area = useModpackArea();
  return (
    <div data-vesta="modpack-scroll">
      <div data-vesta="modpack-versions">
        <Show when={area.kind() === 'provider'}><ProviderVersions /></Show>
        <section data-vesta="modpack-panel" data-panel="history">
          <header data-vesta="modpack-panel-head"><h3>{t('server-pack.history-title')}</h3></header>
          <div data-vesta="modpack-panel-body">
            <ol data-vesta="pack-graph" aria-label={t('server-pack.history-title')}>
              <Show when={area.kind() !== 'provider'}><DraftReview /></Show>
              <PublishedHistory />
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}

const entryName = (entry: PackEntry) => (entry.source.type === 'provider' ? peekProject(entry.source.provider, entry.source.projectId)?.name : undefined) ?? entryFileName(entry);

/** Custom pack: review the draft against the published release, then publish it optional or required. */
function DraftReview() {
  const area = useModpackArea();
  const [state, setState] = createSignal<PublishState>({ step: 'idle' }, { name: 'modpack-publish:state' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-publish:error' });
  const intents = new IntentMemo();
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const send = (event: PublishEvent) => {
    const next = publishReducer(untrack(state), event);
    setState(next);
    if (event.type === 'review' || (event.type === 'retry' && next.step === 'reviewing')) void review();
    if (next.step === 'publishing' && (event.type === 'publish' || event.type === 'retry')) void publish(next.request);
  };
  const review = async () => {
    setError(null);
    try {
      const revision = untrack(area.workspace)!.draft.revision;
      const preview = await area.refreshPreview();
      if (!disposed && revision === untrack(area.workspace)?.draft.revision) send({ type: 'previewed', preview });
      else if (!disposed) send({ type: 'reset' });
    } catch (reason) { if (!disposed) { setError(reason as ServerCommandError); send({ type: 'failed', code: (reason as ServerCommandError).code }); } }
  };
  const publish = async (request: Extract<PublishState, { step: 'publishing' }>['request']) => {
    setError(null);
    try {
      const outcome = await serverCommand((api) => api.packBuildPublish(area.id(), request, intents.idFor(request)));
      intents.settle();
      if (disposed) return;
      area.applyPublication(outcome, request.draftRevision);
      send({ type: 'published', outcome });
      toast.show({ title: t('server-pack.published', { version: outcome.hostedRevision }), tone: 'success' });
      await area.reload();
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      if (!disposed) { setError(reason as ServerCommandError); send({ type: 'failed', code: (reason as ServerCommandError).code }); }
    }
  };
  // A new draft revision makes an open review stale.
  createEffect(() => area.workspace()?.draft.revision, (revision) => {
    const current = untrack(state);
    if (current.step === 'review' && current.preview.draftRevision !== revision) setState({ step: 'idle' });
  }, { name: 'modpack-publish:stale' });

  const pending = () => area.workspace()!.pendingPublication;
  /** The revision players get, which the draft is based on; none before the first publish. */
  const live = () => { const revision = area.workspace()!.publishedRevision; return revision === '0' ? null : revision; };
  const reviewing = () => { const current = state(); return current.step === 'review' || current.step === 'publishing' ? current.preview : current.step === 'failed' ? current.preview : undefined; };

  return (
    <li data-vesta="pack-commit" data-kind="draft" data-state={pending() ? 'pending' : 'clean'}>
      {/* The draft branches off the revision players get; publishing commits it to the line. */}
      <span data-vesta="pack-graph-lane" data-fork={live() ? '' : undefined} aria-hidden="true"><span data-vesta="pack-graph-node" /></span>
      <div data-vesta="pack-commit-body">
        <header data-vesta="pack-commit-head">
          <strong>{t('server-pack.draft-title')}</strong>
          <Show when={pending()} fallback={<span data-vesta="server-muted">{live() ? t('server-pack.draft-matches', { revision: live()! }) : t('server-pack.draft-clean-help')}</span>}>
            <Badge size="sm" tone="accent">{area.preview() ? t('server-pack.unpublished-count', { count: diffChangeCount(area.preview()!.diff) }) : t('server-pack.unpublished')}</Badge>
            <Show when={live()}>{(revision) => <span data-vesta="server-muted">{t('server-pack.draft-based', { revision: revision() })}</span>}</Show>
          </Show>
          <span data-vesta="server-toolbar-spacer" />
          <Show when={pending() && (state().step === 'idle' || (state().step === 'failed' && !reviewing()))}>
            <Button size="sm" tone="accent" icon={<Icon name="icons/content/history" />} disabled={!area.gates().build} onClick={() => send({ type: 'review' })}>
              {t('server-pack.review-publish')}
            </Button>
          </Show>
        </header>
        <Show when={customizingProvider(area.workspace())}>
          <p data-vesta="server-callout" data-tone="warning">{t('server-pack.customizing-help')}</p>
        </Show>
        <Show when={state().step === 'reviewing'}><p role="status" data-vesta="server-muted">{t('server-pack.reviewing')}</p></Show>
        <Show when={reviewing()}>
          {(preview) => (
            <div data-vesta="modpack-diff">
              <DiffList title={t('server-pack.diff-added', { count: preview().diff.added.length })} tone="success" icon="icons/actions/add" items={preview().diff.added.map(entryName)} />
              <DiffList title={t('server-pack.diff-updated', { count: preview().diff.changed.length })} tone="accent" icon="icons/actions/refresh" items={preview().diff.changed.map((change) => entryName(change.after))} />
              <DiffList title={t('server-pack.diff-removed', { count: preview().diff.removed.length })} tone="danger" icon="icons/actions/delete" items={preview().diff.removed.map(entryName)} />
              <DiffList title={t('server-pack.diff-files', { count: preview().diff.customOverrides.length })} tone="neutral" icon="icons/content/file" items={preview().diff.customOverrides} />
              <Show when={preview().diff.metadataChanged}><p data-vesta="server-muted">{t('server-pack.diff-metadata')}</p></Show>
              <Show when={preview().resolvedEntries.length}>
                <p data-vesta="server-muted">{t('server-pack.diff-resolved', { count: preview().resolvedEntries.length })}</p>
              </Show>
              <For each={preview().issues}>
                {(issue) => <p data-vesta="server-callout" data-tone={issue.severity === 'error' ? 'danger' : 'warning'} role={issue.severity === 'error' ? 'alert' : undefined}>
                  {t(issue.severity === 'error' ? 'server-pack.issue-error' : 'server-pack.issue-warning', { code: issue.code, name: issue.entryId ?? '' })}
                </p>}
              </For>
              <For each={preview().warnings}>{(warning) => <p data-vesta="server-callout" data-tone="warning">{warning}</p>}</For>
              <Show when={preview().safetySnapshotRecommended}>
                <p data-vesta="server-callout" data-tone="neutral"><Icon name="icons/content/storage" size={14} /> {t('server-pack.snapshot')}</p>
              </Show>
              <Show when={state().step === 'review' ? state() as Extract<PublishState, { step: 'review' }> : undefined}>
                {(current) => (
                  <>
                    <div data-vesta="modpack-publish-mode">
                      <SegmentedControl size="sm" aria-label={t('server-pack.publish-mode')} value={current().required ? 'required' : 'optional'}
                        onChange={(value) => send({ type: 'required', value: value === 'required' })}
                        options={[
                          { value: 'optional', label: t('server-pack.publish-optional') },
                          { value: 'required', label: t('server-pack.publish-required'), disabled: !area.gates().forceUpdate },
                        ]} />
                      <span data-vesta="server-muted">{t(current().required ? 'server-pack.publish-required-help' : 'server-pack.publish-optional-help')}</span>
                    </div>
                    <Show when={needsLowerAck(current().preview)}>
                      <Checkbox size="sm" checked={current().acknowledged} onChange={(value) => send({ type: 'acknowledge', value })} label={t('server-pack.ack')} />
                    </Show>
                  </>
                )}
              </Show>
              <div data-vesta="modpack-card-actions">
                <Button size="sm" variant="ghost" disabled={state().step === 'publishing'} onClick={() => send({ type: 'reset' })}>{t('common.cancel')}</Button>
                <span data-vesta="server-toolbar-spacer" />
                <Show when={state().step === 'failed'} fallback={
                  <Button size="sm" tone="accent" disabled={!canPublish(state(), area.gates())} onClick={() => send({ type: 'publish' })}>
                    {state().step === 'publishing' ? t('server-pack.publishing') : t('server-pack.publish')}
                  </Button>
                }>
                  <Button size="sm" tone="accent" onClick={() => send({ type: 'retry' })}>
                    {t((state() as Extract<PublishState, { step: 'failed' }>).reason === 'uncertain' ? 'server-pack.retry' : 'server-pack.review-again')}
                  </Button>
                </Show>
              </div>
            </div>
          )}
        </Show>
        <Show when={state().step === 'published' ? state() as Extract<PublishState, { step: 'published' }> : undefined}>
          {(done) => (
            <p data-vesta="server-callout" data-tone="success" role="status">
              <Icon name="icons/controls/check" size={14} /> {t(done().required ? 'server-pack.published-required' : 'server-pack.published-optional', { version: done().outcome.hostedRevision })}
            </p>
          )}
        </Show>
        <ServerErrorNote error={error()} />
      </div>
    </li>
  );
}

function DiffList(props: { title: string; tone: 'success' | 'accent' | 'danger' | 'neutral'; icon: string; items: string[] }) {
  return (
    <Show when={props.items.length}>
      <div data-vesta="modpack-diff-group" data-tone={props.tone}>
        <h4><Icon name={props.icon} size={12} />{props.title}</h4>
        <ul><For each={props.items}>{(item) => <li>{item}</li>}</For></ul>
      </div>
    </Show>
  );
}

/** Provider pack: the provider's releases; switching publishes a new pointer, nothing is hosted. */
function ProviderVersions() {
  const area = useModpackArea();
  const provider = () => area.workspace()!.providerPack!;
  const [showAll, setShowAll] = createSignal(false, { name: 'modpack-provider-versions:all' });
  const [choosing, setChoosing] = createSignal<ResourceVersion | null>(null, { name: 'modpack-provider-versions:choosing' });
  const [required, setRequired] = createSignal(false, { name: 'modpack-provider-versions:required' });
  const [ack, setAck] = createSignal(false, { name: 'modpack-provider-versions:ack' });
  const [busy, setBusy] = createSignal(false, { name: 'modpack-provider-versions:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack-provider-versions:error' });
  const intents = new IntentMemo();
  createEffect(provider, (value) => { void loadVersions(value.provider, value.projectId).catch(() => {}); }, { name: 'modpack-provider-versions:load' });
  const all = () => peekVersions(provider().provider, provider().projectId);
  const activeIndex = () => all()?.findIndex((version) => version.id === provider().versionId) ?? -1;
  const visible = createMemo(() => {
    const list = all() ?? [];
    const mc = area.workspace()!.serverMinecraftVersion;
    return showAll() ? list : list.filter((version) => version.game_versions.includes(mc) || version.id === provider().versionId);
  }, { name: 'modpack-provider-versions:visible' });
  const older = (version: ResourceVersion) => { const list = all() ?? []; return list.indexOf(version) > activeIndex() && activeIndex() >= 0; };

  const switchTo = async (version: ResourceVersion) => {
    const workspace = area.workspace()!;
    setBusy(true); setError(null);
    const request = {
      provider: provider().provider, projectId: provider().projectId, versionId: version.id,
      expectedRevision: workspace.publishedRevision, draftRevision: workspace.draft.revision, requiredUpdate: required(), acknowledgeLowerVersion: older(version) && ack(),
    };
    try {
      const outcome = await serverCommand((api) => api.packProviderPublish(area.id(), request, intents.idFor(request)));
      intents.settle();
      setChoosing(null);
      toast.show({ title: t('server-pack.switched', { version: version.version_number, revision: outcome.hostedRevision }), tone: 'success' });
      await area.reload();
    } catch (reason) { intents.settle(reason as ServerCommandError); setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };

  return (
    <section data-vesta="modpack-panel">
      <header data-vesta="modpack-panel-head">
        <h3>{t('server-pack.provider-versions', { provider: sourceById(provider().provider).label })}</h3>
        <Switch size="sm" checked={showAll()} onChange={setShowAll} label={t('server-pack.show-all-versions')} />
      </header>
      <div data-vesta="modpack-panel-body">
        <ServerErrorNote error={error()} />
        <Show when={all()} fallback={<p data-vesta="server-muted" role="status">{t('server-pack.loading-versions')}</p>}>
          <Show when={visible().length} fallback={<EmptyState variant="inline" icon="icons/content/history" title={t('server-pack.no-versions', { version: area.workspace()!.serverMinecraftVersion })} />}>
            <ul data-vesta="modpack-version-list">
              <For each={visible()} keyed={(version) => version.id}>
                {(version) => (
                  <li data-vesta="modpack-version" data-active={version().id === provider().versionId ? '' : undefined}>
                    <div data-vesta="modpack-version-copy">
                      <strong>{version().version_number}</strong>
                      <span data-vesta="server-muted">
                        <Metadata parts={[version().game_versions.slice(0, 3).join(', '), version().loaders.join(', '), version().published_at ? formatDate(version().published_at!) : null]} />
                      </span>
                    </div>
                    <Show when={version().release_type !== 'release'}><Badge size="sm" variant="outline" tone="warning">{version().release_type}</Badge></Show>
                    <Show when={version().id === provider().versionId} fallback={
                      <Show when={choosing()?.id === version().id} fallback={
                        <Button size="sm" variant="outline" disabled={busy() || !area.gates().publish} onClick={() => { setChoosing(version()); setRequired(false); setAck(false); }}>{t('server-pack.switch-version')}</Button>
                      }>
                        <div data-vesta="modpack-switch">
                          <SegmentedControl size="sm" aria-label={t('server-pack.publish-mode')} value={required() ? 'required' : 'optional'} onChange={(value) => setRequired(value === 'required')}
                            options={[{ value: 'optional', label: t('server-pack.publish-optional') }, { value: 'required', label: t('server-pack.publish-required'), disabled: !area.gates().forceUpdate }]} />
                          <Show when={older(version())}><Checkbox size="sm" checked={ack()} onChange={setAck} label={t('server-pack.ack-older')} /></Show>
                          <Button size="sm" variant="ghost" disabled={busy()} onClick={() => setChoosing(null)}>{t('common.cancel')}</Button>
                          <Button size="sm" tone="accent" disabled={busy() || (older(version()) && !ack())} onClick={() => void switchTo(version())}>{t('server-pack.switch-confirm')}</Button>
                        </div>
                      </Show>
                    }>
                      <Badge size="sm" tone="success" icon={<Icon name="icons/controls/check" size={11} />}>{t('server-pack.active-version')}</Badge>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </div>
    </section>
  );
}

const historyResource = serverResource<PublishedRevision[], string>('pack-history', id => serverCommand(api => api.packHistory(id)));

/** Published revisions as commits on one line: the live one is marked, older-than-minimum ones fade. */
function PublishedHistory() {
  const area = useModpackArea();
  const history = useServerResource(area.id, historyResource, { args: () => area.workspace()?.publishedRevision ?? '0' });
  const rows = () => history.value() ?? [];
  const live = () => area.workspace()?.publishedRevision ?? '0';
  const minimum = () => area.workspace()?.minimumRevision ?? '0';
  const below = (revision: string) => minimum() !== '0' && BigInt(revision) < BigInt(minimum());
  return (
    <Show when={rows().length} fallback={
      <li data-vesta="pack-commit" data-kind="empty">
        <span data-vesta="pack-graph-lane" aria-hidden="true" />
        <div data-vesta="pack-commit-body">
          <ServerErrorNote error={history.error()} onRetry={() => void history.refresh()} />
          <Show when={!history.error()}><p data-vesta="server-muted" role="status">{t(history.loading() ? 'server-pack.history-loading' : 'server-pack.history-empty')}</p></Show>
        </div>
      </li>
    }>
      <For each={rows()}>
        {(row) => (
          <li data-vesta="pack-commit" data-kind="published" data-live={row.revision === live() ? '' : undefined}
            data-required={row.requiredUpdate ? '' : undefined} data-expired={below(row.revision) ? '' : undefined}>
            <span data-vesta="pack-graph-lane" aria-hidden="true"><span data-vesta="pack-graph-node" /></span>
            <div data-vesta="pack-commit-body">
              <header data-vesta="pack-commit-head">
                <strong>{t('server-pack.revision', { revision: row.revision })}</strong>
                <Show when={row.revision === live()}><Badge size="sm" tone="accent" variant="soft">{t('server-pack.revision-live')}</Badge></Show>
                <Show when={row.requiredUpdate}><Badge size="sm" tone="warning" variant="soft">{t('server-pack.publish-required')}</Badge></Show>
                <Show when={row.providerVersion}><Badge size="sm" variant="outline">{row.providerVersion}</Badge></Show>
              </header>
              <span data-vesta="server-muted">
                <Metadata parts={[
                  formatDate(new Date(row.publishedAt).toISOString()), row.publishedBy,
                  row.entryCount != null ? t('server-pack.history-entries', { count: row.entryCount }) : null,
                  row.overrideCount != null ? t('server-pack.history-overrides', { count: row.overrideCount }) : null,
                ]} />
              </span>
              {/* The line players can't fall below: everything older must update before joining. */}
              <Show when={row.revision === minimum() && minimum() !== '0'}>
                <p data-vesta="pack-commit-minimum"><Icon name="icons/security/lock" size={11} />{t('server-pack.revision-minimum')}</p>
              </Show>
            </div>
          </li>
        )}
      </For>
    </Show>
  );
}
