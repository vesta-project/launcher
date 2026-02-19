import type { SourcePlatform } from "@stores/resources";

export interface ParsedResourceUrl {
	platform: SourcePlatform;
	id: string;
	activeTab?: "description" | "versions" | "gallery" | "dependencies";
}

/**
 * Parses a resource URL (Modrinth or CurseForge) into platform and ID/slug.
 * Handles both modern and legacy URL structures.
 */
export function parseResourceUrl(url: string): ParsedResourceUrl | null {
	try {
		const parsedUrl = new URL(url);
		const hostname = parsedUrl.hostname.toLowerCase();
		const pathParts = parsedUrl.pathname.split("/").filter((p) => p);

		// 1. Modrinth
		if (hostname === "modrinth.com" || hostname.endsWith(".modrinth.com")) {
			// URL structure: /<type>/<slug>/[gallery|versions]
			if (pathParts.length >= 2) {
				const [type, slug, tab] = pathParts;
				const validTypes = [
					"mod",
					"resourcepack",
					"shader",
					"datapack",
					"modpack",
				];
				if (validTypes.includes(type)) {
					let activeTab: ParsedResourceUrl["activeTab"];
					if (tab === "gallery") activeTab = "gallery";
					else if (tab === "versions") activeTab = "versions";

					return {
						platform: "modrinth",
						id: slug,
						activeTab,
					};
				}
			}
		}

		// 2. CurseForge (Modern)
		if (hostname === "www.curseforge.com" || hostname === "curseforge.com") {
			// Expected: /minecraft/<type>/<slug>/[gallery|files|files/all]
			if (pathParts.length >= 3 && pathParts[0] === "minecraft") {
				const slug = pathParts[2];
				const subPath = pathParts.slice(3).join("/");
				let activeTab: ParsedResourceUrl["activeTab"];

				if (subPath === "gallery") {
					activeTab = "gallery";
				} else if (subPath.startsWith("files")) {
					activeTab = "versions";
				}

				return {
					platform: "curseforge",
					id: slug,
					activeTab,
				};
			}
		}

		// 3. CurseForge (Legacy/Subdomain)
		// e.g., minecraft.curseforge.com/projects/jei
		if (hostname === "minecraft.curseforge.com") {
			if (pathParts[0] === "projects" && pathParts[1]) {
				return {
					platform: "curseforge",
					id: pathParts[1],
				};
			}
		}

		return null;
	} catch {
		return null;
	}
}
