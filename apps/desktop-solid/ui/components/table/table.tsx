import type { JSX } from '@solidjs/web';
import './table.css';

export interface TableProps {
  class?: string;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
}

/** Accessible data table shell. Compose with header/body/row/cell parts. */
export function Table(props: TableProps) {
  return (
    <div data-vesta="table-scroll" class={props.class} style={props.style}>
      <table data-vesta="table">{props.children}</table>
    </div>
  );
}

export interface TableCaptionProps {
  class?: string;
  children?: JSX.Element;
}

export function TableCaption(props: TableCaptionProps) {
  return (
    <caption data-vesta="table-caption" class={props.class}>
      {props.children}
    </caption>
  );
}

export interface TableSectionProps {
  class?: string;
  children?: JSX.Element;
}

export function TableHeader(props: TableSectionProps) {
  return (
    <thead data-vesta="table-header" class={props.class}>
      {props.children}
    </thead>
  );
}

export function TableBody(props: TableSectionProps) {
  return (
    <tbody data-vesta="table-body" class={props.class}>
      {props.children}
    </tbody>
  );
}

export function TableFooter(props: TableSectionProps) {
  return (
    <tfoot data-vesta="table-footer" class={props.class}>
      {props.children}
    </tfoot>
  );
}

export interface TableRowProps {
  class?: string;
  style?: JSX.CSSProperties;
  children?: JSX.Element;
}

export function TableRow(props: TableRowProps) {
  return (
    <tr data-vesta="table-row" class={props.class} style={props.style}>
      {props.children}
    </tr>
  );
}

export interface TableCellProps {
  class?: string;
  style?: JSX.CSSProperties;
  /** Numeric columns right-align by default when set. */
  numeric?: boolean;
  colspan?: number;
  rowspan?: number;
  children?: JSX.Element;
}

export function TableHead(props: TableCellProps) {
  return (
    <th
      data-vesta="table-head"
      data-numeric={props.numeric ? '' : undefined}
      class={props.class}
      style={props.style}
      colspan={props.colspan}
      rowspan={props.rowspan}
      scope="col"
    >
      {props.children}
    </th>
  );
}

export function TableCell(props: TableCellProps) {
  return (
    <td
      data-vesta="table-cell"
      data-numeric={props.numeric ? '' : undefined}
      class={props.class}
      style={props.style}
      colspan={props.colspan}
      rowspan={props.rowspan}
    >
      {props.children}
    </td>
  );
}
