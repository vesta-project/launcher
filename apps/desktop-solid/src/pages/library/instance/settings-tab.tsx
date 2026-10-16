import {
  Button,
  Dialog,
  IconButton,
  IconPicker,
  NumberField,
  Select,
  Slider,
  Switch,
  TextArea,
  TextField,
} from "@vesta/ui";
import type { JSX } from "@solidjs/web";
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onSettled,
  untrack,
} from "solid-js";
import { navigate } from "../../../app/router";
import { SettingRow } from "../../../components/setting-row";
import { Icon } from "../../../components/icon";
import {
  editInstance,
  removeInstance,
  type InstanceEntry,
} from "../../../features/instances/fixtures";
import {
  instancePreferences,
  type InstancePreferences,
} from "../../../features/instances/preferences";
import {
  defaultInstanceIcons,
  stableIconId,
  resolveInstanceIcon,
  uploadedInstanceIcons,
  setUploadedInstanceIcons,
  importInstanceIcon,
} from "../../../features/instances/icon-catalog";
import { versionStore } from "../../../features/instances/versions";
import {
  verifyJavaExecutable,
  canBrowseJava,
  browseJavaExecutable,
} from "../../../platform/java";
import "./settings-tab.css";

/** Fixture host facts until the settings page reads them from the backend. */
const systemMemoryMb = 16384;
const javaOptions = [
  {
    value: "default",
    label: "Launcher default",
    description: "Java 21 · bundled",
  },
  {
    value: "managed-21",
    label: "Java 21 (managed)",
    description: "~/.vesta/java/21/bin/java",
  },
  {
    value: "managed-17",
    label: "Java 17 (managed)",
    description: "~/.vesta/java/17/bin/java",
  },
  {
    value: "system",
    label: "Java 21 (system)",
    description: "/usr/bin/java",
  },
  { value: "custom", label: "Custom…", description: "Choose an executable" },
];

const sections = [
  { id: "general", label: "General", icon: "icons/content/gear" },
  { id: "java", label: "Java", icon: "icons/content/code" },
  { id: "memory", label: "Memory", icon: "icons/content/storage" },
  { id: "window", label: "Window", icon: "icons/content/monitor" },
  { id: "launch", label: "Launch", icon: "icons/actions/play" },
  { id: "hooks", label: "Hooks", icon: "icons/content/terminal" },
  { id: "sandbox", label: "Sandbox", icon: "icons/security/shield" },
  { id: "maintenance", label: "Maintenance", icon: "icons/content/sliders" },
  { id: "danger", label: "Danger zone", icon: "icons/status/error" },
];

const formatGb = (mb: number) => `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB`;

/**
 * Instance settings: a full page opened from the header. A section list on the left
 * (wide windows), panels on the right, and a save bar that appears once something changes.
 */
export function InstanceSettingsTab(props: {
  entry: InstanceEntry;
  onBack: () => void;
}) {
  const id = untrack(() => props.entry.instance.id);
  const store = instancePreferences(id);
  const initialName = untrack(() => props.entry.instance.name);
  const [name, setName] = createSignal(initialName);
  const [icon, setIcon] = createSignal(
    untrack(() => props.entry.instance.image),
  );
  const [iconError, setIconError] = createSignal("");
  const packIcon = () => versionStore(id).state().pack?.icon;
  const iconOptions = createMemo(() => {
    const options = [...defaultInstanceIcons];
    for (const src of [icon(), packIcon(), ...uploadedInstanceIcons()]) {
      if (src && !options.some((option) => option.value === stableIconId(src)))
        options.unshift({
          value: stableIconId(src),
          src,
          label: src === packIcon() ? "Modpack icon" : "Uploaded icon",
        });
    }
    return options.map((option) => ({
      ...option,
      badge:
        packIcon() && option.value === stableIconId(packIcon()!) ? (
          <Icon name="icons/rail/library" size={12} />
        ) : undefined,
    }));
  });
  const uploadIcon = async (file: File) => {
    setIconError("");
    try {
      const src = await importInstanceIcon(file);
      setUploadedInstanceIcons((icons) => [...new Set([...icons, src])]);
      setIcon(src);
    } catch {
      setIconError("Could not open this image. Try a PNG or JPEG.");
    }
  };
  const [javaTest, setJavaTest] = createSignal<{
    pending: boolean;
    text: string;
    failed: boolean;
  }>();
  let javaRequest = 0;
  onCleanup(() => {
    javaRequest++;
  });
  const changeJavaPath = (javaPath: string) => {
    javaRequest++;
    setJavaTest(undefined);
    patch({ javaPath });
  };
  const testJava = async () => {
    const request = ++javaRequest;
    const path = draft().javaPath.trim();
    setJavaTest({ pending: true, text: "Testing Java…", failed: false });
    try {
      const result = await verifyJavaExecutable(path);
      if (request === javaRequest)
        setJavaTest({
          pending: false,
          text: `Java ${result.major_version} · ${result.is_64bit ? "64-bit" : "32-bit"}`,
          failed: false,
        });
    } catch (error) {
      if (request === javaRequest)
        setJavaTest({
          pending: false,
          text: String(error instanceof Error ? error.message : error),
          failed: true,
        });
    }
  };
  const browseJava = async () => {
    try {
      const path = await browseJavaExecutable();
      if (path) changeJavaPath(path);
    } catch (error) {
      setJavaTest({ pending: false, text: String(error), failed: true });
    }
  };
  const [draft, setDraft] = createSignal(
    untrack(() => ({ ...store.values() })),
  );
  const [current, setCurrent] = createSignal("general");
  let jumpedAt = 0;
  const [confirm, setConfirm] = createSignal<"reset" | "delete">();
  let scroller: HTMLDivElement | undefined;

  const dirty = () =>
    name() !== props.entry.instance.name ||
    icon() !== props.entry.instance.image ||
    JSON.stringify(draft()) !== JSON.stringify(store.values());
  const patch = (next: Partial<InstancePreferences>) =>
    setDraft((value) => ({ ...value, ...next }));
  const invalid = () =>
    !name().trim() || (draft().java === "custom" && !draft().javaPath.trim());
  const busy = () =>
    ["running", "warming", "installing"].includes(props.entry.state.kind);
  const save = () => {
    store.setValues({ ...draft() });
    editInstance(id, { name: name().trim(), image: icon() });
  };
  const discard = () => {
    setDraft({ ...store.values() });
    setName(props.entry.instance.name);
    setIcon(props.entry.instance.image);
  };
  const memoryHigh = () => draft().maxMemory >= systemMemoryMb * 0.9;

  // The section nearest the top of the scroller is the current one.
  onSettled(() => {
    if (!scroller) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (performance.now() - jumpedAt < 900) return;
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setCurrent(visible.target.id.replace("settings-", ""));
      },
      { root: scroller, rootMargin: "0px 0px -70% 0px" },
    );
    for (const section of scroller.querySelectorAll("section[id]"))
      observer.observe(section);
    return () => observer.disconnect();
  });
  const jump = (section: string) => {
    jumpedAt = performance.now();
    setCurrent(section);
    scroller
      ?.querySelector(`#settings-${section}`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  /**
   * A setting that follows the launcher's default until switched to Custom. While it
   * follows, the row shows the default; Custom reveals the fields underneath.
   */
  const inherit = (
    key:
      | "inheritArgs"
      | "inheritMemory"
      | "inheritResolution"
      | "inheritLauncherAction"
      | "inheritEnvironment"
      | "inheritCommands"
      | "inheritSandbox",
    label: string,
    fallback: string,
    children: () => JSX.Element,
  ) => (
    <>
      <SettingRow
        label={label}
        description={
          draft()[key] ? `Launcher default · ${fallback}` : undefined
        }
      >
        <Switch
          size="sm"
          label="Custom"
          aria-label={`Custom ${label.toLowerCase()}`}
          checked={!draft()[key]}
          onChange={(custom) => patch({ [key]: !custom })}
        />
      </SettingRow>
      <Show when={!draft()[key]}>
        <div data-vesta="settings-reveal">{children()}</div>
      </Show>
    </>
  );

  return (
    <div data-vesta="instance-settings">
      <nav data-vesta="instance-settings-nav" aria-label="Settings sections">
        <Button
          size="sm"
          variant="ghost"
          icon={<Icon name="icons/navigation/arrow-back" />}
          onClick={props.onBack}
        >
          Back
        </Button>
        <For each={sections}>
          {(section) => (
            <button
              type="button"
              data-vesta="instance-settings-link"
              data-danger={section.id === "danger" ? "" : undefined}
              aria-current={current() === section.id ? "true" : undefined}
              onClick={() => jump(section.id)}
            >
              <Icon name={section.icon} size={15} />
              {section.label}
            </button>
          )}
        </For>
      </nav>

      <div data-vesta="settings-content" data-dirty={dirty() ? "" : undefined}>
        <div
          data-vesta="instance-settings-scroll"
          ref={(element) => {
            scroller = element;
          }}
        >
          <header data-vesta="instance-settings-title">
            <IconButton
              size="sm"
              variant="ghost"
              class="instance-settings-back"
              label="Back"
              icon={<Icon name="icons/navigation/arrow-back" />}
              onClick={props.onBack}
            />
            <h2>Settings</h2>
          </header>

          <Panel id="general" title="General">
            <div data-vesta="settings-identity">
              <IconPicker
                value={stableIconId(icon())}
                preview={icon()}
                options={iconOptions()}
                onSelect={(value) => setIcon(resolveInstanceIcon(value))}
                onUpload={(file) => void uploadIcon(file)}
              />
              <div>
                <TextField
                  size="sm"
                  label="Instance name"
                  value={name()}
                  onChange={setName}
                  error={name().trim() ? undefined : "Enter a name."}
                />
              </div>
            </div>
            <Show when={iconError()}>
              <p data-vesta="settings-feedback" role="alert">
                {iconError()}
              </p>
            </Show>
            <SettingRow
              label="Minecraft options"
              description="Video, controls and sound for this instance (options.txt)."
            >
              <Button size="sm" variant="outline" disabled>
                Edit…
              </Button>
            </SettingRow>
          </Panel>

          <Panel id="java" title="Java">
            <SettingRow
              label="Java executable"
              description="The runtime that starts the game."
            >
              <Select
                size="sm"
                aria-label="Java executable"
                value={draft().java}
                onChange={(java) => {
                  javaRequest++;
                  setJavaTest(undefined);
                  patch({ java });
                }}
                options={javaOptions}
              />
            </SettingRow>
            <Show when={draft().java === "custom"}>
              <div data-vesta="settings-reveal">
                <SettingRow label="Executable path">
                  <TextField
                    size="sm"
                    aria-label="Java executable path"
                    placeholder="/path/to/bin/java"
                    value={draft().javaPath}
                    onChange={changeJavaPath}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canBrowseJava()}
                    onClick={() => void browseJava()}
                  >
                    Browse…
                  </Button>
                  <Show when={draft().javaPath.trim()}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={javaTest()?.pending}
                      onClick={() => void testJava()}
                    >
                      {javaTest()?.pending ? "Testing…" : "Test"}
                    </Button>
                  </Show>
                </SettingRow>
                <Show when={javaTest()}>
                  {(result) => (
                    <p
                      data-vesta="settings-feedback"
                      data-tone={
                        result().failed
                          ? "danger"
                          : result().pending
                            ? undefined
                            : "success"
                      }
                      role="status"
                    >
                      {result().text}
                    </p>
                  )}
                </Show>
              </div>
            </Show>
            {inherit("inheritArgs", "JVM arguments", "none", () => (
              <SettingRow label="Arguments">
                <TextField
                  size="sm"
                  aria-label="JVM arguments"
                  placeholder="-XX:+UseG1GC"
                  value={draft().args}
                  onChange={(args) => patch({ args })}
                />
              </SettingRow>
            ))}
          </Panel>

          <Panel id="memory" title="Memory">
            {inherit("inheritMemory", "Allocation", "2 – 4 GB", () => (
              <div data-vesta="settings-memory">
                <Slider
                  label="Allocation"
                  min={512}
                  max={systemMemoryMb}
                  step={512}
                  minStepsBetweenThumbs={1}
                  value={[draft().minMemory, draft().maxMemory]}
                  onChange={([minMemory, maxMemory]) =>
                    patch({ minMemory, maxMemory })
                  }
                  getValueLabel={([low, high]) =>
                    `${formatGb(low)} – ${formatGb(high)}`
                  }
                />
                <div data-vesta="settings-memory-scale">
                  <span>512 MB</span>
                  <span>{formatGb(systemMemoryMb)} installed</span>
                </div>
                <dl data-vesta="settings-memory-readout">
                  <div>
                    <dt>Start (-Xms)</dt>
                    <dd>{draft().minMemory} MB</dd>
                  </div>
                  <div>
                    <dt>Limit (-Xmx)</dt>
                    <dd>{draft().maxMemory} MB</dd>
                  </div>
                </dl>
                <Show when={memoryHigh()}>
                  <p data-vesta="settings-note" data-tone="warning">
                    <Icon name="icons/controls/warning" size={14} />
                    Leaving less than 10% of memory for your system can make
                    everything slow.
                  </p>
                </Show>
              </div>
            ))}
          </Panel>

          <Panel id="window" title="Game window">
            {inherit("inheritResolution", "Resolution", "1280 × 720", () => (
              <SettingRow label="Width × height">
                <div data-vesta="settings-resolution">
                  <NumberField
                    size="sm"
                    aria-label="Width"
                    value={draft().width}
                    onChange={(width) => patch({ width })}
                    min={0}
                  />
                  <span aria-hidden="true">×</span>
                  <NumberField
                    size="sm"
                    aria-label="Height"
                    value={draft().height}
                    onChange={(height) => patch({ height })}
                    min={0}
                  />
                </div>
              </SettingRow>
            ))}
          </Panel>

          <Panel id="launch" title="Launch">
            {inherit(
              "inheritLauncherAction",
              "Launcher window",
              "stays open",
              () => (
                <SettingRow label="When the game starts">
                  <Select
                    size="sm"
                    aria-label="Launcher window"
                    value={draft().launcherAction}
                    onChange={(launcherAction) => patch({ launcherAction })}
                    options={[
                      { value: "keep", label: "Stay open" },
                      { value: "minimize", label: "Minimize" },
                      { value: "hide", label: "Hide to tray" },
                      { value: "quit", label: "Quit the launcher" },
                    ]}
                  />
                </SettingRow>
              ),
            )}
            {inherit(
              "inheritEnvironment",
              "Environment variables",
              "none",
              () => (
                <div data-vesta="settings-block">
                  <TextArea
                    size="sm"
                    aria-label="Environment variables"
                    description="One KEY=value per line."
                    placeholder={"KEY=value\nOTHER_KEY=value"}
                    value={draft().environment}
                    onChange={(environment) => patch({ environment })}
                    rows={4}
                  />
                </div>
              ),
            )}
          </Panel>

          <Panel id="hooks" title="Hooks">
            {inherit("inheritCommands", "Launch hooks", "none", () => (
              <>
                <SettingRow
                  label="Before launch"
                  description="Runs before the game starts."
                >
                  <TextField
                    size="sm"
                    aria-label="Pre-launch hook"
                    value={draft().preLaunch}
                    onChange={(preLaunch) => patch({ preLaunch })}
                  />
                </SettingRow>
                <SettingRow
                  label="Wrapper"
                  description="Prefixes the Java command."
                >
                  <TextField
                    size="sm"
                    aria-label="Wrapper command"
                    placeholder="mangohud --dlsym"
                    value={draft().wrapper}
                    onChange={(wrapper) => patch({ wrapper })}
                  />
                </SettingRow>
                <SettingRow
                  label="After exit"
                  description="Runs when the game closes."
                >
                  <TextField
                    size="sm"
                    aria-label="Post-exit hook"
                    value={draft().postExit}
                    onChange={(postExit) => patch({ postExit })}
                  />
                </SettingRow>
              </>
            ))}
          </Panel>

          <Panel id="sandbox" title="Sandbox">
            {inherit("inheritSandbox", "Sandbox", "Standard preset", () => (
              <>
                <SettingRow
                  label="Preset"
                  description="What the game can read and write."
                >
                  <Select
                    size="sm"
                    aria-label="Sandbox preset"
                    value={draft().sandboxPreset}
                    onChange={(sandboxPreset) => patch({ sandboxPreset })}
                    options={[
                      { value: "off", label: "Off" },
                      { value: "standard", label: "Standard" },
                      { value: "strict", label: "Strict" },
                    ]}
                  />
                </SettingRow>
                <SettingRow
                  label="Sandbox the wrapper"
                  description="Run the wrapper command inside the sandbox too."
                >
                  <Switch
                    size="sm"
                    aria-label="Sandbox the wrapper"
                    checked={draft().sandboxWrapper}
                    onChange={(sandboxWrapper) => patch({ sandboxWrapper })}
                  />
                </SettingRow>
              </>
            ))}
          </Panel>

          <Panel id="maintenance" title="Maintenance">
            <SettingRow
              label="Export"
              description="Share this instance as a modpack file."
            >
              <Button size="sm" variant="outline" disabled={busy()}>
                Export…
              </Button>
            </SettingRow>
            <SettingRow
              label="Duplicate"
              description="A separate copy with its own worlds."
            >
              <Button size="sm" variant="outline" disabled={busy()}>
                Duplicate
              </Button>
            </SettingRow>
            <SettingRow
              label="Repair"
              description="Re-download missing or damaged game files."
            >
              <Button size="sm" variant="outline" disabled={busy()}>
                Repair
              </Button>
            </SettingRow>
          </Panel>

          <Panel id="danger" title="Danger zone" danger>
            <SettingRow
              label="Reset instance"
              description="Reinstalls from scratch. Worlds, configs and screenshots are deleted."
            >
              <Button
                size="sm"
                variant="outline"
                tone="danger"
                disabled={busy()}
                onClick={() => setConfirm("reset")}
              >
                Reset…
              </Button>
            </SettingRow>
            <SettingRow
              label="Delete instance"
              description="Removes everything, permanently."
            >
              <Button
                size="sm"
                tone="danger"
                disabled={busy()}
                onClick={() => setConfirm("delete")}
              >
                Delete…
              </Button>
            </SettingRow>
          </Panel>
        </div>
        <Show when={dirty()}>
          <div
            data-vesta="settings-savebar"
            role="region"
            aria-label="Unsaved changes"
          >
            <span data-vesta="settings-savebar-dot" />
            <span>Unsaved changes</span>
            <Button size="sm" variant="ghost" onClick={discard}>
              Discard
            </Button>
            <Button size="sm" tone="accent" disabled={invalid()} onClick={save}>
              Save
            </Button>
          </div>
        </Show>
      </div>

      <Dialog
        title={
          confirm() === "delete"
            ? `Delete “${props.entry.instance.name}”?`
            : `Reset “${props.entry.instance.name}”?`
        }
        description={
          confirm() === "delete"
            ? "The instance, its resources, worlds and screenshots are removed. This can't be undone."
            : "The instance is reinstalled. Worlds, configs and screenshots are deleted."
        }
        open={!!confirm()}
        onOpenChange={(open) => {
          if (!open) setConfirm(undefined);
        }}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(undefined)}>
              Cancel
            </Button>
            <Button
              tone="danger"
              onClick={() => {
                const action = confirm();
                setConfirm(undefined);
                if (action === "delete") {
                  removeInstance(id);
                  navigate("/library");
                }
              }}
            >
              {confirm() === "delete" ? "Delete" : "Reset"}
            </Button>
          </>
        }
      />
    </div>
  );
}

function Panel(props: {
  id: string;
  title: string;
  danger?: boolean;
  children: JSX.Element;
}) {
  return (
    <section
      id={`settings-${props.id}`}
      data-vesta="settings-panel"
      data-danger={props.danger ? "" : undefined}
      aria-labelledby={`settings-${props.id}-title`}
    >
      <h3 id={`settings-${props.id}-title`}>{props.title}</h3>
      <div data-vesta="settings-panel-body">{props.children}</div>
    </section>
  );
}
