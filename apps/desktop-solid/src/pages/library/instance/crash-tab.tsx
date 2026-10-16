import { Button } from "@vesta/ui";
import { Show, createSignal } from "solid-js";
import { navigate } from "../../../app/router";
import {
  clearInstanceCrash,
  type InstanceEntry,
} from "../../../features/instances/fixtures";
import { t } from "../../../localization";
import "./crash-tab.css";

const report = `---- Minecraft Crash Report ----
Description: Exception in server tick loop

java.lang.OutOfMemoryError: Java heap space
\tat net.minecraft.world.level.chunk.PalettedContainer.<init>(PalettedContainer.java:84)
\tat net.minecraft.world.level.chunk.LevelChunkSection.<init>(LevelChunkSection.java:31)
\tat net.minecraft.server.level.ChunkMap.lambda$scheduleChunkLoad$14(ChunkMap.java:612)`;

/** Same hierarchy as the original: diagnosis, suggested fixes, then supporting evidence. */
export function CrashTab(props: { entry: InstanceEntry }) {
  const [copyStatus, setCopyStatus] = createSignal("");
  const id = () => props.entry.instance.id;
  const summary = () =>
    props.entry.state.kind === "crashed"
      ? props.entry.state.summary
      : undefined;
  const memory = () => summary()?.includes("OutOfMemoryError");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
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
            {t(memory() ? "crash.memory-category" : "crash.game-category")} · {t("crash.last-launch-exit-code", { code: 1 })}
          </p>
          <h2>
            {memory()
              ? t("crash.out-of-memory-title")
              : t("crash.unexpected-stop-title")}
          </h2>
          <p>{summary()}</p>
        </div>
        <div data-vesta="crash-actions">
          <Button size="sm" variant="outline" disabled>
            {t("crash.share-log")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearInstanceCrash(id());
              navigate(`/library/${id()}`);
            }}
          >
            {t("crash.clear")}
          </Button>
        </div>
      </header>
      <div data-vesta="crash-grid">
        <section data-vesta="crash-fixes">
          <h3>{t("crash.suggested-fixes")}</h3>
          <ol>
            <Show
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
          <pre data-vesta="crash-report">{report}</pre>
          <div data-vesta="crash-actions">
            <Button size="sm" variant="outline" disabled>
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
