import { Button } from "@vesta/ui";
import { invoke } from "@tauri-apps/api/core";
import { nativeInstances, nativeRecord, performNative, reportInstanceError } from "../../../features/instances/native-service";
import { instanceSlug } from "../../../features/instances/native-model";
import { parseNativeCrash } from "../../../features/instances/native-details-model";
import { For, Show, createSignal, createEffect, onCleanup } from "solid-js";
import { navigate } from "../../../app/router";
import {
  clearInstanceCrash,
  type InstanceEntry,
} from "../../../features/instances/catalog";
import { t } from "../../../localization";
import "./crash-tab.css";

const fixtureReport = `---- Minecraft Crash Report ----
Description: Exception in server tick loop

java.lang.OutOfMemoryError: Java heap space
\tat net.minecraft.world.level.chunk.PalettedContainer.<init>(PalettedContainer.java:84)
\tat net.minecraft.world.level.chunk.LevelChunkSection.<init>(LevelChunkSection.java:31)
\tat net.minecraft.server.level.ChunkMap.lambda$scheduleChunkLoad$14(ChunkMap.java:612)`;

/** Same hierarchy as the original: diagnosis, suggested fixes, then supporting evidence. */
export function CrashTab(props: { entry: InstanceEntry }) {
  const [copyStatus, setCopyStatus] = createSignal("");
  const id = () => props.entry.instance.id;
  const details = () => parseNativeCrash(nativeRecord(id())?.crashDetails);
  const [fileReport, setFileReport] = createSignal('');
  let revision = 0;
  onCleanup(() => { revision++; });
  createEffect(() => nativeInstances ? details().report_path : undefined, (path) => {
    const current = ++revision;
    setFileReport('');
    if (path) void invoke<string[]>('read_specific_log_file', { path }).then((lines) => {
      if (current === revision) setFileReport(lines.join('\n'));
    }).catch((reason) => { if (current === revision) reportInstanceError(reason); });
  });
  const report = () => nativeInstances ? fileReport() || details().evidence || details().message || '' : fixtureReport;
  const openReport = () => { const path = details().report_path; return performNative(id(), (record) => invoke('open_crash_report', { instanceIdSlug: instanceSlug(record.name), path })); };
  const share = () => { const crashId = details().crash_id; return performNative(id(), async (record) => {
    const result = await invoke<{url:string}>('upload_crash_to_mclogs', { instanceIdSlug: instanceSlug(record.name), crashId });
    setCopyStatus(result.url);
  }); };
  const summary = () =>
    props.entry.state.kind === "crashed"
      ? props.entry.state.summary
      : undefined;
  const memory = () => summary()?.includes("OutOfMemoryError");
  const clear = async () => {
    const instanceId = id();
    const cleared = await clearInstanceCrash(instanceId);
    if (cleared !== false) navigate(`/library/${instanceId}`);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report());
      setCopyStatus(t("crash.report-copied"));
    } catch {
      setCopyStatus(t("crash.report-copy-failed"));
    }
  };
  return (
    <div data-vesta="crash">
      <header data-vesta="crash-summary">
        <div>
          <p data-vesta="crash-category">
            {t(memory() ? "crash.memory-category" : "crash.game-category")}<Show when={!nativeInstances}> · {t("crash.last-launch-exit-code", { code: 1 })}</Show>
          </p>
          <h2>
            {memory()
              ? t("crash.out-of-memory-title")
              : t("crash.unexpected-stop-title")}
          </h2>
          <p>{summary()}</p>
        </div>
        <div data-vesta="crash-actions">
          <Button size="sm" variant="outline" disabled={!nativeInstances} onClick={() => void share()}>
            {t("crash.share-log")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void clear()}
          >
            {t("crash.clear")}
          </Button>
        </div>
      </header>
      <div data-vesta="crash-grid">
        <section data-vesta="crash-fixes">
          <h3>{t("crash.suggested-fixes")}</h3>
          <ol>
            <Show when={nativeInstances && details().suggested_fixes?.length} fallback={<Show
              when={memory()}
              fallback={
                <li>
                  {t("crash.inspect-console")}
                </li>
              }
            >
              <li>
                {t("crash.increase-memory")}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/library/${id()}/settings`)}
                >
                  {t("crash.open-instance-settings")}
                </Button>
              </li>
              <li>{t("crash.close-applications")}</li>
            </Show>}>
              <For each={details().suggested_fixes ?? []}>{(fix) => <li>{fix}</li>}</For>
            </Show>
          </ol>
          <p data-vesta="crash-note">
            {t("crash.analysis-note")}
          </p>
        </section>
        <section data-vesta="crash-evidence">
          <header>
            <h3>{t("crash.log-excerpt")}</h3>
            <Button size="sm" variant="ghost" onClick={() => void copy()}>
              {t("crash.copy-report")}
            </Button>
          </header>
          <pre data-vesta="crash-report">{report()}</pre>
          <div data-vesta="crash-actions">
            <Button size="sm" variant="outline" disabled={!nativeInstances || !details().report_path} onClick={() => void openReport()}>
              {t("crash.open-file")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`/library/${id()}/console`)}
            >
              {t("crash.view-full-log")}
            </Button>
            <span role="status">{copyStatus()}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
