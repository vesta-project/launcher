import { invoke, isTauri } from "@tauri-apps/api/core";
import { createEffect, createSignal, onSettled } from "solid-js";
import { resolvedScheme } from "../../app/preferences";
import { setting } from "./config";
import { createWindowEffectDrain, resolveWindowEffect } from "./window-effect-model";

export type { Scheme, WindowEffectRequest } from "./window-effect-model";

interface Capabilities {
  supportedEffects: string[];
}
const [supported, setSupported] = createSignal<string[]>(["none"]);
export const supportedWindowEffects = supported;

const reducedTransparencyQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-transparency: reduce)")
    : undefined;
const [reducedTransparency, setReducedTransparency] = createSignal(reducedTransparencyQuery?.matches ?? false);

/** Longest the window waits for the first native effect before it is shown anyway. */
const FIRST_EFFECT_TIMEOUT_MS = 600;

/**
 * Native materials belong to this window preference Adapter, never to theme presets.
 * Returns a promise for the first application of the saved effect (bounded by a timeout), so the
 * window can be presented with its material rather than switching after it appears.
 */
export function useWindowEffects(): Promise<void> {
  if (typeof window === "undefined" || !isTauri()) return Promise.resolve();
  let disposed = false;
  let capabilitiesRead = false;
  let firstApplied!: () => void;
  const first = new Promise<void>((resolve) => { firstApplied = resolve; });
  const timer = setTimeout(firstApplied, FIRST_EFFECT_TIMEOUT_MS);
  const [capabilitiesSettled, setCapabilitiesSettled] = createSignal(false);
  onSettled(() => {
    const onReducedTransparency = (event: MediaQueryListEvent) => setReducedTransparency(event.matches);
    reducedTransparencyQuery?.addEventListener("change", onReducedTransparency);
    void invoke<Capabilities>("get_window_effect_capabilities")
      .then((capabilities) => {
        if (!disposed) setSupported(capabilities.supportedEffects);
      })
      .catch(() => {
        /* Keep the solid fallback when capabilities cannot be read. */
      })
      .finally(() => {
        if (!disposed) setCapabilitiesSettled(true);
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      firstApplied();
      reducedTransparencyQuery?.removeEventListener("change", onReducedTransparency);
    };
  });
  const drain = createWindowEffectDrain({
    // `dark` is optional on the native command; the old frontend omits it.
    apply: ({ effect, scheme }) => invoke("set_window_effect", { effect, dark: scheme === "dark" }),
    publish: (effect) => { document.documentElement.dataset.vestaWindowEffect = effect; },
    disposed: () => disposed,
  });
  createEffect(
    () => ({
      effect: resolveWindowEffect(setting("theme_window_effect"), supported(), reducedTransparency()),
      scheme: resolvedScheme(),
      settled: capabilitiesSettled(),
    }),
    ({ effect, scheme, settled }) => {
      const pending = drain.request({ effect, scheme });
      // Until capabilities are known every request resolves to "none"; wait for the real one.
      if (settled && !capabilitiesRead) {
        capabilitiesRead = true;
        void pending.then(() => { clearTimeout(timer); firstApplied(); });
      }
    },
  );
  return first;
}
