import { Breadcrumbs as KobalteBreadcrumbs } from '@kobalte/core/breadcrumbs';
import type { JSX } from '@solidjs/web';
import { children, Show } from 'solid-js';
import { ChevronRightGlyph } from '../../internal/icons';
import './breadcrumb.css';

export interface BreadcrumbsProps {
  /** Separator between items. Defaults to a chevron. */
  separator?: JSX.Element;
  'aria-label'?: string;
  class?: string;
  style?: JSX.CSSProperties;
  /** `BreadcrumbItem` elements. */
  children?: JSX.Element;
}

/** Hierarchy trail for the current location. */
export function Breadcrumbs(props: BreadcrumbsProps) {
  // Always pass translations — Solid 2 merge() treats explicit `undefined` as set
  // and would wipe Kobalte’s default, crashing on `translations.breadcrumbs`.
  const translations = () => ({
    breadcrumbs: props['aria-label'] ?? 'Breadcrumbs',
  });
  const separator = children(() => props.separator ?? <ChevronRightGlyph />);

  return (
    <KobalteBreadcrumbs
      data-vesta="breadcrumbs"
      class={props.class}
      style={props.style}
      separator={separator()}
      translations={translations()}
    >
      <ol data-vesta="breadcrumb-list">{props.children}</ol>
    </KobalteBreadcrumbs>
  );
}

export interface BreadcrumbItemProps {
  /** Destination. Omit (or set `current`) for the current page. */
  href?: string;
  /** Marks this item as the current page. */
  current?: boolean;
  class?: string;
  children?: JSX.Element;
}

export function BreadcrumbItem(props: BreadcrumbItemProps) {
  const current = () => props.current || props.href == null;

  return (
    <li data-vesta="breadcrumb-item" class={props.class}>
      <Show
        when={!current()}
        fallback={
          <KobalteBreadcrumbs.Link data-vesta="breadcrumb-link" current as="span">
            {props.children}
          </KobalteBreadcrumbs.Link>
        }
      >
        <KobalteBreadcrumbs.Link data-vesta="breadcrumb-link" href={props.href}>
          {props.children}
        </KobalteBreadcrumbs.Link>
      </Show>
      <Show when={!current()}>
        <KobalteBreadcrumbs.Separator data-vesta="breadcrumb-separator" />
      </Show>
    </li>
  );
}
