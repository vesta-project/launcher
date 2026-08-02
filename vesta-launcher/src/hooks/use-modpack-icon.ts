import { invoke } from "@tauri-apps/api/core";
import type { Instance } from "@utils/instances";
import { createEffect, createSignal, onCleanup } from "solid-js";

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
	const [hydratedIcon, setHydratedIcon] = createSignal<string | null>(null);
	const [hydrating, setHydrating] = createSignal(false);
	let requestGeneration = 0;

	createEffect(() => {
		const current = source();
		const generation = ++requestGeneration;
		setHydratedIcon(null);

		if (!current?.modpackId || !current?.modpackPlatform) {
			setHydrating(false);
			return;
		}

		const platform = current.modpackPlatform.toLowerCase();
		if (platform !== "modrinth" && platform !== "curseforge") {
			setHydrating(false);
			return;
		}

		setHydrating(true);
		void invoke<
			Array<{
				icon_data?: number[];
				icon_url?: string | null;
			}>
		>("get_or_hydrate_resource_projects", {
			refs: [{ platform, id: current.modpackId }],
			allowNetwork: true,
			refreshStale: false,
		})
			.then(async (records) => {
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
			})
			.catch((error) => {
				console.error("Failed to fetch modpack icon:", error);
				return null;
			})
			.then((icon) => {
				if (generation !== requestGeneration) return;
				setHydratedIcon(icon);
				setHydrating(false);
			});
	});

	onCleanup(() => {
		requestGeneration += 1;
	});

	return () => {
		const current = source();
		if (!current?.modpackId || !current?.modpackPlatform) {
			return current?.modpackIconUrl ?? null;
		}

		const platform = current.modpackPlatform.toLowerCase();
		if (platform !== "modrinth" && platform !== "curseforge") {
			return current.modpackIconUrl ?? null;
		}

		return hydratedIcon() ?? (hydrating() ? null : current.modpackIconUrl);
	};
}
