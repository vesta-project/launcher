import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "@vesta/ui";
import { createEffect, createSignal, onSettled, untrack } from "solid-js";
import { navigate } from "../../app/router";
import { t } from "../../localization";
import { accountsLoaded } from "../accounts/accounts";
import { instanceSlug } from "./native-model";
import {
  instanceError,
  instancesLoaded,
  launchNativeInstance,
  nativeInstances,
  nativeRecords,
} from "./native-service";
import {
  parseInstanceShortcutArgs,
  type InstanceShortcutIntent,
  type QueuedShortcutIntent,
} from "./shortcut-intent-model";

/** Subscribe before marking the frontend ready; retain cold-start intents until identity data loads. */
export function useInstanceShortcutRuntime() {
  if (!nativeInstances) return;
  const [queue, setQueue] = createSignal<InstanceShortcutIntent[]>([], {
    name: "instanceShortcutIntents",
  });
  let disposed = false;
  let processing = false;
  const receive = (intents: QueuedShortcutIntent[]) => {
    if (disposed) return;
    const incoming = intents.flatMap((intent) =>
      intent.type === "argv" ? parseInstanceShortcutArgs(intent.args) : [],
    );
    if (incoming.length) setQueue((current) => [...current, ...incoming]);
  };
  onSettled(() => {
    let stop: (() => void) | undefined;
    void (async () => {
      const unsubscribe = await listen<QueuedShortcutIntent[]>(
        "core://handle-launch-intents",
        (event) => receive(event.payload),
      );
      if (disposed) {
        unsubscribe();
        return;
      }
      stop = unsubscribe;
      receive(await invoke<QueuedShortcutIntent[]>("consume_pending_intents"));
      if (!disposed) await invoke("signal_frontend_ready");
    })().catch((reason) => {
      if (!disposed)
        toast.show({
          title: t("instance-actions.intent-failed"),
          description: String(reason),
          tone: "danger",
        });
    });
    return () => {
      disposed = true;
      stop?.();
    };
  });
  createEffect(
    () => ({ ready: instancesLoaded(), accountsReady: accountsLoaded(), intents: queue() }),
    ({ ready, accountsReady, intents }) => {
      if (!ready || !intents.length || processing || disposed) return;
      // Opening details does not require account loading; direct launch does.
      if (intents[0].launch && !accountsReady) return;
      processing = true;
      let consumed = 0;
      // External requests launch once. They never use the card's launch/stop toggle.
      void (async () => {
        try {
          for (const intent of intents) {
            if (disposed || (intent.launch && !accountsReady)) return;
            consumed++;
            const matches = untrack(nativeRecords).filter(
              (item) => instanceSlug(item.name) === intent.slug,
            );
            // Never choose an arbitrary instance when legacy slug identities collide.
            const record = matches.length === 1 ? matches[0] : undefined;
            if (!record) {
              toast.show({
                title: t("instance.not-found"),
                description: intent.slug,
                tone: "danger",
              });
              continue;
            }
            navigate(`/library/${record.id}`);
            if (
              intent.launch &&
              !(await launchNativeInstance(String(record.id))) &&
              instanceError()
            ) {
              toast.show({
                title: t("instance-actions.intent-failed"),
                description: instanceError(),
                tone: "danger",
              });
            }
          }
        } catch (reason) {
          if (!disposed)
            toast.show({
              title: t("instance-actions.intent-failed"),
              description: String(reason),
              tone: "danger",
            });
        } finally {
          processing = false;
          if (!disposed && consumed) setQueue((current) => current.slice(consumed));
        }
      })();
    },
  );
}
