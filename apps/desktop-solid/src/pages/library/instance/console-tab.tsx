import {
  Button,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuSeparator,
  MenuSub,
  Select,
  Switch,
  TextField,
} from "@vesta/ui";

const levels = [
  { id: "INFO", label: "Info" },
  { id: "WARN", label: "Warn" },
  { id: "ERROR", label: "Error" },
  { id: "DEBUG", label: "Debug" },
];
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  untrack,
  onSettled,
} from "solid-js";
import { navigate } from "../../../app/router";
import { VirtualList } from "../../../components/virtual-list";
import { Icon } from "../../../components/icon";
import { consoleSession } from "../../../features/instances/console-session";
import {
  nativeInstances,
  openNativeLogsFolder,
} from "../../../features/instances/native-service";
import {
  matchesLog,
  type ParsedLog,
} from "../../../features/instances/interaction-utils";
import type { InstanceEntry } from "../../../features/instances/catalog";
import "./console-tab.css";

export function ConsoleTab(props: { entry: InstanceEntry }) {
  const session = consoleSession(untrack(() => props.entry.instance.id));
  onSettled(() => session.connect());
  const state = session.state;
  const source = () =>
    session.sources().find((item) => item.id === state().source) ??
    session.sources()[0];
  const [copyStatus, setCopyStatus] = createSignal("", {
    name: "console:copy-status",
  });
  let root!: HTMLDivElement;
  const [compact, setCompact] = createSignal(false, {
    name: "console:compact-toolbar",
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
    name: "console:metadata",
  });
  const [viewport, setViewport] = createSignal<HTMLDivElement | undefined>(
    undefined,
    { name: "console:viewport" },
  );
  const [earlierEnd, setEarlierEnd] = createSignal<number | null>(null, {
    name: "console:earlier-end",
  });
  const filterState = createMemo(
    () => ({
      source: state().source,
      hidden: state().hiddenUntil[state().source] ?? 0,
      levels: state().levels,
      query: state().query,
    }),
    {
      name: "console:filter-state",
      equals: (a, b) =>
        a.source === b.source &&
        a.hidden === b.hidden &&
        a.levels === b.levels &&
        a.query === b.query,
    },
  );
  const sourceLines = createMemo(() => session.lines(), {
    name: "console:source-lines",
  });
  const visible = createMemo(
    () => {
      const filter = filterState();
      return sourceLines().filter(
        (line) =>
          line.id >= filter.hidden &&
          matchesLog(line, filter.levels, filter.query),
      );
    },
    { name: "console:filtered" },
  );
  /** Lines per level in the whole source, so the filters show what each would add. */
  const counts = createMemo(
    () => {
      const result: Record<string, number> = {};
      for (const line of sourceLines()) {
        const level = line.level === "FATAL" ? "ERROR" : line.level;
        result[level] = (result[level] ?? 0) + 1;
      }
      return result;
    },
    { name: "console:level-counts" },
  );
  const toggleLevel = (level: string) =>
    patch({
      levels: state().levels.includes(level)
        ? state().levels.filter((item) => item !== level)
        : [...state().levels, level],
    });
  const raw = (filtered: boolean) =>
    (filtered ? visible() : session.lines()).map((line) => line.raw).join("\n");
  const copy = async (filtered: boolean) => {
    try {
      await navigator.clipboard.writeText(raw(filtered));
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed — select and copy the text below.");
    }
  };
  const patch = (next: Partial<ReturnType<typeof state>>) =>
    session.setState((current) => ({ ...current, ...next }));
  const choose = (id: string) => {
    if (id === state().source) return;
    void session.choose(id);
    setCopyStatus("");
    const element = viewport();
    if (element) element.scrollTop = 0;
  };
  createEffect(
    () => ({
      last: visible().at(-1)?.id,
      count: visible().length,
      follow: state().follow,
      source: state().source,
    }),
    ({ follow, source: chosen }) => {
      if (follow && chosen === "live")
        queueMicrotask(() => {
          const element = viewport();
          if (element) element.scrollTop = element.scrollHeight;
        });
    },
    { name: "console:follow" },
  );
  const scroll = () => {
    const element = viewport();
    if (!element || state().source !== "live") return;
    const bottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 36;
    if (earlierEnd() === null && bottom !== state().follow)
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
    { name: "console:wrapped-page" },
  );
  const pageScope = createMemo(
    () => ({ filter: filterState(), wrap: state().wrap }),
    {
      name: "console:page-scope",
      equals: (a, b) => a.filter === b.filter && a.wrap === b.wrap,
    },
  );
  createEffect(
    () => pageScope(),
    () => {
      setEarlierEnd(null);
    },
    { name: "console:reset-page" },
  );
  return (
    <div
      data-vesta="console"
      ref={(element) => {
        root = element;
      }}
      data-metadata={metadata() ? "" : undefined}
    >
      <header data-vesta="console-toolbar">
        <Select
          size="sm"
          aria-label="Log source"
          class="console-source"
          value={state().source}
          onChange={choose}
          options={session.sources().map((item) => ({
            value: item.id,
            label: item.name,
            description:
              item.kind === "live"
                ? props.entry.state.kind === "running"
                  ? "Live game output"
                  : "Retained output · game stopped"
                : `${item.modified} · ${item.size}`,
          }))}
        />
        <TextField
          size="sm"
          class="console-search"
          aria-label="Search log"
          placeholder="Search log"
          value={state().query}
          onChange={(query) => patch({ query })}
        />
        <div data-vesta="console-levels" role="group" aria-label="Levels">
          <For each={levels}>
            {(level) => (
              <button
                type="button"
                data-vesta="console-level"
                data-level={level.id}
                aria-pressed={
                  state().levels.includes(level.id) ? "true" : "false"
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
        <Switch
          size="sm"
          class="console-follow"
          label="Follow"
          aria-label="Follow"
          disabled={source().kind !== "live"}
          checked={source().kind === "live" && state().follow}
          onChange={(follow) => {
            if (follow) setEarlierEnd(null);
            patch({ follow });
          }}
        />
        <Menu
          placement="bottom-end"
          trigger={(menuProps) => (
            <IconButton
              {...menuProps}
              class="console-actions"
              variant="ghost"
              size="sm"
              tooltip={false}
              label="Log actions"
              icon={<Icon name="icons/content/ellipsis-v" />}
            />
          )}
        >
          <Show when={compact()}>
            <MenuSub label="Levels">
              <For each={levels}>
                {(level) => (
                  <MenuCheckboxItem
                    checked={state().levels.includes(level.id)}
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
            Copy displayed output
          </MenuItem>
          <MenuItem onSelect={() => void copy(false)}>Copy entire log</MenuItem>
          <MenuCheckboxItem
            checked={state().wrap}
            onChange={(wrap) => patch({ wrap })}
          >
            Wrap long lines
          </MenuCheckboxItem>
          <MenuCheckboxItem checked={metadata()} onChange={setMetadata}>
            Show levels and threads
          </MenuCheckboxItem>
          <MenuSeparator />
          <MenuItem onSelect={() => session.clearDisplay()}>
            Clear display
          </MenuItem>
          <MenuItem
            disabled={!state().hiddenUntil[state().source]}
            onSelect={() => session.restoreDisplay()}
          >
            Restore displayed output
          </MenuItem>
          <MenuItem
            disabled={!nativeInstances}
            onSelect={() => void openNativeLogsFolder(props.entry.instance.id)}
          >
            Open logs folder
          </MenuItem>
          <Show when={props.entry.state.kind === "crashed"}>
            <MenuSeparator />
            <MenuItem
              onSelect={() =>
                navigate(`/library/${props.entry.instance.id}/crash`, {
                  replace: true,
                })
              }
            >
              View crash report
            </MenuItem>
          </Show>
        </Menu>
      </header>
      <div
        data-vesta="console-log"
        data-wrap={state().wrap ? "" : undefined}
        role="region"
        aria-label={`${source().name} log output`}
        tabindex={0}
        ref={setViewport}
        onScroll={scroll}
      >
        <Show
          when={visible().length}
          fallback={
            <p data-vesta="console-empty">
              {state().query || state().levels.length < 4
                ? "No lines match the current filters."
                : "No displayed output."}
            </p>
          }
        >
          <Show
            when={state().wrap}
            fallback={
              <VirtualList
                items={visible()}
                key={(line) => `${state().source}:${line.id}`}
                rowHeight={20}
                scrollElement={viewport()}
              >
                {(line) => <LogLine line={line()} />}
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
                Show earlier lines
              </Button>
            </Show>
            <Show when={earlierEnd() !== null}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEarlierEnd(null)}
              >
                Show latest lines
              </Button>
            </Show>
            <For
              each={wrappedPage().lines}
              keyed={(line) => `${state().source}:${line.id}`}
            >
              {(line) => <LogLine line={line()} />}
            </For>
          </Show>
        </Show>
      </div>
      <footer
        data-vesta="console-status"
        title={`${source().path ?? "Current launcher capture"} · ${source().modified} ${source().size}`}
      >
        <span role="status">
          {copyStatus() ||
            (state().source === "live" && !state().follow
              ? "Following paused"
              : source().kind === "file"
                ? `${source().path} · ${source().modified} · ${visible().length} of ${session.lines().length} lines`
                : `${visible().length} of ${session.lines().length} lines`)}
        </span>
        <Show when={state().source === "live" && !state().follow}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEarlierEnd(null);
              patch({ follow: true });
            }}
          >
            Jump to latest
          </Button>
        </Show>
      </footer>
    </div>
  );
}

function LogLine(props: { line: ParsedLog }) {
  return (
    <div
      data-vesta="log-line"
      data-level={props.line.level}
      title={`${props.line.level} · ${props.line.thread}`}
    >
      <time>{props.line.timestamp}</time>
      <span data-vesta="log-level">
        {props.line.level === "UNKNOWN" ? "" : props.line.level}
      </span>
      <span data-vesta="log-thread" title={props.line.thread}>
        {props.line.thread}
      </span>
      <span data-vesta="log-text">{props.line.message}</span>
    </div>
  );
}
