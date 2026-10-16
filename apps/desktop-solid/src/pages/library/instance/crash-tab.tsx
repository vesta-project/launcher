import { Button } from "@vesta/ui";
import { Show, createSignal } from "solid-js";
import { navigate } from "../../../app/router";
import {
  clearInstanceCrash,
  type InstanceEntry,
} from "../../../features/instances/fixtures";
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
      setCopyStatus("Report copied");
    } catch {
      setCopyStatus("Could not copy report");
    }
  };
  return (
    <div data-vesta="crash">
      <header data-vesta="crash-summary">
        <div>
          <p data-vesta="crash-category">
            {memory() ? "Memory" : "Game crash"} · Last launch · Exit code 1
          </p>
          <h2>
            {memory()
              ? "The game ran out of memory"
              : "The game stopped unexpectedly"}
          </h2>
          <p>{summary()}</p>
        </div>
        <div data-vesta="crash-actions">
          <Button size="sm" variant="outline" disabled>
            Share log
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearInstanceCrash(id());
              navigate(`/library/${id()}`);
            }}
          >
            Clear crash
          </Button>
        </div>
      </header>
      <div data-vesta="crash-grid">
        <section data-vesta="crash-fixes">
          <h3>Suggested fixes</h3>
          <ol>
            <Show
              when={memory()}
              fallback={
                <li>
                  Open the console and inspect the first error before the stack
                  trace.
                </li>
              }
            >
              <li>
                Increase this instance’s maximum memory allocation.
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/library/${id()}/settings`)}
                >
                  Open instance settings
                </Button>
              </li>
              <li>Close other applications before launching again.</li>
            </Show>
          </ol>
          <p data-vesta="crash-note">
            Suggestions are based on log analysis and may be incomplete.
          </p>
        </section>
        <section data-vesta="crash-evidence">
          <header>
            <h3>Log excerpt</h3>
            <Button size="sm" variant="ghost" onClick={() => void copy()}>
              Copy report
            </Button>
          </header>
          <pre data-vesta="crash-report">{report}</pre>
          <div data-vesta="crash-actions">
            <Button size="sm" variant="outline" disabled>
              Open file
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`/library/${id()}/console`)}
            >
              View full log
            </Button>
            <span role="status">{copyStatus()}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
