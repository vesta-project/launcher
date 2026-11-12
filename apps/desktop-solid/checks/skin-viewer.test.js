import { describe, expect, test } from 'bun:test';
import { SkinViewerController } from '../src/components/skin-viewer-controller';
import { SkinTextureCache } from '../src/features/accounts/skin-textures';
import { IdleAnimation, PlayerObject } from 'skinview3d';

const settled = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const image = (name, width = 64, height = 64) => ({ name, naturalWidth: width, naturalHeight: height });

function fixture({ slowModule = false, slowTextures = false, failModule = false } = {}) {
  const module = deferred();
  const images = new Map(), frames = new Map(), viewers = [];
  let frameId = 0, imports = 0;
  class Viewer {
    constructor(options) {
      this.options = options;
      this.renderPaused = true;
      this.controls = Object.assign(new EventTarget(), { enabled: true, target: { x: 0, y: 0, z: 0 }, update() {} });
      this.camera = { position: { x: 0, y: 0, z: 50, set(x, y, z) { Object.assign(this, { x, y, z }); } } };
      this.playerObject = new PlayerObject();
      this.renderer = { getContext: () => ({ isContextLost: () => false }) };
      this.skins = []; this.capes = []; this.resizes = []; this.renders = 0;
      this.assignments = 0;
      viewers.push(this);
    }
    loadSkin(texture, options) { this.skins.push(texture.name); this.playerObject.skin.modelType = options.model; }
    loadCape(texture) { this.capes.push(texture.name); }
    get animation() { return this._animation; }
    set animation(next) {
      this.assignments++;
      if (next) next.progress = 0;
      this._animation = next;
    }
    resetSkin() { this.skins.push(null); }
    resetCape() { this.capes.push(null); }
    setSize(...size) { this.resizes.push(size); }
    render() { this.renders++; }
    dispose() { this.disposed = true; }
  }
  const library = { SkinViewer: Viewer, IdleAnimation };
  const canvas = new EventTarget();
  const controller = new SkinViewerController(canvas, {
    loadLibrary: () => {
      imports++;
      if (failModule && imports === 1) return Promise.reject(Error('offline'));
      return slowModule ? module.promise : Promise.resolve(library);
    },
    loadTexture: (source) => {
      if (!images.has(source)) images.set(source, deferred());
      const pending = images.get(source);
      if (!slowTextures) pending.resolve(image(source));
      return pending.promise;
    },
    requestFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelFrame: (id) => frames.delete(id),
  });
  controller.setSize(240, 300, 1);
  const appearance = (skin = 'skin-A', model = 'classic', cape) => controller.setAppearance({ skin, model, cape });
  const paint = () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(0); };
  const animate = (seconds) => {
    const viewer = viewers[0];
    for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) viewer.animation?.update(viewer.playerObject, 1 / 60);
  };
  return { controller, appearance, frames, paint, animate, canvas, viewers, images, imports: () => imports,
    resolveModule: () => module.resolve(library) };
}

describe('skin viewer lifecycle and render budgets', () => {
  test('does not import or create a GPU viewer until visible with a skin; textures start alongside the module', async () => {
    const f = fixture({ slowModule: true, slowTextures: true });
    f.appearance();
    await settled();
    expect(f.imports()).toBe(0);
    f.controller.setVisible(true);
    expect(f.imports()).toBe(1);
    expect(f.images.has('skin-A')).toBe(true);
    expect(f.viewers).toHaveLength(0);
    f.controller.dispose();
    f.resolveModule();
    await settled();
    expect(f.viewers).toHaveLength(0);
  });

  test('normal idle stops offscreen, resumes on return, and static mode owns no continuous loop', async () => {
    const f = fixture();
    f.appearance(); f.controller.setVisible(true);
    await settled();
    const v = f.viewers[0];
    expect(v.renderPaused).toBe(false);
    f.controller.setVisible(false);
    expect(v.renderPaused).toBe(true);
    expect(v.controls.enabled).toBe(false);
    f.controller.setVisible(true);
    expect(v.renderPaused).toBe(false);
    f.controller.setReducedMotion(true);
    expect(v.animation).toBeNull();
    expect(v.renderPaused).toBe(true);
    f.paint();
    const before = v.renders;
    v.controls.dispatchEvent(new Event('change'));
    v.controls.dispatchEvent(new Event('change'));
    expect(f.frames.size).toBe(1);
    f.paint();
    expect(v.renders).toBe(before + 1);
    expect(f.frames.size).toBe(0);
    f.controller.dispose();
  });

  test('static previews repaint on resize and context recovery, with no duplicate resize or hidden paint', async () => {
    const f = fixture();
    f.controller.setReducedMotion(true); f.appearance(); f.controller.setVisible(true);
    await settled(); f.paint();
    const v = f.viewers[0];
    f.controller.setSize(240, 300, 1);
    expect(v.resizes).toHaveLength(0);
    f.controller.setSize(250, 320, 4);
    expect(v.resizes).toEqual([[250, 320]]);
    expect(v.pixelRatio).toBe(2);
    f.paint();
    f.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(f.frames.size).toBe(1);
    f.controller.setVisible(false);
    expect(f.frames.size).toBe(0);
    const count = v.renders;
    v.controls.dispatchEvent(new Event('change')); f.paint();
    expect(v.renders).toBe(count);
    f.controller.dispose();
  });

  test('changing only the arm model does not reload or upload the texture', async () => {
    const f = fixture();
    f.appearance(); f.controller.setVisible(true);
    await settled();
    const v = f.viewers[0];
    f.appearance('skin-A', 'slim');
    await settled();
    expect(v.skins).toEqual(['skin-A']);
    expect(v.playerObject.skin.modelType).toBe('slim');
    f.controller.dispose();
  });

  test('a slow obsolete skin and removed cape cannot overwrite the latest selection', async () => {
    const f = fixture({ slowTextures: true });
    f.appearance('skin-A', 'classic', 'cape-A'); f.controller.setVisible(true);
    await settled();
    f.appearance('skin-B', 'slim');
    f.images.get('skin-B').resolve(image('skin-B'));
    await settled();
    const v = f.viewers[0];
    f.images.get('skin-A').resolve(image('skin-A'));
    f.images.get('cape-A').resolve(image('cape-A'));
    await settled();
    expect(v.skins.filter(Boolean)).toEqual(['skin-B']);
    expect(v.capes.filter(Boolean)).toEqual([]);
    expect(v.playerObject.skin.modelType).toBe('slim');
    f.controller.dispose();
  });

  test('texture work finishing after disposal never touches the disposed viewer', async () => {
    const f = fixture({ slowTextures: true });
    f.appearance('skin-A', 'classic', 'cape-A'); f.controller.setVisible(true);
    await settled();
    const v = f.viewers[0];
    f.controller.dispose();
    f.images.get('skin-A').resolve(image('skin-A'));
    f.images.get('cape-A').resolve(image('cape-A'));
    await settled();
    expect(v.disposed).toBe(true);
    expect(v.skins).toEqual([]);
    expect(v.capes).toEqual([]);
    expect(f.frames.size).toBe(0);
  });

  test('hidden texture completions defer GPU work until shown; clearing a pending skin cancels it', async () => {
    const f = fixture({ slowTextures: true });
    f.appearance(); f.controller.setVisible(true);
    await settled();
    f.controller.setVisible(false);
    f.images.get('skin-A').resolve(image('skin-A'));
    await settled();
    expect(f.viewers[0].skins).toEqual([]);
    f.controller.setVisible(true);
    await settled();
    expect(f.viewers[0].skins).toEqual(['skin-A']);
    f.appearance('skin-B'); f.controller.setAppearance({ model: 'classic' });
    f.images.get('skin-B').resolve(image('skin-B'));
    await settled();
    expect(f.viewers[0].skins.filter(Boolean)).toEqual(['skin-A']);
    expect(f.viewers[0].renderPaused).toBe(true);
    f.controller.dispose();
  });

  test('a failed engine import can retry when the pane becomes visible again', async () => {
    const f = fixture({ failModule: true });
    f.appearance(); f.controller.setVisible(true);
    await settled();
    expect(f.viewers).toHaveLength(0);
    f.controller.setVisible(false); f.controller.setVisible(true);
    await settled();
    expect(f.viewers).toHaveLength(1);
    f.controller.dispose();
  });

  test('adding a cape or changing the arm model does not restart the idle animation', async () => {
    const f = fixture();
    f.appearance(); f.controller.setVisible(true);
    await settled();
    const v = f.viewers[0];
    f.animate(2);
    const progress = v.animation.progress, assignments = v.assignments;
    f.appearance('skin-A', 'slim', 'cape-A');
    await settled();
    expect(v.assignments).toBe(assignments);
    expect(v.animation.progress).toBe(progress);
    f.controller.dispose();
  });

  test('drag release returns the camera gently, while re-grabbing cancels the return', async () => {
    const f = fixture();
    f.appearance(); f.controller.setVisible(true);
    await settled();
    const v = f.viewers[0];
    v.controls.dispatchEvent(new Event('start'));
    v.camera.position.set(50, 0, 0);
    f.animate(3);
    expect(v.camera.position.x).toBe(50);
    v.controls.dispatchEvent(new Event('end'));
    f.animate(0.9);
    expect(v.camera.position.x).toBe(50);
    f.animate(0.9);
    expect(v.camera.position.x).toBeGreaterThan(1);
    expect(v.camera.position.x).toBeLessThan(49);
    expect(v.camera.position.z).toBeGreaterThan(1);
    v.controls.dispatchEvent(new Event('start'));
    const position = { x: v.camera.position.x, z: v.camera.position.z };
    f.animate(3);
    expect(v.camera.position.x).toBe(position.x);
    expect(v.camera.position.z).toBe(position.z);
    v.controls.dispatchEvent(new Event('end'));
    f.animate(2.6);
    // Home is the three-quarter resting view, a little from the character's right.
    expect(v.camera.position.x).toBeCloseTo(50 * Math.sin(-0.48), 6);
    expect(v.camera.position.z).toBeCloseTo(50 * Math.cos(-0.48), 6);
    expect(f.frames.size).toBe(0);
    f.controller.dispose();
  });

  test('reduced motion cancels automatic camera return and keeps the inspected angle', async () => {
    const f = fixture();
    f.appearance(); f.controller.setVisible(true);
    await settled();
    const v = f.viewers[0];
    v.controls.dispatchEvent(new Event('start'));
    v.camera.position.set(50, 0, 0);
    v.controls.dispatchEvent(new Event('end'));
    f.controller.setReducedMotion(true);
    f.paint(); f.animate(4);
    expect(v.animation).toBeNull();
    expect(v.camera.position.x).toBe(50);
    expect(v.controls.enabled).toBe(true);
    expect(v.renderPaused).toBe(true);
    f.controller.setReducedMotion(false);
    f.animate(4);
    expect(v.camera.position.x).toBe(50);
    f.controller.dispose();
  });
});

describe('shared decoded skin texture cache', () => {
  test('waits for asynchronous image decoding before publishing a texture', async () => {
    const original = globalThis.Image;
    const decoded = deferred();
    const created = [];
    globalThis.Image = class {
      naturalWidth = 64; naturalHeight = 64;
      constructor() { created.push(this); }
      decode() { return decoded.promise; }
    };
    let pending;
    try {
      const cache = new SkinTextureCache();
      let published = false;
      pending = cache.load('texture').then(image => { published = true; return image; });
      await settled();
      expect(created[0].crossOrigin).toBe('anonymous');
      expect(created[0].decoding).toBe('async');
      created[0].onload();
      await settled();
      expect(published).toBe(false);
      decoded.resolve();
      expect(await pending).toBe(created[0]);
      expect(created[0].onload).toBeNull();
    } finally {
      for (const image of created) image.onerror?.();
      await pending?.catch(() => {});
      if (original === undefined) delete globalThis.Image;
      else globalThis.Image = original;
    }
  });

  test('deduplicates in-flight requests and reuses decoded images', async () => {
    let calls = 0;
    const pending = deferred();
    const cache = new SkinTextureCache(() => { calls++; return pending.promise; });
    const a = cache.load('A'), b = cache.load('A');
    await settled();
    expect(calls).toBe(1);
    const decoded = image('A'); pending.resolve(decoded);
    expect(await a).toBe(decoded); expect(await b).toBe(decoded);
    expect(await cache.load('A')).toBe(decoded);
    expect(calls).toBe(1);
  });

  test('evicts least recently used decoded pixels and does not retain oversized textures', async () => {
    const calls = [];
    const cache = new SkinTextureCache(async (source) => {
      calls.push(source); return image(source, source === 'large' ? 100 : 2, 2);
    }, { entries: 2, bytes: 32, concurrent: 2, queued: 4 });
    await cache.load('A'); await cache.load('B'); await cache.load('A'); await cache.load('C');
    await cache.load('A');
    expect(calls).toEqual(['A', 'B', 'C']);
    await cache.load('B');
    await cache.load('large'); await cache.load('large');
    expect(calls).toEqual(['A', 'B', 'C', 'B', 'large', 'large']);
  });

  test('bounds simultaneous decodes and discards an obsolete queued request for the newest one', async () => {
    const pending = new Map();
    const cache = new SkinTextureCache((source) => {
      const job = deferred(); pending.set(source, job); return job.promise;
    }, { entries: 2, bytes: 32768, concurrent: 1, queued: 1 });
    const a = cache.load('A');
    const b = cache.load('B').catch(error => error.message);
    const c = cache.load('C');
    await settled();
    expect([...pending.keys()]).toEqual(['A']);
    expect(await b).toBe('Skin texture superseded');
    pending.get('A').resolve(image('A')); await a; await settled();
    expect([...pending.keys()]).toEqual(['A', 'C']);
    pending.get('C').resolve(image('C')); await c;
  });

  test('a failed decode is not cached and can be retried immediately', async () => {
    let calls = 0;
    const cache = new SkinTextureCache(async () => {
      if (++calls === 1) throw Error('offline');
      return image('A');
    });
    await expect(cache.load('A')).rejects.toThrow('offline');
    expect((await cache.load('A')).name).toBe('A');
    expect(calls).toBe(2);
  });
});
