import { Button, IconButton, ImageViewer } from "@vesta/ui";
import { For, Show, createSignal } from "solid-js";
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
} from "../../../features/instances/fixtures";
import { copyScreenshot } from "../../../features/instances/screenshot-clipboard";
import { t } from "../../../localization";
import "./overview-tab.css";

/**
 * Overview: what you came back for. The last world you played leads, with a way straight
 * into it; other worlds, the instance's health and recent screenshots follow.
 */
export function OverviewTab(props: { entry: InstanceEntry }) {
  const id = () => props.entry.instance.id;
  const worlds = () => worldsFor(id());
  const latest = () => worlds()[0];
  const others = () => worlds().slice(1, 5);
  const resources = () => resourcesFor(id());
  const updates = () => resources().filter((item) => item.update).length;
  const disabled = () => resources().filter((item) => !item.enabled).length;
  const stats = () => statsFor(id());
  const shots = () => screenshotsFor(id());
  const idle = () => props.entry.state.kind === "idle";
  const goto = (section: string) => navigate(`/library/${id()}/${section}`);

  const [viewer, setViewer] = createSignal<number | undefined>(undefined);
  const [copyStatus, setCopyStatus] = createSignal("");
  const copy = async (src: string) => {
    setCopyStatus("");
    try {
      await copyScreenshot(src);
      setCopyStatus(t("overview.screenshot-copied"));
    } catch {
      setCopyStatus(t("overview.screenshot-copy-failed"));
    }
  };

  return (
    <div data-vesta="overview">
      <Show
        when={latest()}
        fallback={
          <section data-vesta="overview-panel" class="overview-empty">
            <Icon name="icons/content/globe" size={20} />
            <div>
            <strong>{t("overview.no-worlds")}</strong>
              <p>{t("overview.create-or-import-world")}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => goto("worlds")}>
              {t("overview.go-to-worlds")}
            </Button>
          </section>
        }
      >
        {(world) => (
          <section data-vesta="overview-continue" aria-label={t("overview.continue-playing")}>
            <img src={world().image} alt="" draggable="false" />
            <div data-vesta="overview-continue-copy">
              <span data-vesta="overview-eyebrow">{t("overview.continue-playing")}</span>
              <strong>{world().name}</strong>
              <span data-vesta="overview-continue-meta">
                <span
                  data-vesta="mode-tag"
                  data-mode={world().mode.toLowerCase()}
                >
                  {world().mode}
                </span>
                {t("worlds.day-count", { count: world().days })} · {world().lastPlayed}
              </span>
            </div>
            <div data-vesta="overview-continue-actions">
              <Button
                variant="ghost"
                onClick={() => goto(`worlds/${world().id}`)}
              >
                {t("overview.manage")}
              </Button>
              <Button
                tone="accent"
                disabled={!idle()}
                icon={<Icon name="icons/actions/play" />}
                onClick={() => playInstance(id())}
              >
                {t("overview.play-world")}
              </Button>
            </div>
          </section>
        )}
      </Show>

      <div data-vesta="overview-columns">
        <section data-vesta="overview-panel" aria-labelledby="overview-worlds">
          <header data-vesta="overview-panel-header">
            <h2 id="overview-worlds">{t("overview.other-worlds")}</h2>
            <Button size="sm" variant="ghost" onClick={() => goto("worlds")}>
              {t("overview.view-all-count", { count: worlds().length })}
            </Button>
          </header>
          <Show
            when={others().length}
            fallback={<p data-vesta="overview-quiet">{t("overview.no-other-worlds")}</p>}
          >
            <ul data-vesta="overview-world-list">
              <For each={others()}>
                {(world) => (
                  <li>
                    <button
                      type="button"
                      data-vesta="overview-world"
                      onClick={() => goto(`worlds/${world.id}`)}
                    >
                      <img src={world.image} alt="" draggable="false" />
                      <span data-vesta="overview-world-name">{world.name}</span>
                      <span data-vesta="overview-world-meta">
                        <span
                          data-vesta="mode-tag"
                          data-mode={world.mode.toLowerCase()}
                        >
                          {world.mode}
                        </span>
                        {world.lastPlayed}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <section data-vesta="overview-panel" aria-labelledby="overview-status">
          <header data-vesta="overview-panel-header">
            <h2 id="overview-status">{t("overview.instance")}</h2>
          </header>
          <dl data-vesta="overview-facts">
            <div>
              <dt>{t("overview.played")}</dt>
              <dd>{formatPlaytime(stats().playtimeMinutes)}</dd>
            </div>
            <div>
              <dt>{t("overview.last-played")}</dt>
              <dd>{stats().lastPlayed}</dd>
            </div>
            <div>
              <dt>{t("overview.resources")}</dt>
              <dd>
                {resources().length}
                <Show when={disabled()}>
                  <span>{t("overview.off-count", { count: disabled() })}</span>
                </Show>
              </dd>
            </div>
            <div>
              <dt>{t("overview.memory")}</dt>
              <dd>{(stats().memoryMb / 1024).toFixed(1)} GB</dd>
            </div>
          </dl>
          <Show when={updates()}>
            <div data-vesta="overview-updates">
              <span>
                {t(updates() === 1 ? "overview.update-one" : "overview.update-other", { count: updates() })}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => goto("resources")}
              >
                {t("common.review")}
              </Button>
            </div>
          </Show>
        </section>
      </div>

      <Show when={shots().length}>
        <section aria-labelledby="overview-shots">
          <header data-vesta="overview-panel-header">
            <h2 id="overview-shots">{t("overview.screenshots")}</h2>
            <span data-vesta="overview-quiet">{shots().length}</span>
          </header>
          <ul data-vesta="shot-grid">
            <For each={shots().slice(0, 4)}>
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
        onCopy={(src) => void copy(src)}
        showDelete={false}
      />
    </div>
  );
}
