import type { SourcePlatform } from "@stores/resources";

export interface ParsedResourceUrl {
	platform: SourcePlatform;
	id: string;
	activeTab?: "description" | "versions" | "gallery";
	versionId?: string;
}

/**
 * Detects and decodes CurseForge linkout URLs.
 */
export function decodeCurseForgeLinkout(url: string): string {
	try {
		const parsed = new URL(url);
		// Detect linkout redirect patterns. Some environments (dev servers, proxies)
		// may rewrite external URLs to a local /linkout endpoint (e.g. localhost:1420/linkout?remoteUrl=...).
		// We treat any path named "/linkout" that carries a `remoteUrl` query param as a redirect wrapper
		// and extract + decode the real destination.
		if (parsed.pathname === "/linkout") {
			const remoteUrl = parsed.searchParams.get("remoteUrl");
			if (remoteUrl) {
				// CurseForge (and some proxies) sometimes double-encode the URL (e.g. %253a instead of %3a)
				// Decode once, then decode again if it still contains percent-escapes.
				let decoded = decodeURIComponent(remoteUrl);
				if (decoded.includes("%")) {
					try {
						decoded = decodeURIComponent(decoded);
					} catch {
						// Ignore double-decode errors and keep the once-decoded value
					}
				}
				return decoded;
			}
		}
	} catch {
		// Fallback to original URL
	}
	return url;
}

/**
 * Parses a resource URL (Modrinth or CurseForge) into platform and ID/slug.
 * Handles both modern and legacy URL structures, as well as CurseForge linkout redirects.
 */
export function parseResourceUrl(url: string): ParsedResourceUrl | null {
	try {
		const decodedUrl = decodeCurseForgeLinkout(url);
		const parsedUrl = new URL(decodedUrl);
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
					let versionId: string | undefined;
					if (tab === "gallery") activeTab = "gallery";
					else if (tab === "versions") activeTab = "versions";
					else if (tab === "version" && pathParts[3]) {
						activeTab = "versions";
						versionId = pathParts[3];
					}

					return {
						platform: "modrinth",
						id: slug,
						activeTab,
						...(versionId ? { versionId } : {}),
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
				let versionId: string | undefined;

				if (subPath === "gallery") {
					activeTab = "gallery";
				} else if (subPath.startsWith("files")) {
					activeTab = "versions";
					const fileId = pathParts[4];
					if (fileId && /^\d+$/.test(fileId)) versionId = fileId;
				}

				return {
					platform: "curseforge",
					id: slug,
					activeTab,
					...(versionId ? { versionId } : {}),
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

		// 4. Smithed
		// e.g. smithed.dev/packs/coc , nightly.smithed.net/packs/coc
		if (
			hostname === "smithed.dev" ||
			hostname.endsWith(".smithed.dev") ||
			hostname === "smithed.net" ||
			hostname.endsWith(".smithed.net")
		) {
			if (pathParts[0] === "packs" && pathParts[1]) {
				return {
					platform: "smithed",
					id: pathParts[1],
				};
			}
		}

		return null;
	} catch {
		return null;
	}
}
