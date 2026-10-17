import type { JSX } from "@solidjs/web";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  children,
} from "solid-js";
import { rowOffsets, virtualWindow } from "./virtual-window";
import "./virtual-list.css";

export interface VirtualListProps<T> {
  items: readonly T[];
  key: (item: T) => string | number;
  rowHeight: number;
  getHeight?: (index: number) => number;
  overscan?: number;
  scrollElement: HTMLElement | undefined;
  header?: JSX.Element;
  headerHeight?: number;
  headerHook?: string;
  bodyHook?: string;
  /** Keep an open overlay's anchor mounted even if it leaves the window. */
  pinnedKey?: string | number | null;
  rowRole?: "row";
  children: (item: () => T, index: () => number) => JSX.Element;
}

/** Uses an existing scroll pane, preserving the caller's region and scroll behavior. */
export function VirtualList<T>(props: VirtualListProps<T>) {
  let root!: HTMLDivElement;
  const header = children(() => props.header);
  const [viewport, setViewport] = createSignal(
    { top: 0, height: 0 },
    { name: "virtual-list:viewport" },
  );
  const [focusedKey, setFocusedKey] = createSignal<string | number | null>(
    null,
    { name: "virtual-list:focus" },
  );
  const offsets = createMemo(
    () => rowOffsets(props.items.length, props.rowHeight, props.getHeight),
    { name: "virtual-list:offsets" },
  );
  const window = createMemo(
    () =>
      virtualWindow(
        offsets(),
        viewport().top,
        viewport().height,
        props.overscan,
      ),
    { name: "virtual-list:window" },
  );
  const rendered = createMemo(
    () => {
      const { start, end } = window();
      const indices = new Set(
        Array.from({ length: end - start }, (_, index) => index + start),
      );
      for (const key of [focusedKey(), props.pinnedKey]) {
        if (key == null) continue;
        const index = props.items.findIndex((item) => props.key(item) === key);
        if (index >= 0) indices.add(index);
      }
      return [...indices]
        .sort((a, b) => a - b)
        .map((index) => ({ item: props.items[index], index }));
    },
    { name: "virtual-list:rows" },
  );

  createEffect(
    () => ({
      element: props.scrollElement,
      headerHeight: props.headerHeight ?? 0,
    }),
    ({ element, headerHeight }) => {
      if (!element) return;
      let frame: number | undefined;
      const measure = () => {
        frame = undefined;
        const origin =
          root.getBoundingClientRect().top -
          element.getBoundingClientRect().top +
          element.scrollTop -
          element.clientTop;
        const next = {
          top: Math.max(0, element.scrollTop - origin),
          height: Math.max(0, element.clientHeight - headerHeight),
        };
        setViewport((previous) =>
          previous.top === next.top && previous.height === next.height
            ? previous
            : next,
        );
      };
      const schedule = () => {
        if (frame === undefined) frame = requestAnimationFrame(measure);
      };
      const observer = new ResizeObserver(schedule);
      observer.observe(element);
      observer.observe(root);
      element.addEventListener("scroll", schedule, { passive: true });
      measure();
      return () => {
        observer.disconnect();
        element.removeEventListener("scroll", schedule);
        if (frame !== undefined) cancelAnimationFrame(frame);
      };
    },
    { name: "virtual-list:observe" },
  );

  onSettled(() => {
    // Return focus to the pane if the list is replaced while it owns focus.
    return () => {
      if (root.contains(document.activeElement))
        props.scrollElement?.focus({ preventScroll: true });
    };
  });
  return (
    <div
      data-vesta="virtual-list"
      ref={(element) => {
        root = element;
      }}
    >
      <Show when={header()}>
        <div
          data-vesta={props.headerHook ?? "virtual-header"}
          data-virtual-header=""
          role={props.rowRole ? "rowgroup" : undefined}
          style={{ height: `${props.headerHeight ?? 0}px` }}
        >
          {header()}
        </div>
      </Show>
      <div
        data-vesta={props.bodyHook ?? "virtual-body"}
        data-virtual-body=""
        role={props.rowRole ? "rowgroup" : undefined}
        style={{ height: `${window().total}px` }}
      >
        <For each={rendered()} keyed={(row) => props.key(row.item)}>
          {(row) => {
            // `rendered` rebuilds its row objects whenever focus or the window moves. Memoize
            // the parts so rows (and overlays opened from them) only update on real changes.
            const item = createMemo(() => row().item);
            const index = createMemo(() => row().index);
            return (
              <div
                data-vesta="virtual-row"
                role={props.rowRole}
                aria-rowindex={props.rowRole ? row().index + 2 : undefined}
                style={{
                  top: `${offsets()[row().index]}px`,
                  height: `${offsets()[row().index + 1] - offsets()[row().index]}px`,
                }}
                onFocusIn={() => setFocusedKey(props.key(row().item))}
                onFocusOut={(event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null,
                    )
                  )
                    setFocusedKey(null);
                }}
              >
                {props.children(item, index)}
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
