import { invoke, isTauri } from "@tauri-apps/api/core";
import { createEffect, createSignal, onSettled } from "solid-js";
import { setting } from "./config";

interface Capabilities {
  supportedEffects: string[];
}
const [supported, setSupported] = createSignal<string[]>(["none"]);
export const supportedWindowEffects = supported;

/** Native materials belong to this window preference Adapter, never to theme presets. */
export function useWindowEffects() {
  if (typeof window === "undefined" || !isTauri()) return;
  onSettled(() => {
    let disposed = false;
    void invoke<Capabilities>("get_window_effect_capabilities")
      .then((capabilities) => {
        if (!disposed) setSupported(capabilities.supportedEffects);
      })
      .catch(() => {
        /* Keep the solid fallback when capabilities cannot be read. */
      });
    return () => {
      disposed = true;
    };
  });
  let desired = "none";
  let applied: string | undefined;
  let running = false;
  let disposed = false;
  onSettled(() => () => {
    disposed = true;
  });
  const drain = async () => {
    running = true;
    try {
      while (!disposed && applied !== desired) {
        const effect = desired;
        try {
          await invoke("set_window_effect", { effect });
          applied = effect;
          if (!disposed) document.documentElement.dataset.vestaWindowEffect = effect;
        } catch {
          if (!disposed) document.documentElement.dataset.vestaWindowEffect = "none";
          if (desired === effect) break;
        }
      }
    } finally {
      running = false;
    }
  };
  createEffect(
    () => {
      const requested = setting("theme_window_effect");
      return supported().includes(requested) ? requested : "none";
    },
    (effect) => {
      desired = effect;
      if (!running) void drain();
    },
  );
}
