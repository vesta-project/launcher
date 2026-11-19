import { createEffect, createSignal } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { createResourceImageQueue } from './resource-image-queue';
import { createImageCacheReader } from './resource-image-cache';
import { invoke, isTauri } from '@tauri-apps/api/core';

let nativeIconsAvailable = true;
async function iconSource(url: string) {
  if (!isTauri() || !nativeIconsAvailable || !url.startsWith('https://')) return url;
  try { return await invoke<string>('resolve_resource_image', { url }); }
  catch (reason) {
    // HMR can update the frontend while an older native binary is still running.
    if (/resolve_resource_image.*not found/i.test(String(reason))) {
      nativeIconsAvailable = false; return url;
    }
    throw reason;
  }
}
async function loadImage(url: string, priority: number) {
  const source = priority >= 2 ? url : await iconSource(url);
  // Native has already fetched the bytes. Let the real <img> decode them;
  // decoding another hidden Image first delays presentation and duplicates work.
  if (source.startsWith('data:') || source.startsWith('asset:')) return source;
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async'; image.fetchPriority = priority === 0 ? 'high' : 'low';
    const finish = (ok: boolean) => {
      clearTimeout(timer); image.onload = image.onerror = null;
      if (ok) resolve(); else { image.src = ''; reject(new Error('Resource icon unavailable')); }
    };
    const timer = setTimeout(() => finish(false), 8000);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = source;
  });
  return source;
}
const queue = createResourceImageQueue(loadImage);
// A banner may share its URL with an icon. Keep original images separate from
// the thumbnail cache, and keep their larger downloads out of visible icon slots.
const backgrounds = createResourceImageQueue(loadImage, 1);
const readCached = createImageCacheReader(urls => invoke<Record<string, string>>('get_cached_resource_images', { urls }));

type PriorityListener = (priority: number) => void;
type Visibility = { near: boolean; visible: boolean; listeners: Set<PriorityListener> };
const watched = new Map<Element, Visibility>();
let nearObserver: IntersectionObserver | undefined, visibleObserver: IntersectionObserver | undefined;
function observe(element: Element, update: PriorityListener) {
  if (typeof IntersectionObserver === 'undefined') { update(0); return () => {}; }
  const receive = (entries: IntersectionObserverEntry[], field: 'near' | 'visible') => {
    for (const entry of entries) {
      const state = watched.get(entry.target);
      if (!state) continue;
      state[field] = entry.isIntersecting;
      for (const listener of state.listeners) listener(state.visible ? 0 : state.near ? 1 : 2);
    }
  };
  // Expand nested scroll containers as well as the viewport so Browse can warm the next rows.
  nearObserver ??= new IntersectionObserver(entries => receive(entries, 'near'), {
    rootMargin: '520px', scrollMargin: '520px',
  } as IntersectionObserverInit);
  visibleObserver ??= new IntersectionObserver(entries => receive(entries, 'visible'));
  // Offscreen cards skip laying out descendants. Observe the card box to warm all its artwork.
  const target = element.closest('[data-vesta="browse-card"]') ?? element;
  let state = watched.get(target);
  if (!state) {
    state = { near: false, visible: false, listeners: new Set() };
    watched.set(target, state);
    nearObserver.observe(target); visibleObserver.observe(target);
  }
  state.listeners.add(update);
  update(state.visible ? 0 : state.near ? 1 : 2);
  return () => {
    state.listeners.delete(update);
    if (state.listeners.size) return;
    watched.delete(target); nearObserver?.unobserve(target); visibleObserver?.unobserve(target);
    if (!watched.size) { nearObserver?.disconnect(); visibleObserver?.disconnect(); }
  };
}

type Props = Pick<JSX.ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'width' | 'height' | 'class' | 'draggable' | 'loading' | 'decoding' | 'onLoad' | 'onError'>
  & { src?: string | null; background?: boolean; 'data-backdrop'?: string };

/** Resource thumbnails share visibility priority, URL deduplication and a bounded decode cache. */
export function ResourceImage(props: Props) {
  const [element, setElement] = createSignal<HTMLImageElement>();
  const [priority, setPriority] = createSignal(2);
  const [shown, setShown] = createSignal<string>();
  let currentUrl: string | null | undefined;
  createEffect(element, node => node ? observe(node, setPriority) : undefined);
  createEffect(() => ({ url: props.src, priority: priority(), background: props.background }), ({ url, priority, background }) => {
    if (url !== currentUrl) { currentUrl = url; setShown(undefined); }
    if (!url || priority > 1) return;
    const images = background ? backgrounds : queue;
    let active = true;
    let lease: { dispose(): void } | undefined;
    const enqueue = () => {
      if (!active) return;
      lease = images.request(url, priority + (background ? 2 : 0), (ok, source) => { if (ok) setShown(source ?? url); });
    };
    const known = images.peek(url);
    if (known) setShown(known);
    else if (url.startsWith('data:') || url.startsWith('asset:')) setShown(url);
    else if (!background && isTauri() && url.startsWith('https://')) {
      void readCached(url).then(source => {
        if (!active) return;
        if (source) { images.remember(url, source); setShown(source); }
        else enqueue();
      });
    } else enqueue();
    return () => { active = false; lease?.dispose(); };
  });
  return <img ref={setElement} src={shown()} alt={props.alt ?? ''} width={props.width} height={props.height}
    class={props.class} draggable={props.draggable} data-backdrop={props['data-backdrop']}
    loading="eager" decoding="async" style={{ visibility: shown() ? undefined : 'hidden' }}
    onLoad={props.onLoad} onError={props.onError} />;
}
