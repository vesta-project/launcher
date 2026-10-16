import { Button, IconButton, Menu, MenuItem } from "@vesta/ui";
import { Show } from "solid-js";
import { instanceArtTransitionName } from "../../../app/transition";
import { Icon } from "../../../components/icon";
import { formatPlaytime, statsFor } from "../../../features/instances/details";
import {
  playInstance,
  retryInstance,
  type InstanceEntry,
} from "../../../features/instances/fixtures";
import { route } from "../../../app/router";
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
        label: "Stop",
        icon: "icons/actions/stop",
        tone: "danger" as const,
        disabled: false,
        run: () => playInstance(entry.instance.id),
      };
    case "warming":
      return {
        label: "Starting…",
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
        label: "Retry installation",
        icon: "icons/actions/play",
        tone: "accent" as const,
        disabled: !!state.retrying,
        run: () => retryInstance(entry.instance.id, "Installing"),
      };
    case "interrupted":
      return {
        label: state.recovery ? "Resume recovery" : "Resume",
        icon: "icons/actions/play",
        tone: "accent" as const,
        disabled: !!state.resuming,
        run: () => retryInstance(entry.instance.id, "Resuming"),
      };
    default:
      return {
        label: "Play",
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
        title: "The game crashed",
        text: state.summary,
        action: "View details",
      };
    case "failed":
      return {
        tone: "danger",
        title: "Installation failed",
        text: state.reason,
        action: undefined,
      };
    case "interrupted":
      return {
        tone: "warning",
        title: state.recovery
          ? "Recovery is incomplete"
          : `${state.label} was interrupted`,
        text: "Resume to finish where it stopped.",
        action: undefined,
      };
    default:
      return undefined;
  }
}

/**
 * Compact instance header: art band, identity, facts and actions in one row.
 * The art layer carries the shared view-transition name, so opening the page from a
 * card morphs the card's art into this band.
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
      data-compact={props.compact ? "" : undefined}
      style={{ "--header-image": `url('${instance().image}')` } as never}
    >
      <div
        data-vesta="instance-header-art"
        style={{ "view-transition-name": instanceArtTransitionName }}
        aria-hidden="true"
      />

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
              {formatPlaytime(statsFor(instance().id).playtimeMinutes)} played
            </span>
          </p>
        </div>

        <div data-vesta="instance-header-actions">
          <IconButton
            variant="ghost"
            label="Instance settings"
            icon={<Icon name="icons/content/gear" />}
            onClick={props.onOpenSettings}
          />
          <Menu
            placement="bottom-end"
            trigger={(menuProps) => (
              <IconButton
                {...menuProps}
                variant="ghost"
                label="Instance actions"
                tooltip={false}
                icon={<Icon name="icons/content/ellipsis-v" />}
              />
            )}
          >
            <MenuItem icon={<Icon name="icons/content/folder" />} disabled>
              Open instance folder
            </MenuItem>
          </Menu>
          <Button
            tone={action().tone}
            disabled={action().disabled}
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
