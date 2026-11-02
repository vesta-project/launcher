import { serverPackMetadata } from '../../features/servers/native-pack-sync';
import { serverInstanceFallback } from '../../features/servers/create-instance-model';
import { preloadLaunchers } from '../../features/launcher-import';
import { useNativeDropZone } from '../../features/file-drop/zone';
import {
  enrichLocalPack,
  packArtwork,
} from "../../features/installation/pack-metadata";
import { Button, Checkbox, Combobox, IconPicker, Switch, TextField, toast } from "@vesta/ui";
import { linkInstanceToServer } from "../../features/browse/server-links";
import { serverPack } from "../../features/browse/server-listing";
import { OptionCards } from "../../components/option-cards";
import { SoftwareMark } from "../../components/software-mark";
import { Notice } from "../../components/notice";
import { softwareIcon } from "../../features/servers/software-flow";
import type { MessageId } from "../../localization/messages";
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
  gameVersionsForLoader,
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
  installationRecord,
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
import { createActionKey, takeCreateAction, takeResourceInstall, takeInstallSource, takeServerListing, takeServerInstall, openServerInstall } from "./install-navigation";
import { InstallMemoryCard } from "./memory-card";
import { InstallPackDetails } from "./pack-details";
import { ImportDialog } from "./import-dialog";
import "./create-page.css";
import { serverCommand, serverSnapshot } from '../../features/servers/store';
import { usingFixtures } from '../../features/servers/service';
import type { PackSyncPreview, PackSyncDetails } from '../../features/servers/native-pack-sync';
import { errorMessage } from '../../features/servers/errors';
import type { ServerCommandError } from '../../features/servers/native';
import { syncApplyRequest } from '../../features/servers/modpack-area-model';
import { invoke } from '@tauri-apps/api/core';
import type { NativeInstance } from '../../features/instances/native-model';
import { refreshNativeInstances } from '../../features/instances/native-service';

const loaderNames: Record<string, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  quilt: "Quilt",
};

const loaderCards = () => Object.entries(loaderNames).map(([value, label]) => ({
  value,
  label,
  hint: t(`software.hint-${value}` as MessageId),
  icon: <SoftwareMark software={value} icon={softwareIcon[value as keyof typeof softwareIcon]} />,
}));

export function CreatePage() {
  onSettled(() => { void preloadLaunchers().catch(() => {}); });
  const selected = () =>
    route().section === "import" ? findLauncher(route().detail)?.value : undefined;
  return (
    <Show when={selected()} keyed fallback={<Show when={createActionKey()} keyed>{(_key) => <InstanceInstallForm />}</Show>}>
      {(kind) => <LauncherImportPage kind={kind} />}
    </Show>
  );
}

function InstanceInstallForm() {
  const serverId = takeServerInstall();
  const [serverReview, setServerReview] = createSignal<PackSyncDetails>();
  const [serverConsent, setServerConsent] = createSignal(false);
  const [serverUncertain, setServerUncertain] = createSignal(false);
  const createAction = takeCreateAction();
  const sourceHandoff = takeInstallSource();
  // Install & play from a Modrinth server listing: the same form, then the instance follows the listing.
  const listing = sourceHandoff ? takeServerListing() : undefined;
  const followsListing = (info: PackInfo | undefined) =>
    !!listing && info?.modpackId === serverPack(listing.server)?.projectId;
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
  const [serverWithoutPack, setServerWithoutPack] = createSignal(false, { name: 'create:server-without-pack' });
  const [reading, setReading] = createSignal(!!sourceHandoff || !!serverId, { name: "installSourceLoading" });
  const [error, setError] = createSignal("", { name: "installError" });
  const [source, setSource] = createSignal<PackSource>();
  const [pack, setPack] = createSignal<PackInfo>();
  const [releases, setReleases] = createSignal<PackRelease[]>([]);
  const [releaseError, setReleaseError] = createSignal("");
  const [importOpen, setImportOpen] = createSignal(!!createAction && createAction !== 'new');
  const [importStep, setImportStep] = createSignal<'methods' | 'file' | 'launchers'>(
    createAction === 'file' || createAction === 'launchers' ? createAction : 'methods',
  );
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
    const review = untrack(serverReview);
    if (review?.reviewId) void serverCommand(api => api.packSyncDiscard(review.reviewId)).catch(() => {});
  });
  const loaderChoices = createMemo(loaderCards, { name: "installLoaderChoices" });
  const selectedMinecraft = () =>
    minecraft() || (nativeInstances ? metadata()?.latest.release : "1.21.4") || "";
  const availableVersions = createMemo(() => nativeInstances
    ? gameVersionsForLoader(loader(), experimental())
    : minecraftVersions()
      .filter(id => (experimental() || !/\d+w|-(pre|rc)/.test(id)) &&
        (loader() === "vanilla" || compatibleLoaderVersions(id, loader()).length > 0))
      .map(id => ({ id })), { name: "installCompatibleMinecraft" });
  const versions = createMemo(() => availableVersions().map(version => ({ value: version.id, label: version.id })),
    { name: "installMinecraftOptions" });
  const loaderOptions = createMemo(() => compatibleLoaderVersions(selectedMinecraft(), loader()),
    { name: "installLoaderVersions" });
  const loaderComboboxOptions = createMemo(() => loaderOptions().map(value => ({ value, label: value })),
    { name: "installLoaderOptions" });
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
    (!serverId || serverWithoutPack() || (!!serverReview() && (!serverReview()!.consentRequired || serverConsent()))) &&
    (serverId && !serverWithoutPack() ? !!pack() : source()
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
    if (serverId) void (usingFixtures ? serverCommand(api => api.packSyncPreview(serverId, null)) : invoke<PackSyncDetails>('server_pack_sync_details', { connectionId: serverId })).then(review => {
      if (disposed) { if (review.reviewId) void serverCommand(api => api.packSyncDiscard(review.reviewId)).catch(() => {}); return; }
      const details = review as PackSyncDetails;
      setServerReview(details); setName(review.name); setMinecraft(review.runtime.minecraftVersion);
      setLoader(review.runtime.loader); setLoaderVersion(review.runtime.loaderVersion || '');
      setPack(serverPackMetadata(details));
      if (details.iconUrl) setIcon(details.iconUrl);
    }).catch(reason => {
      if (disposed) return;
      const failure = reason as ServerCommandError;
      const fallback = serverInstanceFallback(failure, serverSnapshot(serverId));
      if (fallback) {
        setName(fallback.name); setMinecraft(fallback.minecraft); setLoader(fallback.loader);
        setServerWithoutPack(true); return;
      }
      setError(t('server-pack.create-failed', { message: t(errorMessage(failure)) }));
    }).finally(() => { if (!disposed) setReading(false); });
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
    if (sourceHandoff) {
      if (typeof sourceHandoff === "function") void resolveSource(sourceHandoff);
      else void loadSource(sourceHandoff);
    }
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
  const resolveSource = async (resolve: () => Promise<PackSource>) => {
    const generation = ++request;
    setReading(true);
    setError("");
    try {
      const next = await resolve();
      // Back, a native drop or another source choice retires this handoff.
      if (disposed || generation !== request) return;
      await loadSource(next);
    } catch (reason) {
      if (!disposed && generation === request) setError(String(reason));
    } finally {
      if (!disposed && generation === request) setReading(false);
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
      if (!nameEdited) setName(followsListing(info) ? listing!.name : info.name);
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
      // The selected release is already usable. Optional release switching must not
      // keep the form hidden, and reuses the same cache as Browse and hover prefetch.
      if (next.online) setReleases([next.online.release]);
      if (next.kind === "url") {
        void packReleases(info).then((items) => {
          if (disposed || generation !== request) return;
          const versions = items.filter((version) => version.download_url);
          // A pinned release can be absent from a provider's paginated list.
          // Keep its exact download instead of discarding an already valid selection.
          const selected = next.online?.release;
          setReleases(selected && !versions.some((version) => version.id === selected.id)
            ? [selected, ...versions] : versions);
          if (!selected && info.modpackId && !versions.some((version) => version.id === info.modpackVersionId))
            setReleaseError(t("install.release-unavailable"));
        }).catch((reason) => {
          // Switching releases is optional when Browse supplied an exact release.
          if (!disposed && generation === request && !next.online) setReleaseError(String(reason));
        });
      }
    } catch (reason) {
      if (!disposed && generation === request) setError(String(reason));
    } finally {
      if (!disposed && generation === request) setReading(false);
    }
  };
  const chooseRelease = (id: string) => {
    const release = releases().find((item) => item.id === id);
    if (!release || id === pack()?.modpackVersionId) return;
    const online = source()?.online;
    void loadSource({ kind: "url", value: release.download_url,
      ...(online ? { online: { project: online.project, release } } : {}),
    });
  };
  const chooseLoader = (value: string) => {
    setLoader(value);
    setLoaderVersion("");
    if (value !== "vanilla" && !compatibleLoaderVersions(selectedMinecraft(), value).length) {
      const version = nativeInstances
        ? gameVersionsForLoader(value, experimental())[0]
        : minecraftVersions().map(id => ({ id })).find(item =>
          (experimental() || !/\d+w|-(pre|rc)/.test(item.id)) && compatibleLoaderVersions(item.id, value).length);
      setMinecraft(version?.id || "");
    }
  };
  const install = async () => {
    if ((!nativeInstances && !serverId) || !valid()) return;
    setBusy(true);
    setError("");
    try {
      if (serverId && !serverWithoutPack()) {
        if (!usingFixtures) {
          const details = serverReview();
          if (!details) return;
          const instanceData = installationRecord({ name: name().trim(), icon: icon(), minecraft: selectedMinecraft(), loader: loader(), loaderVersion: selectedLoader(), memory: memory() }, pack());
          const id = await invoke<number>('server_pack_sync_install', { connectionId: serverId, revision: details.revision, sha256: details.artifactSha256, consent: serverConsent(), instanceData });
          setCreatedId(id);
          await refreshNativeInstances(true);
          if (!disposed) navigate('/library');
          return;
        }
        const details = serverReview();
        if (!details) return;
        const review = details.reviewId ? details : await serverCommand(api => api.packSyncPreview(serverId, null));
        if (review.artifactSha256 !== details.artifactSha256 || review.revision !== details.revision || review.serverId !== details.serverId || review.fingerprint !== details.fingerprint) {
          await serverCommand(api => api.packSyncDiscard(review.reviewId));
          setServerReview(undefined); setServerConsent(false);
          throw { code: 'conflict', reason: 'pack_review_stale' };
        }
        const apply = syncApplyRequest(review, serverConsent(), false);
        if (!apply) return;
        setServerReview(undefined);
        const id = await serverCommand(api => api.packSyncApply({ ...apply, name: name().trim() }));
        setCreatedId(id);
        if (!usingFixtures) {
          const record = await invoke<NativeInstance>('get_instance', { instanceId: id });
          await invoke('update_instance', { instanceData: { ...record, minMemory: memory()[0], maxMemory: memory()[1], iconPath: iconEdited ? icon() : record.iconPath } });
          await refreshNativeInstances(true);
        }
        navigate(`/library/${id}`); return;
      }
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
      else if (listing && followsListing(initialPack)) {
        const id = String(await start());
        await linkInstanceToServer(id, listing).catch((reason: unknown) =>
          toast.show({ title: t("browse.server-link-failed"), description: String(reason instanceof Error ? reason.message : reason), tone: "danger" }));
        if (!disposed) navigate(`/library/${encodeURIComponent(id)}`);
        return;
      }
      else await start();
      if (!disposed) navigate("/library");
    } catch (reason) {
      if (!disposed) {
        if (reason instanceof InstallationStartError) setCreatedId(reason.instanceId);
        if (serverId && ['outcome_unknown', 'timeout', 'unreachable'].includes(String((reason as { code?: string }).code))) {
          setServerUncertain(true); setError(t('server-pack.get-uncertain')); return;
        }
        setError(serverId ? t('server-pack.create-failed', { message: t(errorMessage(reason as ServerCommandError)) }) : String(reason));
      }
    } finally {
      if (!disposed) setBusy(false);
    }
  };
  let dropElement: HTMLFormElement | undefined;
  useNativeDropZone({ element: () => dropElement, accept: 'files', extensions: ['.zip', '.mrpack'], disabled: () => busy() || !!serverId,
    drop: (paths) => { if (paths.length === 1) void loadSource({ kind: 'file', value: paths[0]! }); else setError(t('drop.single-pack')); },
  });
  return (
    <Board fixed>
      <form
        ref={(element) => { dropElement = element; }}
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
            <Button variant="outline" disabled={locked() || !!serverId} onClick={() => { setImportStep('methods'); setImportOpen(true); }}>
              {source() ? t("install.change-import") : t("install.import")}
            </Button>
          </div>
        </header>
        <div data-vesta="install-scroll">
          <Show when={reading()}>
            <div data-vesta="install-loading" role="status"><Icon name="icons/content/modpack" size={40} /><p>{t("install.reading-pack")}</p></div>
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
                          <OptionCards
                            value={loader()}
                            onChange={chooseLoader}
                            aria-label={t("management.loader")}
                            options={loaderChoices()}
                            disabled={locked()}
                          />
                        </div>
                        <div data-vesta="install-version-row">
                          <div data-vesta="install-field">
                            <label>{t("management.minecraft")}</label>
                            <Combobox
                              value={selectedMinecraft()}
                              options={versions()}
                              maxOptions={80}
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
                              options={loaderComboboxOptions()}
                              maxOptions={80}
                              onChange={setLoaderVersion}
                              disabled={locked() || !loaderOptions().length}
                              aria-label={t("management.loader-version")}
                            />
                          </div>
                        </Show>
                        <Show when={nativeInstances && !metadata()}>
                          <Show when={metadataError()} fallback={<p role="status">{t("management.metadata-loading")}</p>}>
                            {(message) => (
                              <Notice variant="inline" action={{ label: t("common.retry"), onClick: () => void loadMetadata() }}>
                                {message()}
                              </Notice>
                            )}
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
                          pageSize={80}
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
                    <Show when={pack()?.versionFromManifest}>
                      <p>{t("install.version-from-manifest")}</p>
                    </Show>
                    <Show when={releaseError()}>
                      {(message) => (
                        <Notice
                          variant="inline"
                          action={{ label: t("common.retry"), onClick: () => { const current = source(); if (current) void loadSource(current); } }}
                        >
                          {message()}
                        </Notice>
                      )}
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
                  <InstallPackDetails info={info()} source={source()} matching={matching()} serverDetails={serverReview()} />
                )}
              </Show>
            </div>
          </Show>
          <Show when={serverWithoutPack()}><p>{t('server-pack.create-no-pack')}</p></Show>
          <Show when={error()}>
            {(message) => (
              <div data-vesta="install-error">
                <Notice
                  action={
                    createdId()
                      ? { label: t("install.view-library"), onClick: () => navigate("/library") }
                      : serverId && !serverWithoutPack() && !serverReview() && !serverUncertain()
                        ? { label: t("common.retry"), onClick: () => openServerInstall(serverId!) }
                        : source() && !pack()
                          ? { label: t("common.retry"), onClick: () => { const current = source(); if (current) void loadSource(current); } }
                          : undefined
                  }
                >
                  {message()}
                  <Show when={createdId()}> {t("install.created-recovery")}</Show>
                </Notice>
              </div>
            )}
          </Show>
        </div>
        <footer data-vesta="install-footer">
          <Show when={serverReview()?.consentRequired}><div data-vesta="install-consent"><Checkbox label={t('server-pack.play-consent')} checked={serverConsent()} onChange={setServerConsent} /></div></Show>
          <Button variant="ghost" onClick={() => navigate("/library")} disabled={busy()}>
            {t("common.cancel")}
          </Button>
          <Button
            tone="accent"
            type="submit"
            disabled={(!nativeInstances && !serverId) || !valid()}
            icon={<Icon name="icons/actions/download" />}
          >
            {t(busy() ? "install.starting" : "management.install")}
          </Button>
        </footer>
      </form>
      <Show when={importOpen()}>
        <ImportDialog
          initialStep={importStep()}
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
