import { Button, Dialog, IconButton, ImageViewer } from "@vesta/ui";
import { invoke } from '@tauri-apps/api/core';
import { For, Show, createSignal, createEffect, onCleanup } from "solid-js";
import { navigate } from "../../../app/router";
import { Icon } from "../../../components/icon";
import {
  formatPlaytime,
  resourcesFor,
  screenshotsFor,
  statsFor,
  worldsFor,
} from "../../../features/instances/details";
import {
  playInstance,
  type InstanceEntry,
} from "../../../features/instances/catalog";
import { nativeInstances, launchNativeTarget } from "../../../features/instances/native-service";
import { mutateNativeScreenshot } from "../../../features/instances/native-details";
import { copyScreenshot } from "../../../features/instances/screenshot-clipboard";
import { t } from "../../../localization";
import "./overview-tab.css";
import "../../../components/card-play.css";
import { LinkedPack } from './linked-pack';

/**
 * Overview: what you came back for. The last world you played leads, with a way straight
 * into it; other worlds, the instance's health and recent screenshots follow.
 */
export function OverviewTab(props: { entry: InstanceEntry }) {
  const id = () => props.entry.instance.id;
  const [directWorld, setDirectWorld] = createSignal(false);
  createEffect(id, (instanceId) => {
    setDirectWorld(false);
    if (!nativeInstances) return;
    let stale = false;
    onCleanup(() => { stale = true; });
    void invoke<boolean>('instance_direct_launch_support', { instanceId: Number(instanceId) })
      .then(supported => { if (!stale) setDirectWorld(supported); }).catch(() => {});
  }, { name: 'overview.directWorldSupport' });
  const worlds = () => worldsFor(id());

  /** Enough worlds to fill a row or two; the rest are on the Worlds tab. */
  const shownWorlds = () => worlds().slice(0, 6);
  const resources = () => resourcesFor(id());
  const updates = () => resources().filter((item) => item.update).length;
  const stats = () => statsFor(id());
  const shots = () => screenshotsFor(id());
  const idle = () => props.entry.state.kind === "idle";
  const goto = (section: string) => navigate(`/library/${id()}/${section}`, { replace: section !== "settings" });

  const [viewer, setViewer] = createSignal<number | undefined>(undefined);
  const [deleteShot, setDeleteShot] = createSignal<string>();
  const [deletingShot, setDeletingShot] = createSignal(false);
  const deleteScreenshot = async () => {
    const path = deleteShot(); if (!path || deletingShot()) return;
    setDeletingShot(true);
    try { if (await mutateNativeScreenshot(id(), path, true)) { setDeleteShot(undefined); setViewer(undefined); } }
    finally { setDeletingShot(false); }
  };
  const [copyStatus, setCopyStatus] = createSignal("");
  const copy = async (src: string) => {
    setCopyStatus("");
    try {
      await copyScreenshot(src, shots().find((shot) => shot.src === src)?.path);
      setCopyStatus(t("overview.screenshot-copied"));
    } catch {
      setCopyStatus(t("overview.screenshot-copy-failed"));
    }
  };

  const play = (worldId: string) => nativeInstances && directWorld() ? void launchNativeTarget(id(), { kind: 'world', folder: worldId }) : playInstance(id());
  return (
    <div data-vesta="overview">
      <div data-vesta="overview-main">
        {/* Worlds lead, the same card for every one; the newest is marked. Nothing to show, no section. */}
        <Show when={worlds().length} fallback={
          <section data-vesta="overview-start">
            <Icon name="icons/content/globe" size={20} />
            <div>
              <strong>{t("overview.no-worlds")}</strong>
              <span>{t("overview.create-or-import-world")}</span>
            </div>
            <Button tone="accent" disabled={!idle()} icon={<Icon name="icons/actions/play" />} onClick={() => playInstance(id())}>{t("worlds.play")}</Button>
          </section>
        }>
          <section aria-labelledby="overview-worlds">
            <header data-vesta="overview-panel-header">
              <h2 id="overview-worlds">{t("overview.worlds")}</h2>
              <Show when={worlds().length > shownWorlds().length}>
                <Button size="sm" variant="ghost" onClick={() => goto("worlds")}>{t("overview.view-all-count", { count: worlds().length })}</Button>
              </Show>
            </header>
            <ul data-vesta="overview-world-grid">
              <For each={shownWorlds()}>
                {(world, index) => (
                  <li data-latest={index() === 0 ? "" : undefined}>
                    <button type="button" data-vesta="overview-world-card" onClick={() => goto(`worlds/${encodeURIComponent(world.id)}`)}>
                      <img src={world.image} alt="" draggable="false" />
                      <span data-vesta="overview-world-name">{world.name}</span>
                      <span data-vesta="overview-world-meta">
                        <span data-vesta="mode-tag" data-mode={world.mode.toLowerCase()}>{world.mode}</span>
                        <span>{world.lastPlayed}</span>
                      </span>
                    </button>
                    <button type="button" data-card-play="" data-variant="launch" data-running={props.entry.state.kind === "running" ? "" : undefined} class="overview-world-play" disabled={!idle()}
                      aria-label={t("overview.play-named", { name: world.name })} onClick={() => play(world.id)}>
                      <Icon name="icons/actions/play" size={14} />
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={shots().length}>
          <section aria-labelledby="overview-shots">
            <header data-vesta="overview-panel-header">
              <h2 id="overview-shots">{t("overview.screenshots")}</h2>
              <span data-vesta="overview-quiet">{shots().length}</span>
            </header>
            <ul data-vesta="shot-grid">
              <For each={shots().slice(0, 5)}>
                {(shot, index) => (
                  <li data-vesta="shot-item">
                    <button
                      type="button"
                      data-vesta="shot"
                        aria-label={t("overview.open-screenshot", { title: shot.title })}
                      onClick={() => setViewer(index())}
                    >
                      <img
                        src={shot.src}
                        alt=""
                        loading="lazy"
                        draggable="false"
                      />
                      <span>{shot.date}</span>
                    </button>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      class="shot-copy"
                      label={t("overview.copy-screenshot", { title: shot.title })}
                      icon={<Icon name="icons/actions/copy" />}
                      onClick={() => void copy(shot.src)}
                    />
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
  
      </div>

      {/* Beside the worlds: where the instance comes from, then a few plain facts. */}
      <aside data-vesta="overview-side">
        <LinkedPack instanceId={id()} />
        <section data-vesta="overview-panel" aria-labelledby="overview-details">
          <header data-vesta="overview-panel-header"><h2 id="overview-details">{t("overview.details")}</h2></header>
          <dl data-vesta="overview-facts">
            <div><dt>{t("overview.played")}</dt><dd>{formatPlaytime(stats().playtimeMinutes)}</dd></div>
            <Show when={stats().lastPlayed}><div><dt>{t("overview.last-launched")}</dt><dd>{stats().lastPlayed}</dd></div></Show>
            <div>
              <dt>{t("overview.resources")}</dt>
              <dd>
                <Show when={updates()}>
                  <button type="button" data-vesta="overview-facts-link" onClick={() => goto("resources")}>
                    {t(updates() === 1 ? "overview.update-one" : "overview.update-other", { count: updates() })}
                  </button>
                </Show>
                {resources().length}
              </dd>
            </div>
            <div><dt>{t("overview.memory")}</dt><dd>{(stats().memoryMb / 1024).toFixed(1)} GB</dd></div>
          </dl>
        </section>
      </aside>

      <span data-vesta="screenshot-copy-status" role="status">
        {copyStatus()}
      </span>
      <ImageViewer
        open={viewer() !== undefined}
        onOpenChange={(open) => {
          if (!open) setViewer(undefined);
        }}
        images={shots().map((shot) => ({
          src: shot.src,
          title: shot.title,
          date: shot.date,
        }))}
        index={viewer() ?? 0}
        onIndexChange={setViewer}
        previousLabel={t('common.previous-image')}
        nextLabel={t('common.next-image')}
        onCopy={(src) => void copy(src)}
        onOpenFolder={nativeInstances ? (src) => { const path = shots().find((shot) => shot.src === src)?.path; if (path) void mutateNativeScreenshot(id(), path); } : undefined}
        onDelete={nativeInstances ? (src) => setDeleteShot(shots().find((shot) => shot.src === src)?.path) : undefined}
        showDelete={nativeInstances}
      />
      <Dialog closeLabel={t('nav.close')} title={t('common.delete')} description={t('management.delete-screenshot')} open={!!deleteShot()} onOpenChange={(open) => { if (!open && !deletingShot()) setDeleteShot(undefined); }} size="sm"
        footer={<><Button variant="ghost" disabled={deletingShot()} onClick={() => setDeleteShot(undefined)}>{t('common.cancel')}</Button><Button tone="danger" disabled={deletingShot()} onClick={() => void deleteScreenshot()}>{t('common.delete')}</Button></>} />
    </div>
  );
}
