import {
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuItem,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  Select,
  TextField,
} from "@vesta/ui";
import { For, Show, createMemo, createSignal } from "solid-js";
import { navigate, route } from "../../../app/router";
import { EmptyState } from "../../../components/empty-state";
import { Icon } from "../../../components/icon";
import {
  copyWorldFixture,
  deleteWorldFixture,
  importWorldFixture,
  worldsFor,
  type WorldInfo,
} from "../../../features/instances/details";
import {
  findInstance,
  instances,
  type InstanceEntry,
} from "../../../features/instances/fixtures";
import { ResourcesTab } from "./resources-tab";
import "./worlds-tab.css";

export function WorldsTab(props: { entry: InstanceEntry }) {
  const id = () => props.entry.instance.id;
  const [query, setQuery] = createSignal("");
  const [sort, setSort] = createSignal("recency");
  const [deleting, setDeleting] = createSignal<WorldInfo>();
  const [transfer, setTransfer] = createSignal<{
    world: WorldInfo;
    move: boolean;
  }>();
  const [destination, setDestination] = createSignal("");
  const [acknowledged, setAcknowledged] = createSignal(false);
  let importer: HTMLInputElement | undefined;
  const worlds = createMemo(() => {
    const list = worldsFor(id()).filter((world) =>
      world.name.toLowerCase().includes(query().toLowerCase()),
    );
    return sort() === "name"
      ? list.toSorted((a, b) => a.name.localeCompare(b.name))
      : sort() === "size"
        ? list.toSorted((a, b) => b.sizeMb - a.sizeMb)
        : list;
  });
  const chosen = () =>
    worldsFor(id()).find((world) => world.id === route().item);
  const manage = (world?: WorldInfo) =>
    navigate(`/library/${id()}/worlds${world ? `/${world.id}` : ""}`);
  const target = () => findInstance(destination());
  const mismatch = () =>
    !!target() &&
    target()!.instance.minecraftVersion !==
      props.entry.instance.minecraftVersion;
  const startTransfer = (world: WorldInfo, move: boolean) => {
    setAcknowledged(false);
    setDestination("");
    setTransfer({ world, move });
  };
  const actions = (world: WorldInfo, context = false) => {
    const Item = context ? ContextMenuItem : MenuItem;
    return (
      <>
        <Item onSelect={() => manage(world)}>Manage datapacks</Item>
        <Item disabled>Open world folder</Item>
        <Item onSelect={() => startTransfer(world, false)}>
          Copy to another instance…
        </Item>
        <Item onSelect={() => startTransfer(world, true)}>
          Move to another instance…
        </Item>
        <Item onSelect={() => copyWorldFixture(id(), id(), world.id)}>
          Duplicate
        </Item>
        <Item tone="danger" onSelect={() => setDeleting(world)}>
          Delete world…
        </Item>
      </>
    );
  };
  return (
    <div data-vesta="worlds">
      <Show
        when={chosen()}
        fallback={
          <>
            <header data-vesta="pane-toolbar">
              <TextField
                size="sm"
                aria-label="Search worlds"
                placeholder="Search worlds"
                value={query()}
                onChange={setQuery}
                class="world-search"
              />
              <Select
                size="sm"
                aria-label="Sort worlds"
                value={sort()}
                onChange={setSort}
                options={[
                  { value: "recency", label: "Recently played" },
                  { value: "name", label: "Name" },
                  { value: "size", label: "Size" },
                ]}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => importer?.click()}
              >
                Import world
              </Button>
              <input
                ref={(el) => {
                  importer = el;
                }}
                type="file"
                accept=".zip,.mcworld"
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file)
                    importWorldFixture(
                      id(),
                      file.name.replace(/\.(zip|mcworld)$/i, ""),
                    );
                  event.currentTarget.value = "";
                }}
              />
            </header>
            <Show
              when={worlds().length}
              fallback={
                <EmptyState
                  icon="icons/content/globe"
                  title={query() ? "No matching worlds" : "No worlds yet"}
                  description={
                    query()
                      ? "Try another search."
                      : "Create a world in Minecraft or import an existing save."
                  }
                />
              }
            >
              <ul data-vesta="world-list">
                <For each={worlds()}>
                  {(world) => (
                    <ContextMenu
                      trigger={(contextProps) => (
                        <li {...contextProps} data-vesta="world-row">
                          <button
                            type="button"
                            data-vesta="world-open"
                            onClick={() => manage(world)}
                            aria-label={`Manage ${world.name}`}
                          >
                            <img
                              data-vesta="world-thumb"
                              src={world.image}
                              alt=""
                              loading="lazy"
                            />
                            <span data-vesta="world-copy">
                              <strong>{world.name}</strong>
                              <span>
                                <span
                                  data-vesta="mode-tag"
                                  data-mode={world.mode.toLowerCase()}
                                >
                                  {world.mode}
                                </span>
                                Day {world.days}
                              </span>
                            </span>
                          </button>
                          <span data-vesta="world-meta">
                            {world.lastPlayed}
                            <span>{world.sizeMb} MB</span>
                          </span>
                          <Menu
                            placement="bottom-end"
                            trigger={(menuProps) => (
                              <IconButton
                                {...menuProps}
                                variant="ghost"
                                size="sm"
                                tooltip={false}
                                label={`Actions for ${world.name}`}
                                icon={<Icon name="icons/content/ellipsis-v" />}
                              />
                            )}
                          >
                            {actions(world)}
                          </Menu>
                        </li>
                      )}
                    >
                      {actions(world, true)}
                    </ContextMenu>
                  )}
                </For>
              </ul>
            </Show>
          </>
        }
      >
        {(world) => (
          <div data-vesta="world-detail">
            <header data-vesta="world-detail-header">
              <IconButton
                size="sm"
                variant="ghost"
                label="All worlds"
                icon={<Icon name="icons/navigation/arrow-back" />}
                onClick={() => manage()}
              />
              <img src={world().image} alt="" draggable="false" />
              <div data-vesta="world-detail-copy">
                <h2>{world().name}</h2>
                <span>
                  <span
                    data-vesta="mode-tag"
                    data-mode={world().mode.toLowerCase()}
                  >
                    {world().mode}
                  </span>
                  Day {world().days} · {world().lastPlayed} · {world().sizeMb}{" "}
                  MB
                </span>
              </div>
              <span data-vesta="world-detail-section">
                <Icon name="icons/content/layers" size={14} />
                Datapacks
              </span>
            </header>
            <ResourcesTab entry={props.entry} world={world()} />
          </div>
        )}
      </Show>
      <Dialog
        title={`Delete “${deleting()?.name ?? ""}”?`}
        description="This removes the world and its datapacks. Keep a backup before deleting a save."
        size="sm"
        open={!!deleting()}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(undefined)}>
              Cancel
            </Button>
            <Button
              tone="danger"
              onClick={() => {
                const world = deleting();
                if (world) {
                  deleteWorldFixture(id(), world.id);
                  if (route().item === world.id) manage();
                }
                setDeleting(undefined);
              }}
            >
              Delete world
            </Button>
          </>
        }
      />
      <Dialog
        title={`${transfer()?.move ? "Move" : "Copy"} “${transfer()?.world.name ?? ""}”`}
        open={!!transfer()}
        onOpenChange={(open) => {
          if (!open) setTransfer(undefined);
        }}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTransfer(undefined)}>
              Cancel
            </Button>
            <Button
              tone="accent"
              disabled={!target() || (mismatch() && !acknowledged())}
              onClick={() => {
                const pending = transfer();
                if (pending && target())
                  copyWorldFixture(
                    id(),
                    destination(),
                    pending.world.id,
                    pending.move,
                  );
                setTransfer(undefined);
              }}
            >
              {transfer()?.move ? "Move world" : "Copy world"}
            </Button>
          </>
        }
      >
        <Select
          label="Destination instance"
          value={destination()}
          onChange={(value) => {
            setDestination(value);
            setAcknowledged(false);
          }}
          options={instances()
            .filter((entry) => entry.instance.id !== id())
            .map((entry) => ({
              value: entry.instance.id,
              label: entry.instance.name,
              description: entry.instance.minecraftVersion,
            }))}
        />
        <Show when={mismatch()}>
          <p data-vesta="world-transfer-warning">
            The destination uses Minecraft {target()?.instance.minecraftVersion}
            . Opening a save in a different version can damage it.
          </p>
          <Checkbox
            label="I have a backup and understand the risk"
            checked={acknowledged()}
            onChange={setAcknowledged}
          />
        </Show>
      </Dialog>
    </div>
  );
}
