import type { SkinViewer as Viewer } from 'skinview3d';
import { loadSkinTexture } from '../features/accounts/skin-textures';
import { SkinIdleMotion, SkinOrbitReturn } from './skin-viewer-motion';

type Library = Pick<typeof import('skinview3d'), 'SkinViewer' | 'IdleAnimation'>;
let library: Promise<Library> | undefined;
const loadLibrary = () => library ??= import('skinview3d').catch((error) => {
  library = undefined;
  throw error;
});

interface Appearance { skin?: string; model: 'classic' | 'slim'; cape?: string }
interface Dependencies {
  loadLibrary: () => Promise<Library>;
  loadTexture: (source: string) => Promise<HTMLImageElement>;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
}

/** Owns one GPU viewer. Async work may finish late, but can never update an obsolete preview. */
/** Radians around the character for the resting view (a little from its right). */
const HOME_YAW = -0.48;

export class SkinViewerController {
  private viewer?: Viewer;
  private idle?: InstanceType<Library['IdleAnimation']>;
  private motion = new SkinIdleMotion();
  private orbit?: SkinOrbitReturn;
  private loading = false;
  private disposed = false;
  private visible = false;
  private reduced = false;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private frame?: number;
  private appearance: Appearance = { model: 'classic' };
  private skinRevision = 0;
  private capeRevision = 0;
  private requestedSkin?: string;
  private requestedCape?: string;
  private loadedSkin = false;

  constructor(private canvas: HTMLCanvasElement, private deps: Dependencies = {
    loadLibrary, loadTexture: loadSkinTexture,
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
  }) {
    canvas.addEventListener('webglcontextrestored', this.invalidate);
  }

  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.orbit?.cancel();
      this.motion.setDragging(false);
    }
    this.sync();
  }

  /** A small jump to greet a newly applied skin (skipped with reduced motion). */
  hop() {
    if (this.reduced) return;
    this.motion.hop();
    this.invalidate();
  }

  setReducedMotion(reduced: boolean) {
    if (this.disposed || this.reduced === reduced) return;
    this.reduced = reduced;
    this.orbit?.cancel();
    this.motion.reset();
    this.syncRendering();
  }

  setSize(width: number, height: number, pixelRatio: number) {
    if (this.disposed || width <= 0 || height <= 0) return;
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    // Avoid quadratic GPU growth on very high DPI displays, preserving up to 2x detail.
    const ratio = Math.min(2, Math.max(1, pixelRatio || 1));
    const resized = nextWidth !== this.width || nextHeight !== this.height;
    const rescaled = ratio !== this.ratio;
    this.width = nextWidth;
    this.height = nextHeight;
    this.ratio = ratio;
    if (this.viewer) {
      if (rescaled) this.viewer.pixelRatio = ratio;
      if (resized) this.viewer.setSize(nextWidth, nextHeight);
      if (resized || rescaled) this.invalidate();
    } else this.sync();
  }

  setAppearance(next: Appearance) {
    if (this.disposed) return;
    const previous = this.appearance;
    this.appearance = { ...next };
    if (next.skin !== previous.skin) {
      this.skinRevision++;
      this.requestedSkin = undefined;
      this.loadedSkin = false;
      this.viewer?.resetSkin();
    } else if (next.model !== previous.model && this.viewer) {
      // Changing arm width does not need another image decode or GPU texture upload.
      this.viewer.playerObject.skin.modelType = next.model === 'slim' ? 'slim' : 'default';
      this.invalidate();
    }
    if (next.cape !== previous.cape) {
      this.capeRevision++;
      this.requestedCape = undefined;
      this.viewer?.resetCape();
      this.invalidate();
    }
    this.sync();
  }

  private sync() {
    if (this.disposed) return;
    if (!this.visible) {
      this.syncRendering();
      return;
    }
    if (!this.viewer) {
      if (this.loading || !this.appearance.skin || !this.width || !this.height) return;
      this.loading = true;
      // Fetch/decode alongside the engine download, rather than starting textures afterwards.
      void this.deps.loadTexture(this.appearance.skin).catch(() => undefined);
      if (this.appearance.cape) void this.deps.loadTexture(this.appearance.cape).catch(() => undefined);
      void this.deps.loadLibrary().then((module) => {
        this.loading = false;
        if (this.disposed || !this.visible || !this.appearance.skin) return;
        this.viewer = new module.SkinViewer({
          canvas: this.canvas, width: this.width, height: this.height,
          pixelRatio: this.ratio, zoom: 0.7, renderPaused: true,
        });
        this.idle = new module.IdleAnimation();
        // Rest at a three-quarter view so the character reads as a figure, not a flat sprite.
        const camera = this.viewer.camera.position, target = this.viewer.controls.target;
        const reach = Math.hypot(camera.x - target.x, camera.z - target.z);
        camera.set(target.x + reach * Math.sin(HOME_YAW), camera.y, target.z + reach * Math.cos(HOME_YAW));
        this.viewer.controls.update();
        this.orbit = new SkinOrbitReturn(this.viewer.camera.position, this.viewer.controls.target);
        let previous = 0;
        this.idle.addAnimation((player, progress) => {
          if (this.disposed || !this.visible || !this.loadedSkin || this.reduced) return;
          const delta = Math.max(0, progress - previous);
          previous = progress;
          const pose = this.motion.tick(delta);
          player.skin.head.rotation.set(pose.pitch, pose.yaw, 0);
          player.position.set(pose.x, pose.y, 0);
          player.rotation.z = pose.roll;
          this.orbit?.tick(delta);
        });
        this.viewer.controls.enableZoom = false;
        this.viewer.controls.enablePan = false;
        this.viewer.controls.addEventListener('change', this.invalidate);
        this.viewer.controls.addEventListener('start', this.interactionStart);
        this.viewer.controls.addEventListener('end', this.interactionEnd);
        this.sync();
      }).catch(() => { this.loading = false; });
      return;
    }
    this.loadTextures();
    this.syncRendering();
  }

  private loadTextures() {
    const viewer = this.viewer!;
    const { skin, cape } = this.appearance;
    if (skin && skin !== this.requestedSkin) {
      this.requestedSkin = skin;
      const revision = this.skinRevision;
      void this.deps.loadTexture(skin).then((image) => {
        if (this.disposed || revision !== this.skinRevision) return;
        if (!this.visible) { this.requestedSkin = undefined; return; }
        // Decoded sources are applied synchronously, after the generation check.
        viewer.loadSkin(image, { model: this.appearance.model === 'slim' ? 'slim' : 'default' });
        this.loadedSkin = true;
        this.syncRendering();
      }).catch(() => {
        if (revision === this.skinRevision) this.requestedSkin = undefined;
      });
    }
    if (cape && cape !== this.requestedCape) {
      this.requestedCape = cape;
      const revision = this.capeRevision;
      void this.deps.loadTexture(cape).then((image) => {
        if (this.disposed || revision !== this.capeRevision) return;
        if (!this.visible) { this.requestedCape = undefined; return; }
        viewer.loadCape(image, { backEquipment: 'cape' });
        this.invalidate();
      }).catch(() => {
        if (revision === this.capeRevision) this.requestedCape = undefined;
      });
    }
  }

  private syncRendering() {
    const viewer = this.viewer;
    if (!viewer) return;
    const active = this.visible && this.loadedSkin;
    viewer.controls.enabled = active;
    const animation = this.reduced ? null : this.idle!;
    // The library resets progress even when assigned the same animation instance.
    if (viewer.animation !== animation) viewer.animation = animation;
    viewer.renderPaused = !active || this.reduced;
    if ((!active || !viewer.renderPaused) && this.frame !== undefined) {
      this.deps.cancelFrame(this.frame);
      this.frame = undefined;
    }
    // A static preview repaints only after input, texture load, resize or context recovery.
    this.invalidate();
  }

  private interactionStart = () => {
    this.orbit?.cancel();
    this.motion.setDragging(true);
  };

  private interactionEnd = () => {
    this.motion.setDragging(false);
    if (this.visible && this.loadedSkin && !this.reduced) this.orbit?.release();
  };

  private invalidate = () => {
    if (this.disposed || !this.visible || !this.viewer?.renderPaused || this.frame !== undefined) return;
    this.frame = this.deps.requestFrame(() => {
      this.frame = undefined;
      const viewer = this.viewer;
      if (!this.disposed && this.visible && viewer?.renderPaused && !viewer.renderer.getContext().isContextLost()) viewer.render();
    });
  };

  dispose() {
    this.disposed = true;
    this.skinRevision++;
    this.capeRevision++;
    if (this.frame !== undefined) this.deps.cancelFrame(this.frame);
    this.canvas.removeEventListener('webglcontextrestored', this.invalidate);
    this.viewer?.controls.removeEventListener('change', this.invalidate);
    this.viewer?.controls.removeEventListener('start', this.interactionStart);
    this.viewer?.controls.removeEventListener('end', this.interactionEnd);
    this.viewer?.dispose();
    this.viewer = undefined;
  }
}
