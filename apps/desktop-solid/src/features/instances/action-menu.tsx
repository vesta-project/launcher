import {
  Button,
  ContextMenuItem,
  ContextMenuSeparator,
  Dialog,
  MenuItem,
  MenuSeparator,
  toast,
} from "@vesta/ui";
import { For, Show, createSignal, createMemo, untrack } from "solid-js";
import { Icon } from "../../components/icon";
import { navigate } from "../../app/router";
import { t } from "../../localization";
import type { MessageId } from "../../localization/messages";
import { togglePin } from "./catalog";
import type { InstanceCardActions, InstanceCardData, InstanceCardState } from "./instance-card";
import { requestNativeExport } from "./native-export-dialog";
import { createInstanceShortcut, copyInstanceLink } from "./shortcuts";
import {
  nativeInstances,
  instancePending,
  instanceError,
  openNativeInstanceFolder,
  openNativeLogsFolder,
  repairNativeInstance,
  duplicateNativeInstance,
  resetNativeInstance,
  deleteNativeInstance,
} from "./native-service";

const [confirmation, setConfirmation] = createSignal<{ id: string; kind: "reset" | "delete" }>();
const [confirming, setConfirming] = createSignal(false);

/** Report command failures through the same toast surface as shortcut creation. */
async function run(result: Promise<boolean>) {
  if (!(await result)) {
    const error = instanceError();
    if (error) toast.show({ title: t("management.error"), description: error, tone: "danger" });
  }
}

/** One action list for the instance header and library context menu. */
export function InstanceActionItems(
  props: InstanceCardActions & {
    instance: InstanceCardData;
    state?: InstanceCardState;
    pending?: boolean;
    context?: boolean;
  },
) {
  const Item = untrack(() => props.context) ? ContextMenuItem : MenuItem;
  const Separator = untrack(() => props.context) ? ContextMenuSeparator : MenuSeparator;
  const id = () => props.instance.id;
  const busy = () =>
    !!props.pending ||
    instancePending(id()) ||
    ["installing", "warming"].includes(props.state?.kind ?? "");
  const locked = () => busy() || props.state?.kind === "running";
  const open = (tab = "") => navigate(`/library/${id()}${tab ? `/${tab}` : ""}`);
  const actions = createMemo(
    (): {
      label: MessageId;
      icon: string;
      disabled?: boolean;
      onSelect: () => void;
      group: number;
      danger?: boolean;
    }[] => [
      {
        label: "instance-actions.details",
        icon: "icons/rail/library",
        group: 0,
        onSelect: () => (props.onOpen ? props.onOpen() : open()),
      },
      ...(props.onOpenStandalone
        ? [
            {
              label: "instance-actions.new-window" as const,
              icon: "icons/actions/external-link",
              group: 0,
              onSelect: props.onOpenStandalone,
            },
          ]
        : []),
      {
        label: "instance-actions.content",
        icon: "icons/actions/add",
        group: 0,
        onSelect: () => (props.onAddContent ? props.onAddContent() : open("resources")),
      },
      {
        label: "instance.open-folder",
        icon: "icons/content/folder",
        group: 0,
        disabled: busy() || (!nativeInstances && !props.onOpenFolder),
        onSelect: () =>
          props.onOpenFolder ? props.onOpenFolder() : void run(openNativeInstanceFolder(id())),
      },
      {
        label: props.instance.pinned ? "instance-actions.unpin" : "instance-actions.pin",
        icon: props.instance.pinned ? "icons/actions/unpin" : "icons/actions/pin",
        group: 1,
        onSelect: () => (props.onTogglePin ? props.onTogglePin() : togglePin(id())),
      },
      {
        label: "instance-actions.desktop-launch",
        icon: "icons/actions/desktop-add",
        group: 1,
        disabled: !nativeInstances || busy(),
        onSelect: () => void createInstanceShortcut(id(), true),
      },
      {
        label: "instance-actions.desktop-page",
        icon: "icons/actions/desktop-add",
        group: 1,
        disabled: !nativeInstances || busy(),
        onSelect: () => void createInstanceShortcut(id(), false),
      },
      {
        label: "instance-actions.copy-link",
        icon: "icons/content/link",
        group: 1,
        disabled: !nativeInstances || busy(),
        onSelect: () => void copyInstanceLink(id()),
      },
      {
        label: "instance-actions.logs",
        icon: "icons/content/folder",
        group: 2,
        disabled: !nativeInstances || busy(),
        onSelect: () => void run(openNativeLogsFolder(id())),
      },
      ...(props.state?.kind === "crashed"
        ? [
            {
              label: "instance-actions.crash" as const,
              icon: "icons/status/error",
              group: 2,
              onSelect: () => (props.onOpenCrash ? props.onOpenCrash() : open("crash")),
            },
          ]
        : []),
      {
        label: "instance-settings.repair",
        icon: "icons/actions/refresh",
        group: 3,
        disabled: locked() || (!nativeInstances && !props.onRepair),
        onSelect: () => (props.onRepair ? props.onRepair() : void run(repairNativeInstance(id()))),
      },
      {
        label: "instance-settings.duplicate",
        icon: "icons/actions/duplicate",
        group: 3,
        disabled: locked() || (!nativeInstances && !props.onDuplicate),
        onSelect: () =>
          props.onDuplicate ? props.onDuplicate() : void run(duplicateNativeInstance(id())),
      },
      {
        label: "instance-settings.export",
        icon: "icons/actions/upload",
        group: 3,
        disabled: locked() || (!nativeInstances && !props.onExport),
        onSelect: () => (props.onExport ? props.onExport() : void run(requestNativeExport(id()))),
      },
      {
        label: "instance-settings.reset-action",
        icon: "icons/actions/reload",
        group: 4,
        danger: true,
        disabled: locked() || (!nativeInstances && !props.onHardReset),
        onSelect: () =>
          props.onHardReset ? props.onHardReset() : setConfirmation({ id: id(), kind: "reset" }),
      },
      {
        label: "common.delete",
        icon: "icons/actions/delete",
        group: 4,
        danger: true,
        disabled: locked() || (!nativeInstances && !props.onUninstall),
        onSelect: () =>
          props.onUninstall ? props.onUninstall() : setConfirmation({ id: id(), kind: "delete" }),
      },
    ],
    { name: "instanceMenuActions" },
  );
  return (
    <For each={actions()} keyed={(action) => action.label}>
      {(action, index) => (
        <>
          <Show when={index() > 0 && actions()[index() - 1]?.group !== action().group}>
            <Separator />
          </Show>
          <Item
            icon={<Icon name={action().icon} />}
            tone={action().danger ? "danger" : "neutral"}
            disabled={action().disabled}
            onSelect={action().onSelect}
          >
            {t(action().label)}
          </Item>
        </>
      )}
    </For>
  );
}

/** Mounted outside menu portals so destructive confirmations survive menu dismissal. */
export function InstanceActionDialogs() {
  const deleting = () => confirmation()?.kind === "delete";
  const close = () => {
    if (!confirming()) setConfirmation(undefined);
  };
  const confirm = async () => {
    const current = confirmation();
    if (!current || confirming()) return;
    setConfirming(true);
    try {
      const success = await (current.kind === "delete"
        ? deleteNativeInstance(current.id)
        : resetNativeInstance(current.id));
      if (success) {
        setConfirmation(undefined);
        if (current.kind === "delete") navigate("/library");
      } else if (instanceError())
        toast.show({ title: t("management.error"), description: instanceError(), tone: "danger" });
    } finally {
      setConfirming(false);
    }
  };
  return (
    <Dialog
      size="sm"
      open={!!confirmation()}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t(deleting() ? "instance-settings.delete-title" : "instance-settings.reset-title")}
      description={t(
        deleting()
          ? "instance-settings.delete-confirm-description"
          : "instance-settings.reset-confirm-description",
      )}
      footer={
        <>
          <Button variant="ghost" disabled={confirming()} onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button tone="danger" disabled={confirming()} onClick={() => void confirm()}>
            {t(deleting() ? "common.delete" : "instance-settings.reset-action")}
          </Button>
        </>
      }
    />
  );
}
