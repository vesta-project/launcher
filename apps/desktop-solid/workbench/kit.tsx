import { For, Show } from 'solid-js';
import type { JSX } from '@solidjs/web';

export function Stack(props: { gap?: number; children?: JSX.Element }) {
  return (
    <div class="wb-kit-stack" style={{ gap: `${props.gap ?? 16}px` }}>
      {props.children}
    </div>
  );
}

export function Row(props: {
  label?: string;
  gap?: number;
  align?: 'center' | 'start';
  children?: JSX.Element;
}) {
  return (
    <div class="wb-kit-row">
      <Show when={props.label}>
        <div class="wb-kit-label wb-kit-row-label">{props.label}</div>
      </Show>
      <div
        class="wb-kit-row-items"
        style={{
          gap: `${props.gap ?? 8}px`,
          'align-items': props.align === 'start' ? 'flex-start' : 'center',
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

export function Matrix<R extends string, C extends string>(props: {
  rows: readonly R[];
  cols: readonly C[];
  rowLabel?: (row: R) => string;
  colLabel?: (col: C) => string;
  render: (row: R, col: C) => JSX.Element;
}) {
  return (
    <div
      class="wb-kit-matrix"
      style={{ 'grid-template-columns': `auto repeat(${props.cols.length}, auto)` }}
    >
      <div />
      <For each={props.cols}>
        {(col) => <div class="wb-kit-label">{props.colLabel ? props.colLabel(col) : col}</div>}
      </For>
      <For each={props.rows}>
        {(row) => (
          <>
            <div class="wb-kit-label">{props.rowLabel ? props.rowLabel(row) : row}</div>
            <For each={props.cols}>{(col) => <div class="wb-kit-cell">{props.render(row, col)}</div>}</For>
          </>
        )}
      </For>
    </div>
  );
}

export function Section(props: { title: string; description?: string; children?: JSX.Element }) {
  return (
    <section class="wb-kit-section">
      <h3 class="wb-kit-section-title">{props.title}</h3>
      <Show when={props.description}>
        <p class="wb-kit-section-description">{props.description}</p>
      </Show>
      {props.children}
    </section>
  );
}
