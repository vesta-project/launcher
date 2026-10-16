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
          ? "Snapshot / experimental"
          : "Release",
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
          <SettingsSection title="Core configuration">
            <div data-vesta="version-core">
              <div data-vesta="version-field">
                <label>Modloader</label>
                <SegmentedControl
                  aria-label="Modloader"
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
                  <label>Minecraft version</label>
                  <Switch
                    size="sm"
                    label="Show snapshots"
                    checked={experimental()}
                    onChange={setExperimental}
                  />
                </header>
                <Combobox
                  aria-label="Minecraft version"
                  options={mcOptions()}
                  value={minecraft()}
                  onChange={chooseMinecraft}
                />
              </div>
              <Show when={loader() !== "vanilla"}>
                <div data-vesta="version-field">
                  <label>Loader version</label>
                  <Combobox
                    aria-label="Compatible loader version"
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
                  ? "Choose a loader version."
                  : `No ${loader().charAt(0).toUpperCase() + loader().slice(1)} versions found for Minecraft ${minecraft()}.`}
              </p>
            </Show>
            <Show when={dirty()}>
              <div data-vesta="version-actions">
                <Button
                  tone="accent"
                  disabled={!valid() || busy()}
                  onClick={() => setPending({ engine: engine() })}
                >
                  Review changes
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
                  Discard
                </Button>
              </div>
            </Show>
          </SettingsSection>
        }
      >
        {(linked) => (
          <section data-vesta="linked-pack">
            <SettingsSection title="Linked modpack">
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
                    <span>
                      Version <strong>{linked().releases[0].label}</strong> is
                      available
                    </span>
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
                      Update pack
                    </Button>
                  </div>
                </Show>
                <Show when={releasesOpen()}>
                  <div data-vesta="version-release-heading">
                    <TextField
                      aria-label="Search pack versions"
                      placeholder="Search versions"
                      size="sm"
                      value={releaseQuery()}
                      onChange={setReleaseQuery}
                    />
                    <Select
                      size="sm"
                      aria-label="Pack release type"
                      value={releaseFilter()}
                      onChange={setReleaseFilter}
                      options={[
                        { value: "stable", label: "Stable releases" },
                        { value: "all", label: "All releases" },
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
                      fallback={<p>No matching versions.</p>}
                    >
                      {(item) => (
                        <div data-vesta="version-release">
                          <span>
                            <strong>{item.label}</strong>
                            <small>
                              {item.experimental ? "Experimental · " : ""}
                              Minecraft {item.minecraft} · {item.loader}{" "}
                              {item.loaderVersion}
                            </small>
                          </span>
                          <Show
                            when={item.id !== linked().installed}
                            fallback={<small>Installed</small>}
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy()}
                              onClick={() =>
                                setPending({ engine: item, release: item })
                              }
                            >
                              Switch version
                            </Button>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </SettingsSection>
            <SettingsSection title="Modpack connection">
              <SettingRow
                label="Unlink modpack"
                description="Keep installed files and manage them individually."
              >
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy()}
                  onClick={() => setUnlinking("keep")}
                >
                  Unlink…
                </Button>
              </SettingRow>
              <SettingRow
                label="Delete bundled files and unlink"
                description="Your individually added resources and worlds are kept."
              >
                <Button
                  size="sm"
                  variant="outline"
                  tone="danger"
                  disabled={busy()}
                  onClick={() => setUnlinking("delete")}
                >
                  Delete and unlink…
                </Button>
              </SettingRow>
            </SettingsSection>
          </section>
        )}
      </Show>
      <Show when={busy()}>
        <p data-vesta="version-warning">
          Stop the game and finish any ongoing installation before changing
          versions.
        </p>
      </Show>
      <Dialog
        title="Change instance version?"
        open={!!pending()}
        onOpenChange={(open) => {
          if (!open) setPending(undefined);
        }}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(undefined)}>
              Cancel
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
              Apply version change
            </Button>
          </>
        }
      >
        <p>
          Back up your worlds before changing Minecraft versions, especially
          when downgrading.
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
                <dt>Pack version</dt>
                <dd>
                  {pack()?.installed} → {next().release?.label}
                </dd>
              </Show>
            </dl>
          )}
        </Show>
        <p>
          Your worlds and custom resources are kept. Bundled resources follow
          the selected pack release.
        </p>
      </Dialog>
      <Dialog
        title={
          unlinking() === "delete"
            ? "Delete bundled files and unlink?"
            : "Unlink modpack?"
        }
        description={
          unlinking() === "delete"
            ? "Bundled resources will be removed. Worlds and custom resources remain."
            : "Installed files remain, but future updates are managed individually."
        }
        open={!!unlinking()}
        onOpenChange={(open) => {
          if (!open) setUnlinking(undefined);
        }}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setUnlinking(undefined)}>
              Cancel
            </Button>
            <Button
              tone={unlinking() === "delete" ? "danger" : "accent"}
              onClick={() => {
                unlinkPack(id(), unlinking() === "delete");
                setUnlinking(undefined);
              }}
            >
              Confirm unlink
            </Button>
          </>
        }
      />
    </div>
  );
}
