import { MenuItem, MenuSeparator } from "@vesta/ui";
import { Show, untrack, onSettled } from "solid-js";
import { navigate } from "../../../app/router";
import { t } from "../../../localization";
import { LogView } from "../../../components/log-view/log-view";
import { consoleSession } from "../../../features/instances/console-session";
import {
  nativeInstances,
  openNativeLogsFolder,
} from "../../../features/instances/native-service";
import type { InstanceEntry } from "../../../features/instances/catalog";

export function ConsoleTab(props: { entry: InstanceEntry }) {
  const session = consoleSession(untrack(() => props.entry.instance.id));
  onSettled(() => session.connect());
  const state = session.state;
  const source = () =>
    session.sources().find((item) => item.id === state().source) ??
    session.sources()[0];
  const sourceName = () =>
    source().kind === "live" ? t("console.live-output") : source().name;
  return (
    <LogView
      lines={session.lines}
      state={state}
      patch={(next) => session.setState((current) => ({ ...current, ...next }))}
      hidden={() => state().hiddenUntil[state().source] ?? 0}
      canRestore={() => !!state().hiddenUntil[state().source]}
      onClearDisplay={() => session.clearDisplay()}
      onRestoreDisplay={() => session.restoreDisplay()}
      live={() => state().source === "live"}
      sourceKey={() => state().source}
      sources={() =>
        session.sources().map((item) => ({
          value: item.id,
          label: item.kind === "live" ? t("console.live-output") : item.name,
          description:
            item.kind === "live"
              ? props.entry.state.kind === "running"
                ? t("console.source-live-game")
                : t("console.source-stopped")
              : `${item.modified} · ${item.size}`,
        }))
      }
      onSourceChange={(id) => void session.choose(id)}
      ariaLabel={() => t("console.log-output", { name: sourceName() })}
      emptyText={() => t("console.no-output")}
      footerDetail={() =>
        source().kind === "file"
          ? `${source().path} · ${source().modified}`
          : undefined
      }
      footerTitle={() =>
        `${source().path ?? t("console.current-capture")} · ${source().modified} ${source().size}`
      }
      extraMenuItems={
        <>
          <MenuItem
            disabled={!nativeInstances}
            onSelect={() => void openNativeLogsFolder(props.entry.instance.id)}
          >
            {t("console.open-logs")}
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
        </>
      }
    />
  );
}
