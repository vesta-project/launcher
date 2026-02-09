import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Resolves a resource URL by checking if it's a local path and converting it if necessary.
 * 
 * @param path The path or URL to resolve.
 * @returns The resolved URL string ready for use in <img> tags or CSS.
 */
export function resolveResourceUrl(path: string | null | undefined): string | undefined {
    if (!path) return undefined;

    // Don't convert gradients
    if (path.startsWith("linear-gradient")) {
        return path;
    }

    // Don't convert remote URLs or already converted protocols
    if (
        path.startsWith("http://") || 
        path.startsWith("https://") || 
        path.startsWith("data:") || 
        path.startsWith("blob:") || 
        path.startsWith("asset:") ||
        path.startsWith("http://asset.localhost")
    ) {
        return path;
    }

    // Don't convert bundled assets (Vite)
    // Dev: /src/assets/...
    // Prod: /assets/...
    if (path.startsWith("/src/") || path.startsWith("/assets/") || path.startsWith("/@")) {
        return path;
    }

    // Otherwise, assume it's a local file path and convert it for the asset protocol
    try {
        // Only convert if it looks like an absolute path. 
        // Bundled assets are already handled above. 
        // Relative paths (not starting with /) are ambiguous but usually 
        // we store absolute paths for custom icons.
        return convertFileSrc(path);
    } catch (e) {
        console.error("Failed to convert file source:", e);
        return path;
    }
}
