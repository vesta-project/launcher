import { Dialog as KobalteDialog } from '@kobalte/core/dialog';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import {
  ChevronLeftGlyph,
  ChevronRightGlyph,
  CloseGlyph,
  CopyGlyph,
  DownloadGlyph,
  FolderGlyph,
  InfoGlyph,
  TrashGlyph,
} from '../../internal/icons';
import { IconButton } from '../button/button';
import { useOverlayMount } from '../overlay/mount';
import './image-viewer.css';

export interface ImageViewerItem {
  src: string;
  title?: string;
  date?: string;
  alt?: string;
}

export interface ImageViewerProps {
  /** Controlled open state. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Single-image shortcut when `images` is omitted. */
  src?: string | null;
  title?: string;
  date?: string;
  /** Gallery. When more than one, swipe/arrows/wheel navigate. */
  images?: ImageViewerItem[];
  /** Controlled index into `images`. */
  index?: number;
  onIndexChange?: (index: number) => void;
  onCopy?: (src: string) => void;
  onDelete?: (src: string) => void;
  onDownload?: (src: string) => void;
  onOpenFolder?: (src: string) => void;
  /** Show the delete action when `onDelete` is set. Defaults to true. */
  showDelete?: boolean;
  /** Accessible name for the previous-image button. Defaults to "Previous image". */
  previousLabel?: string;
  /** Accessible name for the next-image button. Defaults to "Next image". */
  nextLabel?: string;
  /** Base image scale before zoom. Defaults to 1. */
  scale?: number;
  /** Pixelate scaling (Minecraft screenshots). */
  pixelated?: boolean;
  class?: string;
}

const UI_IDLE_TIMEOUT_MS = 3500;
const DEFAULT_ZOOM_ORIGIN = { x: '50%', y: '50%' };
const ZOOM_MULTIPLIER = 2.2;

const WHEEL_LINE_PX = 16;
const PAN_SENSITIVITY = 0.85;
/** Scroll distance pushed against either end before the gallery wraps around. */
const WRAP_PUSH_PX = 80;
/** After wrapping, swallow wheel input (trackpad momentum) so the jump isn't fought. */
const WRAP_COOLDOWN_MS = 700;
const MAX_WHEEL_PAN_STEP = 120;

/**
 * Fullscreen image lightbox — gallery nav, click-to-zoom with pan, idle chrome,
 * and optional copy/download/folder/delete actions (parity with vesta-launcher).
 */
export function ImageViewer(props: ImageViewerProps) {
  const mount = useOverlayMount();
  const [zoomed, setZoomed] = createSignal(false);
  const [hasError, setHasError] = createSignal(false);
  const [localIndex, setLocalIndex] = createSignal(0);
  const [showUI, setShowUI] = createSignal(true);
  const [zoomOrigin, setZoomOrigin] = createSignal(DEFAULT_ZOOM_ORIGIN);
  const [controlHovered, setControlHovered] = createSignal(false);
  /** Focus anywhere in the viewer keeps the chrome visible, like hover does. */
  const [focusInside, setFocusInside] = createSignal(false);
  const [panOffset, setPanOffset] = createSignal({ x: 0, y: 0 });
  const [dragging, setDragging] = createSignal(false);
  /** Mouse drag-to-navigate in progress (touch and trackpads scroll natively). */
  const [navDragging, setNavDragging] = createSignal(false);

  let idleTimer: number | undefined;
  /** The native horizontal scroller; the browser owns smoothing, momentum and snapping. */
  let track: HTMLDivElement | undefined;
  let navStartScroll = 0;
  let edgePush = 0;
  let lastWrapAt = 0;
  let activePanPointerId: number | null = null;
  let dragStartPointer = { x: 0, y: 0 };
  let dragStartPan = { x: 0, y: 0 };
  let suppressNextImageClick = false;
  let navPointerId: number | null = null;
  let navStartX = 0;
  let suppressNavClick = false;
  const NAV_DRAG_THRESHOLD = 0.18;

  const list = createMemo((): ImageViewerItem[] => {
    if (props.images && props.images.length > 0) return props.images;
    if (props.src) {
      return [{ src: props.src, title: props.title, date: props.date, alt: props.title }];
    }
    return [];
  });

  const index = () => {
    const len = list().length;
    if (len === 0) return 0;
    const raw = props.index != null ? props.index : localIndex();
    return Math.min(Math.max(0, raw), len - 1);
  };

  /** Record a new current image (from buttons, keys, or the user scrolling). */
  const commitIndex = (next: number) => {
    if (next === index()) return;
    setLocalIndex(next);
    props.onIndexChange?.(next);
    resetZoom();
    setHasError(false);
  };

  const scrollToIndex = (target: number, behavior: ScrollBehavior = 'smooth') => {
    if (!track) return;
    track.scrollTo({ left: target * track.clientWidth, behavior });
  };

  /** Buttons and arrow keys: wrap around and scroll there. */
  const setIndex = (next: number) => {
    const len = list().length;
    if (len === 0) return;
    const wrapped = ((next % len) + len) % len;
    commitIndex(wrapped);
    scrollToIndex(wrapped);
  };

  /** Scrolling (wheel, trackpad, touch, drag) decides the index, not the reverse. */
  const handleTrackScroll = () => {
    if (!track || track.clientWidth === 0) return;
    const nearest = Math.round(track.scrollLeft / track.clientWidth);
    commitIndex(Math.min(Math.max(0, nearest), list().length - 1));
  };

  // A controlled `index` prop moves the scroller too (no-op when it already shows that image).
  createEffect(
    () => props.index,
    (next) => {
      if (next == null || !track || track.clientWidth === 0) return;
      if (Math.round(track.scrollLeft / track.clientWidth) !== next) scrollToIndex(next);
    },
  );

  /** Place the scroller on the current image without animating (open, resize, controlled index). */
  const alignTrack = (el: HTMLDivElement) => {
    track = el;
    requestAnimationFrame(() => scrollToIndex(index(), 'instant'));
  };

  const current = createMemo(() => list()[index()]);
  const title = () => current()?.title || props.title;
  const multi = () => list().length > 1;
  const imageScale = () => props.scale ?? 1;

  /** Prefer explicit `open`; otherwise treat a non-empty `src` as open (launcher API). */
  const dialogOpen = (): boolean | undefined => {
    if (props.open !== undefined) return props.open;
    if (props.src !== undefined) return props.src != null && props.src !== '';
    return undefined;
  };

  const isOpen = () => dialogOpen() === true;

  const close = () => {
    resetZoom();
    props.onOpenChange?.(false);
  };

  const clearIdleTimer = () => {
    if (idleTimer !== undefined) {
      window.clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  const scheduleUIHide = () => {
    clearIdleTimer();
    idleTimer = window.setTimeout(() => {
      if (!controlHovered() && !focusInside()) setShowUI(false);
    }, UI_IDLE_TIMEOUT_MS);
  };

  const resetZoom = () => {
    setZoomOrigin(DEFAULT_ZOOM_ORIGIN);
    setPanOffset({ x: 0, y: 0 });
    setDragging(false);
    activePanPointerId = null;
    suppressNextImageClick = false;
    setZoomed(false);
  };

  const revealUI = () => {
    setShowUI(true);
    if (isOpen()) scheduleUIHide();
  };

  const handleControlHoverStart = () => {
    setControlHovered(true);
    setShowUI(true);
    clearIdleTimer();
  };

  const handleControlHoverEnd = () => {
    setControlHovered(false);
    scheduleUIHide();
  };

  const handleControlBlur = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    const container = e.currentTarget as HTMLElement;
    if (!next || !container.contains(next)) handleControlHoverEnd();
  };

  const handleViewerFocusIn = () => {
    setFocusInside(true);
    revealUI();
  };

  const handleViewerFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as HTMLElement).contains(next)) return;
    setFocusInside(false);
    scheduleUIHide();
  };

  createEffect(
    () => props.index,
    (idx) => {
      if (idx != null) setLocalIndex(idx);
    },
  );

  createEffect(
    () => isOpen(),
    (open) => {
      if (open) {
        revealUI();
        setHasError(false);
        resetZoom();
        const onKeyDown = (e: KeyboardEvent) => {
          revealUI();
          if (e.key === 'Escape') {
            close();
            return;
          }
          if (!multi()) return;
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setIndex(index() - 1);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            setIndex(index() + 1);
          }
        };
        // Capture phase: any key reveals the chrome, even when a child stops propagation.
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('pointerdown', revealUI, true);
        onCleanup(() => {
          window.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('pointerdown', revealUI, true);
          clearIdleTimer();
        });
      } else {
        clearIdleTimer();
        setControlHovered(false);
        setFocusInside(false);
        setShowUI(true);
      }
    },
  );

  onCleanup(clearIdleTimer);

  const getPanBounds = (container: HTMLElement, img: HTMLImageElement) => {
    const zoomScale = imageScale() * ZOOM_MULTIPLIER;
    const scaledWidth = img.clientWidth * zoomScale;
    const scaledHeight = img.clientHeight * zoomScale;
    return {
      maxPanX: Math.max(0, (scaledWidth - container.clientWidth) / 2),
      maxPanY: Math.max(0, (scaledHeight - container.clientHeight) / 2),
    };
  };

  const clampPan = (nextX: number, nextY: number, bounds: { maxPanX: number; maxPanY: number }) => ({
    x: Math.min(bounds.maxPanX, Math.max(-bounds.maxPanX, nextX)),
    y: Math.min(bounds.maxPanY, Math.max(-bounds.maxPanY, nextY)),
  });

  const handleBackgroundClick = (slideIndex: number) => {
    revealUI();
    if (suppressNavClick) {
      suppressNavClick = false;
      return;
    }
    if (zoomed() && index() === slideIndex) {
      resetZoom();
      return;
    }
    close();
  };

  const handleImageClick = (e: MouseEvent, slideIndex: number) => {
    e.stopPropagation();
    revealUI();
    if (suppressNextImageClick || suppressNavClick) {
      suppressNextImageClick = false;
      suppressNavClick = false;
      return;
    }
    if (zoomed() && index() === slideIndex) {
      resetZoom();
      return;
    }
    const img = e.currentTarget as HTMLImageElement;
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setZoomOrigin({
        x: `${((e.clientX - rect.left) / rect.width) * 100}%`,
        y: `${((e.clientY - rect.top) / rect.height) * 100}%`,
      });
    }
    setPanOffset({ x: 0, y: 0 });
    setZoomed(true);
  };

  /** Mouse drag scrolls the track; release snaps to the nearest or next image. */
  const handleNavPointerDown = (e: PointerEvent & { currentTarget: HTMLElement }, slideIndex: number) => {
    revealUI();
    if (e.pointerType !== 'mouse' || e.button !== 0 || zoomed() || !multi() || slideIndex !== index() || !track) return;
    navPointerId = e.pointerId;
    navStartX = e.clientX;
    navStartScroll = track.scrollLeft;
    suppressNavClick = false;
    // A press is still a click. Capturing here retargets image clicks to this
    // container and runs its background-close handler instead of click-to-zoom.
  };

  const handleNavPointerMove = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (navPointerId !== e.pointerId || !track) return;
    const dx = e.clientX - navStartX;
    if (!navDragging()) {
      if (Math.abs(dx) <= 3) return;
      setNavDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    suppressNavClick = true;
    track.scrollLeft = navStartScroll - dx;
  };

  const handleNavPointerUp = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (navPointerId !== e.pointerId || !track) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const wasDragging = navDragging();
    navPointerId = null;
    setNavDragging(false);
    if (!wasDragging) return;
    const dx = e.clientX - navStartX;
    const start = Math.round(navStartScroll / track.clientWidth);
    const target = e.type === 'pointercancel' ? start
      : Math.abs(dx) >= track.clientWidth * NAV_DRAG_THRESHOLD ? start + (dx < 0 ? 1 : -1) : start;
    // Dragging past either end wraps around, like the buttons.
    if (target < 0 || target >= list().length) setIndex(target);
    else scrollToIndex(target);
  };

  const handleImagePointerDown = (e: PointerEvent, slideIndex: number) => {
    revealUI();
    // When not zoomed, let the event reach the slide for swipe navigation.
    if (!zoomed() || index() !== slideIndex) return;
    e.stopPropagation();
    const img = e.currentTarget as HTMLImageElement;
    activePanPointerId = e.pointerId;
    dragStartPointer = { x: e.clientX, y: e.clientY };
    dragStartPan = panOffset();
    suppressNextImageClick = false;
    setDragging(true);
    img.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handleImagePointerMove = (e: PointerEvent, slideIndex: number) => {
    if (!dragging() || activePanPointerId !== e.pointerId || !zoomed() || index() !== slideIndex) {
      return;
    }
    e.stopPropagation();
    revealUI();
    const img = e.currentTarget as HTMLImageElement;
    const container = img.parentElement;
    if (!container) return;
    const deltaX = e.clientX - dragStartPointer.x;
    const deltaY = e.clientY - dragStartPointer.y;
    if (!suppressNextImageClick && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
      suppressNextImageClick = true;
    }
    setPanOffset(clampPan(dragStartPan.x + deltaX, dragStartPan.y + deltaY, getPanBounds(container, img)));
  };

  const handleImagePointerEnd = (e: PointerEvent) => {
    if (activePanPointerId !== e.pointerId) return;
    const img = e.currentTarget as HTMLImageElement;
    if (img.hasPointerCapture(e.pointerId)) img.releasePointerCapture(e.pointerId);
    activePanPointerId = null;
    setDragging(false);
  };

  const normalizeWheelDelta = (delta: number, deltaMode: number, viewportSize: number) => {
    let normalized = delta;
    if (deltaMode === 1) normalized *= WHEEL_LINE_PX;
    else if (deltaMode === 2) normalized *= viewportSize;
    return Math.min(MAX_WHEEL_PAN_STEP, Math.max(-MAX_WHEEL_PAN_STEP, normalized));
  };

  const handleSlideWheel = (e: WheelEvent, slideIndex: number) => {
    revealUI();
    if (e.ctrlKey) return;

    if (zoomed() && index() === slideIndex) {
      e.preventDefault();
      const container = e.currentTarget as HTMLElement;
      const img = container.querySelector('img');
      if (!img) return;
      const bounds = getPanBounds(container, img);
      const deltaX = normalizeWheelDelta(e.deltaX, e.deltaMode, container.clientWidth);
      const deltaY = normalizeWheelDelta(e.deltaY, e.deltaMode, container.clientHeight);
      setPanOffset((prev) =>
        clampPan(prev.x - deltaX * PAN_SENSITIVITY, prev.y - deltaY * PAN_SENSITIVITY, bounds),
      );
      return;
    }

    // Not zoomed: the track scrolls natively. The only thing it can't do is go
    // past either end, so a sustained push there wraps around like the buttons.
    if (!multi() || !track) return;
    if (Date.now() - lastWrapAt < WRAP_COOLDOWN_MS) {
      e.preventDefault();
      return;
    }
    const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    const max = track.scrollWidth - track.clientWidth;
    const pushingEnd = delta > 0 && track.scrollLeft >= max - 1;
    const pushingStart = delta < 0 && track.scrollLeft <= 1;
    if (!pushingEnd && !pushingStart) {
      edgePush = 0;
      return;
    }
    edgePush += Math.abs(delta);
    if (edgePush < WRAP_PUSH_PX) return;
    e.preventDefault();
    edgePush = 0;
    lastWrapAt = Date.now();
    setIndex(pushingEnd ? 0 : list().length - 1);
  };

  const runAction = (fn: ((src: string) => void) | undefined) => (e: MouseEvent) => {
    e.stopPropagation();
    const src = current()?.src;
    if (src) fn?.(src);
  };

  return (
    <KobalteDialog
      {...(dialogOpen() !== undefined ? { open: dialogOpen() } : {})}
      defaultOpen={props.defaultOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetZoom();
          props.onOpenChange?.(false);
        } else {
          props.onOpenChange?.(true);
        }
      }}
    >
      <KobalteDialog.Portal mount={mount}>
        <KobalteDialog.Overlay data-vesta="image-viewer-backdrop" />
        <div data-vesta="image-viewer-positioner">
          <KobalteDialog.Content
            data-vesta="image-viewer"
            data-ui-hidden={showUI() ? undefined : ''}
            data-pixelated={props.pixelated ? '' : undefined}
            class={props.class}
            onPointerMove={revealUI}
            onFocusIn={handleViewerFocusIn}
            onFocusOut={handleViewerFocusOut}
            onMouseLeave={() => {
              if (!zoomed() && !controlHovered() && !focusInside()) setShowUI(false);
            }}
            onOpenAutoFocus={(e: Event) => e.preventDefault()}
          >
            <header
              data-vesta="image-viewer-header"
              data-hidden={showUI() ? undefined : ''}
              onMouseEnter={handleControlHoverStart}
              onMouseLeave={handleControlHoverEnd}
              onFocusIn={handleControlHoverStart}
              onFocusOut={handleControlBlur}
            >
              <div data-vesta="image-viewer-info">
                <KobalteDialog.Title data-vesta="image-viewer-title" data-placeholder={title() ? undefined : ''}>
                  {title() || 'Image'}
                </KobalteDialog.Title>
                <Show when={current()?.date || props.date}>
                  <div data-vesta="image-viewer-date">{current()?.date || props.date}</div>
                </Show>
              </div>
              <div data-vesta="image-viewer-actions">
                <Show when={props.onCopy}>
                  <IconButton
                    icon={<CopyGlyph />}
                    label="Copy"
                    variant="ghost"
                    size="sm"
                    onClick={runAction(props.onCopy)}
                  />
                </Show>
                <Show when={props.onDownload}>
                  <IconButton
                    icon={<DownloadGlyph />}
                    label="Download"
                    variant="ghost"
                    size="sm"
                    onClick={runAction(props.onDownload)}
                  />
                </Show>
                <Show when={props.onOpenFolder}>
                  <IconButton
                    icon={<FolderGlyph />}
                    label="Open folder"
                    variant="ghost"
                    size="sm"
                    onClick={runAction(props.onOpenFolder)}
                  />
                </Show>
                <Show when={props.onDelete && props.showDelete !== false}>
                  <IconButton
                    icon={<TrashGlyph />}
                    label="Delete"
                    variant="ghost"
                    tone="danger"
                    size="sm"
                    onClick={runAction(props.onDelete)}
                  />
                </Show>
                <KobalteDialog.CloseButton
                  as={(closeProps: Record<string, unknown>) => (
                    <IconButton
                      {...closeProps}
                      icon={<CloseGlyph />}
                      label="Close"
                      variant="ghost"
                      size="sm"
                      tooltip={false}
                    />
                  )}
                />
              </div>
            </header>

            <div data-vesta="image-viewer-viewport">
              <div
                ref={alignTrack}
                data-vesta="image-viewer-track"
                data-dragging={navDragging() ? '' : undefined}
                data-zoomed={zoomed() ? '' : undefined}
                onScroll={handleTrackScroll}
              >
                <For each={list()}>
                  {(image, slideIndex) => (
                    <div data-vesta="image-viewer-slide">
                      <div
                        data-vesta="image-viewer-slide-content"
                        onClick={() => handleBackgroundClick(slideIndex())}
                        onWheel={(e) => handleSlideWheel(e, slideIndex())}
                        onPointerDown={(e) => handleNavPointerDown(e, slideIndex())}
                        onPointerMove={handleNavPointerMove}
                        onPointerUp={handleNavPointerUp}
                        onPointerCancel={handleNavPointerUp}
                      >
                        <Show
                          when={!hasError() || index() !== slideIndex()}
                          fallback={
                            <div data-vesta="image-viewer-error">
                              <span data-vesta="image-viewer-error-icon">
                                <InfoGlyph />
                              </span>
                              <p>Failed to load image</p>
                              <span data-vesta="image-viewer-error-path">{image.src}</span>
                            </div>
                          }
                        >
                          <div
                            data-vesta="image-viewer-image-wrap"
                            data-zoomed={zoomed() && index() === slideIndex() ? '' : undefined}
                            data-panned={
                              zoomed() &&
                              index() === slideIndex() &&
                              (Math.abs(panOffset().x) > 1 || Math.abs(panOffset().y) > 1)
                                ? ''
                                : undefined
                            }
                            data-dragging={
                              zoomed() && index() === slideIndex() && dragging() ? '' : undefined
                            }
                          >
                            <img
                              data-vesta="image-viewer-image"
                              src={image.src}
                              draggable="false"
                              alt={image.alt ?? image.title ?? ''}
                              style={{
                                '--image-scale': String(imageScale()),
                                '--pan-x': index() === slideIndex() ? `${panOffset().x}px` : '0px',
                                '--pan-y': index() === slideIndex() ? `${panOffset().y}px` : '0px',
                                '--zoom-x':
                                  index() === slideIndex() ? zoomOrigin().x : DEFAULT_ZOOM_ORIGIN.x,
                                '--zoom-y':
                                  index() === slideIndex() ? zoomOrigin().y : DEFAULT_ZOOM_ORIGIN.y,
                              }}
                              onPointerDown={(e) => handleImagePointerDown(e, slideIndex())}
                              onPointerMove={(e) => handleImagePointerMove(e, slideIndex())}
                              onPointerUp={handleImagePointerEnd}
                              onPointerCancel={handleImagePointerEnd}
                              onClick={(e) => handleImageClick(e, slideIndex())}
                              onError={() => {
                                if (index() === slideIndex()) setHasError(true);
                              }}
                            />
                          </div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>

              <Show when={multi()}>
                <div data-vesta="image-viewer-nav" data-slot="prev" data-hidden={showUI() ? undefined : ''}>
                  <IconButton
                    size="lg"
                    icon={<ChevronLeftGlyph />}
                    label={props.previousLabel ?? 'Previous image'}
                    tooltip={false}
                    onMouseEnter={handleControlHoverStart}
                    onMouseLeave={handleControlHoverEnd}
                    onFocus={handleControlHoverStart}
                    onBlur={handleControlHoverEnd}
                    onClick={(e) => {
                      e.stopPropagation();
                      revealUI();
                      setIndex(index() - 1);
                    }}
                  />
                </div>
                <div data-vesta="image-viewer-nav" data-slot="next" data-hidden={showUI() ? undefined : ''}>
                  <IconButton
                    size="lg"
                    icon={<ChevronRightGlyph />}
                    label={props.nextLabel ?? 'Next image'}
                    tooltip={false}
                    onMouseEnter={handleControlHoverStart}
                    onMouseLeave={handleControlHoverEnd}
                    onFocus={handleControlHoverStart}
                    onBlur={handleControlHoverEnd}
                    onClick={(e) => {
                      e.stopPropagation();
                      revealUI();
                      setIndex(index() + 1);
                    }}
                  />
                </div>
              </Show>
            </div>

            <footer
              data-vesta="image-viewer-footer"
              data-hidden={showUI() ? undefined : ''}
              onMouseEnter={handleControlHoverStart}
              onMouseLeave={handleControlHoverEnd}
              onFocusIn={handleControlHoverStart}
              onFocusOut={handleControlBlur}
            >
              <Show when={multi()}>
                <span data-vesta="image-viewer-counter">
                  {index() + 1} / {list().length}
                </span>
              </Show>
              <span data-vesta="image-viewer-hint">
                Click to {zoomed() ? 'reset' : 'zoom'}
              </span>
            </footer>
          </KobalteDialog.Content>
        </div>
      </KobalteDialog.Portal>
    </KobalteDialog>
  );
}
