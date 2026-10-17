import { Button, Dialog, IconButton, TextField } from "@vesta/ui";
import { For, Show, createSignal, onCleanup, untrack } from "solid-js";
import { Icon } from "../../components/icon";
import { t } from "../../localization";
import { nativeInstances } from "../../features/instances/native-service";
import type { PackSource } from "../../features/installation/install-service";

import {
  launchers,
  type LauncherKind,
} from "../../features/installation/launchers";

export function ImportDialog(props: {
  open: boolean;
  onClose: () => void;
  onSource: (source: PackSource) => void;
  onLauncher: (kind: LauncherKind) => void;
  initialUrl?: string;
  initialStep?: "methods" | "launchers";
}) {
  const [step, setStep] = createSignal<"methods" | "launchers">(
    untrack(() => props.initialStep ?? "methods"),
    { name: "importMethod" },
  );
  const [url, setUrl] = createSignal(
    untrack(() => props.initialUrl ?? ""),
    { name: "modpackImportUrl" },
  );
  const [showUrl, setShowUrl] = createSignal(untrack(() => !!props.initialUrl));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const close = () => {
    if (!busy()) {
      setStep("methods");
      setError("");
      props.onClose();
    }
  };
  const local = async () => {
    setBusy(true);
    setError("");
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({
        multiple: false,
        filters: [{ name: "Modpack", extensions: ["zip", "mrpack"] }],
      });
      if (!disposed && typeof result === "string")
        props.onSource({ kind: "file", value: result });
    } catch (reason) {
      if (!disposed) setError(String(reason));
    } finally {
      if (!disposed) setBusy(false);
    }
  };
  const submitUrl = () => {
    try {
      const value = new URL(url().trim());
      if (!["http:", "https:"].includes(value.protocol)) throw new Error();
    } catch {
      setError(t("install.invalid-url"));
      return;
    }
    setError("");
    props.onSource({ kind: "url", value: url().trim() });
  };
  const back = () => {
    setStep("methods");
    setError("");
  };
  const methodRow = (
    icon: string,
    title: string,
    description: string,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      class="install-import-row"
      onClick={onClick}
      disabled={busy() || disabled}
    >
      <span class="install-import-row-icon">
        <Icon name={icon} size={20} />
      </span>
      <span class="install-import-row-copy">
        <span class="install-import-row-title">{title}</span>
        <span class="install-import-row-desc">{description}</span>
      </span>
    </button>
  );
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      class="install-import-dialog"
      title={
        <span class="install-import-heading">
          <Show when={step() !== "methods"}>
            <IconButton
              variant="ghost"
              size="sm"
              tooltip={false}
              icon={<Icon name="icons/navigation/arrow-back" />}
              label={t("common.back")}
              disabled={busy()}
              onClick={back}
            />
          </Show>
          <span>
            {step() === "methods"
              ? t("install.import")
              : t("install.from-launcher")}
          </span>
        </span>
      }
      description={
        step() === "methods"
          ? t("install.import-description")
          : step() === "launchers"
            ? t("install.choose-launcher")
            : undefined
      }
    >
      <div data-vesta="install-import">
        <Show when={step() === "methods"}>
          <div class="install-import-methods">
            {methodRow(
              "icons/content/cube",
              t("install.local-file"),
              t("install.local-file-description"),
              () => void local(),
              !nativeInstances,
            )}
            {methodRow(
              "icons/content/search",
              t("install.browse-modpacks"),
              t("install.browse-description"),
              () => {},
              true,
            )}
            <button
              type="button"
              class="install-import-row"
              disabled={busy() || !nativeInstances}
              onClick={() => setStep("launchers")}
            >
              <span class="install-import-row-icon install-import-launcher-stack">
                <Icon name="branding/launchers/prism-launcher" size={20} />
                <Icon name="branding/sources/curseforge" size={20} />
              </span>
              <span class="install-import-row-copy">
                <span class="install-import-row-title">
                  {t("install.from-launcher")}
                </span>
                <span class="install-import-row-desc">
                  {t("install.launchers-description")}
                </span>
              </span>
            </button>
            <Show
              when={showUrl()}
              fallback={methodRow(
                "icons/content/link",
                t("install.from-url"),
                t("install.url-description"),
                () => {
                  setShowUrl(true);
                  setError("");
                },
                !nativeInstances,
              )}
            >
              <div class="install-import-url-panel">
                <div class="install-import-url-row">
                  <TextField
                    aria-label={t("install.modpack-url")}
                    value={url()}
                    onChange={(value) => {
                      setUrl(value);
                      setError("");
                    }}
                    placeholder="https://…"
                    disabled={busy()}
                    autofocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitUrl();
                      }
                    }}
                  />
                  <Button
                    tone="accent"
                    onClick={submitUrl}
                    disabled={busy() || !url().trim()}
                  >
                    {t("install.import-action")}
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={step() === "launchers"}>
          <div class="install-import-launchers">
            <For each={launchers}>
              {(item) => (
                <button
                  type="button"
                  class="install-import-row"
                  data-brand={item.value}
                  disabled={busy()}
                  onClick={() => {
                    props.onLauncher(item.value);
                  }}
                >
                  <span class="install-import-row-icon">
                    <Icon name={"branding/" + item.icon} size={20} />
                  </span>
                  <span class="install-import-row-title">{item.label}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={busy()}>
          <p role="status">{t("install.working")}</p>
        </Show>
        <Show when={error()}>
          <p role="alert">{error()}</p>
        </Show>
      </div>
    </Dialog>
  );
}
