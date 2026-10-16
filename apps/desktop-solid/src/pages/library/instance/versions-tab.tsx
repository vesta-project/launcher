import {
  Button,
  Combobox,
  Dialog,
  Select,
  Switch,
  SegmentedControl,
  TextField,
} from "@vesta/ui";
import { For, Show, createSignal, untrack } from "solid-js";
import { SettingRow, SettingsSection } from "../../../components/setting-row";
import {
  compatibleLoaderVersions,
  experimentalVersion,
  minecraftVersions,
  versionStore,
  applyEngineVersion,
  unlinkPack,
  type EngineVersion,
  type PackRelease,
} from "../../../features/instances/versions";
import type { InstanceEntry } from "../../../features/instances/fixtures";
import { Icon } from "../../../components/icon";
import { t } from "../../../localization";
import "./versions-tab.css";

export function VersionsTab(props: { entry: InstanceEntry }) {
  const id = () => props.entry.instance.id;
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
  const [releasesOpen, setReleasesOpen] = createSignal(false);
  const [releaseQuery, setReleaseQuery] = createSignal("");
  const [pending, setPending] = createSignal<{
    engine: EngineVersion;
    release?: PackRelease;
  }>();
  const [unlinking, setUnlinking] = createSignal<"keep" | "delete">();
  const pack = () => store.state().pack;
  const busy = () =>
    ["running", "warming", "installing"].includes(props.entry.state.kind);
  const engine = (): EngineVersion => ({
    minecraft: minecraft(),
    loader: loader(),
    loaderVersion: loader() === "vanilla" ? "" : loaderVersion(),
  });
  const valid = () =>
    loader() === "vanilla" ||
    compatibleLoaderVersions(minecraft(), loader()).includes(loaderVersion());
  const dirty = () =>
    JSON.stringify(engine()) !== JSON.stringify(store.state().engine);
  const mcOptions = () =>
    [...new Set([store.state().engine.minecraft, ...minecraftVersions])]
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
      }));

  const chooseMinecraft = (value: string) => {
    setMinecraft(value);
    setLoaderVersion(compatibleLoaderVersions(value, loader())[0] ?? "");
  };
  return (
    <div data-vesta="versions">
      <Show
        when={pack()}
        fallback={
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
                    options={compatibleLoaderVersions(
                      minecraft(),
                      loader(),
                    ).map((value) => ({ value, label: value }))}
                  />
                </div>
              </Show>
            </div>
            <Show when={!valid()}>
              <p data-vesta="version-warning">
                {compatibleLoaderVersions(minecraft(), loader()).length
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
                  <button
                    type="button"
                    data-vesta="pack-version-trigger"
                    aria-expanded={releasesOpen() ? "true" : "false"}
                    onClick={() => setReleasesOpen(!releasesOpen())}
                  >
                    <span>
                      <strong>{linked().installed}</strong>
                      <small>
                        Minecraft {store.state().engine.minecraft} ·{" "}
                        {store.state().engine.loader}
                      </small>
                    </span>
                    <Icon name="icons/controls/chevron-down" />
                  </button>
                </div>
                <Show when={linked().releases[0].id !== linked().installed}>
                  <div data-vesta="pack-update">
                    <Icon name="icons/actions/download" size={14} />
                    <span>{t("versions.version-available", { version: linked().releases[0].label })}</span>
                    <Button
                      size="sm"
                      tone="accent"
                      disabled={busy()}
                      onClick={() =>
                        setPending({
                          engine: linked().releases[0],
                          release: linked().releases[0],
                        })
                      }
                    >
                      {t("versions.update-pack")}
                    </Button>
                  </div>
                </Show>
                <Show when={releasesOpen()}>
                  <div data-vesta="version-release-heading">
                    <TextField
                      aria-label={t("versions.search-pack-versions")}
                      placeholder={t("versions.search-versions")}
                      size="sm"
                      value={releaseQuery()}
                      onChange={setReleaseQuery}
                    />
                    <Select
                      size="sm"
                      aria-label={t("versions.release-type")}
                      value={releaseFilter()}
                      onChange={setReleaseFilter}
                      options={[
                        { value: "stable", label: t("versions.stable-releases") },
                        { value: "all", label: t("versions.all-releases") },
                      ]}
                    />
                  </div>
                  <div data-vesta="version-releases">
                    <For
                      each={linked().releases.filter(
                        (item) =>
                          (releaseFilter() === "all" || !item.experimental) &&
                          item.label
                            .toLowerCase()
                            .includes(releaseQuery().toLowerCase()),
                      )}
                      fallback={<p>{t("versions.no-matching-versions")}</p>}
                    >
                      {(item) => (
                        <div data-vesta="version-release">
                          <span>
                            <strong>{item.label}</strong>
                            <small>
                              {item.experimental ? `${t("versions.experimental-tag")} · ` : ""}
                              Minecraft {item.minecraft} · {item.loader}{" "}
                              {item.loaderVersion}
                            </small>
                          </span>
                          <Show
                            when={item.id !== linked().installed}
                            fallback={<small>{t("versions.installed")}</small>}
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy()}
                              onClick={() =>
                                setPending({ engine: item, release: item })
                              }
                            >
                              {t("versions.switch-version")}
                            </Button>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
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
        open={!!pending()}
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
                  applyEngineVersion(id(), next.engine, next.release?.id);
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
