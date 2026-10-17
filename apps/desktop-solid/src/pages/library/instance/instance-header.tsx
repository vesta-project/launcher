import { Button, IconButton, Menu, MenuItem } from "@vesta/ui";
import { Show } from "solid-js";
import { Icon } from "../../../components/icon";
import { formatPlaytime, statsFor } from "../../../features/instances/details";
import {
  playInstance,
  retryInstance,
  type InstanceEntry,
} from "../../../features/instances/catalog";
import { route } from "../../../app/router";
import {
  nativeInstances,
  instancePending,
  openNativeInstanceFolder,
} from "../../../features/instances/native-service";
import { t } from "../../../localization";
import "./instance-header.css";

const loaderLogos: Record<string, string> = {
  fabric: "branding/modloaders/fabric-logo",
  forge: "branding/modloaders/forge-logo",
  neoforge: "branding/modloaders/neoforge-logo",
  quilt: "branding/modloaders/quilt-logo",
};

/** What the main button does in each state, mirroring the old launcher's header. */
function primaryAction(entry: InstanceEntry) {
  const state = entry.state;
  switch (state.kind) {
    case "running":
      return {
        label: t("instance.stop"),
        icon: "icons/actions/stop",
        tone: "danger" as const,
        disabled: false,
        run: () => playInstance(entry.instance.id),
      };
    case "warming":
      return {
        label: t("common.starting"),
        icon: "icons/actions/play",
        tone: "accent" as const,
        disabled: true,
        run: () => {},
      };
    case "installing":
      return {
        label: `${state.label}…`,
        icon: "icons/actions/play",
        tone: "accent" as const,
        disabled: true,
        run: () => {},
      };
    case "failed":
      return {
        label: t("instance.retry-installation"),
        icon: "icons/actions/play",
        tone: "accent" as const,
        disabled: !!state.retrying,
        run: () => retryInstance(entry.instance.id, "Installing"),
      };
    case "interrupted":
      return {
        label: state.initial
          ? t("management.install")
          : state.recovery
            ? t("instance.resume-recovery")
            : t("instance.resume"),
        icon: "icons/actions/play",
        tone: "accent" as const,
        disabled: !!state.resuming,
        run: () => retryInstance(entry.instance.id, "Resuming"),
      };
    default:
      return {
        label: t("instance.play"),
        icon: "icons/actions/play",
        tone: "accent" as const,
        disabled: false,
        run: () => playInstance(entry.instance.id),
      };
  }
}

/** A problem worth interrupting the page for: crashed, failed install, interrupted work. */
function notice(entry: InstanceEntry) {
  const state = entry.state;
  switch (state.kind) {
    case "crashed":
      return {
        tone: "danger",
        title: t("instance.crashed-title"),
        text: state.summary,
        action: t("instance.view-details"),
      };
    case "failed":
      return {
        tone: "danger",
        title: t("instance.installation-failed"),
        text: state.reason,
        action: undefined,
      };
    case "interrupted":
      if (state.initial) return undefined;
      return {
        tone: "warning",
        title: state.recovery
          ? t("instance.recovery-incomplete")
          : t("instance.interrupted", { label: state.label }),
        text: t("instance.resume-to-finish"),
        action: undefined,
      };
    default:
      return undefined;
  }
}

/**
 * Compact instance header: art band, identity, facts and actions in one row.
 * Navigation captures the whole header so its identity stays with the art.
 */
export function InstanceHeader(props: {
  entry: InstanceEntry;
  onOpenCrash: () => void;
  onOpenSettings: () => void;
  compact: boolean;
}) {
  const instance = () => props.entry.instance;
  const action = () => primaryAction(props.entry);
  const problem = () =>
    route().detail === "crash" && props.entry.state.kind === "crashed"
      ? undefined
      : notice(props.entry);
  const loaderLogo = () => loaderLogos[instance().modloader];

  return (
    <header
      data-vesta="instance-header"
      data-instance-id={instance().id}
      data-compact={props.compact ? "" : undefined}
      style={{ "--header-image": `url('${instance().image}')` } as never}
    >
      <div data-vesta="instance-header-art" aria-hidden="true" />

      <div data-vesta="instance-header-main">
        <img
          data-vesta="instance-header-icon"
          src={instance().image}
          alt=""
          draggable="false"
        />
        <div data-vesta="instance-header-copy">
          <h1 data-vesta="instance-header-title">{instance().name}</h1>
          <p data-vesta="instance-header-meta">
            <span>{instance().minecraftVersion}</span>
            <span data-vesta="instance-header-loader">
              <Show when={loaderLogo()}>
                <Icon name={loaderLogo()} size={12} />
              </Show>
              {instance().modloader}
            </span>
            <span data-vesta="instance-header-playtime">
              {t("instance.played-time", {
                time: formatPlaytime(statsFor(instance().id).playtimeMinutes),
              })}
            </span>
          </p>
        </div>

        <div data-vesta="instance-header-actions">
          <IconButton
            variant="ghost"
            label={t("instance.settings")}
            icon={<Icon name="icons/content/gear" />}
            onClick={props.onOpenSettings}
          />
          <Menu
            placement="bottom-end"
            trigger={(menuProps) => (
              <IconButton
                {...menuProps}
                variant="ghost"
                label={t("instance.actions")}
                tooltip={false}
                icon={<Icon name="icons/content/ellipsis-v" />}
              />
            )}
          >
            <MenuItem
              icon={<Icon name="icons/content/folder" />}
              disabled={!nativeInstances}
              onSelect={() =>
                void openNativeInstanceFolder(props.entry.instance.id)
              }
            >
              {t("instance.open-folder")}
            </MenuItem>
          </Menu>
          <Button
            tone={action().tone}
            disabled={action().disabled || instancePending(instance().id)}
            icon={<Icon name={action().icon} />}
            onClick={action().run}
          >
            {action().label}
          </Button>
        </div>
      </div>

      <Show when={problem()}>
        {(current) => (
          <div
            data-vesta="instance-notice"
            data-tone={current().tone}
            role="alert"
          >
            <Icon name="icons/status/error" size={14} />
            <p>
              <strong>{current().title}</strong>
              <Show when={current().text}>
                <span>{current().text}</span>
              </Show>
            </p>
            <Show when={current().action}>
              <Button
                size="sm"
                variant="outline"
                tone="danger"
                onClick={props.onOpenCrash}
              >
                {current().action}
              </Button>
            </Show>
          </div>
        )}
      </Show>
    </header>
  );
}
