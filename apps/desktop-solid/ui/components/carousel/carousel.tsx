import type { JSX } from '@solidjs/web';
import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
} from 'solid-js';
import { ChevronLeftGlyph, ChevronRightGlyph } from '../../internal/icons';
import { IconButton } from '../button/button';
import './carousel.css';

type CarouselContextValue = {
  orientation: Accessor<'horizontal' | 'vertical'>;
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: Accessor<boolean>;
  canScrollNext: Accessor<boolean>;
  registerViewport: (el: HTMLDivElement | undefined) => void;
};

const CarouselContext = createContext<CarouselContextValue>();

function useCarousel() {
  return useContext(CarouselContext);
}

export interface CarouselProps {
  orientation?: 'horizontal' | 'vertical';
  /** Accessible name for the region. */
  'aria-label'?: string;
  class?: string;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
}

/** Scroll-snap slide region with previous/next controls. */
export function Carousel(props: CarouselProps) {
  const orientation = () => props.orientation ?? 'horizontal';
  const [viewportEl, setViewportEl] = createSignal<HTMLDivElement>();
  const [canScrollPrev, setCanScrollPrev] = createSignal(false);
  const [canScrollNext, setCanScrollNext] = createSignal(false);

  const update = () => {
    const el = viewportEl();
    if (!el) {
      setCanScrollPrev(false);
      setCanScrollNext(false);
      return;
    }
    if (orientation() === 'horizontal') {
      setCanScrollPrev(el.scrollLeft > 1);
      setCanScrollNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    } else {
      setCanScrollPrev(el.scrollTop > 1);
      setCanScrollNext(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    }
  };

  const scrollBySlide = (dir: -1 | 1) => {
    const el = viewportEl();
    if (!el) return;
    if (orientation() === 'horizontal') {
      el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' });
    } else {
      el.scrollBy({ top: dir * el.clientHeight, behavior: 'smooth' });
    }
  };

  createEffect(
    () => viewportEl(),
    (el) => {
      if (!el) return;
      update();
      el.addEventListener('scroll', update, { passive: true });
      const ro = new ResizeObserver(update);
      ro.observe(el);
      onCleanup(() => {
        el.removeEventListener('scroll', update);
        ro.disconnect();
      });
    },
  );

  const ctx: CarouselContextValue = {
    orientation,
    scrollPrev: () => scrollBySlide(-1),
    scrollNext: () => scrollBySlide(1),
    canScrollPrev,
    canScrollNext,
    registerViewport: setViewportEl,
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (orientation() === 'horizontal') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        scrollBySlide(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        scrollBySlide(1);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      scrollBySlide(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      scrollBySlide(1);
    }
  };

  return (
    <CarouselContext value={ctx}>
      <div
        data-vesta="carousel"
        data-orientation={orientation()}
        role="region"
        aria-roledescription="carousel"
        aria-label={props['aria-label']}
        class={props.class}
        style={props.style}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
    </CarouselContext>
  );
}

export interface CarouselViewportProps {
  class?: string;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
}

export function CarouselViewport(props: CarouselViewportProps) {
  const { registerViewport, orientation } = useCarousel();
  const [dragging, setDragging] = createSignal(false);

  let pointerId: number | null = null;
  let startPos = 0;
  let startScroll = 0;
  let moved = false;

  const isInteractive = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest('button, a, input, textarea, select, label, [role="button"]');

  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (e.button !== 0 || isInteractive(e.target)) return;
    const el = e.currentTarget;
    pointerId = e.pointerId;
    moved = false;
    setDragging(true);
    el.setPointerCapture(e.pointerId);
    if (orientation() === 'horizontal') {
      startPos = e.clientX;
      startScroll = el.scrollLeft;
    } else {
      startPos = e.clientY;
      startScroll = el.scrollTop;
    }
  };

  const onPointerMove = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (pointerId !== e.pointerId || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const el = e.currentTarget;
    const delta =
      orientation() === 'horizontal' ? e.clientX - startPos : e.clientY - startPos;
    if (!moved && Math.abs(delta) > 3) moved = true;
    if (!moved) return;
    e.preventDefault();
    if (orientation() === 'horizontal') el.scrollLeft = startScroll - delta;
    else el.scrollTop = startScroll - delta;
  };

  const onPointerUp = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (pointerId !== e.pointerId) return;
    const el = e.currentTarget;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    pointerId = null;
    setDragging(false);
    // Snap to the nearest slide after a drag (accounts for track gap).
    if (moved) {
      const slides = [...el.querySelectorAll<HTMLElement>('[data-vesta=carousel-slide]')];
      if (slides.length) {
        const horizontal = orientation() === 'horizontal';
        const current = horizontal ? el.scrollLeft : el.scrollTop;
        let best = 0;
        let bestDist = Infinity;
        for (const slide of slides) {
          const pos = horizontal ? slide.offsetLeft : slide.offsetTop;
          const dist = Math.abs(current - pos);
          if (dist < bestDist) {
            bestDist = dist;
            best = pos;
          }
        }
        el.scrollTo(
          horizontal
            ? { left: best, behavior: 'smooth' }
            : { top: best, behavior: 'smooth' },
        );
      }
    }
  };

  return (
    <div
      ref={registerViewport}
      data-vesta="carousel-viewport"
      data-orientation={orientation()}
      data-dragging={dragging() ? '' : undefined}
      class={props.class}
      style={props.style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div data-vesta="carousel-track" data-orientation={orientation()}>
        {props.children}
      </div>
    </div>
  );
}

export interface CarouselSlideProps {
  class?: string;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
}

export function CarouselSlide(props: CarouselSlideProps) {
  return (
    <div
      data-vesta="carousel-slide"
      role="group"
      aria-roledescription="slide"
      class={props.class}
      style={props.style}
    >
      {props.children}
    </div>
  );
}

export interface CarouselPreviousProps {
  label?: string;
  class?: string;
}

export function CarouselPrevious(props: CarouselPreviousProps) {
  const { scrollPrev, canScrollPrev } = useCarousel();
  return (
    <span data-vesta="carousel-previous" class={props.class}>
      <IconButton
        icon={<ChevronLeftGlyph />}
        label={props.label ?? 'Previous slide'}
        variant="outline"
        size="sm"
        disabled={!canScrollPrev()}
        onClick={scrollPrev}
        tooltip={false}
      />
    </span>
  );
}

export interface CarouselNextProps {
  label?: string;
  class?: string;
}

export function CarouselNext(props: CarouselNextProps) {
  const { scrollNext, canScrollNext } = useCarousel();
  return (
    <span data-vesta="carousel-next" class={props.class}>
      <IconButton
        icon={<ChevronRightGlyph />}
        label={props.label ?? 'Next slide'}
        variant="outline"
        size="sm"
        disabled={!canScrollNext()}
        onClick={scrollNext}
        tooltip={false}
      />
    </span>
  );
}

export interface CarouselControlsProps {
  class?: string;
  children?: JSX.Element;
}

/** Optional chrome row for previous/next (or custom controls). */
export function CarouselControls(props: CarouselControlsProps) {
  return (
    <div data-vesta="carousel-controls" class={props.class}>
      {props.children ?? (
        <>
          <CarouselPrevious />
          <CarouselNext />
        </>
      )}
    </div>
  );
}
