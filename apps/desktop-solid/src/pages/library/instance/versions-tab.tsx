import {
  Badge,
  Button,
  Combobox,
  Dialog,
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
        {(linked) => (
          <section data-vesta="linked-pack">
            <SettingsSection title={t("versions.linked-modpack")}>
              <div data-vesta="pack-selector">
                <div data-vesta="pack-summary">
                  <img src={linked().icon} alt="" />
                  <div>
                    <strong>{linked().name}</strong>
                    <span
                      data-vesta="source-tag"
                      data-source={linked().source.toLowerCase()}
                    >
                      {linked().source}
                    </span>
                  </div>
                  <span data-vesta="pack-installed">
                    <small>
                      {t("linking.installed-version", {
                        version: linked().installedLabel ?? linked().installed,
                      })}
                    </small>
                    <small>
                      Minecraft {store.state().engine.minecraft} ·{" "}
                      {store.state().engine.loader}
                    </small>
                  </span>
                </div>
                <Show when={updateTarget(linked())}>
                  {(target) => (
                    <div data-vesta="pack-update">
                      <Icon name="icons/actions/download" size={14} />
                      <span>{t("versions.version-available", { version: target().label })}</span>
                      <Button
                        size="sm"
                        tone="accent"
                        disabled={busy()}
                        onClick={() => setPreviewing(target())}
                      >
                        {t("linking.action-update")}
                      </Button>
                    </div>
                  )}
                </Show>
              </div>
            </SettingsSection>
            <SettingsSection
              title={t("linking.versions-title")}
              description={t("linking.versions-description")}
            >
              <div data-vesta="version-release-heading">
                <TextField
                  aria-label={t("versions.search-pack-versions")}
                  placeholder={t("versions.search-versions")}
                  value={releaseQuery()}
                  onChange={setReleaseQuery}
                />
                <Combobox
                  aria-label={t("versions.release-type")}
                  value={releaseFilter()}
                  onChange={setReleaseFilter}
                  options={[
                    { value: "stable", label: t("versions.stable-releases") },
                    { value: "all", label: t("linking.all-channels") },
                  ]}
                />
              </div>
              <div data-vesta="version-releases">
                <For
                  each={linked().releases.filter(
                    (item) =>
                      (releaseFilter() === "all" ||
                        item.channel === "release" ||
                        item.id === linked().installed) &&
                      item.label
                        .toLowerCase()
                        .includes(releaseQuery().toLowerCase()),
                  )}
                  fallback={<p data-vesta="version-empty">{t("versions.no-matching-versions")}</p>}
                >
                  {(item) => (
                    <ReleaseRow
                      pack={linked()}
                      release={item}
                      busy={busy()}
                      onPreview={setPreviewing}
                    />
                  )}
                </For>
              </div>
            </SettingsSection>
            <SettingsSection title={t("versions.connection")}>
              <SettingRow
                label={t("versions.unlink-modpack")}
                description={t("versions.unlink-description")}
              >
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy()}
                  onClick={() => setUnlinking("keep")}
                >
                  {t("versions.unlink-action")}
                </Button>
              </SettingRow>
              <SettingRow
                label={t("versions.delete-bundled-unlink")}
                description={t("versions.delete-unlink-description")}
              >
                <Button
                  size="sm"
                  variant="outline"
                  tone="danger"
                  disabled={busy()}
                  onClick={() => setUnlinking("delete")}
                >
                  {t("versions.delete-unlink-action")}
                </Button>
              </SettingRow>
            </SettingsSection>
          </section>
        )}
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

function ReleaseRow(props: {
  pack: LinkedPack;
  release: PackRelease;
  busy: boolean;
  onPreview: (release: PackRelease) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [changelog, setChangelog] = createSignal<string | null>();
  const installed = () => props.release.id === props.pack.installed;
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
    <div data-vesta="version-release" data-installed={installed() ? "true" : undefined}>
      <div data-vesta="version-release-row">
        <span>
          <strong>
            {props.release.label}
            <ChannelBadge channel={props.release.channel} />
            <Show when={installed()}>
              <Badge size="sm" tone="accent" variant="outline">{t("versions.installed")}</Badge>
            </Show>
          </strong>
          <small>
            Minecraft {props.release.minecraft} · {props.release.loader}
            <Show when={props.release.publishedAt}>
              {(date) => <> · {t("linking.published", { date: date() })}</>}
            </Show>
          </small>
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open() ? "true" : "false"}
          iconEnd={<Icon name={open() ? "icons/controls/chevron-up" : "icons/controls/chevron-down"} size={14} />}
          onClick={toggle}
        >
          {open() ? t("linking.hide-changelog") : t("linking.show-changelog")}
        </Button>
        <Show when={!installed()}>
          <Button
            size="sm"
            variant="outline"
            disabled={props.busy}
            onClick={() => props.onPreview(props.release)}
          >
            {t(`linking.action-${changeKind(props.pack, props.release)}`)}
          </Button>
        </Show>
      </div>
      <Show when={open()}>
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
      </Show>
    </div>
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
