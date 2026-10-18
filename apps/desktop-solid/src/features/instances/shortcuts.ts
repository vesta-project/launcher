import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "@vesta/ui";
import { t } from "../../localization";
import { instanceSlug } from "./native-model";
import { instanceError, performNative } from "./native-service";

export interface ShortcutCreationResult {
  shortcutPath: string;
  iconPath: string | null;
  iconApplied: boolean;
  warnings: string[];
}

export async function createInstanceShortcut(id: string, launch: boolean) {
  const success = await performNative(
    id,
    async (record) => {
      const result = await invoke<ShortcutCreationResult>("create_desktop_shortcut", {
        name: `${record.name} (${t(launch ? "instance-actions.shortcut-launch" : "instance-actions.shortcut-page")})`,
        target: {
          kind: launch ? "launch-instance" : "open-instance",
          slug: instanceSlug(record.name),
        },
        iconSource: record.iconPath || record.modpackIconUrl,
      });
      toast.show({
        title: t("instance-actions.shortcut-created"),
        description: result.warnings.join("\n") || result.shortcutPath,
        tone: result.warnings.length ? "warning" : "success",
      });
    },
    false,
  );
  if (!success && instanceError())
    toast.show({
      title: t("instance-actions.shortcut-failed"),
      description: instanceError(),
      tone: "danger",
    });
}

export async function copyInstanceLink(id: string) {
  const success = await performNative(
    id,
    async (record) => {
      await writeText(
        `vesta://open-instance?slug=${encodeURIComponent(instanceSlug(record.name))}`,
      );
      toast.show({ title: t("instance-actions.link-copied"), tone: "success" });
    },
    false,
  );
  if (!success && instanceError())
    toast.show({ title: t("management.error"), description: instanceError(), tone: "danger" });
}
