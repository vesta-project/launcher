import { invoke, isTauri } from '@tauri-apps/api/core';
import { createEffect, createSignal, onSettled, untrack } from 'solid-js';
import type { Account } from './account-bootstrap';

export type SkinVariant = 'classic' | 'slim';

export interface LibrarySkin {
  id: number;
  name: string;
  variant: SkinVariant;
  /** PNG data URL. */
  image: string;
}

export interface Cape {
  id: string;
  name: string;
  url: string;
}

export interface SkinProfile {
  skin?: string;
  variant: SkinVariant;
  cape?: string;
  capeId?: string;
  capes: Cape[];
  library: LibrarySkin[];
}

/** Only Microsoft accounts have a Mojang profile to change. */
export const canManageSkin = (account?: Pick<Account, 'account_type'>) =>
  account?.account_type.toLowerCase() === 'microsoft';

const native = typeof window !== 'undefined' && isTauri();
const PNG = 'data:image/png;base64,';

const variantOf = (value?: string | null): SkinVariant => (String(value ?? '').toLowerCase() === 'slim' ? 'slim' : 'classic');
// Mojang can supply HTTP texture URLs. Upgrade those without widening the image CSP.
const textureUrl = (value: string) => value.replace(/^http:\/\/textures\.minecraft\.net\//i, 'https://textures.minecraft.net/');
const asImage = (value?: string | null) => (value ? (/^(data:|https?:|asset:|blob:)/.test(value) ? textureUrl(value) : PNG + value) : undefined);

interface NativeLibrarySkin { id: number; name: string; variant: string; image_data: string }
interface NativeProfile {
  current_skin_base64: string | null;
  current_cape_base64: string | null;
  current_cape_profile_id: string | null;
  current_variant: string;
  recent_history: NativeLibrarySkin[];
  capes: { id: string; url: string; alias: string }[];
}

// Browser fixtures: procedurally drawn skins so the panel is testable without a backend.
function fixtureSkin(body: string, accent: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const fill = (color: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  fill('#e0b090', 0, 0, 64, 16); fill('#3b2a20', 8, 0, 16, 8); fill(accent, 20, 16, 36, 16); fill(body, 0, 16, 16, 16);
  fill('#e0b090', 8, 8, 8, 8); fill('#2a2a3a', 10, 11, 1, 1); fill('#2a2a3a', 13, 11, 1, 1);
  fill(accent, 20, 20, 8, 12); fill(body, 4, 20, 4, 12); fill(body, 44, 20, 4, 12); fill(body, 20, 52, 4, 12); fill(accent, 36, 52, 4, 12);
  return canvas.toDataURL('image/png');
}

let fixtureState: SkinProfile | undefined;
function fixtures(): SkinProfile {
  fixtureState ??= {
    skin: fixtureSkin('#3a6fb0', '#c24a4a'),
    variant: 'classic',
    capes: [{ id: 'fixture-cape', name: 'Migrator', url: '' }],
    library: [
      { id: 1, name: 'Explorer', variant: 'classic', image: fixtureSkin('#3a6fb0', '#c24a4a') },
      { id: 2, name: 'Forest', variant: 'slim', image: fixtureSkin('#3c7a4a', '#e8c14a') },
    ],
  };
  return fixtureState;
}

async function loadProfile(uuid: string, sync: boolean): Promise<SkinProfile> {
  if (!native) return structuredClone(fixtures());
  if (sync) await invoke('force_sync_account_profile', { accountUuid: uuid }).catch(() => undefined);
  const data = await invoke<NativeProfile>('get_complete_skin_data', { accountUuid: uuid });
  return {
    skin: asImage(data.current_skin_base64),
    variant: variantOf(data.current_variant),
    cape: asImage(data.current_cape_base64),
    capeId: data.current_cape_profile_id ?? undefined,
    capes: data.capes.map((cape) => ({ id: cape.id, name: cape.alias || cape.id, url: textureUrl(cape.url) })),
    library: data.recent_history.map((skin) => ({
      id: skin.id,
      name: skin.name,
      variant: variantOf(skin.variant),
      image: asImage(skin.image_data) ?? '',
    })),
  };
}

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

export interface Preset {
  key: string;
  name: string;
  packId: string;
  packName: string;
  classic?: string;
  slim?: string;
}

export interface PresetPack {
  id: string;
  name: string;
  skins: Preset[];
}

interface NativePreset {
  texture_key: string;
  name?: string | null;
  source: { type: string; pack_id?: string | null; pack_name?: string | null; category?: string | null; slim_texture?: string | null; classic_texture?: string | null };
}

const titleCase = (value: string) => value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

/** Public Mojang preset skins; the same list for every account, so it is cached for the session. */
let presetPromise: Promise<PresetPack[]> | undefined;
function loadPresets(): Promise<PresetPack[]> {
  presetPromise ??= (async () => {
    if (!native) {
      const skins = (packId: string, packName: string, items: [string, string, string][]): PresetPack => ({
        id: packId,
        name: packName,
        skins: items.map(([name, body, accent]) => ({ key: `${packId}-${name}`, name, packId, packName, classic: fixtureSkin(body, accent) })),
      });
      return [skins('defaults', 'Defaults', [['Steve', '#3a6fb0', '#2a8a8a'], ['Alex', '#3c7a4a', '#c2884a']])];
    }
    const items = await invoke<NativePreset[]>('get_default_skins');
    const packs = new Map<string, PresetPack>();
    for (const item of items) {
      if (item.source?.type !== 'default') continue;
      const id = item.source.pack_id || item.source.pack_name || item.source.category || 'other';
      const name = item.source.pack_name || item.source.category || titleCase(id);
      const classic = item.source.classic_texture ? textureUrl(item.source.classic_texture) : undefined;
      const slim = item.source.slim_texture ? textureUrl(item.source.slim_texture) : undefined;
      if (!classic && !slim) continue;
      const pack = packs.get(id) ?? { id, name, skins: [] };
      pack.skins.push({ key: item.texture_key, name: item.name || item.texture_key, packId: id, packName: name, classic, slim });
      packs.set(id, pack);
    }
    // The built-in characters first, then packs alphabetically.
    return [...packs.values()].sort((a, b) => (a.id === 'defaults' ? -1 : b.id === 'defaults' ? 1 : a.name.localeCompare(b.name)));
  })().catch((reason) => {
    presetPromise = undefined;
    throw reason;
  });
  return presetPromise;
}

/** A skin chosen locally but not yet sent to Mojang. */
type StagedSkin = { image: string; variant: SkinVariant; name: string } & (
  | { kind: 'history'; libId: number; original: SkinVariant }
  | { kind: 'preset'; preset: Preset }
  | { kind: 'upload' }
);

/** Local edits waiting to be committed. `cape: null` means "no cape"; `undefined` means untouched. */
interface Pending {
  uuid: string;
  skin?: StagedSkin;
  variant?: SkinVariant;
  cape?: string | null;
}

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** The profile as the user should see it: the server state with local edits laid over it. */
export interface SkinView {
  skin?: string;
  variant: SkinVariant;
  capeId?: string;
  cape?: string;
}

/** Quiet period after the last edit before anything is sent to Mojang. */
export const SAVE_IDLE_MS = 2000;
const SAVED_VISIBLE_MS = 2500;

/** Accounts whose cape the user hid this session. The host reports the first cape as active when none is. */
const hiddenCape = new Set<string>();

/**
 * Skin state for one account.
 * Edits are staged locally, merged, and sent as one upload after SAVE_IDLE_MS of quiet or when the user leaves.
 * Rust owns authentication and the Mojang calls.
 */
export function createSkinController(account: () => Account | undefined) {
  const [profile, setProfile] = createSignal<SkinProfile>();
  const [presets, setPresets] = createSignal<PresetPack[]>();
  const [busy, setBusy] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  const [status, setStatus] = createSignal<SaveStatus>('idle');
  const [pending, setPendingSignal] = createSignal<Pending>();
  /** Synchronous mirror of `pending`: signal writes are batched, but cleanup must see the latest edit. */
  let latest: Pending | undefined;
  const setPending = (next: Pending | undefined) => {
    latest = next;
    setPendingSignal(next);
  };
  const [committing, setCommitting] = createSignal<Pending>();

  /** The account whose panel is on screen. Commits for other accounts still finish but never touch the UI. */
  let currentUuid: string | undefined;
  /** Latest server state per account, used to skip edits that change nothing. */
  const committed = new Map<string, SkinProfile>();
  let inFlight = 0;
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  const fetchProfile = async (uuid: string, sync: boolean) => {
    const next = await loadProfile(uuid, sync);
    if (hiddenCape.has(uuid)) {
      next.capeId = undefined;
      next.cape = undefined;
    }
    committed.set(uuid, next);
    if (uuid === currentUuid) setProfile(next);
    return next;
  };

  const view = (): SkinView | undefined => {
    const base = profile();
    if (!base) return undefined;
    const queued = committing();
    const staged = pending();
    const skin = staged?.skin ?? queued?.skin;
    const variant = staged?.skin?.variant ?? staged?.variant ?? queued?.skin?.variant ?? queued?.variant ?? base.variant;
    const cape = staged?.cape !== undefined ? staged.cape : queued?.cape;
    const capeId = cape === undefined ? base.capeId : (cape ?? undefined);
    const capeImage = capeId ? (base.capes.find((item) => item.id === capeId)?.url ?? (capeId === base.capeId ? base.cape : undefined)) : undefined;
    return { skin: skin?.image ?? base.skin, variant, capeId, cape: capeImage };
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const markSaved = () => {
    setStatus('saved');
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => status() === 'saved' && setStatus('idle'), SAVED_VISIBLE_MS);
  };

  /** Send one staged batch: at most one skin upload plus one cape call. */
  const send = async (batch: Pending) => {
    const uuid = batch.uuid;
    const base = committed.get(uuid);
    const skin = batch.skin;
    const variantOnly = !skin && batch.variant && batch.variant !== base?.variant ? batch.variant : undefined;
    const skinChanged = skin && (skin.image !== base?.skin || skin.variant !== base?.variant);
    const capeChanged = batch.cape !== undefined && (batch.cape ?? undefined) !== base?.capeId;
    if (!native) {
      const state = fixtures();
      if (skinChanged && skin) { state.skin = skin.image; state.variant = skin.variant; if (skin.kind === 'upload') state.library = [...state.library, { id: Date.now(), name: skin.name, variant: skin.variant, image: skin.image }]; }
      if (variantOnly) state.variant = variantOnly;
      if (capeChanged) state.capeId = batch.cape ?? undefined;
      return;
    }
    if (skinChanged && skin) {
      if (skin.kind === 'history' && skin.variant === skin.original) {
        await invoke('apply_history_skin', { accountUuid: uuid, historyId: skin.libId });
      } else if (skin.kind === 'upload') {
        await invoke('upload_account_skin', { accountUuid: uuid, name: skin.name, variant: skin.variant, base64Data: skin.image });
      } else {
        await invoke('apply_preset_skin', {
          accountUuid: uuid,
          textureUrl: skin.image,
          variant: skin.variant,
          category: skin.kind === 'preset' ? skin.preset.packName : 'Library',
          name: skin.name,
          packId: skin.kind === 'preset' ? skin.preset.packId : undefined,
        });
      }
    } else if (variantOnly) {
      await invoke('change_skin_variant', { accountUuid: uuid, variant: variantOnly });
    }
    if (capeChanged) {
      if (batch.cape) {
        await invoke('change_account_cape', { accountUuid: uuid, capeId: batch.cape });
        hiddenCape.delete(uuid);
      } else {
        await invoke('hide_account_cape', { accountUuid: uuid });
        hiddenCape.add(uuid);
      }
    }
  };

  const run = async (batch: Pending) => {
    const uuid = batch.uuid;
    if (uuid === currentUuid) {
      setStatus('saving');
      setError(undefined);
    }
    try {
      await send(batch);
      // One reload after the batch; the mutating commands already synced the profile on the host.
      await fetchProfile(uuid, false);
      if (uuid === currentUuid) {
        if (latest) setStatus('pending');
        else markSaved();
      }
    } catch (reason) {
      if (uuid === currentUuid) {
        // Drop the failed edit and show what Mojang really has. No automatic retry, to avoid hammering a rate limit.
        setError(messageOf(reason));
        setStatus('error');
        await fetchProfile(uuid, false).catch(() => undefined);
      }
    } finally {
      inFlight--;
      if (!inFlight) setCommitting(undefined);
    }
  };

  /** Commit whatever is staged right now. Safe to call repeatedly and while leaving the page. */
  const flush = (): Promise<void> => {
    clearTimer();
    const batch = latest;
    if (!batch) return chain;
    setPending(undefined);
    inFlight++;
    setCommitting((previous) => (previous?.uuid === batch.uuid ? { ...previous, ...batch, skin: batch.skin ?? previous.skin } : batch));
    chain = chain.then(() => run(batch));
    return chain;
  };

  const schedule = () => {
    clearTimer();
    timer = setTimeout(() => void flush(), SAVE_IDLE_MS);
  };

  /** Merge one edit into the pending batch and restart the idle timer. */
  const stage = (change: (batch: Pending) => void) => {
    const uuid = currentUuid;
    if (!uuid || !profile()) return;
    const batch: Pending = { ...(latest?.uuid === uuid ? latest : undefined), uuid } as Pending;
    change(batch);
    setPending(batch);
    setError(undefined);
    setStatus('pending');
    schedule();
  };

  createEffect(
    () => (canManageSkin(account()) ? account()?.uuid : undefined),
    (uuid) => {
      currentUuid = uuid;
      setProfile(undefined);
      setBusy(undefined);
      setError(undefined);
      setStatus('idle');
      if (uuid) void fetchProfile(uuid, true).catch((reason) => uuid === currentUuid && setError(messageOf(reason)));
      // Leaving this account: its staged edits go to it, not to whoever is selected next.
      return () => void flush();
    },
  );

  onSettled(() => {
    if (typeof window === 'undefined') return;
    const hidden = () => document.visibilityState === 'hidden' && void flush();
    const leave = () => void flush();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leave);
    window.addEventListener('beforeunload', leave);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('beforeunload', leave);
      if (savedTimer) clearTimeout(savedTimer);
      void flush();
    };
  });

  /** Local-only or destructive actions that run straight away. */
  const immediate = async (key: string, work: (uuid: string) => Promise<void>) => {
    const uuid = currentUuid;
    if (!uuid || busy()) return;
    setBusy(key);
    setError(undefined);
    try {
      await chain;
      await work(uuid);
      await fetchProfile(uuid, false);
    } catch (reason) {
      if (uuid === currentUuid) setError(messageOf(reason));
    } finally {
      if (uuid === currentUuid) setBusy(undefined);
    }
  };

  const textureFor = (preset: Preset, variant: SkinVariant) => {
    const wanted = variant === 'slim' ? preset.slim : preset.classic;
    if (wanted) return { image: wanted, variant };
    return preset.classic ? { image: preset.classic, variant: 'classic' as SkinVariant } : { image: preset.slim ?? '', variant: 'slim' as SkinVariant };
  };

  return {
    profile,
    view,
    presets,
    busy,
    error,
    status,
    /** True while edits are waiting or on their way to Mojang. */
    dirty: () => !!pending() || !!committing(),
    flush,
    loadPresets: () => {
      // Called from effects: the check is a one-off, not a dependency.
      if (untrack(presets)) return;
      void loadPresets().then(setPresets, (reason) => setError(messageOf(reason)));
    },
    selectLibrary: (skin: LibrarySkin) =>
      stage((batch) => {
        batch.skin = { kind: 'history', libId: skin.id, original: skin.variant, image: skin.image, variant: skin.variant, name: skin.name };
        batch.variant = undefined;
      }),
    selectPreset: (preset: Preset) => {
      const shown = view()?.variant ?? 'classic';
      stage((batch) => {
        const wanted = batch.skin?.variant ?? batch.variant ?? shown;
        const texture = textureFor(preset, wanted);
        batch.skin = { kind: 'preset', preset, name: preset.name, ...texture };
        batch.variant = undefined;
      });
    },
    setVariant: (variant: SkinVariant) =>
      stage((batch) => {
        const skin = batch.skin;
        if (!skin) {
          batch.variant = variant;
        } else if (skin.kind === 'preset') {
          const texture = textureFor(skin.preset, variant);
          batch.skin = { ...skin, ...(texture.variant === variant ? texture : { variant }) };
        } else {
          batch.skin = { ...skin, variant };
        }
      }),
    setCape: (capeId: string | undefined) =>
      stage((batch) => {
        batch.cape = capeId ?? null;
      }),
    removeLibrary: (skin: LibrarySkin) =>
      immediate(`delete:${skin.id}`, async () => {
        if (!native) {
          fixtures().library = fixtures().library.filter((item) => item.id !== skin.id);
          return;
        }
        await invoke('delete_history_skin', { historyId: skin.id });
      }),
    /** Pick a PNG and stage it. Nothing is sent until the idle delay (or leaving) commits it. */
    upload: async () => {
      if (!currentUuid || !profile()) return;
      try {
        if (!native) {
          const image = fixtureSkin('#8a4ab0', '#4ab0a0');
          stage((batch) => { batch.skin = { kind: 'upload', image, variant: 'classic', name: 'Uploaded' }; batch.variant = undefined; });
          return;
        }
        const { open } = await import('@tauri-apps/plugin-dialog');
        const path = await open({ multiple: false, filters: [{ name: 'PNG', extensions: ['png'] }] });
        if (!path || Array.isArray(path)) return;
        const local = await invoke<{ variant: string; base64_data: string }>('detect_local_skin_variant', { filePath: path });
        const image = asImage(local.base64_data);
        if (!image) return;
        const name = path.split(/[\\/]/).pop()?.replace(/\.png$/i, '') || 'Custom skin';
        stage((batch) => { batch.skin = { kind: 'upload', image, variant: variantOf(local.variant), name }; batch.variant = undefined; });
      } catch (reason) {
        setError(messageOf(reason));
      }
    },
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image'));
    image.src = src;
  });
}

/** Gap between the two figures, in skin pixels. */
const GAP = 4;
const FIGURE_W = 16;
const FIGURE_H = 32;

export const figureSize = (views: 'front' | 'both', scale: number) => ({
  width: (views === 'both' ? FIGURE_W * 2 + GAP : FIGURE_W) * scale,
  height: FIGURE_H * scale,
});

const draws = new WeakMap<HTMLCanvasElement, number>();
function beginDraw(canvas: HTMLCanvasElement) {
  const generation = (draws.get(canvas) ?? 0) + 1;
  draws.set(canvas, generation);
  return generation;
}

/**
 * Draw a front (and optionally back) view of a skin without a 3D library.
 * Handles 64x64 and legacy 64x32 skins, HD textures, slim arms and an optional cape on the back view.
 * Resolves false if an image could not be loaded.
 */
export async function drawSkin(
  canvas: HTMLCanvasElement,
  options: { skin?: string; variant: SkinVariant; cape?: string; views: 'front' | 'both'; scale: number },
): Promise<boolean> {
  const generation = beginDraw(canvas);
  const { width, height } = figureSize(options.views, options.scale);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  if (!options.skin) return true;
  try {
    const [skin, cape] = await Promise.all([loadImage(options.skin), options.cape ? loadImage(options.cape).catch(() => undefined) : undefined]);
    if (draws.get(canvas) !== generation) return false;
    const k = skin.width / 64;
    const legacy = skin.height < skin.width;
    const arm = options.variant === 'slim' ? 3 : 4;
    const s = options.scale;
    // Source rect in skin pixels, destination in figure pixels (origin of the figure at ox).
    const part = (ox: number, sx: number, sy: number, w: number, h: number, dx: number, dy: number, flip = false) => {
      ctx.save();
      if (flip) {
        ctx.translate((ox + dx + w) * s, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(skin, sx * k, sy * k, w * k, h * k, 0, dy * s, w * s, h * s);
      } else {
        ctx.drawImage(skin, sx * k, sy * k, w * k, h * k, (ox + dx) * s, dy * s, w * s, h * s);
      }
      ctx.restore();
    };
    // Each limb: [x, y] of the base layer's front/back faces, and of the outer layer, for the right and left side.
    const limbs = (back: boolean) => {
      const front = (x: number, w: number) => (back ? x + 8 + w : x + 4);
      return {
        rightArm: { x: front(40, arm), y: 20, ox: front(40, arm), oy: 36 },
        leftArm: legacy ? undefined : { x: front(32, arm), y: 52, ox: front(48, arm), oy: 52 },
        rightLeg: { x: back ? 12 : 4, y: 20, ox: back ? 12 : 4, oy: 36 },
        leftLeg: legacy ? undefined : { x: back ? 28 : 20, y: 52, ox: back ? 12 : 4, oy: 52 },
      };
    };
    const body = (ox: number, back: boolean) => {
      const l = limbs(back);
      const bodyX = back ? 32 : 20;
      const headX = back ? 24 : 8;
      part(ox, headX, 8, 8, 8, 4, 0);
      part(ox, headX + 32, 8, 8, 8, 4, 0);
      part(ox, bodyX, 20, 8, 12, 4, 8);
      if (!legacy) part(ox, bodyX, 36, 8, 12, 4, 8);
      // Viewer's left is the character's right in front view and the character's left in back view.
      const legW = 4;
      const left = back ? 'leftArm' : 'rightArm';
      const right = back ? 'rightArm' : 'leftArm';
      const legLeft = back ? 'leftLeg' : 'rightLeg';
      const legRight = back ? 'rightLeg' : 'leftLeg';
      const drawLimb = (name: 'rightArm' | 'leftArm', dx: number) => {
        const source = l[name] ?? { ...l.rightArm, ox: l.rightArm.x };
        const mirrored = !l[name];
        part(ox, source.x, source.y, arm, 12, dx, 8, mirrored);
        if (!legacy && l[name]) part(ox, source.ox, source.oy, arm, 12, dx, 8);
      };
      const drawLeg = (name: 'rightLeg' | 'leftLeg', dx: number) => {
        const source = l[name] ?? l.rightLeg;
        const mirrored = !l[name];
        part(ox, source.x, source.y, legW, 12, dx, 20, mirrored);
        if (!legacy && l[name]) part(ox, source.ox, source.oy, legW, 12, dx, 20);
      };
      drawLimb(left as 'rightArm' | 'leftArm', 4 - arm);
      drawLimb(right as 'rightArm' | 'leftArm', 12);
      drawLeg(legLeft as 'rightLeg' | 'leftLeg', 4);
      drawLeg(legRight as 'rightLeg' | 'leftLeg', 8);
      if (back && cape) {
        const c = cape.width / 64;
        ctx.drawImage(cape, c, c, 10 * c, 16 * c, (ox + 3) * s, 8 * s, 10 * s, 16 * s);
      }
    };
    body(0, false);
    if (options.views === 'both') body(FIGURE_W + GAP, true);
    return true;
  } catch {
    return false;
  }
}

/** Draw the outer face of a cape texture into a small canvas. */
export async function drawCape(canvas: HTMLCanvasElement, src: string, scale: number): Promise<boolean> {
  const generation = beginDraw(canvas);
  canvas.width = 10 * scale;
  canvas.height = 16 * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!src) return true;
  try {
    const image = await loadImage(src);
    if (draws.get(canvas) !== generation) return false;
    const k = image.width / 64;
    ctx.drawImage(image, k, k, 10 * k, 16 * k, 0, 0, canvas.width, canvas.height);
    return true;
  } catch {
    return false;
  }
}
