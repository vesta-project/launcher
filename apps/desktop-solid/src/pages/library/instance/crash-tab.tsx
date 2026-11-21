import { Metadata } from '../../../components/metadata';
import { Button } from "@vesta/ui";
import { invoke } from "@tauri-apps/api/core";
import { nativeInstances, nativeRecord, performNative, reportInstanceError } from "../../../features/instances/native-service";
import { instanceSlug } from "../../../features/instances/native-model";
import { parseNativeCrash } from "../../../features/instances/native-details-model";
import { For, Show, createSignal, createEffect, createMemo, onCleanup } from "solid-js";
import { openExternal } from "../../../features/links/external-links";
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
  const id = () => props.entry.instance.id;
  const record = () => nativeRecord(id());
  const details = createMemo(() => parseNativeCrash(record()?.crashDetails));
  const crashSource = createMemo(() => {
    const name = record()?.name;
    const { crash_id: crashId, report_path: reportPath, log_path: logPath } = details();
    return { key: JSON.stringify([id(), name, crashId, reportPath, logPath]), name, crashId };
  }, { name: "crashSource", equals: (previous, next) => previous.key === next.key });
  const crashKey = () => crashSource().key;
  const [reportFile, setReportFile] = createSignal<{ key: string; text: string | null } | undefined>(undefined, { name: "crashReport" });
  const [uploadedLink, setUploadedLink] = createSignal<{ key: string; url: string } | undefined>(undefined, { name: "crashSharedLink" });
  const [sharingKey, setSharingKey] = createSignal<string | undefined>(undefined, { name: "crashSharing" });
  const [feedback, setFeedback] = createSignal<{ key: string; message: string } | undefined>(undefined, { name: "crashFeedback" });
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const stillCurrent = (key: string) => !disposed && key === crashKey();
  createEffect(crashSource, ({ key, name, crashId }) => {
    if (!nativeInstances || name === undefined) return;
    const args = { instanceIdSlug: instanceSlug(name), crashId };
    void invoke<string>('read_crash_report', args).then((text) => {
      if (stillCurrent(key)) setReportFile({ key, text });
    }).catch(() => {
      if (stillCurrent(key)) setReportFile({ key, text: null });
    });
  });
  const report = () => {
    if (!nativeInstances) return fixtureReport;
    const value = reportFile();
    return value?.key === crashKey() ? value.text || null : undefined;
  };
  const sharedUrl = () => {
    const value = uploadedLink();
    return value?.key === crashKey() ? value.url : details().mclogs_url;
  };
  const sharing = () => sharingKey() === crashKey();
  const openReport = () => { const path = details().report_path; return performNative(id(), (record) => invoke('open_crash_report', { instanceIdSlug: instanceSlug(record.name), path })); };
  const share = async () => {
    if (sharing()) return;
    const key = crashKey();
    const crashId = details().crash_id;
    setSharingKey(key);
    setFeedback(undefined);
    await performNative(id(), async (record) => {
      const result = await invoke<{ url: string }>('upload_crash_to_mclogs', { instanceIdSlug: instanceSlug(record.name), crashId });
      if (stillCurrent(key)) setUploadedLink({ key, url: result.url });
    });
    if (!stillCurrent(key)) return;
    setSharingKey(undefined);
    setFeedback({ key, message: t(sharedUrl() ? "crash.link-ready" : "crash.share-failed") });
  };
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
  const copy = async (text: string | null | undefined, kind: "link" | "report") => {
    if (!text) return;
    const key = crashKey();
    let message: string;
    try {
      await navigator.clipboard.writeText(text);
      message = t(kind === "link" ? "crash.link-copied" : "crash.report-copied");
    } catch {
      message = t(kind === "link" ? "crash.link-copy-failed" : "crash.report-copy-failed");
    }
    if (stillCurrent(key)) setFeedback({ key, message });
  };
  /** Report lines, with the error itself (and its stack) picked out like the console does. */
  const lines = () => (report() ?? '').split('\n').map((text) => ({
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
              <Button size="sm" variant="ghost" disabled={!report()} icon={<Icon name="icons/actions/copy" />} onClick={() => void copy(report(), "report")}>{t("crash.copy-report")}</Button>
              <Button size="sm" variant="ghost" disabled={!nativeInstances || !details().report_path} onClick={() => void openReport()}>{t("crash.open-file")}</Button>
              <Button size="sm" variant="ghost" iconEnd={<Icon name="icons/navigation/arrow-forward" />} onClick={() => navigate(`/library/${id()}/console`, { replace: true })}>{t("crash.view-full-log")}</Button>
            </span>
          </header>
          <Show when={report()} fallback={<p data-vesta="crash-note" role="status">{t(report() === undefined ? "crash.loading-report" : "crash.report-unavailable")}</p>}>
            <pre data-vesta="crash-report"><For each={lines()}>{(line) => <span data-tone={line.tone}>{line.text}{'\n'}</span>}</For></pre>
          </Show>
          <Show when={nativeInstances}>
            <div data-vesta="crash-share">
              <Show when={sharedUrl()}>
                {(url) => <code>{url()}</code>}
              </Show>
              <div data-vesta="crash-share-actions">
                <Button size="sm" variant="outline" disabled={sharing() || (!sharedUrl() && !report())} icon={<Icon name="icons/actions/external-link" />} onClick={() => {
                  const url = sharedUrl();
                  if (url) void openExternal(url).catch(reportInstanceError);
                  else void share();
                }}>{t(sharedUrl() ? "crash.open-shared-log" : sharing() ? "crash.sharing-log" : "crash.share-log")}</Button>
                <Show when={sharedUrl()}>
                  {(url) => <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/copy" />} onClick={() => void copy(url(), "link")}>{t("crash.copy-link")}</Button>}
                </Show>
              </div>
            </div>
          </Show>
          <p data-vesta="crash-status" role="status">{feedback()?.key === crashKey() ? feedback()?.message : ""}</p>
        </section>
      </div>
    </div>
  );
}
