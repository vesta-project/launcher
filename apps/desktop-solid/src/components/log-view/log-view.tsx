import { Metadata } from '../metadata';
import type { JSX } from "@solidjs/web";
import {
  Button,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuSeparator,
  Select,
  TextField,
} from "@vesta/ui";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { t } from "../../localization";
import { VirtualList } from "../virtual-list";
import { Icon } from "../icon";
import {
  LOG_LEVELS,
  filterLog,
  groupLogEntries,
  isGap,
  levelCounts,
  lineTotal,
  logText,
  type LogEntry,
  type LogLineEntry,
  type LogViewState,
} from "./log-model";
import "./log-view.css";

export type { LogEntry, LogViewState } from "./log-model";

/** Wrapped lines rendered at a time, and how many more each scroll to the top adds. */
const WRAP_PAGE = 160;

const levels = [
  { id: "INFO", label: "Info" },
  { id: "WARN", label: "Warn" },
  { id: "ERROR", label: "Error" },
  { id: "DEBUG", label: "Debug" },
];

export interface LogViewSource {
  value: string;
  label: string;
  description?: JSX.Element;
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
  loading?: () => boolean;
  /** Shown when nothing is displayed and no filter is narrowing the view. */
  emptyText: () => string;
  /** Owner-specific actions, appended to the log actions menu. */
  extraMenuItems?: JSX.Element;
  /** Owner-specific controls, placed before the log actions menu. */
  toolbarExtras?: JSX.Element;
  /** Content between the toolbar and the log, such as a notice. */
  banner?: JSX.Element;
  /** Prefix for the footer's line count, such as a file path. */
  footerDetail?: () => readonly (string | null | undefined)[] | undefined;
  footerTitle?: () => string | undefined;
  /**
   * Scrolled to the top with nothing more loaded above: fetch older lines (server history).
   * The view keeps its place when they arrive on top.
   */
  onReachTop?: () => Promise<unknown> | void;
  /** Older lines are on their way, for a quiet note at the top. */
  loadingEarlier?: () => boolean;
}

/** The console log surface shared by instance logs and server consoles. */
export function LogView(props: LogViewProps) {
  const [copyStatus, setCopyStatus] = createSignal("", {
    name: "log-view:copy-status",
  });
  const [metadata, setMetadata] = createSignal(false, {
    name: "log-view:metadata",
  });
  const [viewport, setViewport] = createSignal<HTMLDivElement | undefined>(
    undefined,
    { name: "log-view:viewport" },
  );
  /**
   * Wrapped lines can't be virtualised (their heights vary), so they render the newest
   * `wrapWindow` lines and the window grows as you scroll up to its top, keeping your place.
   */
  const [wrapWindow, setWrapWindow] = createSignal(WRAP_PAGE, {
    name: "log-view:wrap-window",
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
  const continuations = new WeakMap<LogLineEntry, LogLineEntry>();
  const sourceLines = createMemo(() => groupLogEntries(props.lines(), continuations), {
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
  let followFrame: number | undefined;
  const cancelFollow = () => {
    if (followFrame !== undefined) cancelAnimationFrame(followFrame);
    followFrame = undefined;
  };
  onCleanup(cancelFollow);
  createEffect(
    () => ({
      last: visible().at(-1)?.id,
      count: visible().length,
      follow: props.state().follow,
      source: props.sourceKey(),
      live: props.live(),
    }),
    ({ follow, live }) => {
      if (!follow || !live) { cancelFollow(); return; }
      if (followFrame !== undefined) return;
      followFrame = requestAnimationFrame(() => {
        followFrame = undefined;
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
    if (bottom !== props.state().follow) {
      if (bottom) setWrapWindow(WRAP_PAGE);
      patch({ follow: bottom });
    }
  };
  /**
   * Near the top with every loaded line shown: ask for older ones. Their arrival grows the
   * content above the view, so the scroll position moves by the same amount and nothing jumps.
   */
  let reachingTop = false;
  const reachTop = () => {
    const element = viewport();
    if (!element || !props.onReachTop || reachingTop || element.scrollTop > 120) return;
    if (props.state().wrap && wrappedPage().start > 0) return;
    reachingTop = true;
    const height = element.scrollHeight;
    const first = props.lines()[0]?.id;
    void Promise.resolve(props.onReachTop())
      .catch(() => undefined)
      .finally(() => {
        requestAnimationFrame(() => {
          if (props.lines()[0]?.id !== first) element.scrollTop += element.scrollHeight - height;
          reachingTop = false;
        });
      });
  };
  /** Near the top of a wrapped log with more above: render more, then hold the view still. */
  const growWrapped = () => {
    const element = viewport();
    if (!element || !props.state().wrap || element.scrollTop > 120) return;
    if (wrappedPage().start === 0) return;
    const before = element.scrollHeight;
    setWrapWindow((size) => size + WRAP_PAGE);
    requestAnimationFrame(() => {
      element.scrollTop += element.scrollHeight - before;
    });
  };
  const wrappedPage = createMemo(
    () => {
      const lines = visible();
      const start = Math.max(0, lines.length - wrapWindow());
      return { start, lines: lines.slice(start) };
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
      setWrapWindow(WRAP_PAGE);
    },
    { name: "log-view:reset-page" },
  );
  const rowKey = (line: LogEntry) => `${props.sourceKey()}:${line.id}`;
  const count = () => t("console.line-count", totals());
  return (
    <div
      data-vesta="console"
      data-metadata={metadata() ? "" : undefined}
    >
      <header data-vesta="console-toolbar">
        <div data-vesta="console-search-group">
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
          <Menu
            placement="bottom-end"
            trigger={(menuProps) => (
              <IconButton {...menuProps} size="sm" class="console-level-filter" variant="ghost"
                tone={props.state().levels.length === LOG_LEVELS.length ? "neutral" : "accent"}
                label={t("console.levels")} tooltip={false} icon={<Icon name="icons/content/filter" />} />
            )}
          >
            <For each={levels}>
              {(level) => (
                <MenuCheckboxItem
                  checked={props.state().levels.includes(level.id)}
                  onChange={() => toggleLevel(level.id)}
                >
                  <span data-vesta="console-level-option" data-level={level.id}>
                    <i aria-hidden="true" />{level.label}<small>{counts()[level.id] ?? 0}</small>
                  </span>
                </MenuCheckboxItem>
              )}
            </For>
          </Menu>
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
        onScroll={() => {
          scroll();
          growWrapped();
          reachTop();
        }}
        aria-busy={props.loading?.() || props.loadingEarlier?.() ? "true" : undefined}
      >
        <Show when={props.loadingEarlier?.()}>
          <p data-vesta="console-earlier" role="status"><span>{t("console.loading-earlier")}</span></p>
        </Show>
        <Show
          when={visible().length}
          fallback={
            <p data-vesta="console-empty">
              {props.loading?.()
                ? t("console.loading-output")
                : props.state().query || props.state().levels.length < LOG_LEVELS.length
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
            <For each={wrappedPage().lines} keyed={rowKey}>
              {(line) => <LogRow entry={line()} />}
            </For>
          </Show>
        </Show>
      </div>
      <footer data-vesta="console-status" data-tip={props.footerTitle?.()}>
        <span role="status">
          {copyStatus() ||
            (props.live() && !props.state().follow
              ? t("console.following-paused")
              : props.footerDetail?.()
                ? <Metadata parts={[...(props.footerDetail?.() ?? []), count()]} />
                : count())}
        </span>
        <Show when={props.live() && !props.state().follow}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setWrapWindow(WRAP_PAGE);
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
    >
      <time>{line()?.timestamp}</time>
      <span data-vesta="log-level">
        {line()?.level === "UNKNOWN" ? "" : line()?.level}
      </span>
      <span data-vesta="log-thread" data-tip-overflow="">
        {line()?.thread}
      </span>
      <span data-vesta="log-text">
        {line()?.message}
        <Show when={line()?.truncated}>
          <span
            data-vesta="log-truncated"
            role="img"
            aria-label={t("console.line-truncated")}
            data-tip={t("console.line-truncated")}
          >
            …
          </span>
        </Show>
      </span>
    </div>
  );
}
