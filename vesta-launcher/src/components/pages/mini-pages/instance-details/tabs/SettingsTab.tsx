import { SettingsCard, SettingsField } from "@components/settings";
import Button from "@ui/button/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import { areIconsEqual, IconPicker } from "@ui/icon-picker/icon-picker";
import {
  NumberField,
  NumberFieldDecrementTrigger,
  NumberFieldGroup,
  NumberFieldIncrementTrigger,
  NumberFieldInput,
  NumberFieldLabel,
} from "@ui/number-field/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/select/select";
import {
  Slider,
  SliderFill,
  SliderThumb,
  SliderTrack,
} from "@ui/slider/slider";
import {
  Switch,
  SwitchControl,
  SwitchLabel,
  SwitchThumb,
} from "@ui/switch/switch";
import {
  TextFieldInput,
  TextFieldRoot,
  TextFieldTextArea,
} from "@ui/text-field/text-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { batch, createMemo, Show } from "solid-js";
import styles from "../instance-details.module.css";

interface SettingsTabProps {
  instance: any;
  name: string;
  setName: (v: string) => void;
  setIsNameDirty: (v: boolean) => void;
  iconPath: string;
  setIconPath: (v: string) => void;
  setIsIconDirty: (v: boolean) => void;
  uploadedIcons: () => string[];
  modpackIcon: () => string | null;
  isSuggestedSelected: () => boolean;
  isInstalling: boolean;
  jreOptions: () => any[];
  javaPath: string;
  setJavaPath: (v: string) => void;
  setIsJavaPathDirty: (v: boolean) => void;
  isCustomMode: boolean;
  setIsCustomMode: (v: boolean) => void;
  javaArgs: string;
  setJavaArgs: (v: string) => void;
  setIsJvmDirty: (v: boolean) => void;
  minMemory: number[];
  setMinMemory: (v: number[]) => void;
  setIsMinMemDirty: (v: boolean) => void;
  maxMemory: number[];
  setMaxMemory: (v: number[]) => void;
  setIsMaxMemDirty: (v: boolean) => void;

  // Linking & Overrides
  useGlobalResolution: boolean;
  setUseGlobalResolution: (v: boolean) => void;
  gameWidth: number;
  setGameWidth: (v: number) => void;
  gameHeight: number;
  setGameHeight: (v: number) => void;
  setIsResolutionDirty: (v: boolean) => void;
  useGlobalMemory: boolean;
  setUseGlobalMemory: (v: boolean) => void;
  useGlobalJavaArgs: boolean;
  setUseGlobalJavaArgs: (v: boolean) => void;
  useGlobalJavaPath: boolean;
  setUseGlobalJavaPath: (v: boolean) => void;
  preLaunchHook: string;
  setPreLaunchHook: (v: string) => void;
  postExitHook: string;
  setPostExitHook: (v: string) => void;
  wrapperCommand: string;
  setWrapperCommand: (v: string) => void;
  useGlobalHooks: boolean;
  setUseGlobalHooks: (v: boolean) => void;
  setIsHooksDirty: (v: boolean) => void;
  environmentVariables: string;
  setEnvironmentVariables: (v: string) => void;
  useGlobalEnvironmentVariables: boolean;
  setUseGlobalEnvironmentVariables: (v: boolean) => void;
  setIsEnvDirty: (v: boolean) => void;

  handleSave: () => void;
  saving: () => boolean;
  totalRam: number;
  invoke: any;
  showToast: any;
}

export const SettingsTab = (p: SettingsTabProps) => {
  const currentSelection = createMemo(() => {
    if (p.useGlobalJavaPath) return "__default__";
    if (p.isCustomMode) return "__custom__";
    if (!p.javaPath) return "__default__";
    return p.javaPath;
  });

  // Memory Multi-Thumb Logic
  const memoryRange = createMemo(() => [p.minMemory[0], p.maxMemory[0]]);
  const handleMemoryChange = (val: number[]) => {
    // Guard against phantom changes (e.g. from Slider mount/sync)
    if (val[0] === p.minMemory[0] && val[1] === p.maxMemory[0]) return;

    batch(() => {
      p.setMinMemory([val[0]]);
      p.setMaxMemory([val[1]]);
      p.setIsMinMemDirty(true);
      p.setIsMaxMemDirty(true);
    });
  };

  return (
    <div class={styles["tab-settings"]}>
      <div class={styles["settings-metadata-section"]}>
        <div class={styles["metadata-main-info"]}>
          <div class={styles["metadata-icon-container"]}>
            <IconPicker
              value={p.iconPath}
              onSelect={(val) => {
                if (areIconsEqual(val, p.iconPath)) return;
                p.setIconPath(val);
                p.setIsIconDirty(true);
              }}
              uploadedIcons={p.uploadedIcons()}
              modpackIcon={p.modpackIcon()}
              isSuggestedSelected={p.isSuggestedSelected()}
              showHint={true}
            />
          </div>

          <div class={styles["metadata-fields"]}>
            <TextFieldRoot class={styles["metadata-name-input-root"]}>
              <TextFieldInput
                class={styles["metadata-name-input"]}
                value={p.name}
                onInput={(e) => {
                  const val = (e.currentTarget as HTMLInputElement).value;
                  if (val === p.name) return;
                  p.setName(val);
                  p.setIsNameDirty(true);
                }}
                disabled={p.isInstalling}
                placeholder="Instance Name"
              />
            </TextFieldRoot>
            <p class={styles["metadata-description"]}>
              Choose an icon and a name for this instance. These will be visible
              in your library.
            </p>
          </div>
        </div>
      </div>

      <SettingsCard header="Java Configuration">
        <SettingsField
          label="Java Executable"
          description="The Java runtime used to launch this instance."
          helpTopic="JAVA_MANAGED"
          layout="stack"
        >
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <Select<any>
                options={p.jreOptions()}
                optionValue="value"
                optionTextValue="label"
                value={p.jreOptions().find((o) => o.value === currentSelection())}
                onChange={(val: any) => {
                  if (val.value === currentSelection()) return;

                  if (val.value === "__default__") {
                    batch(() => {
                      p.setJavaPath("");
                      p.setUseGlobalJavaPath(true);
                      p.setIsCustomMode(false);
                      p.setIsJavaPathDirty(true);
                    });
                  } else if (val.value === "__custom__") {
                    batch(() => {
                      p.setUseGlobalJavaPath(false);
                      p.setIsCustomMode(true);
                    });
                  } else if (val.value.startsWith("__download_")) {
                    const version = parseInt(val.value.split("_")[2]);
                    p.invoke("download_managed_java", { version })
                      .then(() => {
                        p.showToast({
                          title: "Download Started",
                          description: `Java ${version} is being downloaded.`,
                          severity: "info",
                        });
                      })
                      .catch(() => {
                        p.showToast({
                          title: "Error",
                          description: "Failed to start Java download.",
                          severity: "error",
                        });
                      });
                    batch(() => {
                      p.setJavaPath("");
                      p.setUseGlobalJavaPath(false);
                      p.setIsCustomMode(false);
                      p.setIsJavaPathDirty(true);
                    });
                  } else {
                    batch(() => {
                      p.setJavaPath(val.value);
                      p.setUseGlobalJavaPath(false);
                      p.setIsCustomMode(false);
                      p.setIsJavaPathDirty(true);
                    });
                  }
                }}
                itemComponent={(p) => (
                  <SelectItem item={p.item}>
                    <div style="display: flex; flex-direction: column; line-height: 1.2;">
                      <span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">
                        {p.item.rawValue.label}
                      </span>
                      <span style="font-size: 10px; opacity: 0.5; color: var(--text-secondary); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px;">
                        {p.item.rawValue.description}
                      </span>
                    </div>
                  </SelectItem>
                )}
              >
                <ContextMenu>
                  <Tooltip>
                    <TooltipTrigger style="width: 100%; display: block;" as="div">
                      <ContextMenuTrigger style="width: 100%;" as="div">
                        <SelectTrigger style="width: 100%;">
                          <SelectValue<any>>
                            {(state) => (
                              <div style="display: flex; flex-direction: column; align-items: flex-start; line-height: 1.2;">
                                <span style="font-size: 13px;">
                                  {state.selectedOption().label}
                                </span>
                                <span style="font-size: 10px; opacity: 0.5; font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 340px;">
                                  {state.selectedOption().description}
                                </span>
                              </div>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                      </ContextMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <Show
                        when={
                          p
                            .jreOptions()
                            .find((o) => o.value === currentSelection())
                            ?.description
                        }
                        fallback="No path set"
                      >
                        {(desc) => (
                          <div style="font-family: var(--font-mono); font-size: 11px; max-width: 400px; word-break: break-all;">
                            {desc().startsWith("→ ")
                              ? desc().substring(2)
                              : desc()}
                          </div>
                        )}
                      </Show>
                    </TooltipContent>
                  </Tooltip>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() => {
                        const current = p
                          .jreOptions()
                          .find((o) => o.value === currentSelection());
                        if (
                          current &&
                          current.description &&
                          current.description !== "(not set)"
                        ) {
                          let path = current.description;
                          if (path.startsWith("→ ")) path = path.substring(2);
                          navigator.clipboard.writeText(path);
                          p.showToast({
                            title: "Copied",
                            description: "Java path copied to clipboard",
                            severity: "success",
                          });
                        }
                      }}
                    >
                      Copy Full Path
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                <SelectContent />
              </Select>

            <Show when={p.isCustomMode}>
              <div style="display: flex; gap: 8px; margin-top: 4px;">
                <TextFieldRoot style="flex: 1">
                  <TextFieldInput
                    value={p.javaPath}
                    placeholder="Path to java executable"
                    onInput={(e) => {
                      const val = (e.currentTarget as HTMLInputElement).value;
                      if (val === p.javaPath) return;
                      batch(() => {
                        p.setJavaPath(val);
                        p.setUseGlobalJavaPath(false);
                        p.setIsJavaPathDirty(true);
                      });
                    }}
                  />
                </TextFieldRoot>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const path = await p.invoke("select_java_file");
                    if (path && path !== p.javaPath) {
                      batch(() => {
                        p.setJavaPath(path);
                        p.setUseGlobalJavaPath(false);
                        p.setIsJavaPathDirty(true);
                      });
                    }
                  }}
                >
                  Browse...
                </Button>
              </div>
            </Show>
          </div>
        </SettingsField>

        <SettingsField
          label="Java Arguments"
          description="Custom JVM arguments for this instance."
          layout="stack"
        >
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-size: 13px; font-weight: 500; color: var(--text-secondary);">
                Use Global Java Arguments
              </span>
              <Switch
                checked={p.useGlobalJavaArgs}
                onCheckedChange={(val: boolean) => {
                  batch(() => {
                    p.setUseGlobalJavaArgs(val);
                    p.setIsJvmDirty(true);
                  });
                }}
              >
                <SwitchControl>
                  <SwitchThumb />
                </SwitchControl>
              </Switch>
            </div>

            <Show
              when={!p.useGlobalJavaArgs}
              fallback={
                <div style="padding: 10px; border-radius: 8px; border: 1px dashed var(--border-subtle); opacity: 0.6; font-size: 12px;">
                  Currently using the Java arguments defined in global settings.
                </div>
              }
            >
              <TextFieldRoot>
                <TextFieldInput
                  value={p.javaArgs}
                  onInput={(e: any) => {
                    const val = (e.currentTarget as HTMLInputElement).value;
                    if (val === p.javaArgs) return;
                    p.setJavaArgs(val);
                    p.setIsJvmDirty(true);
                  }}
                  placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
                />
              </TextFieldRoot>
            </Show>
          </div>
        </SettingsField>
      </SettingsCard>

      <SettingsCard header="Memory Management">
        <SettingsField
          label="Allocation Range"
          description={`Set the minimum and maximum RAM for the game. (System Total: ${Math.round(
            p.totalRam / 1024
          )}GB)`}
          layout="stack"
        >
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-size: 13px; font-weight: 500; color: var(--text-secondary);">
                Use Global Memory Allocation
              </span>
              <Switch
                checked={p.useGlobalMemory}
                onCheckedChange={(val: boolean) => {
                  batch(() => {
                    p.setUseGlobalMemory(val);
                    p.setIsMinMemDirty(true);
                    p.setIsMaxMemDirty(true);
                  });
                }}
              >
                <SwitchControl>
                  <SwitchThumb />
                </SwitchControl>
              </Switch>
            </div>

            <Show
              when={!p.useGlobalMemory}
              fallback={
                <div style="padding: 10px; border-radius: 8px; border: 1px dashed var(--border-subtle); opacity: 0.6; font-size: 12px;">
                  Currently using the memory range defined in global settings.
                </div>
              }
            >
              <div style="margin-bottom: 32px; margin-top: 12px;">
                <Slider
                  value={memoryRange()}
                  onChange={handleMemoryChange}
                  minValue={512}
                  maxValue={p.totalRam}
                  step={512}
                >
                  <div class={styles["slider__header"]}>
                    <div class={styles["slider__value-label"]}>
                      {p.minMemory[0] >= 1024
                        ? `${(p.minMemory[0] / 1024).toFixed(1)}GB`
                        : `${p.minMemory[0]}MB`}
                      {" — "}
                      {p.maxMemory[0] >= 1024
                        ? `${(p.maxMemory[0] / 1024).toFixed(1)}GB`
                        : `${p.maxMemory[0]}MB`}
                    </div>
                  </div>
                  <SliderTrack>
                    <SliderFill />
                    <SliderThumb />
                    <SliderThumb />
                  </SliderTrack>
                </Slider>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; opacity: 0.8; font-size: 13px;">
                <div>
                  <strong>Min (-Xms):</strong> {p.minMemory[0]} MB
                </div>
                <div>
                  <strong>Max (-Xmx):</strong> {p.maxMemory[0]} MB
                </div>
              </div>
            </Show>
          </div>
        </SettingsField>
      </SettingsCard>

      <SettingsCard header="Resolution">
        <SettingsField
          label="Game Window"
          description="Set the initial width and height of the Minecraft window."
          layout="stack"
        >
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-size: 13px; font-weight: 500; color: var(--text-secondary);">
                Use Global Resolution
              </span>
              <Switch
                checked={p.useGlobalResolution}
                onCheckedChange={(val: boolean) => {
                  batch(() => {
                    p.setUseGlobalResolution(val);
                    p.setIsResolutionDirty(true);
                  });
                }}
              >
                <SwitchControl>
                  <SwitchThumb />
                </SwitchControl>
              </Switch>
            </div>

            <Show
              when={!p.useGlobalResolution}
              fallback={
                <div style="padding: 10px; border-radius: 8px; border: 1px dashed var(--border-subtle); opacity: 0.6; font-size: 12px;">
                  Currently using the resolution defined in global settings.
                </div>
              }
            >
              <div
                style={{
                  display: "flex",
                  gap: "16px",
                  "align-items": "flex-end",
                  "max-width": "400px",
                }}
              >
                <NumberField
                  style="flex: 1;"
                  value={p.gameWidth}
                  onRawValueChange={(val) => {
                    p.setGameWidth(val);
                    p.setIsResolutionDirty(true);
                  }}
                  minValue={0}
                >
                  <label
                    style={{
                      display: "block",
                      "font-size": "12px",
                      opacity: 0.6,
                      "margin-bottom": "4px",
                    }}
                  >
                    Width
                  </label>
                  <NumberFieldGroup>
                    <NumberFieldInput placeholder="1280" />
                    <NumberFieldIncrementTrigger />
                    <NumberFieldDecrementTrigger />
                  </NumberFieldGroup>
                </NumberField>
                <span style="opacity: 0.5; margin-bottom: 12px;">×</span>
                <NumberField
                  style="flex: 1;"
                  value={p.gameHeight}
                  onRawValueChange={(val) => {
                    p.setGameHeight(val);
                    p.setIsResolutionDirty(true);
                  }}
                  minValue={0}
                >
                  <label
                    style={{
                      display: "block",
                      "font-size": "12px",
                      opacity: 0.6,
                      "margin-bottom": "4px",
                    }}
                  >
                    Height
                  </label>
                  <NumberFieldGroup>
                    <NumberFieldInput placeholder="720" />
                    <NumberFieldIncrementTrigger />
                    <NumberFieldDecrementTrigger />
                  </NumberFieldGroup>
                </NumberField>
              </div>
            </Show>
          </div>
        </SettingsField>
      </SettingsCard>

      <SettingsCard header="Environment Variables">
        <SettingsField
          label="Variables"
          description="Custom environment variables for the game process. One per line (e.g. KEY=VALUE)."
          layout="stack"
        >
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-size: 13px; font-weight: 500; color: var(--text-secondary);">
                Use Global Environment Variables
              </span>
              <Switch
                checked={p.useGlobalEnvironmentVariables}
                onCheckedChange={(val: boolean) => {
                  batch(() => {
                    p.setUseGlobalEnvironmentVariables(val);
                    p.setIsEnvDirty(true);
                  });
                }}
              >
                <SwitchControl>
                  <SwitchThumb />
                </SwitchControl>
              </Switch>
            </div>

            <Show
              when={!p.useGlobalEnvironmentVariables}
              fallback={
                <div style="padding: 10px; border-radius: 8px; border: 1px dashed var(--border-subtle); opacity: 0.6; font-size: 12px;">
                  Currently using the environment variables defined in global
                  settings.
                </div>
              }
            >
              <TextFieldRoot>
                <TextFieldTextArea
                  value={p.environmentVariables}
                  onInput={(e: any) => {
                    p.setEnvironmentVariables(e.currentTarget.value);
                    p.setIsEnvDirty(true);
                  }}
                  placeholder="MESA_GL_VERSION_OVERRIDE=4.6&#10;__GL_THREADED_OPTIMIZATIONS=1"
                  style="min-height: 80px; font-family: var(--font-mono); font-size: 12px; padding: 10px;"
                />
              </TextFieldRoot>
            </Show>
          </div>
        </SettingsField>
      </SettingsCard>

      <SettingsCard header="Life-cycle Hooks">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding: 0 4px;">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-size: 13px; font-weight: 500; color: var(--text-secondary);">
              Use Global Life-cycle Hooks
            </span>
            <span style="font-size: 11px; opacity: 0.6;">
              Link all hooks to the settings defined in your global profile.
            </span>
          </div>
          <Switch
            checked={p.useGlobalHooks}
            onCheckedChange={(val: boolean) => {
              batch(() => {
                p.setUseGlobalHooks(val);
                p.setIsHooksDirty(true);
              });
            }}
          >
            <SwitchControl>
              <SwitchThumb />
            </SwitchControl>
          </Switch>
        </div>

        <Show
          when={!p.useGlobalHooks}
          fallback={
            <div style="padding: 12px; border-radius: 8px; border: 1px dashed var(--border-subtle); opacity: 0.6; font-size: 12px; margin-bottom: 12px;">
              Currently using the pre-launch, wrapper, and post-exit hooks
              defined in global settings.
            </div>
          }
        >
          <SettingsField
            label="Pre-launch Hook"
            description="Command to run before the game starts. (e.g. a script to sync worlds)"
            layout="stack"
          >
            <TextFieldRoot>
              <TextFieldInput
                value={p.preLaunchHook}
                onInput={(e: any) => {
                  p.setPreLaunchHook(e.currentTarget.value);
                  p.setIsHooksDirty(true);
                }}
                placeholder="e.g. C:\scripts\pre-launch.bat"
                style="font-family: var(--font-mono); font-size: 12px;"
              />
            </TextFieldRoot>
          </SettingsField>

          <SettingsField
            label="Wrapper Command"
            description="Execute the game through a wrapper (e.g. mangohud, optirun, or a debugger)."
            layout="stack"
          >
            <TextFieldRoot>
              <TextFieldInput
                value={p.wrapperCommand}
                onInput={(e: any) => {
                  p.setWrapperCommand(e.currentTarget.value);
                  p.setIsHooksDirty(true);
                }}
                placeholder="e.g. mangohud --dlsym"
                style="font-family: var(--font-mono); font-size: 12px;"
              />
            </TextFieldRoot>
          </SettingsField>

          <SettingsField
            label="Post-exit Hook"
            description="Command to run after the game closes."
            layout="stack"
          >
            <TextFieldRoot>
              <TextFieldInput
                value={p.postExitHook}
                onInput={(e: any) => {
                  p.setPostExitHook(e.currentTarget.value);
                  p.setIsHooksDirty(true);
                }}
                placeholder="e.g. powershell -File C:\scripts\cleanup.ps1"
                style="font-family: var(--font-mono); font-size: 12px;"
              />
            </TextFieldRoot>
          </SettingsField>
        </Show>
      </SettingsCard>

      <div
        class={styles["settings-actions"]}
        style="display: flex; gap: 12px; margin-top: 24px;"
      >
        <Button onClick={p.handleSave} disabled={p.saving() || p.isInstalling}>
          {p.saving()
            ? "Saving…"
            : p.isInstalling
            ? "Installing..."
            : "Save Settings"}
        </Button>
      </div>
    </div>
  );
};
