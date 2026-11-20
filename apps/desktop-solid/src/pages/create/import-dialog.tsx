import { IconTile } from '../../components/icon-tile';
import { Button, Dialog, IconButton, TextField } from "@vesta/ui";
import { For, Show, createSignal, onCleanup, onSettled, untrack } from "solid-js";
import { Icon } from "../../components/icon";
import { transitionTo } from "../../app/transition";
import { setType } from "../../features/browse/browse-store";
import { t } from "../../localization";
import { nativeInstances } from "../../features/instances/native-service";
import type { PackSource } from "../../features/installation/install-service";
import { closeImport, importRequest } from "../../features/installation/import-request";
import { openInstallSource } from "./install-navigation";
import { navigate } from "../../app/router";
import "./import-dialog.css";

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
  initialStep?: "methods" | "launchers" | "file";
}) {
  const [step, setStep] = createSignal<"methods" | "launchers">(
    untrack(() => props.initialStep === 'launchers' ? 'launchers' : 'methods'),
    { name: "importMethod" },
  );
  const [url, setUrl] = createSignal(
    untrack(() => props.initialUrl ?? ""),
    { name: "modpackImportUrl" },
  );
  const [showUrl, setShowUrl] = createSignal(untrack(() => !!props.initialUrl));
  /** Which way the last page change went, so the new page slides in from that side. */
  const [direction, setDirection] = createSignal<"forward" | "back" | undefined>(undefined, { name: "importDirection" });
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
  onSettled(() => {
    if (untrack(() => props.initialStep) === 'file' && nativeInstances) void local();
  });
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
    setDirection("back");
    setStep("methods");
    setError("");
  };
  const methodRow = (
    icon: string,
    title: string,
    description: string,
    onClick: () => void,
    disabled = false,
    working = () => false,
  ) => (
    <button
      type="button"
      class="install-import-row"
      onClick={onClick}
      disabled={busy() || disabled}
      aria-busy={working() ? 'true' : undefined}
    >
      {/* The row that is working shows it in place, so the dialog keeps its height. */}
      <IconTile hook="install-import-icon" class="install-import-row-icon">
        <Show when={!working()} fallback={<span class="install-import-spinner" aria-hidden="true" />}>
          <Icon name={icon} size={20} />
        </Show>
      </IconTile>
      <span class="install-import-row-copy">
        <span class="install-import-row-title">{title}</span>
        <span class="install-import-row-desc">{description}</span>
      </span>
    </button>
  );
  return (
    <Dialog
      closeLabel={t('nav.close')}
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      class="install-import-dialog"
      title={
        // The back button's slot is always there and slides open, so the title moves smoothly
        // instead of jumping when a page is pushed.
        <span class="install-import-heading" data-nested={step() !== "methods" ? "" : undefined}>
          <span class="install-import-back" inert={step() === "methods"}>
            <IconButton
              variant="ghost"
              size="sm"
              tooltip={false}
              icon={<Icon name="icons/navigation/arrow-back" />}
              label={t("common.back")}
              disabled={busy() || step() === "methods"}
              onClick={back}
            />
          </span>
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
      <div data-vesta="install-import" data-direction={direction()}>
        <Show when={step() === "methods"}>
          <div class="install-import-methods">
            {methodRow(
              "icons/content/cube",
              t("install.local-file"),
              t("install.local-file-description"),
              () => void local(),
              !nativeInstances,
              busy,
            )}
            {methodRow(
              "icons/content/search",
              t("install.browse-modpacks"),
              t("install.browse-description"),
              () => {
                setType("modpack");
                close();
                transitionTo("/browse");
              },
            )}
            <button
              type="button"
              class="install-import-row"
              disabled={busy()}
              onClick={() => { setDirection("forward"); setStep("launchers"); }}
            >
              <IconTile hook="install-import-icon" class="install-import-row-icon install-import-launcher-stack">
                <Icon name="branding/launchers/prism-launcher" size={20} />
                <Icon name="branding/sources/curseforge" size={20} />
              </IconTile>
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
                  <IconTile hook="install-import-icon" class="install-import-row-icon">
                    <Icon name={"branding/" + item.icon} size={20} />
                  </IconTile>
                  <span class="install-import-row-title">{item.label}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={busy()}>
          <p role="status" class="install-import-status">{t("install.working")}</p>
        </Show>
        <Show when={error()}>
          <p role="alert">{error()}</p>
        </Show>
      </div>
    </Dialog>
  );
}

/** The launcher-wide import dialog (see openImport): opens over the current page. */
export function GlobalImportDialog() {
  return (
    <Show when={importRequest()} keyed>
      {(request) => (
        <ImportDialog
          open
          initialStep={request.step}
          initialUrl={request.url}
          onClose={closeImport}
          onSource={(source) => { closeImport(); openInstallSource(source); }}
          onLauncher={(kind) => { closeImport(); navigate(`/create/import/${kind}`); }}
        />
      )}
    </Show>
  );
}
