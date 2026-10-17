import { invoke, isTauri } from "@tauri-apps/api/core";
import { Button, NumberField, Progress, Select, Slider, TextField } from "@vesta/ui";
import { Show, createSignal, onCleanup } from "solid-js";
import { SettingRow } from "../../../components/setting-row";
import { setting, updateSetting } from "../../../features/settings/config";
import { storageUsage } from "../../../features/settings/resources";
import { formatBytes } from "../../../features/settings/storage-model";
import { t } from "../../../localization";
import { Callout, Card, Reveal, ToggleRow } from "../parts";

const MB = 1024 * 1024;

export function DownloadsSettings() {
  const [testing, setTesting] = createSignal<"idle" | "busy" | "ok" | "failed">("idle");
  const used = () => storageUsage.data().artifactCacheUsageBytes;
  const limit = () => setting("artifact_cache_max_bytes");
  let testGeneration = 0;
  onCleanup(() => {
    testGeneration++;
  });
  const testProxy = async () => {
    const generation = ++testGeneration;
    const url = setting("proxy_url");
    setTesting("busy");
    try {
      const result = isTauri()
        ? await invoke<{ ok: boolean }>("test_proxy_connection", { input: { enabled: true, url } })
        : { ok: false };
      if (generation === testGeneration)
        setTesting(setting("proxy_url") === url ? (result.ok ? "ok" : "failed") : "idle");
    } catch {
      if (generation === testGeneration)
        setTesting(setting("proxy_url") === url ? "failed" : "idle");
    }
  };
  return (
    <>
      <Card title={t("prefs.downloads.transfers")}>
        <SettingRow
          label={t("prefs.downloads.threads")}
          description={t("prefs.downloads.threads-description")}
        >
          <div data-vesta="prefs-slider">
            <Slider
              aria-label={t("prefs.downloads.threads")}
              min={1}
              max={16}
              step={1}
              showValue
              value={[setting("max_download_threads")]}
              onChange={([value]) => updateSetting("max_download_threads", value)}
            />
          </div>
        </SettingRow>
      </Card>

      <Card title={t("prefs.downloads.cache")} description={t("prefs.downloads.cache-description")}>
        <div data-vesta="prefs-meter">
          <div>
            <strong>{formatBytes(used())}</strong>
            <span>{t("prefs.downloads.cache-of", { limit: formatBytes(limit()) })}</span>
          </div>
          <Progress
            aria-label={t("prefs.downloads.cache-limit")}
            value={Math.min(100, (used() / Math.max(limit(), 1)) * 100)}
            size="sm"
          />
        </div>
        <SettingRow
          label={t("prefs.downloads.cache-limit")}
          description={t("prefs.downloads.cache-limit-description")}
        >
          <NumberField
            aria-label={t("prefs.downloads.cache-limit")}
            value={Math.round(limit() / MB)}
            min={128}
            max={102400}
            step={128}
            onChange={(megabytes) =>
              updateSetting("artifact_cache_max_bytes", Math.max(128, megabytes) * MB)
            }
          />
          <span data-vesta="prefs-unit">MB</span>
        </SettingRow>
      </Card>

      <Card title={t("prefs.downloads.dependencies")}>
        <ToggleRow
          label={t("prefs.downloads.auto-dependencies")}
          description={t("prefs.downloads.auto-dependencies-description")}
          checked={setting("auto_install_dependencies")}
          onChange={(value) => updateSetting("auto_install_dependencies", value)}
        />
        <SettingRow
          label={t("prefs.downloads.manual-dependencies")}
          description={t("prefs.downloads.manual-dependencies-description")}
        >
          <Select
            aria-label={t("prefs.downloads.manual-dependencies")}
            value={setting("manual_mod_dependency_policy")}
            onChange={(value) =>
              updateSetting("manual_mod_dependency_policy", value as "ask" | "always" | "never")
            }
            options={[
              { value: "ask", label: t("prefs.downloads.policy-ask") },
              { value: "always", label: t("prefs.downloads.policy-always") },
              { value: "never", label: t("prefs.downloads.policy-never") },
            ]}
          />
        </SettingRow>
      </Card>

      <Card title={t("prefs.downloads.proxy")} description={t("prefs.downloads.proxy-description")}>
        <ToggleRow
          label={t("prefs.downloads.proxy-enable")}
          checked={setting("proxy_enabled")}
          onChange={(value) => updateSetting("proxy_enabled", value)}
        />
        <Show when={setting("proxy_enabled")}>
          <Reveal>
            <SettingRow
              label={t("prefs.downloads.proxy-url")}
              description={t("prefs.downloads.proxy-url-description")}
            >
              <TextField
                aria-label={t("prefs.downloads.proxy-url")}
                placeholder="http://127.0.0.1:8080"
                value={setting("proxy_url") ?? ""}
                onChange={(value) => updateSetting("proxy_url", value.trim() || null)}
              />
              <Button
                variant="outline"
                disabled={testing() === "busy" || !setting("proxy_url")}
                onClick={() => void testProxy()}
              >
                {testing() === "busy" ? t("prefs.testing") : t("prefs.test")}
              </Button>
            </SettingRow>
            <ToggleRow
              label={t("prefs.downloads.proxy-games")}
              description={t("prefs.downloads.proxy-games-description")}
              checked={setting("proxy_apply_to_games")}
              onChange={(value) => updateSetting("proxy_apply_to_games", value)}
            />
            <Show when={testing() === "ok"}>
              <Callout tone="success" icon="icons/controls/success">
                {t("prefs.downloads.proxy-ok")}
              </Callout>
            </Show>
            <Show when={testing() === "failed"}>
              <Callout tone="danger">{t("prefs.downloads.proxy-failed")}</Callout>
            </Show>
          </Reveal>
          <Callout icon="icons/actions/refresh">{t("prefs.downloads.proxy-restart")}</Callout>
        </Show>
      </Card>
    </>
  );
}
