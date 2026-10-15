import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import type { JSX } from '@solidjs/web';
import type { Story, StoryMeta } from './story';
import { applyTheme, themes } from './themes';
import { OverlayMount } from '@vesta/ui';

// ---- Story discovery ------------------------------------------------------

interface Entry {
  slug: string;
  name: string;
  story: Story;
}
interface Component {
  slug: string;
  group: string;
  name: string;
  description?: string;
  stories: Entry[];
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
const isStory = (v: unknown): v is Story =>
  typeof v === 'object' && v !== null && typeof (v as Story).render === 'function';

const modules = import.meta.glob<{ default?: StoryMeta }>(
  ['../ui/**/*.stories.tsx', '../src/**/*.stories.tsx'],
  { eager: true },
);

function discover(): Component[] {
  const found: Component[] = [];
  for (const mod of Object.values(modules)) {
    const meta = mod.default;
    if (!meta?.title) continue;
    const [group, ...rest] = meta.title.split('/');
    const stories = Object.entries(meta.stories ?? {})
      .filter(([, story]) => isStory(story))
      .map(([key, story]) => {
        const spaced = words(key);
        return {
          slug: slugify(spaced.replace(/ /g, '-')),
          name: story.name ?? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase(),
          story,
        };
      });
    found.push({
      slug: slugify(meta.title),
      group: rest.length ? group : '',
      name: rest.length ? rest.join('/') : group,
      description: meta.description,
      stories,
    });
  }
  return found.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

const components = discover();
const groups = [...new Set(components.map((c) => c.group))].map((group) => ({
  group,
  items: components.filter((c) => c.group === group),
}));

// ---- Persisted preferences ------------------------------------------------

type Scheme = 'dark' | 'light' | 'both';
const backdrops = [
  { id: 'plain', label: 'Plain' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'busy', label: 'Busy' },
] as const;
type Backdrop = (typeof backdrops)[number]['id'];
interface Prefs {
  scheme: Scheme;
  backdrop: Backdrop;
  theme: string;
  hue?: number;
  zoom: number;
}
const STORAGE_KEY = 'vesta-workbench';

function loadPrefs(): Prefs {
  const defaults: Prefs = { scheme: 'dark', backdrop: 'plain', theme: themes[0].id, zoom: 100 };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

// ---- Shell ------------------------------------------------------------------

export function Workbench() {
  const saved = loadPrefs();
  const [scheme, setScheme] = createSignal<Scheme>(saved.scheme, { name: 'scheme' });
  const [backdrop, setBackdrop] = createSignal<Backdrop>(
    backdrops.some((b) => b.id === saved.backdrop) ? saved.backdrop : 'plain',
    { name: 'backdrop' },
  );
  const [themeId, setThemeId] = createSignal(saved.theme, { name: 'theme' });
  const [hue, setHue] = createSignal<number | undefined>(saved.hue, { name: 'hue' });
  const [zoom, setZoom] = createSignal(saved.zoom, { name: 'zoom' });
  const [hash, setHash] = createSignal(location.hash, { name: 'hash' });

  const theme = createMemo(() => themes.find((t) => t.id === themeId()) ?? themes[0]);
  untrack(() => applyTheme(theme())); // before first paint; the effect below handles changes
  createEffect(theme, applyTheme);
  createEffect(
    () => JSON.stringify({ scheme: scheme(), backdrop: backdrop(), theme: themeId(), hue: hue(), zoom: zoom() }),
    (json) => localStorage.setItem(STORAGE_KEY, json),
  );

  const onHashChange = () => setHash(location.hash);
  window.addEventListener('hashchange', onHashChange);
  onCleanup(() => window.removeEventListener('hashchange', onHashChange));

  const route = createMemo(() => {
    const [compSlug, storySlug] = hash().replace(/^#\/?/, '').split('/');
    const component = components.find((c) => c.slug === compSlug) ?? components[0];
    const entry = component?.stories.find((s) => s.slug === storySlug);
    return { component, entry };
  });
  const visible = createMemo(() => {
    const { component, entry } = route();
    return entry ? [entry] : (component?.stories ?? []);
  });

  const schemes = createMemo<('dark' | 'light')[]>(() =>
    scheme() === 'both' ? ['dark', 'light'] : [scheme() as 'dark' | 'light'],
  );
  const hueEnabled = () => !!theme().supportsAccentHue;

  return (
    <div class="wb-app">
      <nav class="wb-sidebar">
        <div class="wb-brand">Vesta UI Workbench</div>
        <For each={groups}>
          {(g) => (
            <div class="wb-group">
              <Show when={g.group}>
                <div class="wb-group-title">{g.group}</div>
              </Show>
              <For each={g.items}>
                {(c) => (
                  <>
                    <a
                      class={['wb-nav-item', { 'wb-active': route().component === c && !route().entry }]}
                      href={`#/${c.slug}`}
                    >
                      {c.name}
                    </a>
                    <Show when={route().component === c}>
                      <For each={c.stories}>
                        {(s) => (
                          <a
                            class={['wb-nav-item', 'wb-nav-story', { 'wb-active': route().entry === s }]}
                            href={`#/${c.slug}/${s.slug}`}
                          >
                            {s.name}
                          </a>
                        )}
                      </For>
                    </Show>
                  </>
                )}
              </For>
            </div>
          )}
        </For>
      </nav>

      <div class="wb-main">
        <header class="wb-toolbar">
          <div class="wb-field">
            <span class="wb-label">Scheme</span>
            <div class="wb-segmented">
              <For each={['dark', 'light', 'both'] as const}>
                {(s) => (
                  <button
                    type="button"
                    class={{ 'wb-active': scheme() === s }}
                    onClick={() => setScheme(s)}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                )}
              </For>
            </div>
          </div>
          <label class="wb-field">
            <span class="wb-label">Backdrop</span>
            <select onChange={(e) => setBackdrop(e.currentTarget.value as Backdrop)}>
              <For each={backdrops}>
                {(b) => (
                  <option value={b.id} selected={b.id === backdrop()}>
                    {b.label}
                  </option>
                )}
              </For>
            </select>
          </label>
          <label class="wb-field">
            <span class="wb-label">Theme</span>
            <select onChange={(e) => setThemeId(e.currentTarget.value)}>
              <For each={themes}>
                {(t) => (
                  <option value={t.id} selected={t.id === themeId()}>
                    {t.label}
                  </option>
                )}
              </For>
            </select>
          </label>
          <label class="wb-field">
            <span class="wb-label">Accent hue</span>
            <input
              type="range"
              min="0"
              max="360"
              disabled={!hueEnabled()}
              value={hue() ?? 0}
              onInput={(e) => setHue(e.currentTarget.valueAsNumber)}
            />
            <span class="wb-value">{hue() ?? 'auto'}</span>
            <button type="button" disabled={!hueEnabled() || hue() === undefined} onClick={() => setHue(undefined)}>
              Reset
            </button>
          </label>
          <label class="wb-field">
            <span class="wb-label">Zoom</span>
            <select onChange={(e) => setZoom(Number(e.currentTarget.value))}>
              <For each={[100, 125, 150]}>
                {(z) => (
                  <option value={z} selected={z === zoom()}>
                    {z}%
                  </option>
                )}
              </For>
            </select>
          </label>
        </header>

        <main class={['wb-canvas', { 'wb-canvas-both': scheme() === 'both' }]}>
          <Show when={components.length} fallback={<div class="wb-empty">No stories found</div>}>
            <For each={schemes()}>
              {(s) => (
                <div
                  class="wb-scheme"
                  data-vesta-scheme={s}
                  data-wb-backdrop={backdrop()}
                  style={hueEnabled() && hue() !== undefined ? { '--vesta-accent-hue': hue(), '--vesta-neutral-hue': hue() } : undefined}
                >
                  <SchemeOverlays>
                    <div class="wb-content" style={{ zoom: zoom() / 100 }}>
                      <Show when={!route().entry && route().component?.description}>
                        <p class="wb-story-description">{route().component?.description}</p>
                      </Show>
                      <For each={visible()}>{(entry) => <StoryView entry={entry} />}</For>
                    </div>
                  </SchemeOverlays>
                </div>
              )}
            </For>
          </Show>
        </main>
      </div>
    </div>
  );
}

function StoryView(props: { entry: Entry }): JSX.Element {
  return (
    <section class="wb-story">
      <h2 class="wb-story-title">{props.entry.name}</h2>
      <Show when={props.entry.story.description}>
        <p class="wb-story-description">{props.entry.story.description}</p>
      </Show>
      <div class={['wb-story-body', { 'wb-padded': props.entry.story.layout !== 'fullscreen' }]}>
        {props.entry.story.render()}
      </div>
    </section>
  );
}

/** Portals menus/dialogs into this scheme root so overlays inherit its scheme and backdrop tokens. */
function SchemeOverlays(props: { children: JSX.Element }): JSX.Element {
  const mount = (<div class="wb-overlay-root" />) as HTMLDivElement;
  return (
    <>
      <OverlayMount mount={mount}>{props.children}</OverlayMount>
      {mount}
    </>
  );
}
