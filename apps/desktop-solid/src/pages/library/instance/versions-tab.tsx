import {
  Badge,
  Button,
  Combobox,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  Switch,
  SegmentedControl,
  TextField,
} from "@vesta/ui";
import { For, Show, createEffect, createMemo, createSignal, untrack, onSettled } from "solid-js";
import { SettingRow, SettingsSection } from "../../../components/setting-row";
import {
  compatibleLoaderVersions,
  experimentalVersion,
  minecraftVersions,
  versionStore,
  useNativePack,
  applyEngineVersion,
  unlinkPack,
  linkPack,
  previewPackUpdate,
  releaseChangelog,
  searchPacks,
  packReleases,
  type EngineVersion,
  type LinkedPack,
  type PackCandidate,
  type PackRelease,
  type PackSource,
  type UpdatePreview,
} from "../../../features/instances/versions";
import type { InstanceEntry } from "../../../features/instances/catalog";
import { loadMetadata } from "../../../features/instances/metadata";
import { instancePending } from "../../../features/instances/native-service";
import { Icon } from "../../../components/icon";
import { t } from "../../../localization";
import "./versions-tab.css";

export function VersionsTab(props: { entry: InstanceEntry }) {
  onSettled(() => { void loadMetadata(); });
  const id = () => props.entry.instance.id;
  useNativePack(untrack(id));
  const store = versionStore(untrack(id));
  const [minecraft, setMinecraft] = createSignal(
    untrack(() => store.state().engine.minecraft),
  );
  const [loader, setLoader] = createSignal(
    untrack(() => store.state().engine.loader),
  );
  const [loaderVersion, setLoaderVersion] = createSignal(
    untrack(() => store.state().engine.loaderVersion),
  );
  const [experimental, setExperimental] = createSignal(
    untrack(() => experimentalVersion(minecraft())),
  );
  const [releaseFilter, setReleaseFilter] = createSignal("stable");
  const [releaseQuery, setReleaseQuery] = createSignal("");
  const [pending, setPending] = createSignal<{
    engine: EngineVersion;
    release?: PackRelease;
  }>();
  const [previewing, setPreviewing] = createSignal<PackRelease>();
  const [preview, setPreview] = createSignal<UpdatePreview>();
  const [linking, setLinking] = createSignal(false);
  const [unlinking, setUnlinking] = createSignal<"keep" | "delete">();
  const pack = () => store.state().pack;
  createEffect(
    () => previewing(),
    (release) => {
      setPreview(undefined);
      const current = untrack(pack);
      if (!release || !current) return;
      let stale = false;
      void previewPackUpdate(current, release).then((data) => {
        if (!stale) setPreview(data);
      });
      return () => {
        stale = true;
      };
    },
  );
  const busy = () =>
    instancePending(id()) || ["running", "warming", "installing"].includes(props.entry.state.kind);
  const engine = (): EngineVersion => ({
    minecraft: minecraft(),
    loader: loader(),
    loaderVersion: loader() === "vanilla" ? "" : loaderVersion(),
  });
  const loaders = createMemo(() => compatibleLoaderVersions(minecraft(), loader()),
    { name: "versionsCompatibleLoaders" });
  const loaderOptions = createMemo(() => loaders().map(value => ({ value, label: value })),
    { name: "versionsLoaderOptions" });
  const valid = () =>
    loader() === "vanilla" ||
    loaders().includes(loaderVersion());
  const dirty = () =>
    JSON.stringify(engine()) !== JSON.stringify(store.state().engine);
  const mcOptions = createMemo(() =>
    [...new Set([store.state().engine.minecraft, ...minecraftVersions()])]
      .filter(
        (value) =>
          experimental() ||
          !experimentalVersion(value) ||
          value === store.state().engine.minecraft,
      )
      .map((value) => ({
        value,
        label: value,
        description: experimentalVersion(value)
          ? t("versions.experimental")
          : t("versions.release"),
      })), { name: "versionsMinecraftOptions" });

  const chooseMinecraft = (value: string) => {
    setMinecraft(value);
    setLoaderVersion(compatibleLoaderVersions(value, loader())[0] ?? "");
  };
  return (
    <div data-vesta="versions">
      <Show
        when={pack()}
        fallback={
          <>
          <SettingsSection title={t("linking.unlinked-title")}>
            <SettingRow
              label={t("linking.unlinked-title")}
              description={t("linking.unlinked-description")}
            >
              <Button
                variant="outline"
                disabled={busy()}
                icon={<Icon name="icons/actions/add" size={16} />}
                onClick={() => setLinking(true)}
              >
                {t("linking.link-action")}
              </Button>
            </SettingRow>
          </SettingsSection>
          <SettingsSection title={t("versions.core-configuration")}>
            <div data-vesta="version-core">
              <div data-vesta="version-field">
                <label>{t("versions.modloader")}</label>
                <SegmentedControl
                  aria-label={t("versions.modloader")}
                  fill
                  value={loader()}
                  onChange={(value) => {
                    setLoader(value);
                    setLoaderVersion(
                      compatibleLoaderVersions(minecraft(), value)[0] ?? "",
                    );
                  }}
                  options={[
                    "vanilla",
                    "fabric",
                    "forge",
                    "neoforge",
                    "quilt",
                  ].map((value) => ({
                    value,
                    label:
                      value === "neoforge"
                        ? "NeoForge"
                        : value.charAt(0).toUpperCase() + value.slice(1),
                    icon: (
                      <Icon
                        name={
                          value === "vanilla"
                            ? "icons/rail/library"
                            : `branding/modloaders/${value}-logo`
                        }
                        size={20}
                      />
                    ),
                  }))}
                />
              </div>
              <div data-vesta="version-field">
                <header>
                  <label>{t("versions.minecraft-version")}</label>
                  <Switch
                    size="sm"
                    label={t("versions.show-snapshots")}
                    checked={experimental()}
                    onChange={setExperimental}
                  />
                </header>
                <Combobox
                  aria-label={t("versions.minecraft-version")}
                  options={mcOptions()}
                  maxOptions={80}
                  value={minecraft()}
                  onChange={chooseMinecraft}
                />
              </div>
              <Show when={loader() !== "vanilla"}>
                <div data-vesta="version-field">
                  <label>{t("versions.loader-version")}</label>
                  <Combobox
                    aria-label={t("versions.loader-version")}
                    value={loaderVersion()}
                    onChange={setLoaderVersion}
                    options={loaderOptions()}
                    maxOptions={80}
                  />
                </div>
              </Show>
            </div>
            <Show when={!valid()}>
              <p data-vesta="version-warning">
                {loaders().length
                  ? t("versions.choose-loader-version")
                  : t("versions.none-found", { loader: loader().charAt(0).toUpperCase() + loader().slice(1), minecraft: minecraft() })}
              </p>
            </Show>
            <Show when={dirty()}>
              <div data-vesta="version-actions">
                <Button
                  tone="accent"
                  disabled={!valid() || busy()}
                  onClick={() => setPending({ engine: engine() })}
                >
                  {t("versions.review-changes")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const installed = store.state().engine;
                    setMinecraft(installed.minecraft);
                    setLoader(installed.loader);
                    setLoaderVersion(installed.loaderVersion);
                  }}
                >
                  {t("versions.discard")}
                </Button>
              </div>
            </Show>
          </SettingsSection>
          </>
        }
      >
        {(linked) => {
          const releases = createMemo(
            () => {
              const query = releaseQuery().trim().toLowerCase();
              return linked().releases.filter(
                (item) =>
                  (releaseFilter() === "all" || item.channel === "release" || item.id === linked().installed) &&
                  (!query || item.label.toLowerCase().includes(query) || item.minecraft.toLowerCase().includes(query)),
              );
            },
            { name: "versionsPackReleases" },
          );
          return (
            <section data-vesta="pack-view">
              {/* The pack as one line: what is installed, whether it is current, and its actions. */}
              <header data-vesta="pack-head">
                <img data-vesta="pack-icon" src={linked().icon} alt="" />
                <div data-vesta="pack-title">
                  <span data-vesta="pack-name">
                    <strong>{linked().name}</strong>
                    <span data-vesta="source-tag" data-source={linked().source.toLowerCase()}>
                      {linked().source}
                    </span>
                  </span>
                  <span data-vesta="pack-meta">
                    {linked().installedLabel ?? linked().installed}
                    <span aria-hidden="true">·</span>
                    Minecraft {store.state().engine.minecraft}
                    <span aria-hidden="true">·</span>
                    {loaderName(store.state().engine.loader)}
                  </span>
                </div>
                <div data-vesta="pack-status">
                  <Show
                    when={updateTarget(linked())}
                    fallback={
                      <span data-vesta="pack-current">
                        <Icon name="icons/controls/check" size={12} />
                        {t("versions.up-to-date")}
                      </span>
                    }
                  >
                    {(target) => (
                      <Button
                        size="sm"
                        tone="accent"
                        disabled={busy()}
                        icon={<Icon name="icons/actions/download" size={14} />}
                        onClick={() => setPreviewing(target())}
                      >
                        {t("versions.update-to", { version: target().label })}
                      </Button>
                    )}
                  </Show>
                  <Menu
                    placement="bottom-end"
                    trigger={(menuProps) => (
                      <IconButton
                        {...menuProps}
                        size="sm"
                        variant="ghost"
                        label={t("versions.pack-actions")}
                        icon={<Icon name="icons/controls/ellipsis-horizontal" size={16} />}
                      />
                    )}
                  >
                    <MenuItem
                      icon={<Icon name="icons/content/link" size={14} />}
                      disabled={busy()}
                      onSelect={() => setUnlinking("keep")}
                    >
                      {t("versions.unlink-action")}
                    </MenuItem>
                    <MenuItem
                      tone="danger"
                      icon={<Icon name="icons/actions/delete" size={14} />}
                      disabled={busy()}
                      onSelect={() => setUnlinking("delete")}
                    >
                      {t("versions.delete-unlink-action")}
                    </MenuItem>
                  </Menu>
                </div>
              </header>

              <section data-vesta="pack-releases" aria-labelledby="pack-releases-title">
                <header data-vesta="pack-releases-head">
                  <h3 id="pack-releases-title">
                    {t("linking.versions-title")}
                    <span data-vesta="pack-releases-count">{releases().length}</span>
                  </h3>
                  <TextField
                    size="sm"
                    class="pack-releases-search"
                    aria-label={t("versions.search-pack-versions")}
                    placeholder={t("versions.search-versions")}
                    icon={<Icon name="icons/content/search" size={14} />}
                    value={releaseQuery()}
                    onChange={setReleaseQuery}
                  />
                  <SegmentedControl
                    size="sm"
                    aria-label={t("versions.release-type")}
                    value={releaseFilter()}
                    onChange={setReleaseFilter}
                    options={[
                      { value: "stable", label: t("versions.stable-releases") },
                      { value: "all", label: t("linking.all-channels") },
                    ]}
                  />
                </header>
                <ol data-vesta="release-list">
                  <For
                    each={releases()}
                    keyed={(item) => item.id}
                    fallback={<li data-vesta="version-empty">{t("versions.no-matching-versions")}</li>}
                  >
                    {(item) => (
                      <ReleaseRow
                        pack={linked()}
                        release={item()}
                        minecraft={store.state().engine.minecraft}
                        busy={busy()}
                        onPreview={setPreviewing}
                      />
                    )}
                  </For>
                </ol>
              </section>
            </section>
          );
        }}
      </Show>
      <Show when={busy()}>
        <p data-vesta="version-warning">
          {t("versions.stop-before-changing")}
        </p>
      </Show>
      <Dialog
        title={t("versions.change-title")}
        open={!!pending() && !pending()?.release}
        onOpenChange={(open) => {
          if (!open) setPending(undefined);
        }}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(undefined)}>
              {t("common.cancel")}
            </Button>
            <Button
              tone="accent"
              disabled={busy()}
              onClick={() => {
                const next = pending();
                if (next)
                  void applyEngineVersion(id(), next.engine, next.release?.id);
                setPending(undefined);
              }}
            >
              {t("versions.apply-change")}
            </Button>
          </>
        }
      >
        <p>
          {t("versions.back-up-worlds")}
        </p>
        <Show when={pending()}>
          {(next) => (
            <dl data-vesta="version-comparison">
              <dt>Minecraft</dt>
              <dd>
                {store.state().engine.minecraft} → {next().engine.minecraft}
              </dd>
              <dt>Modloader</dt>
              <dd>
                {store.state().engine.loader}{" "}
                {store.state().engine.loaderVersion} → {next().engine.loader}{" "}
                {next().engine.loaderVersion}
              </dd>
              <Show when={next().release}>
              <dt>{t("versions.pack-version")}</dt>
                <dd>
                  {pack()?.installed} → {next().release?.label}
                </dd>
              </Show>
            </dl>
          )}
        </Show>
        <p>
          {t("versions.worlds-resources-kept")} {t("versions.bundled-follow-release")}
        </p>
      </Dialog>
      <Show when={previewing()}>
        {(release) => (
          <Dialog
            title={t(`linking.preview-title-${changeKind(pack(), release())}`, { version: release().label })}
            open
            onOpenChange={(open) => {
              if (!open) setPreviewing(undefined);
            }}
            footer={
              <>
                <Button variant="ghost" onClick={() => setPreviewing(undefined)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  tone={changeKind(pack(), release()) === "downgrade" ? "danger" : "accent"}
                  disabled={busy()}
                  onClick={() => {
                    void applyEngineVersion(id(), release(), release().id);
                    setPreviewing(undefined);
                  }}
                >
                  {t(`linking.preview-apply-${changeKind(pack(), release())}`)}
                </Button>
              </>
            }
          >
            <dl data-vesta="version-comparison">
              <dt>{t("linking.preview-engine")}</dt>
              <dd>
                Minecraft {store.state().engine.minecraft} → {release().minecraft || store.state().engine.minecraft}
                {" · "}
                {store.state().engine.loader} → {release().loader}
              </dd>
              <dt>{t("versions.pack-version")}</dt>
              <dd>
                {pack()?.installedLabel ?? pack()?.installed} → {release().label}
              </dd>
            </dl>
            <Show
              when={preview()}
              fallback={<p data-vesta="version-muted">{t("linking.preview-loading")}</p>}
            >
              {(data) => (
                <>
                  <Show
                    when={data().added || data().removed || data().updated}
                    fallback={<p data-vesta="version-muted">{t("linking.preview-unavailable")}</p>}
                  >
                    <div data-vesta="diff">
                      <DiffGroup tone="success" label={t("linking.preview-added")} items={data().added} />
                      <DiffGroup tone="danger" label={t("linking.preview-removed")} items={data().removed} />
                      <DiffGroup tone="accent" label={t("linking.preview-updated")} items={data().updated} />
                    </div>
                  </Show>
                  <Show when={data().changelog}>
                    {(text) => <pre data-vesta="changelog">{text()}</pre>}
                  </Show>
                </>
              )}
            </Show>
            <Show when={changeKind(pack(), release()) === "downgrade"}>
              <p data-vesta="version-warning">{t("linking.preview-downgrade-warning")}</p>
            </Show>
            <div data-vesta="keep-note">
              <Icon name="icons/controls/success" size={16} />
              <span>
                <strong>{t("linking.preview-keep-title")}</strong>
                <small>{t("linking.preview-keep-description")}</small>
              </span>
            </div>
          </Dialog>
        )}
      </Show>
      <LinkDialog
        open={linking()}
        onClose={() => setLinking(false)}
        onLink={(candidate, release) => {
          void linkPack(id(), candidate, release);
          setLinking(false);
        }}
      />
      <Dialog
        title={
          unlinking() === "delete"
            ? t("versions.delete-unlink-title")
            : t("versions.unlink-title")
        }
        description={
          unlinking() === "delete"
            ? t("versions.delete-unlink-warning")
            : t("versions.unlink-warning")
        }
        open={!!unlinking()}
        onOpenChange={(open) => {
          if (!open) setUnlinking(undefined);
        }}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setUnlinking(undefined)}>
              {t("common.cancel")}
            </Button>
            <Button
              tone={unlinking() === "delete" ? "danger" : "accent"}
              onClick={() => {
                unlinkPack(id(), unlinking() === "delete");
                setUnlinking(undefined);
              }}
            >
              {t("versions.confirm-unlink")}
            </Button>
          </>
        }
      />
    </div>
  );
}

/** Newest stable release (or newest of any channel) when it is ahead of the installed one. */
function updateTarget(pack: LinkedPack): PackRelease | undefined {
  const latest = pack.releases.find((item) => item.channel === "release") ?? pack.releases[0];
  if (!latest || latest.id === pack.installed) return undefined;
  const installed = pack.releases.findIndex((item) => item.id === pack.installed);
  return installed < 0 || pack.releases.indexOf(latest) < installed ? latest : undefined;
}
/** Releases are ordered newest first, so a larger index than the installed one is older. */
function changeKind(pack: LinkedPack | undefined, release: PackRelease): "update" | "downgrade" | "switch" {
  if (!pack) return "switch";
  const installed = pack.releases.findIndex((item) => item.id === pack.installed);
  const target = pack.releases.findIndex((item) => item.id === release.id);
  if (installed < 0 || target < 0) return "switch";
  return target < installed ? "update" : "downgrade";
}
const channelTone = { release: "success", beta: "warning", alpha: "danger" } as const;

/** Direction of a change relative to the installed release. */
const changeIcon = {
  update: "icons/navigation/arrow-up",
  downgrade: "icons/navigation/arrow-down",
  switch: "icons/actions/swap",
} as const;
function ChannelBadge(props: { channel: PackRelease["channel"] }) {
  return (
    <Badge size="sm" tone={channelTone[props.channel]} variant="soft">
      {t(`linking.channel-${props.channel}`)}
    </Badge>
  );
}
function DiffGroup(props: { tone: "success" | "danger" | "accent"; label: string; items?: string[] }) {
  return (
    <Show when={props.items}>
      {(items) => (
        <section data-vesta="diff-group" data-tone={props.tone}>
          <h4>
            {props.label} <Badge size="sm" tone={props.tone}>{items().length}</Badge>
          </h4>
          <ul>
            <For each={items()} fallback={<li data-vesta="version-muted">{t("linking.preview-nothing")}</li>}>
              {(item) => <li>{item}</li>}
            </For>
          </ul>
        </section>
      )}
    </Show>
  );
}

const loaderName = (id: string) =>
  id === "neoforge" ? "NeoForge" : id ? id.charAt(0).toUpperCase() + id.slice(1) : "";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
function formatDate(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

/**
 * One release on a single line: the whole line discloses its changelog; the change action
 * (update / downgrade / switch, each opening a preview) shows on hover or focus. Releases for
 * another Minecraft version than the installed one say so in the game column.
 */
function ReleaseRow(props: {
  pack: LinkedPack;
  release: PackRelease;
  minecraft: string;
  busy: boolean;
  onPreview: (release: PackRelease) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [changelog, setChangelog] = createSignal<string | null>();
  const installed = () => props.release.id === props.pack.installed;
  const kind = () => changeKind(props.pack, props.release);
  const toggle = () => {
    const next = !open();
    setOpen(next);
    if (next && changelog() === undefined) {
      void releaseChangelog(props.pack.source, props.pack.projectId, props.release.id)
        .then((text) => setChangelog(text ?? null))
        .catch(() => setChangelog(null));
    }
  };
  return (
    <li
      data-vesta="release"
      data-installed={installed() ? "" : undefined}
      data-open={open() ? "" : undefined}
    >
      <div data-vesta="release-row">
        <button
          type="button"
          data-vesta="release-toggle"
          aria-expanded={open() ? "true" : "false"}
          aria-label={`${props.release.label}, ${open() ? t("linking.hide-changelog") : t("linking.show-changelog")}`}
          onClick={toggle}
        >
          <span data-vesta="release-chevron" aria-hidden="true">
            <Icon name="icons/controls/chevron-right" size={12} />
          </span>
          <span data-vesta="release-name">
            <strong>{props.release.label}</strong>
            <Show when={props.release.channel !== "release"}>
              <ChannelBadge channel={props.release.channel} />
            </Show>
            <Show when={installed()}>
              <Badge size="sm" tone="accent" variant="soft">{t("versions.installed")}</Badge>
            </Show>
          </span>
          <span
            data-vesta="release-game"
            data-differs={props.release.minecraft && props.release.minecraft !== props.minecraft ? "" : undefined}
          >
            {props.release.minecraft}
            <span aria-hidden="true">·</span>
            {loaderName(props.release.loader)}
          </span>
          <time data-vesta="release-date" datetime={props.release.publishedAt}>
            {formatDate(props.release.publishedAt)}
          </time>
        </button>
        <span data-vesta="release-action">
          <Show when={!installed()}>
            <Button
              size="sm"
              variant="outline"
              tone={kind() === "update" ? "accent" : "neutral"}
              icon={<Icon name={changeIcon[kind()]} size={14} />}
              disabled={props.busy}
              onClick={() => props.onPreview(props.release)}
            >
              {t(`versions.release-${kind()}`)}
            </Button>
          </Show>
        </span>
      </div>
      <Show when={open()}>
        <div data-vesta="release-changelog">
          <Show
            when={changelog() !== undefined}
            fallback={<p data-vesta="version-muted">{t("linking.changelog-loading")}</p>}
          >
            <Show
              when={changelog()}
              fallback={<p data-vesta="version-muted">{t("linking.changelog-empty")}</p>}
            >
              {(text) => <pre data-vesta="changelog">{text()}</pre>}
            </Show>
          </Show>
        </div>
      </Show>
    </li>
  );
}

function LinkDialog(props: {
  open: boolean;
  onClose: () => void;
  onLink: (pack: PackCandidate, release: PackRelease) => void;
}) {
  const [source, setSource] = createSignal<PackSource>("Modrinth");
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<PackCandidate[]>();
  const [failed, setFailed] = createSignal(false);
  const [chosen, setChosen] = createSignal<PackCandidate>();
  const [releases, setReleases] = createSignal<PackRelease[]>();
  const [releaseId, setReleaseId] = createSignal("");

  createEffect(
    () => ({ open: props.open, source: source(), query: query(), chosen: chosen() }),
    ({ open, source, query, chosen }) => {
      if (!open || chosen) return;
      setResults(undefined);
      setFailed(false);
      let stale = false;
      const timer = setTimeout(() => {
        searchPacks(source, query)
          .then((hits) => { if (!stale) setResults(hits); })
          .catch(() => { if (!stale) { setFailed(true); setResults([]); } });
      }, 300);
      return () => {
        stale = true;
        clearTimeout(timer);
      };
    },
  );
  createEffect(
    () => chosen(),
    (pack) => {
      setReleases(undefined);
      setReleaseId("");
      if (!pack) return;
      let stale = false;
      packReleases(pack)
        .then((list) => {
          if (stale) return;
          setReleases(list);
          setReleaseId(list.find((item) => item.channel === "release")?.id ?? list[0]?.id ?? "");
        })
        .catch(() => { if (!stale) { setFailed(true); setReleases([]); } });
      return () => {
        stale = true;
      };
    },
  );
  const reset = () => {
    setChosen(undefined);
    setQuery("");
  };
  const selectedRelease = () => releases()?.find((item) => item.id === releaseId());
  return (
    <Dialog
      title={t("linking.link-title")}
      description={t("linking.link-description")}
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          props.onClose();
        }
      }}
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); props.onClose(); }}>
            {t("common.cancel")}
          </Button>
          <Button
            tone="accent"
            disabled={!chosen() || !selectedRelease()}
            onClick={() => {
              const pack = chosen();
              const release = selectedRelease();
              if (pack && release) {
                props.onLink(pack, release);
                reset();
              }
            }}
          >
            {t("linking.link-confirm")}
          </Button>
        </>
      }
    >
      <Show
        when={chosen()}
        fallback={
          <div data-vesta="link-form">
            <div data-vesta="version-field">
              <label>{t("linking.link-source")}</label>
              <SegmentedControl
                aria-label={t("linking.link-source")}
                fill
                value={source()}
                onChange={(value) => setSource(value as PackSource)}
                options={[
                  { value: "Modrinth", label: "Modrinth", icon: <Icon name="branding/sources/modrinth" size={18} /> },
                  { value: "CurseForge", label: "CurseForge", icon: <Icon name="branding/sources/curseforge" size={18} /> },
                ]}
              />
            </div>
            <div data-vesta="version-field">
              <label>{t("linking.link-search")}</label>
              <TextField
                aria-label={t("linking.link-search")}
                placeholder={t("linking.link-search-placeholder")}
                value={query()}
                onChange={setQuery}
              />
            </div>
            <div data-vesta="link-results">
              <Show
                when={results()}
                fallback={<p data-vesta="version-muted">{t("linking.link-searching")}</p>}
              >
                {(list) => (
                  <For
                    each={list()}
                    fallback={
                      <p data-vesta="version-muted">
                        {failed() ? t("linking.link-error") : t("linking.link-no-results")}
                      </p>
                    }
                  >
                    {(pack) => (
                      <button type="button" data-vesta="link-result" onClick={() => setChosen(pack)}>
                        <Show when={pack.icon} fallback={<span data-vesta="link-result-art" />}>
                          <img src={pack.icon} alt="" />
                        </Show>
                        <span>
                          <strong>{pack.name}</strong>
                          <small>{pack.summary}</small>
                        </span>
                      </button>
                    )}
                  </For>
                )}
              </Show>
            </div>
          </div>
        }
      >
        {(pack) => (
          <div data-vesta="link-form">
            <div data-vesta="pack-summary" data-compact="true">
              <Show when={pack().icon} fallback={<span data-vesta="link-result-art" />}>
                <img src={pack().icon} alt="" />
              </Show>
              <div>
                <strong>{pack().name}</strong>
                <span data-vesta="source-tag" data-source={pack().source.toLowerCase()}>
                  {pack().source}
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={reset}>
                {t("linking.link-change-pack")}
              </Button>
            </div>
            <div data-vesta="version-field">
              <label>{t("linking.link-choose-version")}</label>
              <Show
                when={releases()}
                fallback={<p data-vesta="version-muted">{t("linking.link-loading-versions")}</p>}
              >
                {(list) => (
                  <Combobox
                    aria-label={t("linking.link-choose-version")}
                    value={releaseId()}
                    onChange={setReleaseId}
                    options={list().map((item) => ({
                      value: item.id,
                      label: item.label,
                      description: t(`linking.channel-${item.channel}`),
                    }))}
                  />
                )}
              </Show>
            </div>
            <p data-vesta="version-muted">{t("linking.link-note")}</p>
          </div>
        )}
      </Show>
    </Dialog>
  );
}
