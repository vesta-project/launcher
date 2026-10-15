import { Pagination as KobaltePagination } from '@kobalte/core/pagination';
import type { JSX } from '@solidjs/web';
import { ChevronLeftGlyph, ChevronRightGlyph } from '../../internal/icons';
import './pagination.css';

export interface PaginationProps {
  /** Total number of pages (1-indexed paging). */
  count: number;
  /** Controlled page (1-indexed). */
  page?: number;
  defaultPage?: number;
  onPageChange?: (page: number) => void;
  /** Pages shown on each side of the current page. Defaults to 1. */
  siblingCount?: number;
  disabled?: boolean;
  /** Accessible name for the nav. Defaults to "Pagination". */
  'aria-label'?: string;
  previousLabel?: string;
  nextLabel?: string;
  class?: string;
  style?: JSX.CSSProperties;
}

/** Page number list with previous/next controls. */
export function Pagination(props: PaginationProps) {
  return (
    <KobaltePagination
      data-vesta="pagination"
      class={props.class}
      style={props.style}
      count={props.count}
      page={props.page}
      defaultPage={props.defaultPage}
      onPageChange={props.onPageChange}
      siblingCount={props.siblingCount ?? 1}
      disabled={props.disabled}
      fixedItems
      itemComponent={(item) => (
        <KobaltePagination.Item data-vesta="pagination-item" page={item.page}>
          {item.page}
        </KobaltePagination.Item>
      )}
      ellipsisComponent={() => (
        <KobaltePagination.Ellipsis data-vesta="pagination-ellipsis">
          <span aria-hidden="true">…</span>
        </KobaltePagination.Ellipsis>
      )}
      aria-label={props['aria-label'] ?? 'Pagination'}
    >
      <KobaltePagination.Previous data-vesta="pagination-previous">
        <span data-vesta="pagination-icon" aria-hidden="true">
          <ChevronLeftGlyph />
        </span>
        <span data-vesta="pagination-label">{props.previousLabel ?? 'Previous'}</span>
      </KobaltePagination.Previous>
      <KobaltePagination.Items />
      <KobaltePagination.Next data-vesta="pagination-next">
        <span data-vesta="pagination-label">{props.nextLabel ?? 'Next'}</span>
        <span data-vesta="pagination-icon" aria-hidden="true">
          <ChevronRightGlyph />
        </span>
      </KobaltePagination.Next>
    </KobaltePagination>
  );
}
