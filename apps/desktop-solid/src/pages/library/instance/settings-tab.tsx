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
import { formatNumber, t } from "../../../localization";
import {
  verifyJavaExecutable,
  canBrowseJava,
  browseJavaExecutable,
} from "../../../platform/java";
import "./settings-tab.css";

/** Fixture host facts until the settings page reads them from the backend. */
const systemMemoryMb = 16384;
const javaOptions = () => [
  {
    value: "default",
    label: t("instance-settings.launcher-default"),
    description: t("instance-settings.java-bundled", { version: "21" }),
  },
  {
    value: "managed-21",
    label: t("instance-settings.java-managed", { version: "21" }),
    description: "~/.vesta/java/21/bin/java",
  },
  {
    value: "managed-17",
    label: t("instance-settings.java-managed", { version: "17" }),
    description: "~/.vesta/java/17/bin/java",
  },
  {
    value: "system",
    label: t("instance-settings.java-system", { version: "21" }),
    description: "/usr/bin/java",
  },
  { value: "custom", label: t("instance-settings.java-custom"), description: t("instance-settings.choose-executable") },
];

const sections = [
  { id: "general", label: "instance-settings.general", icon: "icons/content/gear" },
  { id: "java", label: "instance-settings.java", icon: "icons/content/code" },
  { id: "memory", label: "instance-settings.memory", icon: "icons/content/storage" },
  { id: "window", label: "instance-settings.window", icon: "icons/content/monitor" },
  { id: "launch", label: "instance-settings.launch", icon: "icons/actions/play" },
  { id: "hooks", label: "instance-settings.hooks", icon: "icons/content/terminal" },
  { id: "sandbox", label: "instance-settings.sandbox", icon: "icons/security/shield" },
  { id: "maintenance", label: "instance-settings.maintenance", icon: "icons/content/sliders" },
  { id: "danger", label: "instance-settings.danger-zone", icon: "icons/status/error" },
] as const;

const formatGb = (mb: number) =>
  t("instance-settings.gigabytes", {
    amount: formatNumber(mb / 1024, { maximumFractionDigits: mb % 1024 ? 1 : 0 }),
  });

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
          label: src === packIcon() ? t("instance-settings.modpack-icon") : t("instance-settings.uploaded-icon"),
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
      setIconError(t("instance-settings.image-error"));
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
    setJavaTest({ pending: true, text: t("instance-settings.testing-java"), failed: false });
    try {
      const result = await verifyJavaExecutable(path);
      if (request === javaRequest)
        setJavaTest({
          pending: false,
          text: t("instance-settings.java-verified", {
            version: result.major_version,
            bits: result.is_64bit ? "64" : "32",
          }),
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
          draft()[key] ? t("instance-settings.inherited", { fallback }) : undefined
        }
      >
        <Switch
          size="sm"
          label={t("instance-settings.custom")}
          aria-label={t("instance-settings.custom-aria", { label: label.toLowerCase() })}
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
      <nav data-vesta="instance-settings-nav" aria-label={t("instance-settings.sections-aria")}>
        <Button
          size="sm"
          variant="ghost"
          icon={<Icon name="icons/navigation/arrow-back" />}
          onClick={props.onBack}
        >
          {t("instance-settings.back")}
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
              {t(section.label)}
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
              label={t("instance-settings.back")}
              icon={<Icon name="icons/navigation/arrow-back" />}
              onClick={props.onBack}
            />
            <h2>{t("instance-settings.settings")}</h2>
          </header>

          <Panel id="general" title={t("instance-settings.general")}>
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
                  label={t("instance-settings.name")}
                  value={name()}
                  onChange={setName}
                  error={name().trim() ? undefined : t("instance-settings.enter-name")}
                />
              </div>
            </div>
            <Show when={iconError()}>
              <p data-vesta="settings-feedback" role="alert">
                {iconError()}
              </p>
            </Show>
            <SettingRow
              label={t("instance-settings.minecraft-options")}
              description={t("instance-settings.minecraft-options-description")}
            >
              <Button size="sm" variant="outline" disabled>
                {t("instance-settings.edit")}
              </Button>
            </SettingRow>
          </Panel>

          <Panel id="java" title={t("instance-settings.java")}>
            <SettingRow
              label={t("instance-settings.java-executable")}
              description={t("instance-settings.runtime-description")}
            >
              <Select
                size="sm"
                aria-label={t("instance-settings.java-executable")}
                value={draft().java}
                onChange={(java) => {
                  javaRequest++;
                  setJavaTest(undefined);
                  patch({ java });
                }}
                options={javaOptions()}
              />
            </SettingRow>
            <Show when={draft().java === "custom"}>
              <div data-vesta="settings-reveal">
                <SettingRow label={t("instance-settings.executable-path")}>
                  <TextField
                    size="sm"
                    aria-label={t("instance-settings.java-path-aria")}
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
                    {t("instance-settings.browse")}
                  </Button>
                  <Show when={draft().javaPath.trim()}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={javaTest()?.pending}
                      onClick={() => void testJava()}
                    >
                      {javaTest()?.pending ? t("instance-settings.testing") : t("instance-settings.test")}
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
            {inherit("inheritArgs", t("instance-settings.jvm-arguments"), t("common.none"), () => (
              <SettingRow label={t("instance-settings.arguments")}>
                <TextField
                  size="sm"
                  aria-label={t("instance-settings.jvm-arguments")}
                  placeholder="-XX:+UseG1GC"
                  value={draft().args}
                  onChange={(args) => patch({ args })}
                />
              </SettingRow>
            ))}
          </Panel>

          <Panel id="memory" title={t("instance-settings.memory")}>
            {inherit("inheritMemory", t("instance-settings.allocation"), t("instance-settings.memory-range", { min: "2", max: "4" }), () => (
              <div data-vesta="settings-memory">
                <Slider
                  label={t("instance-settings.allocation")}
                  min={512}
                  max={systemMemoryMb}
                  step={512}
                  minStepsBetweenThumbs={1}
                  value={[draft().minMemory, draft().maxMemory]}
                  onChange={([minMemory, maxMemory]) =>
                    patch({ minMemory, maxMemory })
                  }
                  getValueLabel={([low, high]) =>
                    t("instance-settings.memory-range", {
                      min: formatGb(low).replace(/ GB$/, ""),
                      max: formatGb(high).replace(/ GB$/, ""),
                    })
                  }
                />
                <div data-vesta="settings-memory-scale">
                  <span>{t("instance-settings.megabytes", { amount: formatNumber(512) })}</span>
                  <span>{t("instance-settings.gb-installed", { value: formatGb(systemMemoryMb) })}</span>
                </div>
                <dl data-vesta="settings-memory-readout">
                  <div>
                    <dt>{t("instance-settings.memory-start")}</dt>
                    <dd>{t("instance-settings.megabytes", { amount: formatNumber(draft().minMemory) })}</dd>
                  </div>
                  <div>
                    <dt>{t("instance-settings.memory-limit")}</dt>
                    <dd>{t("instance-settings.megabytes", { amount: formatNumber(draft().maxMemory) })}</dd>
                  </div>
                </dl>
                <Show when={memoryHigh()}>
                  <p data-vesta="settings-note" data-tone="warning">
                    <Icon name="icons/controls/warning" size={14} />
                    {t("instance-settings.memory-warning")}
                  </p>
                </Show>
              </div>
            ))}
          </Panel>

          <Panel id="window" title={t("instance-settings.game-window")}>
            {inherit("inheritResolution", t("instance-settings.resolution"), "1280 × 720", () => (
              <SettingRow label={t("instance-settings.width-height")}>
                <div data-vesta="settings-resolution">
                  <NumberField
                    size="sm"
                    aria-label={t("instance-settings.width")}
                    value={draft().width}
                    onChange={(width) => patch({ width })}
                    min={0}
                  />
                  <span aria-hidden="true">×</span>
                  <NumberField
                    size="sm"
                    aria-label={t("instance-settings.height")}
                    value={draft().height}
                    onChange={(height) => patch({ height })}
                    min={0}
                  />
                </div>
              </SettingRow>
            ))}
          </Panel>

          <Panel id="launch" title={t("instance-settings.launch")}>
            {inherit(
              "inheritLauncherAction",
              t("instance-settings.launcher-window"),
              t("instance-settings.stays-open"),
              () => (
                <SettingRow label={t("instance-settings.when-game-starts")}>
                  <Select
                    size="sm"
                    aria-label={t("instance-settings.launcher-window")}
                    value={draft().launcherAction}
                    onChange={(launcherAction) => patch({ launcherAction })}
                    options={[
                      { value: "keep", label: t("instance-settings.stay-open") },
                      { value: "minimize", label: t("instance-settings.minimize") },
                      { value: "hide", label: t("instance-settings.hide-to-tray") },
                      { value: "quit", label: t("instance-settings.quit-launcher") },
                    ]}
                  />
                </SettingRow>
              ),
            )}
            {inherit(
              "inheritEnvironment",
              t("instance-settings.environment-variables"),
              "none",
              () => (
                <div data-vesta="settings-block">
                  <TextArea
                    size="sm"
                    aria-label={t("instance-settings.environment-variables")}
                    description={t("instance-settings.environment-format")}
                    placeholder={"KEY=value\nOTHER_KEY=value"}
                    value={draft().environment}
                    onChange={(environment) => patch({ environment })}
                    rows={4}
                  />
                </div>
              ),
            )}
          </Panel>

          <Panel id="hooks" title={t("instance-settings.hooks")}>
            {inherit("inheritCommands", t("instance-settings.launch-hooks"), t("common.none"), () => (
              <>
                <SettingRow
                  label={t("instance-settings.before-launch")}
                  description={t("instance-settings.before-launch-description")}
                >
                  <TextField
                    size="sm"
                    aria-label={t("instance-settings.pre-launch-hook")}
                    value={draft().preLaunch}
                    onChange={(preLaunch) => patch({ preLaunch })}
                  />
                </SettingRow>
                <SettingRow
                  label={t("instance-settings.wrapper")}
                  description={t("instance-settings.wrapper-description")}
                >
                  <TextField
                    size="sm"
                    aria-label={t("instance-settings.wrapper-command")}
                    placeholder="mangohud --dlsym"
                    value={draft().wrapper}
                    onChange={(wrapper) => patch({ wrapper })}
                  />
                </SettingRow>
                <SettingRow
                  label={t("instance-settings.after-exit")}
                  description={t("instance-settings.after-exit-description")}
                >
                  <TextField
                    size="sm"
                    aria-label={t("instance-settings.post-exit-hook")}
                    value={draft().postExit}
                    onChange={(postExit) => patch({ postExit })}
                  />
                </SettingRow>
              </>
            ))}
          </Panel>

          <Panel id="sandbox" title={t("instance-settings.sandbox")}>
            {inherit("inheritSandbox", t("instance-settings.sandbox"), t("instance-settings.standard-preset"), () => (
              <>
                <SettingRow
                  label={t("instance-settings.preset")}
                  description={t("instance-settings.preset-description")}
                >
                  <Select
                    size="sm"
                    aria-label={t("instance-settings.sandbox-preset")}
                    value={draft().sandboxPreset}
                    onChange={(sandboxPreset) => patch({ sandboxPreset })}
                    options={[
                      { value: "off", label: t("instance-settings.off") },
                      { value: "standard", label: t("instance-settings.standard") },
                      { value: "strict", label: t("instance-settings.strict") },
                    ]}
                  />
                </SettingRow>
                <SettingRow
                  label={t("instance-settings.sandbox-wrapper")}
                  description={t("instance-settings.sandbox-wrapper-description")}
                >
                  <Switch
                    size="sm"
                    aria-label={t("instance-settings.sandbox-wrapper")}
                    checked={draft().sandboxWrapper}
                    onChange={(sandboxWrapper) => patch({ sandboxWrapper })}
                  />
                </SettingRow>
              </>
            ))}
          </Panel>

          <Panel id="maintenance" title={t("instance-settings.maintenance")}>
            <SettingRow
              label={t("instance-settings.export")}
              description={t("instance-settings.export-description")}
            >
              <Button size="sm" variant="outline" disabled={busy()}>
                {t("instance-settings.export-action")}
              </Button>
            </SettingRow>
            <SettingRow
              label={t("instance-settings.duplicate")}
              description={t("instance-settings.duplicate-description")}
            >
              <Button size="sm" variant="outline" disabled={busy()}>
                {t("instance-settings.duplicate")}
              </Button>
            </SettingRow>
            <SettingRow
              label={t("instance-settings.repair")}
              description={t("instance-settings.repair-description")}
            >
              <Button size="sm" variant="outline" disabled={busy()}>
                {t("instance-settings.repair")}
              </Button>
            </SettingRow>
          </Panel>

          <Panel id="danger" title={t("instance-settings.danger-zone")} danger>
            <SettingRow
              label={t("instance-settings.reset-instance")}
              description={t("instance-settings.reset-instance-description")}
            >
              <Button
                size="sm"
                variant="outline"
                tone="danger"
                disabled={busy()}
                onClick={() => setConfirm("reset")}
              >
                {t("instance-settings.reset-action")}
              </Button>
            </SettingRow>
            <SettingRow
              label={t("instance-settings.delete-instance")}
              description={t("instance-settings.delete-instance-description")}
            >
              <Button
                size="sm"
                tone="danger"
                disabled={busy()}
                onClick={() => setConfirm("delete")}
              >
                {t("instance-settings.delete-action")}
              </Button>
            </SettingRow>
          </Panel>
        </div>
        <Show when={dirty()}>
          <div
            data-vesta="settings-savebar"
            role="region"
            aria-label={t("instance-settings.unsaved-changes")}
          >
            <span data-vesta="settings-savebar-dot" />
            <span>{t("instance-settings.unsaved-changes")}</span>
            <Button size="sm" variant="ghost" onClick={discard}>
              {t("instance-settings.discard")}
            </Button>
            <Button size="sm" tone="accent" disabled={invalid()} onClick={save}>
              {t("instance-settings.save")}
            </Button>
          </div>
        </Show>
      </div>

      <Dialog
        title={
          confirm() === "delete"
            ? t("instance-settings.delete-title", { name: props.entry.instance.name })
            : t("instance-settings.reset-title", { name: props.entry.instance.name })
        }
        description={
          confirm() === "delete"
            ? t("instance-settings.delete-confirm-description")
            : t("instance-settings.reset-confirm-description")
        }
        open={!!confirm()}
        onOpenChange={(open) => {
          if (!open) setConfirm(undefined);
        }}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(undefined)}>
              {t("common.cancel")}
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
              {confirm() === "delete" ? t("common.delete") : t("settings.reset")}
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
