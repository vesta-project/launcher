import { invoke } from "@tauri-apps/api/core";
import type { Instance } from "@utils/instances";
import { createResource } from "solid-js";

type ModpackIconSource = Pick<
	Instance,
	"modpackId" | "modpackPlatform" | "modpackIconUrl"
>;

/**
 * Hydrates the linked modpack project icon from the platform API when DB metadata is missing.
 * Falls back to `modpackIconUrl` from the instance row.
 */
export function useModpackIcon(
	source: () => ModpackIconSource | null | undefined,
) {
	const [hydratedIcon] = createResource(
		() => {
			const current = source();
			if (!current?.modpackId || !current?.modpackPlatform) return null;

			const platform = current.modpackPlatform.toLowerCase();
			if (platform !== "modrinth" && platform !== "curseforge") return null;

			return {
				platform,
				id: current.modpackId,
				cachedUrl: current.modpackIconUrl,
			};
		},
		async (modpackRef) => {
			if (!modpackRef) return null;

			try {
				const records: Array<{
					icon_data?: number[];
					icon_url?: string | null;
				}> = await invoke("get_or_hydrate_resource_projects", {
					refs: [{ platform: modpackRef.platform, id: modpackRef.id }],
					allowNetwork: true,
					refreshStale: false,
				});

				const record = records[0];
				if (record?.icon_url?.startsWith("data:")) {
					return record.icon_url;
				}
				if (!record?.icon_data) return null;

				const blob = new Blob([new Uint8Array(record.icon_data)]);
				return await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result as string);
					reader.onerror = reject;
					reader.readAsDataURL(blob);
				});
			} catch (e) {
				console.error("Failed to fetch modpack icon:", e);
				return null;
			}
		},
	);

	return () => {
		const current = source();
		if (!current?.modpackId || !current?.modpackPlatform) {
			return current?.modpackIconUrl ?? null;
		}

		const platform = current.modpackPlatform.toLowerCase();
		if (platform !== "modrinth" && platform !== "curseforge") {
			return current.modpackIconUrl ?? null;
		}

		return (
			hydratedIcon() ?? (hydratedIcon.loading ? null : current.modpackIconUrl)
		);
	};
}
