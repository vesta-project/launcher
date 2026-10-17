import { Button, Slider } from "@vesta/ui";
import { Show, createSignal } from "solid-js";
import { t, formatNumber } from "../../localization";
import {
  clampManualMemoryRange,
  getManualMemoryLimitMb,
  getMemoryWarningThresholdMb,
  type MemoryRecommendation,
} from "../../features/installation/memory-policy";

/** Original install memory model: selected/default comparison, then opt-in editing. */
export function InstallMemoryCard(props: {
  value: number[];
  onChange: (value: number[]) => void;
  recommendation: MemoryRecommendation;
  manual: boolean;
  modpack: boolean;
  modCount?: number;
  systemMemory?: number;
  disabled: boolean;
}) {
  const [editing, setEditing] = createSignal(false, { name: "installMemoryEditing" });
  const [unit, setUnit] = createSignal<"MB" | "GB">("MB", { name: "installMemoryUnit" });
  const format = (mb: number) =>
    `${formatNumber(unit() === "MB" ? mb : mb / 1024, { maximumFractionDigits: unit() === "MB" ? 0 : 1 })} ${unit()}`;
  const compact = (mb: number) =>
    mb >= 1024
      ? `${formatNumber(mb / 1024, { maximumFractionDigits: 1 })} GB`
      : `${formatNumber(mb)} MB`;
  const suggested = () =>
    props.modpack
      ? Math.min(props.recommendation.policyMax, props.recommendation.generatedLimit)
      : props.recommendation.preferredMax;
  const high = () =>
    !!props.systemMemory && props.value[1] >= getMemoryWarningThresholdMb(props.systemMemory);
  const reason = () => {
    if (props.manual) return t("install.memory-manual");
    const recommendation = props.recommendation;
    if (recommendation.adjustment === "high-for-device") {
      if (recommendation.source === "modpack")
        return t(
          recommendation.policyMax > recommendation.generatedLimit
            ? "install.memory-pack-clamped"
            : "install.memory-pack-high",
        );
      if (recommendation.source === "mod-count")
        return t(
          recommendation.policyMax > recommendation.generatedLimit
            ? "install.memory-suggestion-clamped"
            : "install.memory-raised-high",
        );
      return t("install.memory-default-high");
    }
    if (recommendation.source === "modpack") return t("install.pack-memory");
    if (recommendation.adjustment === "increased")
      return props.modCount
        ? t("install.memory-raised-count", { count: props.modCount })
        : t("install.memory-raised");
    return t("install.memory-default-reason");
  };
  const preset = (max: number) => {
    const value = clampManualMemoryRange(
      { min: Math.min(props.value[0], max), max },
      props.systemMemory ?? 0,
    );
    props.onChange([value.min, value.max]);
  };
  return (
    <section data-vesta="install-memory-card" data-editing={editing() ? "" : undefined}>
      <header>
        <div>
          <h2>{t("instance-settings.memory")}</h2>
          <p>{reason()}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditing(!editing())}
          disabled={props.disabled}
          aria-expanded={editing() ? "true" : "false"}
        >
          {t(editing() ? "install.hide-controls" : "common.edit")}
        </Button>
      </header>
      <Show
        when={editing()}
        fallback={
          <div data-vesta="memory-comparison">
            <div data-selected>
              <span>{t("install.selected-max")}</span>
              <button
                type="button"
                title={t("install.toggle-memory-unit")}
                aria-label={t("install.toggle-memory-unit")}
                onClick={() => setUnit(unit() === "MB" ? "GB" : "MB")}
              >
                {format(props.value[1])}
              </button>
            </div>
            <div>
              <span>
                {t(props.modpack ? "install.suggested-memory" : "install.default-memory")}
              </span>
              <strong>{compact(suggested())}</strong>
            </div>
          </div>
        }
      >
        <div data-vesta="memory-controls">
          <div data-vesta="memory-readout">
            <span>{t("install.memory-min", { amount: format(props.value[0]) })}</span>
            <strong>{t("install.memory-max", { amount: format(props.value[1]) })}</strong>
          </div>
          <Slider
            value={props.value}
            onChange={props.onChange}
            min={512}
            max={getManualMemoryLimitMb(props.systemMemory ?? 0)}
            step={512}
            showValue={false}
            aria-label-thumbs={[
              t("instance-settings.memory-start"),
              t("instance-settings.memory-limit"),
            ]}
            disabled={props.disabled}
          />
          <div data-vesta="memory-presets">
            <Button
              size="sm"
              variant="outline"
              disabled={props.disabled}
              onClick={() => preset(props.recommendation.preferredMax)}
            >
              {t("install.default-preset", { amount: compact(props.recommendation.preferredMax) })}
            </Button>
            <Show when={props.modpack}>
              <Button
                size="sm"
                variant="outline"
                disabled={props.disabled}
                onClick={() => preset(suggested())}
              >
                {t("install.suggested-preset", { amount: compact(suggested()) })}
              </Button>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={high()}>
        <p data-vesta="memory-warning" role="status">
          {t("install.memory-warning")}
        </p>
      </Show>
    </section>
  );
}
