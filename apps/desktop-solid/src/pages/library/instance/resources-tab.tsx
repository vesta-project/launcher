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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextField,
} from "@vesta/ui";
import { For, Show, createMemo, createSignal } from "solid-js";
import { navigate } from "../../../app/router";
import { EmptyState } from "../../../components/empty-state";
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
import type { InstanceEntry } from "../../../features/instances/fixtures";
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
const kindLabel: Record<string, "resources.mod" | "resources.pack" | "resources.shader" | "resources.datapack"> = {
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
  const [filter, setFilter] = createSignal<Filter>("all");
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<string[]>([]);
  const [expanded, setExpanded] = createSignal(true);
  const [deleting, setDeleting] = createSignal<string[]>([]);

  const all = () => resourcesFor(props.scope);
  const pack = () =>
    props.world
      ? undefined
      : versionStore(props.entry.instance.id).state().pack;
  const visible = createMemo(() => {
    const needle = query().trim().toLowerCase();
    return all()
      .filter(
        (item) =>
          (filter() === "all" || item.kind === filter()) &&
          (!needle ||
            `${item.name} ${item.author} ${item.filename}`
              .toLowerCase()
              .includes(needle)),
      )
      .toSorted((a, b) => a.name.localeCompare(b.name));
  });
  const bundled = () =>
    pack() ? visible().filter((item) => item.bundled) : [];
  const own = () =>
    pack() ? visible().filter((item) => !item.bundled) : visible();

  const ids = () => visible().map((item) => item.id);
  const selectedSet = createMemo(() => {
    const available = new Set(all().map((item) => item.id));
    return new Set(selected().filter((id) => available.has(id)));
  });
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

  const row = (item: InstalledResource) => (
    <TableRow
      class={{
        "resource-row": true,
        "row-selected": selectedSet().has(item.id),
        "row-disabled": !item.enabled,
        "row-bundled": !!item.bundled && !!pack(),
      }}
    >
      <TableCell class="col-check">
        <Checkbox
          size="sm"
          aria-label={t("resources.select-resource", { name: item.name })}
          checked={selectedSet().has(item.id)}
          onChange={(on) => toggle(item.id, on)}
        />
      </TableCell>
      <TableCell class="col-name">
        <div data-vesta="resource-identity">
          <img src={item.icon} alt="" loading="lazy" draggable="false" />
          <span data-vesta="resource-copy">
            <span data-vesta="resource-title">{item.name}</span>
            <span data-vesta="resource-sub">
              <Show when={showKind()}>
                <span data-vesta="resource-kind" data-kind={item.kind}>
                  {t(kindLabel[item.kind])}
                </span>
              </Show>
              <span data-vesta="resource-file" title={item.filename}>
                {item.author}
              </span>
            </span>
          </span>
        </div>
      </TableCell>
      <TableCell class="col-version">
        <span data-vesta="resource-version">
          <span title={item.version}>{item.version}</span>
          <Show when={item.update}>
            <IconButton
              size="sm"
              variant="ghost"
              class="resource-update"
              label={t("common.update-to", { version: item.update! })}
              icon={<Icon name="icons/actions/download" />}
              onClick={() => applyUpdates(props.scope, [item.id])}
            />
          </Show>
        </span>
      </TableCell>
      <TableCell class="col-size" numeric>
        {formatSize(item.sizeKb)}
      </TableCell>
      <TableCell class="col-enabled">
        <Switch
          size="sm"
          aria-label={t("resources.enable-resource", { name: item.name })}
          checked={item.enabled}
          onChange={(on) => setResourcesEnabled(props.scope, [item.id], on)}
        />
      </TableCell>
      <TableCell class="col-menu">
        <Menu
          placement="bottom-end"
          trigger={(menuProps) => (
            <IconButton
              {...menuProps}
              variant="ghost"
              size="sm"
              tooltip={false}
              label={t("resources.actions", { name: item.name })}
              icon={<Icon name="icons/content/ellipsis-v" />}
            />
          )}
        >
          <Show when={item.update}>
            <MenuItem
              icon={<Icon name="icons/actions/download" />}
              onSelect={() => applyUpdates(props.scope, [item.id])}
            >
              {t("common.update-to", { version: item.update! })}
            </MenuItem>
          </Show>
          <MenuItem icon={<Icon name="icons/content/folder" />} disabled>
            {t("resources.show-in-folder")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            tone="danger"
            icon={<Icon name="icons/actions/delete" />}
            onSelect={() => setDeleting([item.id])}
          >
            {t("resources.remove")}
          </MenuItem>
        </Menu>
      </TableCell>
    </TableRow>
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
                placeholder={
                  t(props.world ? "resources.search-datapacks" : "resources.search-resources")
                }
                value={query()}
                onChange={setQuery}
              />
              <Show when={updates().length}>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Icon name="icons/actions/download" />}
                  onClick={() => applyUpdates(props.scope, updates())}
                >
                  {t("resources.update-all-count", { count: updates().length })}
                </Button>
              </Show>
              <Button
                size="sm"
                tone="accent"
                icon={<Icon name="icons/actions/add" />}
                onClick={() => navigate(`/browse/${props.entry.instance.id}`)}
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
                  onClick={() => applyUpdates(props.scope, selectedUpdates())}
                >
                  {t("resources.update-count", { count: selectedUpdates().length })}
                </Button>
              </Show>
              <Button
                size="sm"
                variant="outline"
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

      <div data-vesta="resources-list">
        <Show
          when={visible().length}
          fallback={
            <EmptyState
              icon="icons/content/layers"
              title={
                t(query() ? "resources.no-matches" : "resources.none-installed")
              }
              description={
                query()
                  ? t("resources.try-another-search")
                  : t("resources.add-resources-hint")
              }
            />
          }
        >
          <Table class="resource-table">
            <colgroup>
              <col class="col-check" />
              <col />
              <col class="col-version" />
              <col class="col-size" />
              <col class="col-enabled" />
              <col class="col-menu" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead class="col-check">
                  <Checkbox
                    size="sm"
                    aria-label={t("resources.select-all")}
                    checked={allSelected()}
                    indeterminate={someSelected()}
                    onChange={(on) =>
                      setSelected((list) => selectVisible(list, ids(), on))
                    }
                  />
                </TableHead>
                <TableHead class="col-name">{t("resources.name-column")}</TableHead>
                <TableHead class="col-version">{t("resources.version-column")}</TableHead>
                <TableHead class="col-size" numeric>
                  {t("resources.size-column")}
                </TableHead>
                <TableHead class="col-enabled">{t("resources.enabled-column")}</TableHead>
                <TableHead class="col-menu">
                  <span data-vesta="sr-only">{t("resources.actions-column")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <Show when={pack() && bundled().length}>
                <TableRow class="resource-group-row resource-pack-row">
                  <TableCell colspan={6}>
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
                      <img src={props.entry.instance.image} alt="" />
                      <strong>{pack()?.name}</strong>
                      <span data-vesta="resource-group-meta">
                        {t("resources.modpack-group", { version: pack()?.installed ?? "" })}
                      </span>
                      <span data-vesta="resource-group-count">
                        {bundled().length}
                      </span>
                    </button>
                  </TableCell>
                </TableRow>
                <Show when={expanded() || query()}>
                  <For each={bundled()}>{row}</For>
                </Show>
                <Show when={own().length}>
                  <TableRow class="resource-group-row">
                    <TableCell colspan={6}>
                      <div data-vesta="resource-group">
                        <Icon name="icons/content/layers" size={14} />
                        <strong>{t("resources.added-by-you")}</strong>
                        <span data-vesta="resource-group-count">
                          {own().length}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                </Show>
              </Show>
              <For each={own()}>{row}</For>
            </TableBody>
          </Table>
        </Show>
      </div>

      <Dialog
        title={t(deleting().length === 1 ? "resources.remove-title-one" : "resources.remove-title-other", { count: deleting().length })}
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
