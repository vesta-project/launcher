/** Pure window effect request model: no DOM, native API or settings dependency. */
export type Scheme = "light" | "dark";
/** What the native window should show: an effect name plus the scheme Mica/acrylic follow. */
export interface WindowEffectRequest {
  effect: string;
  scheme: Scheme;
}

/** Desired/applied identity. The scheme is part of it: a light/dark switch must reapply Mica. */
export const windowEffectKey = (request: WindowEffectRequest) => `${request.effect}:${request.scheme}`;

/** The effect actually requested: unsupported, or reduced transparency, falls back to solid. */
export function resolveWindowEffect(requested: string, supportedEffects: readonly string[], reducedTransparency: boolean): string {
  if (reducedTransparency) return "none";
  return supportedEffects.includes(requested) ? requested : "none";
}

/**
 * Serialized native application. Requests are coalesced: only the latest desired request is
 * applied after the in-flight call settles, and the root hook publishes the applied result.
 * On failure the root falls back to the solid "none" painting (native side clears the effect).
 */
export function createWindowEffectDrain(options: {
  apply: (request: WindowEffectRequest) => Promise<unknown>;
  publish: (effect: string) => void;
  disposed: () => boolean;
}) {
  let desired: WindowEffectRequest = { effect: "none", scheme: "dark" };
  let appliedKey: string | undefined;
  let active = false;
  let current: Promise<void> = Promise.resolve();
  const drain = async () => {
    try {
      while (!options.disposed() && appliedKey !== windowEffectKey(desired)) {
        const request = desired;
        const key = windowEffectKey(request);
        try {
          await options.apply(request);
          appliedKey = key;
          if (!options.disposed()) options.publish(request.effect);
        } catch {
          // A failed request is not retried until something changes.
          appliedKey = key;
          if (!options.disposed()) options.publish("none");
        }
      }
    } finally {
      active = false;
    }
  };
  return {
    request(next: WindowEffectRequest): Promise<void> {
      desired = next;
      // The drain may finish synchronously (nothing to do), so track activity, not the promise.
      if (!active) {
        active = true;
        current = drain();
      }
      return current;
    },
  };
}
