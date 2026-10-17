import type { SkinVariant } from './skins';
import { drawSkin } from './skins';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const MAX_ENTRIES = 300;
const SCALE = 6;

/** Front render of a skin as a PNG data URL, cached in memory by texture URL and arm model. */
export function skinThumb(skin: string, variant: SkinVariant): Promise<string> {
  const key = `${variant}|${skin}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  let job = inflight.get(key);
  if (!job) {
    job = (async () => {
      const canvas = document.createElement('canvas');
      if (!(await drawSkin(canvas, { skin, variant, views: 'front', scale: SCALE }))) return '';
      const url = canvas.toDataURL('image/png');
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(key, url);
      return url;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

export const cachedSkinThumb = (skin: string, variant: SkinVariant) => cache.get(`${variant}|${skin}`);
