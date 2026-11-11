import { createEffect, createSignal, onSettled } from 'solid-js';
import { reducedMotion } from '../features/settings/reduced-motion';
import { SkinViewerController } from './skin-viewer-controller';
import './skin-viewer.css';

export interface SkinViewerProps {
  /** Skin texture URL or data URL. */
  skin?: string;
  model: 'classic' | 'slim';
  cape?: string;
  label: string;
}

/** Draggable 3D character. Transparent background; idles gently unless motion is reduced. */
export function SkinViewer(props: SkinViewerProps) {
  let canvas: HTMLCanvasElement | undefined;
  let host: HTMLDivElement | undefined;
  const [controller, setController] = createSignal<SkinViewerController | undefined>(undefined, { name: 'skinViewerController' });

  onSettled(() => {
    if (!canvas || !host) return;
    const preview = new SkinViewerController(canvas);
    let intersecting = typeof IntersectionObserver === 'undefined';
    const visibility = () => preview.setVisible(intersecting && !document.hidden);
    const resize = () => {
      const { width, height } = host!.getBoundingClientRect();
      preview.setSize(width, height, window.devicePixelRatio);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const intersection = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      visibility();
    });
    intersection?.observe(host);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('resize', resize);
    resize();
    visibility();
    setController(preview);
    return () => {
      observer.disconnect();
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('resize', resize);
      preview.dispose();
    };
  });

  createEffect(
    () => ({ controller: controller(), skin: props.skin, model: props.model, cape: props.cape }),
    ({ controller: preview, ...appearance }) => preview?.setAppearance(appearance),
    { name: 'skinViewerAppearance' },
  );

  createEffect(
    () => ({ controller: controller(), reduced: reducedMotion() }),
    ({ controller: preview, reduced }) => preview?.setReducedMotion(reduced),
    { name: 'skinViewerMotion' },
  );

  return (
    <div ref={(el) => (host = el)} data-vesta="skin-viewer" role="img" aria-label={props.label}>
      <canvas ref={(el) => (canvas = el)} data-vesta="skin-viewer-canvas" />
    </div>
  );
}
