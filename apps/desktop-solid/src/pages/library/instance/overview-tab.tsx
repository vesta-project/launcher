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
      setCopyStatus("Screenshot copied");
    } catch {
      setCopyStatus("Could not copy screenshot");
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
              <strong>No worlds yet</strong>
              <p>Start the game to create one, or bring in an existing save.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => goto("worlds")}>
              Go to worlds
            </Button>
          </section>
        }
      >
        {(world) => (
          <section data-vesta="overview-continue" aria-label="Continue playing">
            <img src={world().image} alt="" draggable="false" />
            <div data-vesta="overview-continue-copy">
              <span data-vesta="overview-eyebrow">Continue playing</span>
              <strong>{world().name}</strong>
              <span data-vesta="overview-continue-meta">
                <span
                  data-vesta="mode-tag"
                  data-mode={world().mode.toLowerCase()}
                >
                  {world().mode}
                </span>
                Day {world().days} · {world().lastPlayed}
              </span>
            </div>
            <div data-vesta="overview-continue-actions">
              <Button
                variant="ghost"
                onClick={() => goto(`worlds/${world().id}`)}
              >
                Manage
              </Button>
              <Button
                tone="accent"
                disabled={!idle()}
                icon={<Icon name="icons/actions/play" />}
                onClick={() => playInstance(id())}
              >
                Play world
              </Button>
            </div>
          </section>
        )}
      </Show>

      <div data-vesta="overview-columns">
        <section data-vesta="overview-panel" aria-labelledby="overview-worlds">
          <header data-vesta="overview-panel-header">
            <h2 id="overview-worlds">Other worlds</h2>
            <Button size="sm" variant="ghost" onClick={() => goto("worlds")}>
              View all {worlds().length}
            </Button>
          </header>
          <Show
            when={others().length}
            fallback={<p data-vesta="overview-quiet">No other worlds.</p>}
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
            <h2 id="overview-status">Instance</h2>
          </header>
          <dl data-vesta="overview-facts">
            <div>
              <dt>Played</dt>
              <dd>{formatPlaytime(stats().playtimeMinutes)}</dd>
            </div>
            <div>
              <dt>Last played</dt>
              <dd>{stats().lastPlayed}</dd>
            </div>
            <div>
              <dt>Resources</dt>
              <dd>
                {resources().length}
                <Show when={disabled()}>
                  <span> · {disabled()} off</span>
                </Show>
              </dd>
            </div>
            <div>
              <dt>Memory</dt>
              <dd>{(stats().memoryMb / 1024).toFixed(1)} GB</dd>
            </div>
          </dl>
          <Show when={updates()}>
            <div data-vesta="overview-updates">
              <span>
                {updates()} {updates() === 1 ? "update" : "updates"} available
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => goto("resources")}
              >
                Review
              </Button>
            </div>
          </Show>
        </section>
      </div>

      <Show when={shots().length}>
        <section aria-labelledby="overview-shots">
          <header data-vesta="overview-panel-header">
            <h2 id="overview-shots">Screenshots</h2>
            <span data-vesta="overview-quiet">{shots().length}</span>
          </header>
          <ul data-vesta="shot-grid">
            <For each={shots().slice(0, 4)}>
              {(shot, index) => (
                <li data-vesta="shot-item">
                  <button
                    type="button"
                    data-vesta="shot"
                    aria-label={`Open ${shot.title}`}
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
                    label={`Copy ${shot.title}`}
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
