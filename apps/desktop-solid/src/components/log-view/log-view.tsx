import type { JSX } from "@solidjs/web";
import {
  Button,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuSeparator,
  MenuSub,
  Select,
  TextField,
} from "@vesta/ui";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onSettled,
} from "solid-js";
import { t } from "../../localization";
import { VirtualList } from "../virtual-list";
import { Icon } from "../icon";
import {
  LOG_LEVELS,
  filterLog,
  isGap,
  levelCounts,
  lineTotal,
  logText,
  type LogEntry,
  type LogViewState,
} from "./log-model";
import "./log-view.css";

export type { LogEntry, LogViewState } from "./log-model";

const levels = [
  { id: "INFO", label: "Info" },
  { id: "WARN", label: "Warn" },
  { id: "ERROR", label: "Error" },
  { id: "DEBUG", label: "Debug" },
];

export interface LogViewSource {
  value: string;
  label: string;
  description?: string;
}

export interface LogViewProps {
  /** Every entry of the current source, oldest first, ids increasing. */
  lines: () => readonly LogEntry[];
  state: () => LogViewState;
  patch: (next: Partial<LogViewState>) => void;
  /** Entries with a smaller id are hidden by "Clear display". */
  hidden: () => number;
  canRestore: () => boolean;
  onClearDisplay: () => void;
  onRestoreDisplay: () => void;
  /** The source still grows, so following the end applies. */
  live: () => boolean;
  /** Identity of the current source; rows are keyed by it. */
  sourceKey: () => string;
  /** Owners with several sources pass them to show a source picker. */
  sources?: () => LogViewSource[];
  onSourceChange?: (value: string) => void;
  ariaLabel: () => string;
  /** Shown when nothing is displayed and no filter is narrowing the view. */
  emptyText: () => string;
  /** Owner-specific actions, appended to the log actions menu. */
  extraMenuItems?: JSX.Element;
  /** Owner-specific controls, placed before the log actions menu. */
  toolbarExtras?: JSX.Element;
  /** Content between the toolbar and the log, such as a notice. */
  banner?: JSX.Element;
  /** Prefix for the footer's line count, such as a file path. */
  footerDetail?: () => string | undefined;
  footerTitle?: () => string | undefined;
}

/** The console log surface shared by instance logs and server consoles. */
export function LogView(props: LogViewProps) {
  const [copyStatus, setCopyStatus] = createSignal("", {
    name: "log-view:copy-status",
  });
  let root!: HTMLDivElement;
  const [compact, setCompact] = createSignal(false, {
    name: "log-view:compact-toolbar",
  });
  onSettled(() => {
    const pane = root.closest(".instance-pane") ?? root;
    const observer = new ResizeObserver(([entry]) =>
      setCompact(entry.contentRect.width <= 560),
    );
    observer.observe(pane);
    return () => observer.disconnect();
  });
  const [metadata, setMetadata] = createSignal(false, {
    name: "log-view:metadata",
  });
  const [viewport, setViewport] = createSignal<HTMLDivElement | undefined>(
    undefined,
    { name: "log-view:viewport" },
  );
  const [earlierEnd, setEarlierEnd] = createSignal<number | null>(null, {
    name: "log-view:earlier-end",
  });
  const filterState = createMemo(
    () => ({
      source: props.sourceKey(),
      hidden: props.hidden(),
      levels: props.state().levels,
      query: props.state().query,
    }),
    {
      name: "log-view:filter-state",
      equals: (a, b) =>
        a.source === b.source &&
        a.hidden === b.hidden &&
        a.levels === b.levels &&
        a.query === b.query,
    },
  );
  const sourceLines = createMemo(() => props.lines(), {
    name: "log-view:source-lines",
  });
  const visible = createMemo(
    () => {
      const filter = filterState();
      return filterLog(sourceLines(), filter.hidden, filter.levels, filter.query);
    },
    { name: "log-view:filtered" },
  );
  /** Lines per level in the whole source, so the filters show what each would add. */
  const counts = createMemo(() => levelCounts(sourceLines()), {
    name: "log-view:level-counts",
  });
  const totals = createMemo(
    () => ({ visible: lineTotal(visible()), total: lineTotal(sourceLines()) }),
    { name: "log-view:totals" },
  );
  const patch = (next: Partial<LogViewState>) => props.patch(next);
  const toggleLevel = (level: string) =>
    patch({
      levels: props.state().levels.includes(level)
        ? props.state().levels.filter((item) => item !== level)
        : [...props.state().levels, level],
    });
  const copy = async (filtered: boolean) => {
    try {
      await navigator.clipboard.writeText(
        logText(filtered ? visible() : props.lines()),
      );
      setCopyStatus(t("console.copy-status"));
    } catch {
      setCopyStatus(t("console.copy-failed"));
    }
  };
  const choose = (value: string) => {
    if (value === props.sourceKey()) return;
    props.onSourceChange?.(value);
    setCopyStatus("");
    const element = viewport();
    if (element) element.scrollTop = 0;
  };
  createEffect(
    () => ({
      last: visible().at(-1)?.id,
      count: visible().length,
      follow: props.state().follow,
      source: props.sourceKey(),
      live: props.live(),
    }),
    ({ follow, live }) => {
      if (follow && live)
        queueMicrotask(() => {
          const element = viewport();
          if (element) element.scrollTop = element.scrollHeight;
        });
    },
    { name: "log-view:follow" },
  );
  const scroll = () => {
    const element = viewport();
    if (!element || !props.live()) return;
    const bottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 36;
    if (earlierEnd() === null && bottom !== props.state().follow)
      patch({ follow: bottom });
  };
  const wrappedPage = createMemo(
    () => {
      const lines = visible();
      const anchor = earlierEnd();
      const found =
        anchor === null ? -1 : lines.findIndex((line) => line.id > anchor);
      const end =
        found < 0
          ? lines.length
          : found === 0
            ? Math.min(2000, lines.length)
            : found;
      const start = Math.max(0, end - 2000);
      return { start, lines: lines.slice(start, end) };
    },
    { name: "log-view:wrapped-page" },
  );
  const pageScope = createMemo(
    () => ({ filter: filterState(), wrap: props.state().wrap }),
    {
      name: "log-view:page-scope",
      equals: (a, b) => a.filter === b.filter && a.wrap === b.wrap,
    },
  );
  createEffect(
    () => pageScope(),
    () => {
      setEarlierEnd(null);
    },
    { name: "log-view:reset-page" },
  );
  const rowKey = (line: LogEntry) => `${props.sourceKey()}:${line.id}`;
  const count = () => t("console.line-count", totals());
  return (
    <div
      data-vesta="console"
      ref={(element) => {
        root = element;
      }}
      data-metadata={metadata() ? "" : undefined}
    >
      <header data-vesta="console-toolbar">
        <Show when={props.sources}>
          <Select
            size="sm"
            aria-label={t("console.log-source")}
            class="console-source"
            value={props.sourceKey()}
            onChange={choose}
            options={props.sources?.() ?? []}
          />
        </Show>
        <TextField
          size="sm"
          class="console-search"
          aria-label={t("console.search-log")}
          placeholder={t("console.search-log")}
          value={props.state().query}
          onChange={(query) => patch({ query })}
        />
        <div data-vesta="console-levels" role="group" aria-label={t("console.levels")}>
          <For each={levels}>
            {(level) => (
              <button
                type="button"
                data-vesta="console-level"
                data-level={level.id}
                aria-pressed={
                  props.state().levels.includes(level.id) ? "true" : "false"
                }
                onClick={() => toggleLevel(level.id)}
              >
                <span data-vesta="console-level-dot" />
                {level.label}
                <span data-vesta="console-level-count">
                  {counts()[level.id] ?? 0}
                </span>
              </button>
            )}
          </For>
        </div>
        {props.toolbarExtras}
        <Menu
          placement="bottom-end"
          trigger={(menuProps) => (
            <IconButton
              {...menuProps}
              class="console-actions"
              variant="ghost"
              size="sm"
              tooltip={false}
              label={t("console.log-actions")}
              icon={<Icon name="icons/content/ellipsis-v" />}
            />
          )}
        >
          <Show when={compact()}>
            <MenuSub label={t("console.levels")}>
              <For each={levels}>
                {(level) => (
                  <MenuCheckboxItem
                    checked={props.state().levels.includes(level.id)}
                    onChange={() => toggleLevel(level.id)}
                  >
                    {level.label}
                  </MenuCheckboxItem>
                )}
              </For>
            </MenuSub>
            <MenuSeparator />
          </Show>
          <MenuItem onSelect={() => void copy(true)}>
            {t("console.copy-displayed")}
          </MenuItem>
          <MenuItem onSelect={() => void copy(false)}>{t("console.copy-entire")}</MenuItem>
          <MenuCheckboxItem
            checked={props.state().wrap}
            onChange={(wrap) => patch({ wrap })}
          >
            {t("console.wrap-lines")}
          </MenuCheckboxItem>
          <MenuCheckboxItem checked={metadata()} onChange={setMetadata}>
            {t("console.show-levels-threads")}
          </MenuCheckboxItem>
          <MenuSeparator />
          <MenuItem onSelect={() => props.onClearDisplay()}>
            {t("console.clear-display")}
          </MenuItem>
          <MenuItem
            disabled={!props.canRestore()}
            onSelect={() => props.onRestoreDisplay()}
          >
            {t("console.restore-display")}
          </MenuItem>
          {props.extraMenuItems}
        </Menu>
      </header>
      {props.banner}
      <div
        data-vesta="console-log"
        data-wrap={props.state().wrap ? "" : undefined}
        role="region"
        aria-label={props.ariaLabel()}
        tabindex={0}
        ref={setViewport}
        onScroll={scroll}
      >
        <Show
          when={visible().length}
          fallback={
            <p data-vesta="console-empty">
              {props.state().query || props.state().levels.length < LOG_LEVELS.length
                ? t("console.no-filter-matches")
                : props.emptyText()}
            </p>
          }
        >
          <Show
            when={props.state().wrap}
            fallback={
              <VirtualList
                items={visible()}
                key={rowKey}
                rowHeight={20}
                scrollElement={viewport()}
              >
                {(line) => <LogRow entry={line()} />}
              </VirtualList>
            }
          >
            <Show when={wrappedPage().start > 0}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  // Selecting an earlier page pauses live following without growing the DOM.
                  patch({ follow: false });
                  setEarlierEnd(visible()[wrappedPage().start - 1].id);
                  const element = viewport();
                  queueMicrotask(() => {
                    if (element) element.scrollTop = 0;
                  });
                }}
              >
                {t("console.show-earlier")}
              </Button>
            </Show>
            <Show when={earlierEnd() !== null}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEarlierEnd(null)}
              >
                {t("console.show-latest")}
              </Button>
            </Show>
            <For each={wrappedPage().lines} keyed={rowKey}>
              {(line) => <LogRow entry={line()} />}
            </For>
          </Show>
        </Show>
      </div>
      <footer data-vesta="console-status" title={props.footerTitle?.()}>
        <span role="status">
          {copyStatus() ||
            (props.live() && !props.state().follow
              ? t("console.following-paused")
              : props.footerDetail?.()
                ? `${props.footerDetail?.()} · ${count()}`
                : count())}
        </span>
        <Show when={props.live() && !props.state().follow}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEarlierEnd(null);
              patch({ follow: true });
            }}
          >
            {t("console.jump-latest")}
          </Button>
        </Show>
      </footer>
    </div>
  );
}

function LogRow(props: { entry: LogEntry }) {
  const gap = () => (isGap(props.entry) ? props.entry : undefined);
  return (
    <Show when={gap()} fallback={<LogLine entry={props.entry} />}>
      <div data-vesta="log-gap" role="note">
        <span>{gap()?.label}</span>
        <Show when={gap()?.detail}>
          <span data-vesta="log-gap-detail">{gap()?.detail}</span>
        </Show>
      </div>
    </Show>
  );
}

function LogLine(props: { entry: LogEntry }) {
  const line = () => (isGap(props.entry) ? undefined : props.entry);
  return (
    <div
      data-vesta="log-line"
      data-level={line()?.level}
      title={`${line()?.level} · ${line()?.thread}`}
    >
      <time>{line()?.timestamp}</time>
      <span data-vesta="log-level">
        {line()?.level === "UNKNOWN" ? "" : line()?.level}
      </span>
      <span data-vesta="log-thread" title={line()?.thread}>
        {line()?.thread}
      </span>
      <span data-vesta="log-text">
        {line()?.message}
        <Show when={line()?.truncated}>
          <span
            data-vesta="log-truncated"
            role="img"
            aria-label={t("console.line-truncated")}
            title={t("console.line-truncated")}
          >
            …
          </span>
        </Show>
      </span>
    </div>
  );
}
