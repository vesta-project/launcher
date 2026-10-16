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
import { t } from "../../../localization";
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
        <Item onSelect={() => manage(world)}>{t("worlds.manage")}</Item>
        <Item disabled>{t("worlds.open-folder")}</Item>
        <Item onSelect={() => startTransfer(world, false)}>{t("worlds.copy-to-instance")}</Item>
        <Item onSelect={() => startTransfer(world, true)}>{t("worlds.move-to-instance")}</Item>
        <Item onSelect={() => copyWorldFixture(id(), id(), world.id)}>{t("worlds.duplicate")}</Item>
        <Item tone="danger" onSelect={() => setDeleting(world)}>{t("worlds.delete")}</Item>
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
                aria-label={t("worlds.search")}
                placeholder={t("worlds.search")}
                value={query()}
                onChange={setQuery}
                class="world-search"
              />
              <Select
                size="sm"
                aria-label={t("worlds.sort")}
                value={sort()}
                onChange={setSort}
                options={[
                  { value: "recency", label: t("worlds.sort-recency") },
                  { value: "name", label: t("worlds.sort-name") },
                  { value: "size", label: t("worlds.sort-size") },
                ]}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => importer?.click()}
              >
                {t("worlds.import")}
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
                  title={t(query() ? "worlds.no-matches" : "worlds.no-worlds")}
                  description={
                    query()
                      ? t("worlds.try-search")
                      : t("worlds.create-or-import")
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
                            aria-label={t("worlds.manage-world", { name: world.name })}
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
                                {t("worlds.day-count", { count: world.days })}
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
                                label={t("common.actions-for", { name: world.name })}
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
                label={t("worlds.all")}
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
                  {t("worlds.day-count", { count: world().days })} · {world().lastPlayed} · {t("worlds.megabytes", { size: world().sizeMb })}
                </span>
              </div>
              <span data-vesta="world-detail-section">
                <Icon name="icons/content/layers" size={14} />
                {t("worlds.datapacks")}
              </span>
            </header>
            <ResourcesTab entry={props.entry} world={world()} />
          </div>
        )}
      </Show>
      <Dialog
        title={t("worlds.delete-title", { name: deleting()?.name ?? "" })}
        description={t("worlds.delete-description")}
        size="sm"
        open={!!deleting()}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(undefined)}>
              {t("common.cancel")}
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
              {t("worlds.delete-confirm")}
            </Button>
          </>
        }
      />
      <Dialog
        title={t(transfer()?.move ? "worlds.move-title" : "worlds.copy-title", { name: transfer()?.world.name ?? "" })}
        open={!!transfer()}
        onOpenChange={(open) => {
          if (!open) setTransfer(undefined);
        }}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTransfer(undefined)}>
              {t("common.cancel")}
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
              {t(transfer()?.move ? "worlds.move-world" : "worlds.copy-world")}
            </Button>
          </>
        }
      >
        <Select
          label={t("worlds.destination")}
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
            {t("worlds.version-warning", { version: target()?.instance.minecraftVersion ?? "" })}
          </p>
          <Checkbox
            label={t("worlds.backup-acknowledgement")}
            checked={acknowledged()}
            onChange={setAcknowledged}
          />
        </Show>
      </Dialog>
    </div>
  );
}
