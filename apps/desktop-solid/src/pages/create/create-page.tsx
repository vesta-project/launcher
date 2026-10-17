import {
  enrichLocalPack,
  packArtwork,
} from "../../features/installation/pack-metadata";
import { Button, Combobox, IconPicker, SegmentedControl, Switch, TextField } from "@vesta/ui";
import { Show, createMemo, createSignal, onCleanup, onSettled, untrack } from "solid-js";
import { Board } from "../../components/board";
import { Icon } from "../../components/icon";
import { t } from "../../localization";
import { navigate } from "../../app/router";
import {
  nativeInstances,
  systemMemoryMb,
  loadSystemMemory,
} from "../../features/instances/native-service";
import {
  metadata,
  metadataError,
  loadMetadata,
  loaderVersions,
} from "../../features/instances/metadata";
import { minecraftVersions, compatibleLoaderVersions } from "../../features/instances/versions";
import {
  defaultInstanceIcons,
  importInstanceIcon,
  resolveInstanceIcon,
  uploadedInstanceIcons,
  setUploadedInstanceIcons,
} from "../../features/instances/icon-catalog";
import { calculateRecommendedMemory } from "../../features/installation/memory-policy";
import {
  installationDefaults,
  InstallationStartError,
  packReleases,
  readPack,
  matchLocalPack,
  startInstallation,
  type PackInfo,
  type PackRelease,
  type PackSource,
} from "../../features/installation/install-service";
import { route } from "../../app/router";
import { findLauncher } from "../../features/installation/launchers";
import { LauncherImportPage } from "./launcher-import-page";
import { startPendingResourceInstallation } from "../../features/browse/new-instance-install";
import { takeResourceInstall, takeInstallSource } from "./install-navigation";
import { InstallMemoryCard } from "./memory-card";
import { InstallPackDetails } from "./pack-details";
import { ImportDialog } from "./import-dialog";
import "./create-page.css";

const loaderNames: Record<string, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  quilt: "Quilt",
};

export function CreatePage() {
  const selected = () =>
    route().section === "import" ? findLauncher(route().detail)?.value : undefined;
  return (
    <Show when={selected()} keyed fallback={<InstanceInstallForm />}>
      {(kind) => <LauncherImportPage kind={kind} />}
    </Show>
  );
}

function InstanceInstallForm() {
  const [pendingResource, setPendingResource] = createSignal(takeResourceInstall(), { name: "installPendingResource" });
  const [name, setName] = createSignal("", { name: "installName" });
  const [icon, setIcon] = createSignal(defaultInstanceIcons[0].value, { name: "installIcon" });
  const [minecraft, setMinecraft] = createSignal("", { name: "installMinecraft" });
  const [loader, setLoader] = createSignal("vanilla", { name: "installLoader" });
  const [loaderVersion, setLoaderVersion] = createSignal("", { name: "installLoaderVersion" });
  const [experimental, setExperimental] = createSignal(false, { name: "installSnapshots" });
  const [memory, setMemory] = createSignal([2048, 4096], { name: "installMemory" });
  const [busy, setBusy] = createSignal(false, { name: "installSubmitting" });
  const [matching, setMatching] = createSignal(false, { name: "installPackMatching" });
  const [reading, setReading] = createSignal(false, { name: "installSourceLoading" });
  const [error, setError] = createSignal("", { name: "installError" });
  const [source, setSource] = createSignal<PackSource>();
  const [pack, setPack] = createSignal<PackInfo>();
  const [releases, setReleases] = createSignal<PackRelease[]>([]);
  const [releaseError, setReleaseError] = createSignal("");
  const [importOpen, setImportOpen] = createSignal(false);
  const [createdId, setCreatedId] = createSignal<number>();
  const [defaults, setDefaults] = createSignal<{
    default_min_memory: number;
    default_max_memory: number;
  }>();
  const [memoryEdited, setMemoryEdited] = createSignal(false, { name: "installMemoryEdited" });
  let nameEdited = false,
    iconEdited = false,
    request = 0,
    disposed = false;
  onCleanup(() => {
    disposed = true;
    request++;
  });
  const selectedMinecraft = () =>
    minecraft() || (nativeInstances ? metadata()?.latest.release : "1.21.4") || "";
  const availableVersions = () =>
    nativeInstances
      ? (metadata()?.game_versions ?? [])
      : minecraftVersions().map((id) => ({ id, stable: !/\d+w|-(pre|rc)/.test(id), loaders: {} }));
  const versions = createMemo(() =>
    availableVersions()
      .filter(
        (version) =>
          (experimental() || version.stable) &&
          (loader() === "vanilla" || compatibleLoaderVersions(version.id, loader()).length > 0),
      )
      .map((version) => ({ value: version.id, label: version.id })),
  );
  const loaderOptions = () =>
    nativeInstances
      ? loaderVersions(selectedMinecraft(), loader())
      : compatibleLoaderVersions(selectedMinecraft(), loader());
  const selectedLoader = () =>
    loader() === "vanilla" ? "" : loaderVersion() || loaderOptions()[0] || "";
  const locked = () => busy() || reading();
  const recommendedMemory = () =>
    calculateRecommendedMemory(
      systemMemoryMb() ?? 0,
      pack()?.modCount ?? 0,
      pack()?.recommendedRamMb,
      {
        defaultMinMemory: defaults()?.default_min_memory,
        defaultMaxMemory: defaults()?.default_max_memory,
      },
    );
  const recommend = () => {
    if (!untrack(memoryEdited)) {
      const value = untrack(recommendedMemory);
      setMemory([value.min, value.max]);
    }
  };
  const valid = () =>
    name().trim() &&
    selectedMinecraft() &&
    memory().length === 2 &&
    memory().every(Number.isFinite) &&
    memory()[0] >= 512 &&
    memory()[1] >= memory()[0] &&
    !locked() &&
    !createdId() &&
    !releaseError() &&
    (source()
      ? !!pack()
      : versions().some((version) => version.value === selectedMinecraft()) &&
        (loader() === "vanilla" || loaderOptions().includes(selectedLoader())));
  const iconOptions = createMemo(() => {
    const options = [...defaultInstanceIcons];
    for (const src of [icon(), pack()?.iconUrl, ...uploadedInstanceIcons()])
      if (src && !options.some((option) => option.value === src))
        options.push({
          value: src,
          src: resolveInstanceIcon(src),
          label: t("instance-settings.uploaded-icon"),
        });
    return options;
  });
  onSettled(() => {
    const pending = untrack(pendingResource);
    if (pending) {
      setName(pending.project.name);
      setIcon(pending.project.icon_url || defaultInstanceIcons[0].value);
      setMinecraft(pending.minecraft);
      setLoader(pending.loader);
      setLoaderVersion(pending.loaderVersion);
      nameEdited = iconEdited = true;
      setExperimental(true);
    }
    const handoff = takeInstallSource();
    if (handoff) void loadSource(handoff);
    void loadMetadata();
    if (nativeInstances)
      void Promise.all([
        loadSystemMemory(),
        installationDefaults().then((value) => {
          if (!disposed) setDefaults(value);
        }),
      ])
        .then(() => {
          if (!disposed) recommend();
        })
        .catch((reason) => {
          if (!disposed) setError(String(reason));
        });
  });
  const upload = async (file: File) => {
    try {
      const value = await importInstanceIcon(file);
      if (disposed) return;
      iconEdited = true;
      setIcon(value);
      setUploadedInstanceIcons((icons) => [...new Set([...icons, value])]);
    } catch (reason) {
      if (!disposed) setError(String(reason));
    }
  };
  const loadSource = async (next: PackSource) => {
    setPendingResource(undefined);
    const previous = untrack(source);
    // A newly chosen pack starts with its own artwork. Icon choices made after
    // choosing this source survive enrichment and retries.
    if (next.kind === "file" && (!previous || previous.kind !== "file" || previous.value !== next.value))
      iconEdited = false;
    const generation = ++request;
    setImportOpen(false);
    setSource(next);
    setPack(undefined);
    setReading(true);
    setMatching(false);
    setError("");
    setReleaseError("");
    setReleases([]);
    try {
      const info = await readPack(next);
      if (disposed || generation !== request) return;
      setPack(info);
      setMinecraft(info.minecraftVersion);
      setLoader(info.modloader || "vanilla");
      setLoaderVersion(info.modloaderVersion || "");
      if (!nameEdited) setName(info.name);
      if (!iconEdited) setIcon(packArtwork(info.iconUrl) || defaultInstanceIcons[0].value);
      recommend();
      if (next.kind === "file") {
        setMatching(true);
        void matchLocalPack(next.value)
          .then((match) => {
            if (disposed || generation !== request || untrack(busy)) return;
            const enriched = enrichLocalPack(info, match);
            setPack(enriched);
            if (!nameEdited) setName(enriched.name);
            if (!iconEdited)
              setIcon(packArtwork(enriched.iconUrl) || defaultInstanceIcons[0].value);
          })
          .catch(() => {
            // Online enrichment is optional; the local archive can still be installed offline.
          })
          .finally(() => {
            if (!disposed && generation === request) setMatching(false);
          });
      }
      // Archive files remain tied to their exact contents. Online releases use concrete download URLs.
      if (next.kind === "url") {
        try {
          const versions = (await packReleases(info)).filter((version) => version.download_url);
          if (!disposed && generation === request) {
            setReleases(versions);
            if (info.modpackId && !versions.some((version) => version.id === info.modpackVersionId))
              setReleaseError(t("install.release-unavailable"));
          }
        } catch (reason) {
          if (!disposed && generation === request) setReleaseError(String(reason));
        }
      }
    } catch (reason) {
      if (!disposed && generation === request) setError(String(reason));
    } finally {
      if (!disposed && generation === request) setReading(false);
    }
  };
  const chooseRelease = (id: string) => {
    const release = releases().find((item) => item.id === id);
    if (!release) return;
    void loadSource({ kind: "url", value: release.download_url });
  };
  const chooseLoader = (value: string) => {
    setLoader(value);
    setLoaderVersion("");
    if (value !== "vanilla" && !compatibleLoaderVersions(selectedMinecraft(), value).length) {
      const version = availableVersions().find(
        (item) =>
          (experimental() || item.stable) && compatibleLoaderVersions(item.id, value).length,
      );
      setMinecraft(version?.id || "");
    }
  };
  const install = async () => {
    if (!nativeInstances || !valid()) return;
    setBusy(true);
    setError("");
    try {
      const selected = releases().find((item) => item.id === pack()?.modpackVersionId);
      const packSource = source();
      // Bind install to the inspected release, even when the original URL meant "latest".
      const resolved =
        packSource?.kind === "url" && selected
          ? { kind: "url" as const, value: selected.download_url }
          : packSource;
      const initialDraft = {
        name: name(),
        icon: icon(),
        minecraft: selectedMinecraft(),
        loader: loader(),
        loaderVersion: selectedLoader() || pack()?.modloaderVersion || "",
        memory: memory(),
      };
      const initialPack = pack();
      const start = () => startInstallation(initialDraft, resolved, initialPack);
      const pending = untrack(pendingResource);
      if (pending) await startPendingResourceInstallation(pending, start);
      else await start();
      if (!disposed) navigate("/library");
    } catch (reason) {
      if (!disposed) {
        if (reason instanceof InstallationStartError) setCreatedId(reason.instanceId);
        setError(String(reason));
      }
    } finally {
      if (!disposed) setBusy(false);
    }
  };
  return (
    <Board fixed>
      <form
        data-vesta="instance-install"
        data-modpack={pack() ? "" : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          void install();
        }}
      >
        <header data-vesta="install-header">
          <div>
            <h1>{pack()?.name || t("management.create-title")}</h1>
            <Show when={pendingResource()}>
              {(pending) => <p role="status">{t(pending().kind === "datapack" ? "browse.pending-resource-world" : "browse.pending-resource", { name: pending().project.name })}</p>}
            </Show>
            <Show when={source()}>
              <p>{source()?.kind === "file" ? t("install.local-file") : t("install.from-url")}</p>
            </Show>
          </div>
          <div>
            <Button variant="outline" disabled={locked()} onClick={() => setImportOpen(true)}>
              {source() ? t("install.change-import") : t("install.import")}
            </Button>
          </div>
        </header>
        <div data-vesta="install-scroll">
          <Show when={reading()}>
            <p role="status">{t("install.reading-pack")}</p>
          </Show>
          <Show when={!reading() && (!source() || pack())}>
            <div data-vesta="install-columns" data-modpack={pack() ? "" : undefined}>
              <div data-vesta="install-main">
                <section data-vesta="install-identity-section" aria-label={t("install.identity")}>
                  <div data-vesta="install-identity">
                    <IconPicker
                      value={icon()}
                      preview={resolveInstanceIcon(icon())}
                      options={iconOptions()}
                      onSelect={(value) => {
                        if (!locked()) {
                          iconEdited = true;
                          setIcon(value);
                        }
                      }}
                      onUpload={(file) => void upload(file)}
                    />
                    <TextField
                      aria-label={t("management.name")}
                      placeholder={t("install.name-placeholder")}
                      class="install-name-field"
                      value={name()}
                      onChange={(value) => {
                        nameEdited = true;
                        setName(value);
                      }}
                      disabled={locked()}
                    />
                  </div>
                </section>
                <section data-vesta="install-section">
                  <h2>{pack() ? t("install.modpack-configuration") : t("install.game-options")}</h2>
                  <Show
                    when={pack()}
                    fallback={
                      <>
                        <div data-vesta="install-field">
                          <label>{t("management.loader")}</label>
                          <SegmentedControl
                            value={loader()}
                            onChange={chooseLoader}
                            aria-label={t("management.loader")}
                            options={Object.entries(loaderNames).map(([value, label]) => ({
                              value,
                              label,
                            }))}
                            disabled={locked()}
                          />
                        </div>
                        <div data-vesta="install-version-row">
                          <div data-vesta="install-field">
                            <label>{t("management.minecraft")}</label>
                            <Combobox
                              value={selectedMinecraft()}
                              options={versions()}
                              onChange={(value) => {
                                setMinecraft(value);
                                setLoaderVersion("");
                              }}
                              aria-label={t("management.minecraft")}
                              disabled={locked() || (!metadata() && nativeInstances)}
                            />
                          </div>
                          <Switch
                            label={t("versions.show-snapshots")}
                            checked={experimental()}
                            onChange={setExperimental}
                            disabled={locked()}
                          />
                        </div>
                        <Show when={loader() !== "vanilla"}>
                          <div data-vesta="install-field">
                            <label>{t("management.loader-version")}</label>
                            <Combobox
                              value={selectedLoader()}
                              options={loaderOptions().map((value) => ({ value, label: value }))}
                              onChange={setLoaderVersion}
                              disabled={locked() || !loaderOptions().length}
                              aria-label={t("management.loader-version")}
                            />
                          </div>
                        </Show>
                        <Show when={nativeInstances && !metadata()}>
                          <p role={metadataError() ? "alert" : "status"}>
                            {metadataError() || t("management.metadata-loading")}
                          </p>
                          <Show when={metadataError()}>
                            <Button variant="ghost" onClick={() => void loadMetadata()}>
                              {t("common.retry")}
                            </Button>
                          </Show>
                        </Show>
                      </>
                    }
                  >
                    <Show when={releases().length}>
                      <div data-vesta="install-field">
                        <label>{t("install.release")}</label>
                        <Combobox
                          value={pack()?.modpackVersionId || ""}
                          options={releases().map((item) => ({
                            value: item.id,
                            label: item.version_number,
                          }))}
                          onChange={chooseRelease}
                          aria-label={t("install.release")}
                          disabled={locked()}
                        />
                      </div>
                    </Show>
                    <dl data-vesta="install-pack-engine">
                      <div>
                        <dt>{t("management.minecraft")}</dt>
                        <dd>{selectedMinecraft()}</dd>
                      </div>
                      <div>
                        <dt>{t("management.loader")}</dt>
                        <dd>
                          {loaderNames[loader()] || loader()} {pack()?.modloaderVersion}
                        </dd>
                      </div>
                    </dl>
                    <Show when={releaseError()}>
                      <p role="alert">{releaseError()}</p>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const current = source();
                          if (current) void loadSource(current);
                        }}
                      >
                        {t("common.retry")}
                      </Button>
                    </Show>
                  </Show>
                </section>
                <InstallMemoryCard
                  value={memory()}
                  onChange={(value) => {
                    setMemoryEdited(true);
                    setMemory(value);
                  }}
                  recommendation={recommendedMemory()}
                  manual={memoryEdited()}
                  modpack={!!pack()}
                  modCount={pack()?.modCount}
                  systemMemory={systemMemoryMb()}
                  disabled={locked()}
                />
              </div>
              <Show when={pack()}>
                {(info) => (
                  <InstallPackDetails info={info()} source={source()} matching={matching()} />
                )}
              </Show>
            </div>
          </Show>
          <Show when={error()}>
            <div data-vesta="install-error" role="alert">
              <p>{error()}</p>
              <Show
                when={createdId()}
                fallback={
                  <Show when={source() && !pack()}>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const current = source();
                        if (current) void loadSource(current);
                      }}
                    >
                      {t("common.retry")}
                    </Button>
                  </Show>
                }
              >
                <p>{t("install.created-recovery")}</p>
                <Button variant="outline" onClick={() => navigate("/library")}>
                  {t("install.view-library")}
                </Button>
              </Show>
            </div>
          </Show>
        </div>
        <footer data-vesta="install-footer">
          <Button variant="ghost" onClick={() => navigate("/library")} disabled={locked()}>
            {t("common.cancel")}
          </Button>
          <Button
            tone="accent"
            type="submit"
            disabled={!nativeInstances || !valid()}
            icon={<Icon name="icons/actions/download" />}
          >
            {t(busy() ? "install.starting" : "management.install")}
          </Button>
        </footer>
      </form>
      <Show when={importOpen()}>
        <ImportDialog
          initialUrl={source()?.kind === "url" ? source()?.value : undefined}
          open
          onClose={() => setImportOpen(false)}
          onSource={(next) => void loadSource(next)}
          onLauncher={(kind) => {
            setImportOpen(false);
            navigate(`/create/import/${kind}`);
          }}
        />
      </Show>
    </Board>
  );
}
