import type { JSX } from '@solidjs/web';
import { For, Show, createMemo, createSignal, onSettled, untrack } from 'solid-js';
import art1 from '../../assets/images/placeholders/placeholder-image1.jpg';
import art2 from '../../assets/images/placeholders/placeholder-image2.png';
import art3 from '../../assets/images/placeholders/placeholder-image3.png';
import art4 from '../../assets/images/placeholders/placeholder-image4.png';
import art5 from '../../assets/images/placeholders/placeholder-image5.png';
import { Icon } from '../../components/icon';
import { activeAccount, usePlayerHead } from '../../features/accounts/accounts';
import type { SceneName } from '../../features/whats-new';
import { resolveThemeTokens, themePresets, type ThemeValues } from '../../features/settings/theme-model';
import { setting } from '../../features/settings/config';
import { t } from '../../localization';
import { searchResources } from '../../features/browse/browse-api';
import { hostQuery, normalizeQuery, type ResourceType } from '../../features/browse/browse-model';
import { resolvedScheme } from '../preferences';
import './scenes.css';

/**
 * The little pictures behind each highlight: real launcher screens, drawn small. Each is laid out
 * at desktop size and scaled to the stage, so spacing, type and corners keep their true
 * proportions. They play from the start whenever their highlight comes round (the reel remounts
 * them), and with reduced motion each rests on its finished frame.
 */
export function Scene(props: { name: SceneName }) {
  return (
    <div data-vesta="scene" data-scene={props.name} aria-hidden="true">
      {props.name === 'paint' ? <PaintScene />
        : props.name === 'server' ? <ServerScene />
          : props.name === 'join' ? <JoinScene />
            : <SpeedScene />}
    </div>
  );
}


/** Lays its child out `width` px wide and scales it to whatever room the stage has. */
function Fit(props: { width: number; height: number; children: JSX.Element }) {
  let outer: HTMLDivElement | undefined;
  const width = untrack(() => props.width);
  onSettled(() => {
    const element = outer;
    if (!element) return;
    const fit = () => element.style.setProperty('--scene-k', String(element.clientWidth / width));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  });
  return (
    <div data-vesta="scene-fit" ref={(element: HTMLDivElement) => (outer = element)}
      style={{ '--scene-w': `${props.width}px`, '--scene-h': `${props.height}px`, 'aspect-ratio': `${props.width} / ${props.height}` }}>
      <div data-vesta="scene-fit-body">{props.children}</div>
    </div>
  );
}

type Place = 'library' | 'browse' | 'servers';

/** The launcher's frame: rail on the left, titlebar along the top, the board in the middle. */
function Window(props: { place: Place; crumbs: string[]; instances: string[]; children: JSX.Element; joined?: JSX.Element; corner?: string }) {
  // Your own head where the account sits in the rail, as in the real launcher.
  const head = usePlayerHead(() => activeAccount()?.uuid);
  const rail: [Place | 'create', string][] = [['library', 'icons/rail/library'], ['create', 'icons/actions/add'], ['browse', 'icons/rail/browse'], ['servers', 'icons/rail/servers']];
  return (
    <div data-vesta="scene-window">
      <nav data-vesta="scene-rail">
        <span data-vesta="scene-rail-head">
          <Show when={head()}>{(url) => <img src={url()} alt="" />}</Show>
        </span>
        <For each={rail}>
          {([place, icon]) => <span data-vesta="scene-rail-item" data-current={place === props.place ? '' : undefined}><Icon name={icon as never} size={18} /></span>}
        </For>
        <span data-vesta="scene-rail-rule" />
        <For each={props.instances}>{(art) => <img data-vesta="scene-rail-instance" src={art} alt="" />}</For>
        {props.joined}
        <span data-vesta="scene-rail-gap" />
        <span data-vesta="scene-rail-item"><Icon name="icons/rail/settings" size={18} /></span>
      </nav>
      <header data-vesta="scene-titlebar">
        <For each={props.crumbs}>
          {(crumb, index) => (
            <>
              <Show when={index() > 0}><Icon name="icons/controls/chevron-right" size={12} /></Show>
              <span data-current={index() === props.crumbs.length - 1 ? '' : undefined}>{crumb}</span>
            </>
          )}
        </For>
        <Show when={props.corner}>{(corner) => <span data-vesta="scene-corner">{corner()}</span>}</Show>
      </header>
      <main data-vesta="scene-board">{props.children}</main>
    </div>
  );
}

const instanceCards = [
  { name: 'Survival', meta: '1.21.4', art: art1 },
  { name: 'Create Skyblock', meta: '1.20.1', art: art2 },
  { name: 'Modded Survival', meta: '1.21.4', art: art3 },
  { name: 'Vanilla Snapshot', meta: '24w44a', art: art4 },
  { name: 'Aero SMP', meta: '1.21.1', art: art4 },
  { name: 'Creative Builds', meta: '1.21.4', art: art2 },
  { name: 'PvP Practice', meta: '1.8.9', art: art5 },
  { name: 'Old Friends Pack', meta: '1.12.2', art: art3 },
];

function LibraryBoard() {
  return (
    <ul data-vesta="scene-library">
      <For each={instanceCards}>
        {(card, index) => (
          <li data-vesta="scene-card" data-current={index() === 0 ? '' : undefined} style={{ 'background-image': `url(${card.art})` }}>
            <Show when={index() === 0}>
              <span data-vesta="scene-play"><Icon name="icons/actions/play" size={14} /></span>
            </Show>
            <b>{card.name}</b>
            <small>{card.meta}</small>
          </li>
        )}
      </For>
    </ul>
  );
}

/**
 * The same library under a few of the built-in themes, one after another. Each copy carries
 * that theme's real tokens (like the previews in Appearance), so what changes is exactly what
 * choosing it changes. The first is the theme in use, which is where the story rests.
 */
function PaintScene() {
  const looks = createMemo(() => {
    const current = setting('theme_id');
    const scheme = resolvedScheme();
    const others = themePresets.filter((preset) => preset.id !== current && preset.id !== 'haze');
    const picks = [themePresets.find((preset) => preset.id === current) ?? themePresets[0]!, ...others].slice(0, 5);
    return picks.map((preset, index) => ({
      name: preset.name,
      // One of them in the other colour mode, so the picture shows that too.
      scheme: index === picks.length - 1 ? (scheme === 'dark' ? 'light' : 'dark') : scheme,
      tokens: index === 0 ? undefined : resolveThemeTokens(preset.values as ThemeValues),
      neutral: preset.definition.hue === null,
    }));
  }, { name: 'scene:paint-looks' });
  return (
    <For each={looks()}>
      {(look, index) => (
        <div data-vesta="scene-paint-look" style={{ '--i': index(), '--n': looks().length }}>
          <Fit width={820} height={470}>
            <div data-vesta="scene-themed" data-vesta-scheme={look.scheme} data-vesta-accent={look.neutral ? 'neutral' : 'hue'} style={look.tokens}>
              <Window place="library" crumbs={[t('nav.library')]} instances={[art1, art2, art3]} corner={look.name}>
                <LibraryBoard />
              </Window>
            </div>
          </Fit>
        </div>
      )}
    </For>
  );
}

const consoleLines: [string, string, string?][] = [
  ['18:02:11', 'Starting minecraft server version 1.21.4'],
  ['18:02:14', 'Preparing level "world"'],
  ['18:02:17', 'Done (3.2s)! For help, type "help"', 'done'],
  ['18:04:39', 'Steve joined the game'],
  ['18:05:02', 'Kai_builds joined the game'],
  ['18:05:20', '<Kai_builds> anyone got spare iron?'],
  ['18:05:33', "Can't keep up! Is the server overloaded? Running 2034ms or 40 ticks behind", 'warn'],
  ['18:05:41', 'RedstoneRae joined the game'],
  ['18:05:58', '[Server] Welcome in, Rae'],
];

/** A server coming up in its own console: it starts, people join, and you talk to them from here. */
function ServerScene() {
  const tabs: [string, string][] = [['servers.tab.overview', 'icons/navigation/home'], ['servers.tab.console', 'icons/content/terminal'], ['servers.tab.players', 'icons/content/people'], ['servers.tab.backups', 'icons/content/storage'], ['servers.tab.automation', 'icons/content/timer']];
  return (
    <Fit width={760} height={424}>
      <Window place="servers" crumbs={[t('nav.servers'), t('whats-new.scene-server-name'), t('servers.tab.console')]} instances={[art5, art1]}>
        <div data-vesta="scene-server">
          <header data-vesta="scene-server-head" style={{ 'background-image': `url(${art1})` }}>
            <span data-vesta="scene-server-icon">RS</span>
            <span data-vesta="scene-server-who">
              <b>{t('whats-new.scene-server-name')}</b>
              <small>
                <span data-vesta="scene-server-status">
                  <i />
                  <span data-vesta="scene-server-starting">{t('servers.lifecycle.starting')}</span>
                  <span data-vesta="scene-server-online">{t('whats-new.scene-server-online')}</span>
                </span>
                1.21.4
              </small>
            </span>
            {/* The same two buttons, icons and tones as a real server's header. */}
            <span data-vesta="scene-button" data-tone="outline"><Icon name="icons/actions/reload" size={14} />{t('servers.lifecycle.restart')}</span>
            <span data-vesta="scene-button" data-tone="quiet"><Icon name="icons/actions/stop" size={14} />{t('servers.lifecycle.stop')}</span>
          </header>
          <div data-vesta="scene-server-body">
            <ul data-vesta="scene-server-tabs">
              <For each={tabs}>
                {([label, icon], index) => <li data-current={index() === 1 ? '' : undefined}><Icon name={icon as never} size={14} />{t(label as never)}</li>}
              </For>
            </ul>
            {/* Drawn like the real console: a search strip, flush 20px lines that push the
                older ones up as they arrive, warnings tinted, and the command row. */}
            <div data-vesta="scene-console">
              <span data-vesta="scene-console-bar"><span data-vesta="scene-console-search">{t('console.search-log')}</span></span>
              <ol>
                <For each={consoleLines}>
                  {([time, text, kind], index) => <li data-kind={kind} style={{ '--i': index() }}><time>{time}</time><span>{text}</span></li>}
                </For>
              </ol>
              <span data-vesta="scene-console-input">
                <span data-vesta="scene-console-prompt" aria-hidden="true">›</span>
                <span data-vesta="scene-console-field"><span data-vesta="scene-console-typed">say Welcome in, Rae</span></span>
                <span data-vesta="scene-button" data-tone="quiet">{t('servers.console.send')}</span>
              </span>
            </div>
          </div>
        </div>
      </Window>
    </Fit>
  );
}

interface SceneListing { name: string; players: [number, number]; pack: string | null; art: string }
interface SceneResult { name: string; summary: string; icon: string | null }

// What the scenes show when Modrinth can't be reached (offline, or the browser preview).
const sampleListings: SceneListing[] = [
  { name: 'Hearthstead SMP', players: [214, 500], pack: 'Cobblemon', art: art2 },
  { name: 'Pixel Plains', players: [88, 200], pack: 'Fabulously Optimized', art: art3 },
  { name: 'Northwatch', players: [41, 100], pack: 'Prominence II RPG', art: art4 },
];
const sampleResults: Record<string, [string, string][]> = {
  performance: [['Sodium', 'Rendering engine with big frame rate gains'], ['Lithium', 'General-purpose optimisation for the game'], ['FerriteCore', 'Uses less memory'], ['ModernFix', 'Faster launch, less memory'], ['Entity Culling', "Skips drawing what you can't see"], ['ImmediatelyFast', 'Speeds up immediate-mode rendering']],
  minimap: [["Xaero's Minimap", 'A minimap that keeps up with you'], ['JourneyMap', 'Real-time mapping in game or a browser'], ['VoxelMap', 'Minimap and world map'], ['Antique Atlas', 'A hand-drawn world map book'], ['Map Atlases', 'Atlases that fill in as you explore'], ['FTB Chunks', 'Minimap with chunk claiming']],
};
const queries = ['performance', 'minimap'] as const;

/*
 * Real listings from Modrinth, through Browse's own search, fetched once per session the first
 * time a scene that needs them is shown. Until they arrive (or if they can't), the samples above.
 */
const [liveListings, setLiveListings] = createSignal<SceneListing[] | null>(null, { name: 'scene:live-listings' });
const [liveResults, setLiveResults] = createSignal<Record<string, SceneResult[]> | null>(null, { name: 'scene:live-results' });
let fetched = false;
const search = (type: ResourceType, text: string, sort: string, size: number) =>
  searchResources('modrinth', hostQuery(normalizeQuery({
    type, source: 'modrinth', text, gameVersion: null, loader: null, client: false, server: false, creator: null,
    categories: [], sort, sortOrder: 'desc', pageSize: size, page: 1,
  })));
function fetchLive() {
  if (fetched) return;
  fetched = true;
  void search('server', '', 'relevance', 3).then((response) => {
    const servers = response.hits.filter((hit) => hit.server?.ping).slice(0, 3);
    if (servers.length < 3) return;
    setLiveListings(servers.map((hit, index) => ({
      name: hit.name,
      players: [hit.server!.ping!.online, hit.server!.ping!.max],
      pack: hit.server!.content.kind === 'modpack' ? hit.server!.content.projectName : null,
      art: hit.icon_url ?? [art2, art3, art4][index]!,
    })));
  }).catch(() => {});
  void Promise.all(queries.map((text) => search('mod', text, 'relevance', 6))).then((responses) => {
    if (responses.some((response) => response.hits.length < 6)) return;
    setLiveResults(Object.fromEntries(queries.map((text, index) => [text, responses[index]!.hits.slice(0, 6)
      .map((hit) => ({ name: hit.name, summary: hit.summary, icon: hit.icon_url }))])));
  }).catch(() => {});
}
const listings = () => liveListings() ?? sampleListings;
const results = (text: string): SceneResult[] =>
  liveResults()?.[text] ?? sampleResults[text]!.map(([name, summary]) => ({ name, summary, icon: null }));

/** Browse lists servers with who's on; Install & play sets the pack up and the instance lands in the rail. */
function JoinScene() {
  fetchLive();
  return (
    <Fit width={780} height={470}>
      <Window place="browse" crumbs={[t('nav.browse'), t('browse.type-server')]} instances={[art1, art5]}
        joined={<img data-vesta="scene-rail-instance" data-joined="" src={art2} alt="" />}>
        <div data-vesta="scene-browse">
          <span data-vesta="scene-search"><Icon name="icons/content/search" size={14} /><span>{t('browse.type-server')}</span></span>
          <ul data-vesta="scene-listings">
            <For each={listings()}>
              {(listing, index) => (
                <li data-vesta="scene-listing" data-current={index() === 0 ? '' : undefined}>
                  <img src={listing.art} alt="" />
                  <span data-vesta="scene-listing-text">
                    <b>{listing.name}</b>
                    <small><i data-vesta="scene-live" />{t('browse.server-players', { count: listing.players[0]!, max: listing.players[1]! })}</small>
                    <Show when={listing.pack}>{(pack) => <small>{t('browse.server-modpack', { name: pack() })}</small>}</Show>
                  </span>
                  <Show when={index() === 0} fallback={<span data-vesta="scene-button" data-tone="outline">{t('browse.server-play')}</span>}>
                    <span data-vesta="scene-join-button">
                      <span data-vesta="scene-join-install"><Icon name="icons/actions/download" size={14} />{t('browse.server-install-play')}</span>
                      <span data-vesta="scene-join-play"><Icon name="icons/actions/play" size={14} />{t('browse.server-play')}</span>
                    </span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Window>
    </Fit>
  );
}

/** Browse answering at once: each search lands with its results already there. */
function SpeedScene() {
  fetchLive();
  return (
    <Fit width={780} height={470}>
      <Window place="browse" crumbs={[t('nav.browse'), t('browse.type-mod')]} instances={[art1, art5]}>
        <div data-vesta="scene-browse">
          <span data-vesta="scene-search">
            <Icon name="icons/content/search" size={14} />
            <For each={[...queries]}>{(text, index) => <span data-vesta="scene-speed-query" data-set={index()}>{text}</span>}</For>
          </span>
          <For each={[...queries]}>
            {(text, set) => (
              <ul data-vesta="scene-speed-results" data-set={set()}>
                <For each={results(text)}>
                  {(result, index) => (
                    <li data-vesta="scene-result" style={{ '--r': index() }}>
                      <Show when={result.icon} fallback={<span data-vesta="scene-result-initial" style={{ '--tint': (set() * 6 + index()) * 47 }}>{result.name.charAt(0)}</span>}>
                        {(icon) => <img data-vesta="scene-result-icon" src={icon()} alt="" />}
                      </Show>
                      <span data-vesta="scene-listing-text">
                        <b>{result.name}</b>
                        <small>{result.summary}</small>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            )}
          </For>
        </div>
      </Window>
    </Fit>
  );
}
