import { goBack } from "../../app/transition";
import { Button, IconButton, Select, TextField } from "@vesta/ui";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openFolder } from "@tauri-apps/plugin-shell";
import { For, Show, createEffect, createSignal, createUniqueId, onCleanup, onSettled, untrack } from "solid-js";
import { Board } from "../../components/board";
import { SettingsSection } from "../../components/setting-row";
import { Icon } from "../../components/icon";
import { navigate } from "../../app/router";
import { t, formatNumber } from "../../localization";
import { nativeInstances, refreshNativeInstances } from "../../features/instances/native-service";
import { findLauncher, byRecency, type LauncherKind } from "../../features/installation/launchers";
import { detectedLauncherPaths, refreshLaunchers, ensureLaunchers, preloadLaunchers, loadCandidates, loadCandidateDetails, importMany, type HostCandidate as Candidate, type ImportCandidate } from "../../features/launcher-import";
import { ImportDialog } from "./import-dialog";
import "./launcher-import-page.css";
import { openInstallSource } from "./install-navigation";

/** Port of the old ImportPage / LauncherDetailsPanel, after the launcher picker. */
export function LauncherImportPage(props: { kind: LauncherKind }) {
  const selectionName = `import-instance-${createUniqueId()}`;
  const kind = untrack(() => props.kind);
  const visual = findLauncher(kind)!;
  const [failedIcon, setFailedIcon] = createSignal<string>();
  const [path, setPath] = createSignal("", { name: "launcherImportPath" });
  const [roots, setRoots] = createSignal<string[]>([], { name: "launcherImportRoots" });
  const [instances, setInstances] = createSignal<Candidate[]>([], {
    name: "launcherImportCandidates",
  });
  const [selected, setSelected] = createSignal("", { name: "launcherImportSelection" });
  const [dirty, setDirty] = createSignal(false, { name: "launcherImportPathEdited" });
  const [loading, setLoading] = createSignal(false, { name: "launcherImportScanning" });
  const [importing, setImporting] = createSignal(false, { name: "launcherImportSubmitting" });
  const [scanned, setScanned] = createSignal(false, { name: "launcherImportScanned" });
  const [error, setError] = createSignal("", { name: "launcherImportError" });
  const [changeImport, setChangeImport] = createSignal(false, {
    name: "launcherImportChangeMethod",
  });
  let candidates: ImportCandidate[] = [];
  let generation = 0,
    disposed = false;
  onCleanup(() => {
    disposed = true;
    generation++;
  });
  const current = () => instances().find((item) => item.instancePath === selected());
  const busy = () => loading() || importing();
  const adopt = (list: Candidate[]) => {
    const sorted = byRecency(list);
    setInstances(sorted);
    setSelected(sorted[0]?.instancePath ?? "");
    setScanned(true);
    setDirty(false);
  };
  const scan = async (nextPath = path()) => {
    const request = ++generation;
    const root = nextPath.trim();
    if (root) setRoots((items) => (items.includes(root) ? items : [...items, root]));
    setLoading(true);
    setError("");
    setSelected("");
    setInstances([]);
    setScanned(false);
    try {
      const list = await loadCandidates(kind, nextPath);
      if (!disposed && request === generation) {
        candidates = list;
        adopt(list.map((item) => item.raw as Candidate));
      }
    } catch (reason) {
      if (!disposed && request === generation) {
        setError(String(reason));
        setScanned(true);
      }
    } finally {
      if (!disposed && request === generation) setLoading(false);
    }
  };
  // Enrich only the selected preview. Switching/disposal drops late statistics.
  createEffect(
    () => selected(),
    (id) => {
      if (!id) return;
      const candidate = candidates.find((item) => item.key === id);
      if (!candidate) return;
      let current = true;
      const request = generation;
      void loadCandidateDetails(kind, candidate, untrack(path)).then((details) => {
        if (current && !disposed && request === generation) {
          setInstances((rows) => rows.map((row) => row.instancePath === id ? details : row));
        }
      }).catch((reason) => {
        if (current && !disposed && request === generation) setError(String(reason));
      });
      return () => { current = false; };
    },
  );
  const detectPaths = async (refresh = true) => {
    const previous = path().trim();
    const request = ++generation;
    setLoading(true);
    setError("");
    try {
      if (refresh) await refreshLaunchers();
      else await ensureLaunchers();
      void preloadLaunchers().catch(() => {});
      const paths = detectedLauncherPaths(kind);
      if (disposed || request !== generation) return;
      // Keep manually chosen roots too; detection must not silently lose them.
      const choices = previous && !paths.includes(previous) ? [...paths, previous] : paths;
      setRoots(choices);
      const nextPath = choices.includes(previous) ? previous : (choices[0] ?? "");
      setPath(nextPath);
      await scan(nextPath);
    } catch (reason) {
      if (!disposed && request === generation) {
        setError(String(reason));
        setLoading(false);
      }
    }
  };
  onSettled(() => {
    void detectPaths(false);
  });

  let previewElement!: HTMLElement;
  let listElement: HTMLDivElement | undefined;
  let controlsElement!: HTMLDivElement;
  let scrollElement!: HTMLDivElement;
  const [listHeight, setListHeight] = createSignal<number | undefined>(undefined, {
    name: "launcherImportListHeight",
  });
  onSettled(() => {
    const measure = () => {
      if (!listElement) return;
      const preview = previewElement.getBoundingClientRect();
      const list = listElement.getBoundingClientRect();
      // In two columns the list ends with its preview, subject to viewport room.
      if (preview.left <= list.left + 100) {
        setListHeight(undefined);
        return;
      }
      const available =
        scrollElement.clientHeight -
        (list.top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop) -
        16;
      setListHeight(Math.max(168, Math.min(preview.bottom - list.top, available)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(previewElement);
    observer.observe(controlsElement);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  });
  const browse = async () => {
    setError("");
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({ directory: true, multiple: false });
      if (!disposed && typeof result === "string") {
        setRoots((items) => (items.includes(result) ? items : [...items, result]));
        setPath(result);
        await scan(result);
      }
    } catch (reason) {
      if (!disposed) setError(String(reason));
    }
  };
  const submit = async () => {
    const candidate = current();
    if (!candidate || busy() || dirty()) return;
    setImporting(true);
    setError("");
    try {
      const selectedCandidate = candidates.find((item) => item.key === candidate.instancePath);
      if (!selectedCandidate) return;
      const result = await importMany(kind, [selectedCandidate], path());
      if (result.failed.length) throw new Error(result.failed[0].error);
      await refreshNativeInstances(true);
      if (!disposed) navigate("/library");
    } catch (reason) {
      if (!disposed) setError(String(reason));
    } finally {
      if (!disposed) setImporting(false);
    }
  };
  const openGameFolder = async () => {
    const directory = current()?.gameDirectory;
    if (directory)
      try {
        await openFolder(directory);
      } catch (reason) {
        if (!disposed) setError(String(reason));
      }
  };
  const stats = () => {
    const item = current();
    if (!item) return [];
    return [
      { label: t("import.mods"), value: item.modsCount, icon: "icons/content/cube" },
      {
        label: t("import.packs"),
        value: item.resourcepacksCount,
        icon: "icons/content/resource-pack",
      },
      { label: t("import.shaders"), value: item.shaderpacksCount, icon: "icons/content/layers" },
      { label: t("instance.worlds"), value: item.worldsCount, icon: "icons/content/globe" },
      { label: t("import.screenshots"), value: item.screenshotsCount, icon: "icons/content/file" },
    ].filter(
      (stat): stat is { label: string; value: number; icon: string } =>
        typeof stat.value === "number" && Number.isFinite(stat.value),
    );
  };
  const metadata = () => {
    const item = current();
    if (!item) return [];
    const rows: { label: string; value: string }[] = [];
    if (item.lastPlayedAtUnixMs != null) {
      const date = new Date(item.lastPlayedAtUnixMs);
      if (Number.isFinite(date.getTime()))
        rows.push({ label: t("import.last-played"), value: date.toLocaleString() });
    }
    if (item.gameDirectorySizeBytes != null) {
      const bytes = item.gameDirectorySizeBytes;
      rows.push({
        label: t("import.size"),
        value:
          bytes >= 1024 ** 3
            ? `${formatNumber(bytes / 1024 ** 3, { maximumFractionDigits: 1 })} GB`
            : `${formatNumber(bytes / 1024 ** 2, { maximumFractionDigits: 1 })} MB`,
      });
    }
    if (item.modpackId) rows.push({ label: t("import.project-id"), value: item.modpackId });
    return rows;
  };
  const source = () => {
    const platform = current()?.modpackPlatform;
    if (!platform) return undefined;
    if (platform.toLowerCase().includes("modrinth"))
      return { label: "Modrinth", icon: "branding/sources/modrinth" };
    if (platform.toLowerCase().includes("curse"))
      return { label: "CurseForge", icon: "branding/sources/curseforge" };
    return { label: platform, icon: "icons/content/link" };
  };
  return (
    <Board fixed>
      <div data-vesta="launcher-import-page">
        <header data-vesta="install-header">
          <div class="launcher-import-title">
            <Icon name={"branding/" + visual.icon} size={28} />
            <div>
              <h1>{visual.label}</h1>
              <p>{t("import.description")}</p>
            </div>
          </div>
          <div data-vesta="import-header-actions">
            <IconButton
              variant="outline"
              icon={<Icon name="icons/actions/reload" />}
              label={t("import.reload")}
              onClick={() => void detectPaths()}
              disabled={busy() || !nativeInstances}
            />
            <Button variant="outline" onClick={() => setChangeImport(true)} disabled={busy()}>
              {t("install.change-import")}
            </Button>
          </div>
        </header>
        <div
          ref={(element) => {
            scrollElement = element;
          }}
          data-vesta="launcher-import-scroll"
        >
          <div data-vesta="launcher-import-grid">
            <div
              ref={(element) => {
                controlsElement = element;
              }}
              data-vesta="launcher-import-controls"
            >
              <SettingsSection title={t("import.source")}>
                <div data-vesta="import-field-group">
                  <Show when={roots().length > 1}>
                    <div data-vesta="import-root-field">
                      <Select
                        label={t("import.data-root")}
                        value={path()}
                        options={roots().map((value) => ({ value, label: value }))}
                        disabled={busy()}
                        onChange={(value) => {
                          setPath(value);
                          void scan(value);
                        }}
                      />
                    </div>
                  </Show>
                  <div data-vesta="launcher-import-path">
                    <div data-vesta="import-path-field">
                      <TextField
                        onBlur={(event) => {
                          event.currentTarget.scrollLeft = 0;
                        }}
                        label={t("install.launcher-path")}
                        placeholder={t("import.path-placeholder")}
                        value={path()}
                        disabled={busy()}
                        onChange={(value) => {
                          setPath(value);
                          setDirty(true);
                          setSelected("");
                        }}
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => void browse()}
                      disabled={busy() || !nativeInstances}
                    >
                      {t("import.browse")}
                    </Button>
                  </div>
                  <Show when={dirty()}>
                    <div data-vesta="import-path-change">
                      <span>
                        <Icon name="icons/status/info" />
                        {t("import.path-changed")}
                      </span>
                      <Button size="sm" onClick={() => void scan()} disabled={busy()}>
                        {t("import.rescan")}
                      </Button>
                    </div>
                  </Show>
                </div>
              </SettingsSection>
              <SettingsSection title={t("import.instance")}>
                <div data-vesta="import-field-group">
                  <Show when={instances().length && !dirty()}>
                    <div data-vesta="import-instance-list-meta">
                      <span>{t("import.instance-count", { count: instances().length })}</span>
                      <span>{t("import.recent-first")}</span>
                    </div>
                    <div
                      ref={(element) => {
                        listElement = element;
                      }}
                      data-vesta="import-instance-list"
                      style={{
                        "--import-list-height":
                          listHeight() == null ? undefined : `${listHeight()}px`,
                      }}
                      role="radiogroup"
                      aria-label={t("import.select-instance")}
                    >
                      <For each={instances()}>
                        {(candidate) => (
                          <label
                            data-vesta="import-instance-row"
                            data-selected={selected() === candidate.instancePath ? "" : undefined}
                          >
                            <input
                              type="radio"
                              name={selectionName}
                              value={candidate.instancePath}
                              checked={selected() === candidate.instancePath}
                              onChange={() => setSelected(candidate.instancePath)}
                              disabled={busy()}
                            />
                            <CandidateArtwork path={candidate.iconPath} />
                            <span data-vesta="import-instance-row-copy">
                              <strong>{candidate.name}</strong>
                              <span>
                                {[candidate.minecraftVersion, candidate.modloader]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                            <span data-vesta="import-instance-row-date">
                              <Show
                                when={
                                  candidate.lastPlayedAtUnixMs &&
                                  candidate.lastPlayedAtUnixMs > 0 &&
                                  Number.isFinite(new Date(candidate.lastPlayedAtUnixMs).getTime())
                                }
                              >
                                <time
                                  datetime={new Date(candidate.lastPlayedAtUnixMs!).toISOString()}
                                  title={new Date(candidate.lastPlayedAtUnixMs!).toLocaleString()}
                                >
                                  {new Date(candidate.lastPlayedAtUnixMs!).toLocaleDateString(
                                    undefined,
                                    { month: "short", day: "numeric", year: "numeric" },
                                  )}
                                </time>
                              </Show>
                            </span>
                            <span data-vesta="import-instance-row-check">
                              <Show when={selected() === candidate.instancePath}>
                                <Icon name="icons/controls/check" size={14} />
                              </Show>
                            </span>
                          </label>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={loading()}>
                    <div data-vesta="import-inline-status" role="status">
                      <Icon name="icons/content/search" />
                      <span>{t("import.scanning")}</span>
                    </div>
                  </Show>
                  <Show when={scanned() && !instances().length && !loading() && !error()}>
                    <div data-vesta="import-inline-status">
                      <Icon name="icons/content/folder" />
                      <span>{t("install.no-instances")}</span>
                    </div>
                  </Show>
                </div>
              </SettingsSection>
              <Show when={error()}>
                <div data-vesta="import-error" role="alert">
                  <Icon name="icons/status/error" />
                  <p>{error()}</p>
                  <Button variant="outline" size="sm" disabled={busy()} onClick={() => void scan()}>
                    {t("common.retry")}
                  </Button>
                </div>
              </Show>
            </div>
            <section
              ref={(element) => {
                previewElement = element;
              }}
              data-vesta="launcher-import-preview"
              aria-label={t("import.preview")}
            >
              <Show
                when={current() && !dirty() ? current() : undefined}
                fallback={
                  <div data-vesta="import-preview-empty">
                    <Icon
                      name={loading() ? "icons/content/search" : "icons/content/cube"}
                      size={28}
                    />
                    <h2>{t(loading() ? "import.scanning" : "import.preview-empty")}</h2>
                    <p>{t(dirty() ? "import.path-changed" : "import.preview-description")}</p>
                  </div>
                }
              >
                {(item) => (
                  <>
                    <header data-vesta="launcher-import-identity">
                      <div data-vesta="import-instance-art">
                        <Show
                          when={item().iconPath && failedIcon() !== item().iconPath}
                          fallback={<Icon name="icons/content/cube" size={24} />}
                        >
                          <img
                            alt=""
                            src={
                              /^(\/|[A-Za-z]:[\\/])/.test(item().iconPath!)
                                ? convertFileSrc(item().iconPath!)
                                : item().iconPath!
                            }
                            onError={() => setFailedIcon(item().iconPath!)}
                          />
                        </Show>
                      </div>
                      <div>
                        <h2>{item().name}</h2>
                        <p>
                          <Show when={item().minecraftVersion}>
                            <span>{item().minecraftVersion}</span>
                          </Show>
                          <Show when={item().modloader}>
                            <span>
                              {item().modloader} {item().modloaderVersion}
                            </span>
                          </Show>
                        </p>
                      </div>
                    </header>
                    <Show when={stats().length}>
                      <dl data-vesta="launcher-import-stats">
                        <For each={stats()}>
                          {(stat) => (
                            <div>
                              <dt>
                                <Icon name={stat.icon} size={15} />
                                <span>{stat.label}</span>
                              </dt>
                              <dd>{formatNumber(stat.value)}</dd>
                            </div>
                          )}
                        </For>
                      </dl>
                    </Show>
                    <Show when={metadata().length || source()}>
                      <dl data-vesta="import-metadata">
                        <Show when={source()}>
                          {(platform) => (
                            <div>
                              <dt>{t("import.source")}</dt>
                              <dd>
                                <Icon name={platform().icon} size={14} />
                                {platform().label}
                              </dd>
                            </div>
                          )}
                        </Show>
                        <For each={metadata()}>
                          {(row) => (
                            <div>
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          )}
                        </For>
                      </dl>
                    </Show>
                    <Show when={item().gameDirectory}>
                      <div data-vesta="import-directory">
                        <span>{t("import.game-folder")}</span>
                        <Button
                          variant="ghost"
                          icon={<Icon name="icons/content/folder" />}
                          iconEnd={<Icon name="icons/actions/external-link" size={13} />}
                          onClick={() => void openGameFolder()}
                          title={item().gameDirectory}
                        >
                          <span class="launcher-import-game-path">{item().gameDirectory}</span>
                        </Button>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
            </section>
          </div>
        </div>
        <footer data-vesta="install-footer">
          <span data-vesta="import-footer-selection">{!dirty() ? current()?.name : undefined}</span>
          <Button variant="ghost" onClick={() => goBack("/create")} disabled={busy()}>
            {t("common.cancel")}
          </Button>
          <Button
            tone="accent"
            disabled={!nativeInstances || !current() || busy() || dirty()}
            onClick={() => void submit()}
          >
            {t(importing() ? "import.importing" : "install.import-selected")}
          </Button>
        </footer>
      </div>
      <Show when={changeImport()}>
        <ImportDialog
          open
          onClose={() => setChangeImport(false)}
          onSource={(value) => {
            setChangeImport(false);
            openInstallSource(value);
          }}
          onLauncher={(value) => {
            setChangeImport(false);
            navigate(`/create/import/${value}`, { replace: true });
          }}
        />
      </Show>
    </Board>
  );
}

function CandidateArtwork(props: { path?: string | null }) {
  const [failed, setFailed] = createSignal<string>();
  const image = () => (props.path && failed() !== props.path ? props.path : undefined);
  return (
    <span data-vesta="import-candidate-art">
      <Show keyed when={image()} fallback={<Icon name="icons/content/cube" size={18} />}>
        {(path) => (
          <img
            alt=""
            loading="lazy"
            src={/^(\/|[A-Za-z]:[\\/])/.test(path) ? convertFileSrc(path) : path}
            onError={() => setFailed(path)}
          />
        )}
      </Show>
    </span>
  );
}
