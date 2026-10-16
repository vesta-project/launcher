import {
  Button,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuSeparator,
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
} from "solid-js";
import { navigate } from "../../../app/router";
import { Icon } from "../../../components/icon";
import {
  consoleSession,
  logSources,
} from "../../../features/instances/console-session";
import { matchesLog } from "../../../features/instances/interaction-utils";
import type { InstanceEntry } from "../../../features/instances/fixtures";
import "./console-tab.css";

export function ConsoleTab(props: { entry: InstanceEntry }) {
  const session = consoleSession(untrack(() => props.entry.instance.id));
  const state = session.state;
  const source = () => logSources.find((item) => item.id === state().source)!;
  const [copyStatus, setCopyStatus] = createSignal("");
  const [metadata, setMetadata] = createSignal(false);
  let viewport: HTMLDivElement | undefined;
  const visible = createMemo(() =>
    session
      .lines()
      .filter(
        (line) =>
          line.id >= (state().hiddenUntil[state().source] ?? 0) &&
          matchesLog(line, state().levels, state().query),
      ),
  );
  /** Lines per level in the whole source, so the filters show what each would add. */
  const counts = createMemo(() => {
    const result: Record<string, number> = {};
    for (const line of session.lines()) {
      const level = line.level === "FATAL" ? "ERROR" : line.level;
      result[level] = (result[level] ?? 0) + 1;
    }
    return result;
  });
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
    patch({ source: id, follow: id === "live" });
    setCopyStatus("");
    if (viewport) viewport.scrollTop = 0;
  };
  createEffect(
    () => ({
      count: visible().length,
      follow: state().follow,
      source: state().source,
    }),
    ({ follow, source: chosen }) => {
      if (follow && chosen === "live")
        queueMicrotask(() => {
          if (viewport) viewport.scrollTop = viewport.scrollHeight;
        });
    },
  );
  const scroll = () => {
    if (!viewport || state().source !== "live") return;
    const bottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 36;
    if (bottom !== state().follow) patch({ follow: bottom });
  };
  return (
    <div data-vesta="console" data-metadata={metadata() ? "" : undefined}>
      <header data-vesta="console-toolbar">
        <Select
          size="sm"
          aria-label="Log source"
          class="console-source"
          value={state().source}
          onChange={choose}
          options={logSources.map((item) => ({
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
          label="Follow"
          disabled={source().kind !== "live"}
          checked={source().kind === "live" && state().follow}
          onChange={(follow) => patch({ follow })}
        />
        <Menu
          placement="bottom-end"
          trigger={(menuProps) => (
            <IconButton
              {...menuProps}
              variant="ghost"
              size="sm"
              tooltip={false}
              label="Log actions"
              icon={<Icon name="icons/content/ellipsis-v" />}
            />
          )}
        >
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
          <MenuItem disabled>Open logs folder</MenuItem>
          <Show when={props.entry.state.kind === "crashed"}>
            <MenuSeparator />
            <MenuItem
              onSelect={() =>
                navigate(`/library/${props.entry.instance.id}/crash`)
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
        ref={(el) => {
          viewport = el;
        }}
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
          <Show when={state().source} keyed>
            {(_source) => (
              <For each={visible()} keyed={(line) => line.id}>
                {(line) => (
                  <div
                    data-vesta="log-line"
                    data-level={line().level}
                    title={`${line().level} · ${line().thread}`}
                  >
                    <time>{line().timestamp}</time>
                    <span data-vesta="log-level">
                      {line().level === "UNKNOWN" ? "" : line().level}
                    </span>
                    <span data-vesta="log-thread" title={line().thread}>
                      {line().thread}
                    </span>
                    <span data-vesta="log-text">{line().message}</span>
                  </div>
                )}
              </For>
            )}
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
            onClick={() => patch({ follow: true })}
          >
            Jump to latest
          </Button>
        </Show>
      </footer>
    </div>
  );
}
