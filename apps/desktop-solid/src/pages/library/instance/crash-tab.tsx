import { Metadata } from '../../../components/metadata';
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
import { Icon } from "../../../components/icon";
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
    if (cleared !== false) navigate(`/library/${instanceId}`, { replace: true });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report());
      setCopyStatus(t("crash.report-copied"));
    } catch {
      setCopyStatus(t("crash.report-copy-failed"));
    }
  };
  /** Report lines, with the error itself (and its stack) picked out like the console does. */
  const lines = () => report().split('\n').map((text) => ({
    text,
    tone: /^-{2,}|^Description:/.test(text) ? 'head' : /(Exception|Error|Caused by)/.test(text) ? 'error' : /^\s+(at |\.\.\. \d+ more)/.test(text) ? 'trace' : undefined,
  }));
  return (
    <div data-vesta="crash">
      {/* What happened, and the one thing most likely to fix it. */}
      <header data-vesta="crash-summary" data-kind={memory() ? 'memory' : 'game'}>
        <span data-vesta="crash-mark" aria-hidden="true"><Icon name={memory() ? 'icons/content/storage' : 'icons/status/bug'} size={26} /></span>
        <div data-vesta="crash-copy">
          <p data-vesta="crash-category">
            <Metadata parts={[t(memory() ? "crash.memory-category" : "crash.game-category"), !nativeInstances ? t("crash.last-launch-exit-code", { code: 1 }) : null]} />
          </p>
          <h2>{memory() ? t("crash.out-of-memory-title") : t("crash.unexpected-stop-title")}</h2>
          <Show when={summary()}><code>{summary()}</code></Show>
        </div>
        <div data-vesta="crash-actions">
          <Button variant="ghost" onClick={() => void clear()}>{t("crash.clear")}</Button>
          <Button variant="outline" disabled={!nativeInstances} icon={<Icon name="icons/actions/external-link" />} onClick={() => void share()}>{t("crash.share-log")}</Button>
          <Show when={memory()}>
            <Button tone="accent" icon={<Icon name="icons/content/sliders" />} onClick={() => navigate(`/library/${id()}/settings`)}>{t("crash.open-instance-settings")}</Button>
          </Show>
        </div>
      </header>

      <div data-vesta="crash-grid">
        <section data-vesta="crash-panel" data-panel="fixes">
          <header data-vesta="crash-panel-head"><h3>{t("crash.suggested-fixes")}</h3></header>
          <ol data-vesta="crash-steps">
            <Show when={nativeInstances && details().suggested_fixes?.length} fallback={
              <Show when={memory()} fallback={<li>{t("crash.inspect-console")}</li>}>
                <li>{t("crash.increase-memory")}</li>
                <li>{t("crash.close-applications")}</li>
              </Show>
            }>
              <For each={details().suggested_fixes ?? []}>{(fix) => <li>{fix}</li>}</For>
            </Show>
          </ol>
          <p data-vesta="crash-note">{t("crash.analysis-note")}</p>
        </section>

        <section data-vesta="crash-panel" data-panel="evidence">
          <header data-vesta="crash-panel-head">
            <h3>{t("crash.log-excerpt")}</h3>
            <span data-vesta="crash-panel-actions">
              <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/copy" />} onClick={() => void copy()}>{t("crash.copy-report")}</Button>
              <Button size="sm" variant="ghost" disabled={!nativeInstances || !details().report_path} onClick={() => void openReport()}>{t("crash.open-file")}</Button>
              <Button size="sm" variant="ghost" iconEnd={<Icon name="icons/navigation/arrow-forward" />} onClick={() => navigate(`/library/${id()}/console`, { replace: true })}>{t("crash.view-full-log")}</Button>
            </span>
          </header>
          <pre data-vesta="crash-report"><For each={lines()}>{(line) => <span data-tone={line.tone}>{line.text}{'\n'}</span>}</For></pre>
          <p data-vesta="crash-status" role="status">{copyStatus()}</p>
        </section>
      </div>
    </div>
  );
}
