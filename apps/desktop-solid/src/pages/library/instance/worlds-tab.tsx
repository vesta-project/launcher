import { useNativeDropZone } from '../../../features/file-drop/zone';
import { importNativePaths } from '../../../features/instances/native-import-dialog';
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
import { worldRouteId, worldTransferNeedsAcknowledgement } from "../../../features/instances/native-details-model";
import { nativeInstances, nativeRecord, instancePending } from "../../../features/instances/native-service";
import { importNativeWorld } from "../../../features/instances/native-import-dialog";
import { openNativeWorld } from "../../../features/instances/native-details";
import { navigate, route } from "../../../app/router";
import { goBack } from "../../../app/transition";
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
} from "../../../features/instances/catalog";
import { ResourcesTab } from "./resources-tab";
import { t } from "../../../localization";
import "./worlds-tab.css";

export function WorldsTab(props: { entry: InstanceEntry }) {
  const busy = () => nativeInstances && (instancePending(props.entry.instance.id) || ["running", "warming", "installing"].includes(props.entry.state.kind));
  const id = () => props.entry.instance.id;
  let dropElement: HTMLDivElement | undefined;
  useNativeDropZone({ element: () => dropElement, disabled: busy, drop: (paths) => { void importNativePaths(id(), paths); } });
  const [query, setQuery] = createSignal("");
  const [sort, setSort] = createSignal("recency");
  const [deleting, setDeleting] = createSignal<WorldInfo>();
  const [transfer, setTransfer] = createSignal<{
    world: WorldInfo;
    move: boolean;
    duplicate?: boolean;
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
    worldsFor(id()).find((world) => world.id === worldRouteId(route().item));
  const manage = (world?: WorldInfo) =>
    navigate(`/library/${id()}/worlds${world ? `/${encodeURIComponent(world.id)}` : ""}`);
  const target = () => findInstance(destination());
  const mismatch = () => {
    const destinationRecord = nativeRecord(destination()), sourceRecord = nativeRecord(id());
    if (nativeInstances && sourceRecord && destinationRecord) return worldTransferNeedsAcknowledgement(sourceRecord, destinationRecord, transfer()?.world.gameVersion);
    return !!target() && target()!.instance.minecraftVersion !== props.entry.instance.minecraftVersion;
  };
  const startTransfer = (world: WorldInfo, move: boolean, duplicate = false) => {
    setAcknowledged(false);
    setDestination(duplicate ? id() : "");
    setTransfer({ world, move, duplicate });
  };
  const actions = (world: WorldInfo, context = false) => {
    const Item = context ? ContextMenuItem : MenuItem;
    return (
      <>
        <Item onSelect={() => manage(world)}>{t("worlds.manage")}</Item>
        <Item disabled={!nativeInstances} onSelect={() => void openNativeWorld(id(), world.id)}>{t("worlds.open-folder")}</Item>
        <Item disabled={busy() || world.running} onSelect={() => startTransfer(world, false)}>{t("worlds.copy-to-instance")}</Item>
        <Item disabled={busy() || world.running} onSelect={() => startTransfer(world, true)}>{t("worlds.move-to-instance")}</Item>
        <Item disabled={busy() || world.running} onSelect={() => nativeInstances ? startTransfer(world, false, true) : copyWorldFixture(id(), id(), world.id)}>{t("worlds.duplicate")}</Item>
        <Item disabled={busy() || world.running} tone="danger" onSelect={() => setDeleting(world)}>{t("worlds.delete")}</Item>
      </>
    );
  };
  return (
    <div ref={(element) => { dropElement = element; }} data-vesta="worlds">
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
                disabled={busy()}
                onClick={() => nativeInstances ? void importNativeWorld(id()) : importer?.click()}
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
                                <Show when={world.days !== undefined}>{t("worlds.day-count", { count: world.days ?? 0 })}</Show>
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
                onClick={() => goBack(`/library/${id()}/worlds`)}
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
                  <Show when={world().days !== undefined}>{t("worlds.day-count", { count: world().days ?? 0 })} · </Show>{world().lastPlayed} · {t("worlds.megabytes", { size: world().sizeMb })}
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
        closeLabel={t('nav.close')}
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
                  // The deleted world's page must not stay in history for back to land on.
                  if (worldRouteId(route().item) === world.id)
                    navigate(`/library/${id()}/worlds`, { replace: true });
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
        closeLabel={t('nav.close')}
        title={t(transfer()?.duplicate ? "worlds.duplicate" : transfer()?.move ? "worlds.move-title" : "worlds.copy-title", { name: transfer()?.world.name ?? "" })}
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
              disabled={busy() || !target() || (nativeInstances && !!target() && ["running", "warming", "installing"].includes(target()!.state.kind)) || (mismatch() && !acknowledged())}
              onClick={() => {
                const pending = transfer();
                if (pending && target())
                  copyWorldFixture(
                    id(),
                    destination(),
                    pending.world.id,
                    pending.move,
                    acknowledged(),
                  );
                setTransfer(undefined);
              }}
            >
              {t(transfer()?.duplicate ? "worlds.duplicate" : transfer()?.move ? "worlds.move-world" : "worlds.copy-world")}
            </Button>
          </>
        }
      >
        <Show when={!transfer()?.duplicate}><Select
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
        /></Show>
        <Show when={mismatch()}>
          <p data-vesta="world-transfer-warning">
            {t(nativeInstances ? "management.world-transfer-warning" : "worlds.version-warning", { version: target()?.instance.minecraftVersion ?? "" })}
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
