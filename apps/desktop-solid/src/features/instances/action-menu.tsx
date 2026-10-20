import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  MenuItem,
  MenuSeparator,
  MenuSub,
  toast,
} from "@vesta/ui";
import { For, Show, untrack } from "solid-js";
import { Icon } from "../../components/icon";
import { navigate } from "../../app/router";
import { t } from "../../localization";
import { togglePin } from "./catalog";
import type { InstanceCardActions, InstanceCardData, InstanceCardState } from "./instance-card";
import { requestNativeExport } from "./native-export-dialog";
import { requestInstanceDelete } from "./delete-dialog";
import { createInstanceShortcut, copyInstanceLink } from "./shortcuts";
import {
  nativeInstances,
  instancePending,
  instanceError,
  openNativeInstanceFolder,
  openNativeLogsFolder,
  duplicateNativeInstance,
} from "./native-service";

/** Report command failures through the same toast surface as shortcut creation. */
async function run(result: Promise<boolean>) {
  if (!(await result)) {
    const error = instanceError();
    if (error) toast.show({ title: t("management.error"), description: error, tone: "danger" });
  }
}

/**
 * Library arranging without dragging, for the library card's context menu. The library page
 * supplies it; the instance header has no library position, so it leaves it out.
 */
export interface InstanceArrangeActions {
  canMoveEarlier: () => boolean;
  canMoveLater: () => boolean;
  moveEarlier: () => void;
  moveLater: () => void;
  /** Groups this instance could move into, excluding its own. */
  groups: () => { id: string; name: string }[];
  /** The group the instance is in, or null at the top level. */
  group: () => string | null;
  moveToGroup: (id: string | null) => void;
  newGroup: () => void;
  moveWithKeyboard: () => void;
  arrangeLibrary: () => void;
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
  const Sub = untrack(() => props.context) ? ContextMenuSub : MenuSub;
  return (
    <>
      <Show when={props.context}>
        <Item icon={<Icon name="icons/rail/library" />} onSelect={() => props.onOpen ? props.onOpen() : open()}>
          {t("instance-actions.details")}
        </Item>
        <Item icon={<Icon name="icons/rail/settings" />} onSelect={() => open("settings")}>
          {t("instance.settings")}
        </Item>
      </Show>
      <Show when={props.onOpenStandalone}>
        <Item icon={<Icon name="icons/actions/external-link" />} onSelect={() => props.onOpenStandalone?.()}>
          {t("instance-actions.new-window")}
        </Item>
      </Show>
      <Item icon={<Icon name="icons/actions/add" />} onSelect={() => props.onAddContent ? props.onAddContent() : navigate(`/browse/for/${id()}`)}>
        {t("instance-actions.content")}
      </Item>
      <Sub label={t("instance-actions.folders")} icon={<Icon name="icons/content/folder" />}>
        <Item disabled={busy() || (!nativeInstances && !props.onOpenFolder)} onSelect={() => props.onOpenFolder ? props.onOpenFolder() : void run(openNativeInstanceFolder(id()))}>
          {t("instance.open-folder")}
        </Item>
        <Item disabled={!nativeInstances || busy()} onSelect={() => void run(openNativeLogsFolder(id()))}>
          {t("instance-actions.logs")}
        </Item>
      </Sub>
      <Show when={props.context ? props.arrange : undefined}>
        {(arrange) => (
          <>
            <Separator />
            <Item icon={<Icon name="icons/navigation/arrow-back" />} disabled={!arrange().canMoveEarlier()} onSelect={() => arrange().moveEarlier()}>
              {t("library.move-earlier")}
            </Item>
            <Item icon={<Icon name="icons/navigation/arrow-forward" />} disabled={!arrange().canMoveLater()} onSelect={() => arrange().moveLater()}>
              {t("library.move-later")}
            </Item>
            <Sub label={t("library.move-to-group")} icon={<Icon name="icons/content/folder" />}>
              <Show when={arrange().group()}>
                <Item onSelect={() => arrange().moveToGroup(null)}>{t("library.remove-from-group")}</Item>
              </Show>
              <For each={arrange().groups()}>
                {(group) => <Item onSelect={() => arrange().moveToGroup(group.id)}>{group.name}</Item>}
              </For>
              <Item icon={<Icon name="icons/actions/add" />} onSelect={() => arrange().newGroup()}>
                {t("library.new-group-with")}
              </Item>
            </Sub>
            <Item icon={<Icon name="icons/content/keyboard" />} onSelect={() => arrange().moveWithKeyboard()}>{t("library.move-keyboard")}</Item>
            <Item icon={<Icon name="icons/actions/move" />} onSelect={() => arrange().arrangeLibrary()}>{t("library.arrange")}</Item>
          </>
        )}
      </Show>
      <Show when={props.state?.kind === "crashed"}>
        <Item icon={<Icon name="icons/status/error" />} onSelect={() => props.onOpenCrash ? props.onOpenCrash() : open("crash")}>
          {t("instance-actions.crash")}
        </Item>
      </Show>
      <Separator />
      <Item icon={<Icon name={props.instance.pinned ? "icons/actions/unpin" : "icons/actions/pin"} />} onSelect={() => props.onTogglePin ? props.onTogglePin() : togglePin(id())}>
        {t(props.instance.pinned ? "instance-actions.unpin" : "instance-actions.pin")}
      </Item>
      <Sub label={t("instance-actions.desktop")} icon={<Icon name="icons/actions/desktop-add" />} disabled={!nativeInstances || busy()}>
        <Item onSelect={() => void createInstanceShortcut(id(), true)}>{t("instance-actions.desktop-launch-short")}</Item>
        <Item onSelect={() => void createInstanceShortcut(id(), false)}>{t("instance-actions.desktop-page-short")}</Item>
      </Sub>
      <Item icon={<Icon name="icons/content/link" />} disabled={!nativeInstances || busy()} onSelect={() => void copyInstanceLink(id())}>
        {t("instance-actions.copy-link")}
      </Item>
      <Separator />
      <Item icon={<Icon name="icons/actions/duplicate" />} disabled={locked() || (!nativeInstances && !props.onDuplicate)} onSelect={() => props.onDuplicate ? props.onDuplicate() : void run(duplicateNativeInstance(id()))}>
        {t("instance-settings.duplicate")}
      </Item>
      <Item icon={<Icon name="icons/actions/upload" />} disabled={locked() || (!nativeInstances && !props.onExport)} onSelect={() => props.onExport ? props.onExport() : void run(requestNativeExport(id()))}>
        {t("instance-settings.export")}
      </Item>
      <Separator />
      <Item icon={<Icon name="icons/actions/delete" />} tone="danger" disabled={locked()} onSelect={() => requestInstanceDelete(id())}>
        {t("instance-settings.delete-action")}
      </Item>
    </>
  );
}
