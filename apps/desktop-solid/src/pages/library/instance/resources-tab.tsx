import {
  Button,
  Checkbox,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Select,
  Switch,
  TextField,
} from "@vesta/ui";
import { Show, createMemo, createSignal, untrack } from "solid-js";
import { useNativeDetails } from "../../../features/instances/native-details";
import {
  nativeInstances,
  instancePending,
} from "../../../features/instances/native-service";
import { navigate } from "../../../app/router";
import { EmptyState } from "../../../components/empty-state";
import { VirtualList } from "../../../components/virtual-list";
import { Icon } from "../../../components/icon";
import {
  applyUpdates,
  formatSize,
  removeResources,
  resourcesFor,
  setResourcesEnabled,
  type InstalledResource,
  type ResourceKind,
  type WorldInfo,
} from "../../../features/instances/details";
import type { InstanceEntry } from "../../../features/instances/catalog";
import { selectVisible } from "../../../features/instances/interaction-utils";
import { versionStore } from "../../../features/instances/versions";
import { t } from "../../../localization";
import "./resources-tab.css";

type Filter = "all" | ResourceKind;
const filters = () => [
  { value: "all", label: t("resources.all-types") },
  { value: "mod", label: t("resources.mods") },
  { value: "resourcepack", label: t("resources.resource-packs") },
  { value: "shader", label: t("resources.shaders") },
];
const kindLabel: Record<
  string,
  "resources.mod" | "resources.pack" | "resources.shader" | "resources.datapack"
> = {
  mod: "resources.mod",
  resourcepack: "resources.pack",
  shader: "resources.shader",
  datapack: "resources.datapack",
};

export function ResourcesTab(props: {
  entry: InstanceEntry;
  world?: WorldInfo;
}) {
  const scope = () =>
    props.world
      ? `${props.entry.instance.id}/world/${props.world.id}`
      : props.entry.instance.id;
  return (
    <Show when={scope()} keyed>
      {(id) => (
        <ResourceList entry={props.entry} scope={id} world={!!props.world} />
      )}
    </Show>
  );
}

function ResourceList(props: {
  entry: InstanceEntry;
  scope: string;
  world: boolean;
}) {
  if (untrack(() => props.world))
    useNativeDetails(
      untrack(() => props.scope),
      true,
    );
  const busy = () =>
    nativeInstances &&
    (instancePending(props.entry.instance.id) ||
      ["running", "warming", "installing"].includes(props.entry.state.kind));
  const [filter, setFilter] = createSignal<Filter>("all", {
    name: "resources:filter",
  });
  const [query, setQuery] = createSignal("", { name: "resources:query" });
  const [selected, setSelected] = createSignal<string[]>([], {
    name: "resources:selection",
  });
  const [expanded, setExpanded] = createSignal(true, {
    name: "resources:expanded",
  });
  const [deleting, setDeleting] = createSignal<string[]>([], {
    name: "resources:deleting",
  });

  const [viewport, setViewport] = createSignal<HTMLDivElement | undefined>(
    undefined,
    { name: "resources:viewport" },
  );
  const [menuId, setMenuId] = createSignal<string | null>(null, {
    name: "resources:menu",
  });

  const all = () => resourcesFor(props.scope);
  const pack = () =>
    props.world
      ? undefined
      : versionStore(props.entry.instance.id).state().pack;
  const visible = createMemo(
    () => {
      const needle = query().trim().toLowerCase();
      return all()
        .filter(
          (item) =>
            (filter() === "all" || item.kind === filter()) &&
            (!needle ||
              `${item.name} ${item.author || item.filename} ${item.filename}`
                .toLowerCase()
                .includes(needle)),
        )
        .toSorted((a, b) => a.name.localeCompare(b.name));
    },
    { name: "resources:visible" },
  );

  const ids = () =>
    visible()
      .filter((item) => !item.readOnly)
      .map((item) => item.id);
  const selectedSet = createMemo(
    () => {
      const available = new Set(
        all()
          .filter((item) => !item.readOnly)
          .map((item) => item.id),
      );
      return new Set(selected().filter((id) => available.has(id)));
    },
    { name: "resources:selected" },
  );
  const count = () => selectedSet().size;
  const allSelected = () =>
    ids().length > 0 && ids().every((id) => selectedSet().has(id));
  const someSelected = () =>
    !allSelected() && ids().some((id) => selectedSet().has(id));
  const updates = () =>
    all()
      .filter((item) => item.update)
      .map((item) => item.id);
  const selectedItems = () =>
    all().filter((item) => selectedSet().has(item.id));
  const selectedUpdates = () =>
    selectedItems()
      .filter((item) => item.update)
      .map((item) => item.id);
  /** One toggle for the selection: disable if anything is on, otherwise enable. */
  const anyEnabled = () => selectedItems().some((item) => item.enabled);
  const clear = () => setSelected([]);
  const toggle = (id: string, on: boolean) =>
    setSelected((list) => selectVisible(list, [id], on));
  const showKind = () => !props.world && filter() === "all";

  type ListRow =
    | { id: string; kind: "resource"; item: InstalledResource }
    | { id: string; kind: "pack" | "own" };
  const groups = createMemo(
    () => {
      const items = visible();
      return pack()
        ? {
            bundled: items.filter((item) => item.bundled),
            own: items.filter((item) => !item.bundled),
          }
        : { bundled: [], own: items };
    },
    { name: "resources:groups" },
  );
  const rows = createMemo<ListRow[]>(
    () => {
      const { bundled, own } = groups();
      const result: ListRow[] = [];
      const add = (items: InstalledResource[]) =>
        result.push(
          ...items.map((item) => ({
            id: `resource:${item.id}`,
            kind: "resource" as const,
            item,
          })),
        );
      if (bundled.length) {
        result.push({ id: "group:pack", kind: "pack" });
        if (expanded() || query()) add(bundled);
        if (own.length) result.push({ id: "group:own", kind: "own" });
      }
      add(own);
      return result;
    },
    { name: "resources:rows" },
  );
  const row = (item: () => InstalledResource) => (
    <div
      data-vesta="table-row"
      role="presentation"
      class={{
        "resource-row": true,
        "row-selected": selectedSet().has(item().id),
        "row-disabled": !item().enabled,
        "row-bundled": !!item().bundled && !!pack(),
      }}
    >
      <div data-vesta="table-cell" role="cell" class="col-check">
        <Checkbox
          size="sm"
          aria-label={t("resources.select-resource", { name: item().name })}
          disabled={busy() || item().readOnly}
          checked={selectedSet().has(item().id)}
          onChange={(on) => toggle(item().id, on)}
        />
      </div>
      <div data-vesta="table-cell" role="cell" class="col-name">
        <div data-vesta="resource-identity">
          <img
            src={item().icon}
            alt=""
            loading="lazy"
            decoding="async"
            width={28}
            height={28}
            draggable="false"
          />
          <span data-vesta="resource-copy">
            <span data-vesta="resource-title">{item().name}</span>
            <span data-vesta="resource-sub">
              <Show when={showKind()}>
                <span data-vesta="resource-kind" data-kind={item().kind}>
                  {t(kindLabel[item().kind])}
                </span>
              </Show>
              <span data-vesta="resource-file" title={item().filename}>
                {item().author || item().filename}
              </span>
            </span>
          </span>
        </div>
      </div>
      <div data-vesta="table-cell" role="cell" class="col-version">
        <span data-vesta="resource-version">
          <span title={item().version}>{item().version}</span>
          <Show when={item().update}>
            <IconButton
              size="sm"
              variant="ghost"
              class="resource-update"
              label={t("common.update-to", { version: item().update! })}
              icon={<Icon name="icons/actions/download" />}
              disabled={busy()}
              onClick={() => applyUpdates(props.scope, [item().id])}
            />
          </Show>
        </span>
      </div>
      <div data-vesta="table-cell" role="cell" class="col-size" data-numeric="">
        {formatSize(item().sizeKb)}
      </div>
      <div data-vesta="table-cell" role="cell" class="col-enabled">
        <Switch
          size="sm"
          aria-label={t("resources.enable-resource", { name: item().name })}
          disabled={busy() || item().readOnly}
          checked={item().enabled}
          onChange={(on) => setResourcesEnabled(props.scope, [item().id], on)}
        />
      </div>
      <div data-vesta="table-cell" role="cell" class="col-menu">
        <Show
          when={menuId() === item().id}
          fallback={
            <IconButton
              variant="ghost"
              size="sm"
              tooltip={false}
              label={t("resources.actions", { name: item().name })}
              icon={<Icon name="icons/content/ellipsis-v" />}
              aria-haspopup="menu"
              onClick={() => setMenuId(item().id)}
            />
          }
        >
          <Menu
            defaultOpen
            onOpenChange={(open) => {
              if (!open) {
                // Let Kobalte restore focus before replacing its trigger.
                requestAnimationFrame(() => {
                  const cell = document.activeElement?.closest(
                    '[data-vesta="table-cell"]',
                  );
                  setMenuId(null);
                  queueMicrotask(() =>
                    cell
                      ?.querySelector("button")
                      ?.focus({ preventScroll: true }),
                  );
                });
              }
            }}
            placement="bottom-end"
            trigger={(menuProps) => (
              <IconButton
                {...menuProps}
                variant="ghost"
                size="sm"
                tooltip={false}
                label={t("resources.actions", { name: item().name })}
                icon={<Icon name="icons/content/ellipsis-v" />}
              />
            )}
          >
            <Show when={item().update}>
              <MenuItem
                disabled={busy() || item().readOnly}
                icon={<Icon name="icons/actions/download" />}
                onSelect={() => applyUpdates(props.scope, [item().id])}
              >
                {t("common.update-to", { version: item().update! })}
              </MenuItem>
            </Show>
            <MenuItem icon={<Icon name="icons/content/folder" />} disabled>
              {t("resources.show-in-folder")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              disabled={busy() || item().readOnly}
              tone="danger"
              icon={<Icon name="icons/actions/delete" />}
              onSelect={() => setDeleting([item().id])}
            >
              {t("resources.remove")}
            </MenuItem>
          </Menu>
        </Show>
      </div>
    </div>
  );

  return (
    <div data-vesta="resources">
      <div
        data-vesta="resources-toolbar"
        data-selecting={count() ? "" : undefined}
      >
        <Show
          when={count()}
          fallback={
            <div data-vesta="resources-tools" class="resources-bar">
              <Show when={!props.world}>
                <Select
                  size="sm"
                  aria-label={t("resources.resource-type")}
                  value={filter()}
                  onChange={(value) => setFilter(value as Filter)}
                  options={filters()}
                  class="resources-type"
                />
              </Show>
              <TextField
                size="sm"
                class="resources-search"
                aria-label={t("resources.search")}
                placeholder={t(
                  props.world
                    ? "resources.search-datapacks"
                    : "resources.search-resources",
                )}
                value={query()}
                onChange={setQuery}
              />
              <Show when={updates().length}>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Icon name="icons/actions/download" />}
                  disabled={busy()}
                  onClick={() => applyUpdates(props.scope, updates())}
                >
                  {t("resources.update-all-count", { count: updates().length })}
                </Button>
              </Show>
              <Button
                size="sm"
                tone="accent"
                icon={<Icon name="icons/actions/add" />}
                onClick={() => navigate(`/browse/for/${props.entry.instance.id}`)}
              >
                {t("resources.add")}
              </Button>
            </div>
          }
        >
          <div data-vesta="resources-selection" class="resources-bar">
            <IconButton
              size="sm"
              variant="ghost"
              label={t("resources.clear-selection")}
              icon={<Icon name="icons/actions/close" />}
              onClick={clear}
            />
            <strong>{t("resources.selected", { count: count() })}</strong>
            <span data-vesta="resources-selection-actions">
              <Show when={selectedUpdates().length}>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Icon name="icons/actions/download" />}
                  disabled={busy()}
                  onClick={() => applyUpdates(props.scope, selectedUpdates())}
                >
                  {t("resources.update-count", {
                    count: selectedUpdates().length,
                  })}
                </Button>
              </Show>
              <Button
                size="sm"
                variant="outline"
                disabled={busy()}
                onClick={() =>
                  setResourcesEnabled(
                    props.scope,
                    [...selectedSet()],
                    !anyEnabled(),
                  )
                }
              >
                {t(anyEnabled() ? "common.disable" : "common.enable")}
              </Button>
              <Button
                size="sm"
                disabled={busy()}
                tone="danger"
                icon={<Icon name="icons/actions/delete" />}
                onClick={() => setDeleting([...selectedSet()])}
              >
                {t("resources.remove-selected")}
              </Button>
            </span>
          </div>
        </Show>
      </div>

      <div data-vesta="resources-list" tabindex={0} ref={setViewport}>
        <Show
          when={visible().length}
          fallback={
            <EmptyState
              icon="icons/content/layers"
              title={t(
                query() ? "resources.no-matches" : "resources.none-installed",
              )}
              description={
                query()
                  ? t("resources.try-another-search")
                  : t("resources.add-resources-hint")
              }
            />
          }
        >
          <div data-vesta="table-scroll" class="resource-table">
            <div
              data-vesta="table"
              role="table"
              aria-label={t("resources.search-resources")}
              aria-colcount={6}
              aria-rowcount={rows().length + 1}
            >
              <VirtualList
                items={rows()}
                key={(row) => row.id}
                rowHeight={44}
                getHeight={(index) =>
                  rows()[index].kind === "pack"
                    ? 52
                    : rows()[index].kind === "own"
                      ? 36
                      : 44
                }
                scrollElement={viewport()}
                pinnedKey={menuId() ? `resource:${menuId()}` : null}
                rowRole="row"
                headerHeight={32}
                headerHook="table-header"
                bodyHook="table-body"
                header={
                  <div data-vesta="table-row" role="row" aria-rowindex={1}>
                    <div
                      data-vesta="table-head"
                      role="columnheader"
                      class="col-check"
                    >
                      <Checkbox
                        size="sm"
                        aria-label={t("resources.select-all")}
                        checked={allSelected()}
                        indeterminate={someSelected()}
                        onChange={(on) =>
                          setSelected((list) => selectVisible(list, ids(), on))
                        }
                      />
                    </div>
                    <div
                      data-vesta="table-head"
                      role="columnheader"
                      class="col-name"
                    >
                      {t("resources.name-column")}
                    </div>
                    <div
                      data-vesta="table-head"
                      role="columnheader"
                      class="col-version"
                    >
                      {t("resources.version-column")}
                    </div>
                    <div
                      data-vesta="table-head"
                      role="columnheader"
                      class="col-size"
                      data-numeric=""
                    >
                      {t("resources.size-column")}
                    </div>
                    <div
                      data-vesta="table-head"
                      role="columnheader"
                      class="col-enabled"
                    >
                      {t("resources.enabled-column")}
                    </div>
                    <div
                      data-vesta="table-head"
                      role="columnheader"
                      class="col-menu"
                    >
                      <span data-vesta="sr-only">
                        {t("resources.actions-column")}
                      </span>
                    </div>
                  </div>
                }
              >
                {(entry) => (
                  <Show
                    when={entry().kind === "resource"}
                    fallback={
                      <div
                        data-vesta="table-row"
                        role="presentation"
                        class={{
                          "resource-group-row": true,
                          "resource-pack-row": entry().kind === "pack",
                        }}
                      >
                        <div
                          data-vesta="table-cell"
                          role="cell"
                          aria-colspan={6}
                        >
                          <Show
                            when={entry().kind === "pack"}
                            fallback={
                              <div data-vesta="resource-group">
                                <Icon name="icons/content/layers" size={14} />
                                <strong>{t("resources.added-by-you")}</strong>
                                <span data-vesta="resource-group-count">
                                  {groups().own.length}
                                </span>
                              </div>
                            }
                          >
                            <button
                              type="button"
                              data-vesta="resource-group"
                              aria-expanded={expanded() ? "true" : "false"}
                              onClick={() => setExpanded(!expanded())}
                            >
                              <Icon
                                name="icons/controls/chevron-down"
                                size={12}
                                class="resource-group-chevron"
                              />
                              <img
                                src={props.entry.instance.image}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                width={32}
                                height={32}
                              />
                              <strong>{pack()?.name}</strong>
                              <span data-vesta="resource-group-meta">
                                {t("resources.modpack-group", {
                                  version:
                                    pack()?.installedLabel ??
                                    pack()?.installed ??
                                    "",
                                })}
                              </span>
                              <span data-vesta="resource-group-count">
                                {groups().bundled.length}
                              </span>
                            </button>
                          </Show>
                        </div>
                      </div>
                    }
                  >
                    {row(
                      () =>
                        (entry() as Extract<ListRow, { kind: "resource" }>)
                          .item,
                    )}
                  </Show>
                )}
              </VirtualList>
            </div>
          </div>
        </Show>
      </div>

      <Dialog
        title={t(
          deleting().length === 1
            ? "resources.remove-title-one"
            : "resources.remove-title-other",
          { count: deleting().length },
        )}
        size="sm"
        description={t("resources.remove-description")}
        open={deleting().length > 0}
        onOpenChange={(open) => {
          if (!open) setDeleting([]);
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting([])}>
              {t("common.cancel")}
            </Button>
            <Button
              tone="danger"
              disabled={busy()}
              onClick={() => {
                removeResources(props.scope, deleting());
                setSelected((list) =>
                  list.filter((id) => !deleting().includes(id)),
                );
                setDeleting([]);
              }}
            >
              {t("resources.remove-selected")}
            </Button>
          </>
        }
      />
    </div>
  );
}
