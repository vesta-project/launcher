import { createEffect, createSignal, onSettled } from 'solid-js';
import { IdleAnimation, SkinViewer as Viewer } from 'skinview3d';
import { setting } from '../features/settings/config';
import './skin-viewer.css';

export interface SkinViewerProps {
  /** Skin texture URL or data URL. */
  skin?: string;
  model: 'classic' | 'slim';
  cape?: string;
  label: string;
}

const prefersReduced = () =>
  setting('reduced_motion') ||
  (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Draggable 3D character. Transparent background; idles gently unless motion is reduced. */
export function SkinViewer(props: SkinViewerProps) {
  let canvas: HTMLCanvasElement | undefined;
  let host: HTMLDivElement | undefined;
  let viewer: Viewer | undefined;
  const [ready, setReady] = createSignal(false);

  onSettled(() => {
    if (!canvas || !host) return;
    const rect = host.getBoundingClientRect();
    try {
      viewer = new Viewer({
        canvas,
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        zoom: 0.85,
      });
    } catch {
      return;
    }
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (viewer && !viewer.disposed && width > 0 && height > 0) viewer.setSize(Math.round(width), Math.round(height));
    });
    observer.observe(host);
    setReady(true);
    return () => {
      observer.disconnect();
      viewer?.dispose();
      viewer = undefined;
    };
  });

  createEffect(
    () => ({ ready: ready(), skin: props.skin, model: props.model }),
    ({ ready: isReady, skin, model }) => {
      if (!isReady || !viewer || viewer.disposed) return;
      if (!skin) return viewer.resetSkin();
      void viewer.loadSkin(skin, { model: model === 'slim' ? 'slim' : 'default' }).catch(() => undefined);
    },
  );

  createEffect(
    () => ({ ready: ready(), cape: props.cape }),
    ({ ready: isReady, cape }) => {
      if (!isReady || !viewer || viewer.disposed) return;
      if (!cape) return viewer.resetCape();
      void viewer.loadCape(cape, { backEquipment: 'cape' }).catch(() => undefined);
    },
  );

  createEffect(
    () => ({ ready: ready(), reduced: prefersReduced() }),
    ({ ready: isReady, reduced }) => {
      if (!isReady || !viewer || viewer.disposed) return;
      viewer.animation = reduced ? null : new IdleAnimation();
    },
  );

  return (
    <div ref={(el) => (host = el)} data-vesta="skin-viewer" role="img" aria-label={props.label}>
      <canvas ref={(el) => (canvas = el)} data-vesta="skin-viewer-canvas" />
    </div>
  );
}
