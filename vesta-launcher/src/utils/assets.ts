import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveBuiltinIcon } from "./instances";

/**
 * Resolves a resource URL by checking if it's a local path and converting it if necessary.
 * 
 * @param path The path or URL to resolve.
 * @returns The resolved URL string ready for use in <img> tags or CSS.
 */
export function resolveResourceUrl(path: string | null | undefined): string | undefined {
    if (!path) return undefined;

    // First, try to resolve builtin icons (like "builtin:placeholder-1" or legacy hashed paths)
    const resolvedPath = resolveBuiltinIcon(path);
    
    // Don't convert gradients
    if (resolvedPath.startsWith("linear-gradient")) {
        return resolvedPath;
    }

    // Don't convert remote URLs or already converted protocols
    if (
        resolvedPath.startsWith("http://") || 
        resolvedPath.startsWith("https://") || 
        resolvedPath.startsWith("data:") || 
        resolvedPath.startsWith("blob:") || 
        resolvedPath.startsWith("asset:") ||
        resolvedPath.startsWith("http://asset.localhost")
    ) {
        return resolvedPath;
    }

    // Don't convert bundled assets (Vite)
    // Dev: /src/assets/...
    // Prod: /assets/...
    if (resolvedPath.startsWith("/src/") || resolvedPath.startsWith("/assets/") || resolvedPath.startsWith("/@")) {
        return resolvedPath;
    }

    // Otherwise, assume it's a local file path and convert it for the asset protocol
    try {
        // Only convert if it looks like an absolute path. 
        // Bundled assets are already handled above. 
        // Relative paths (not starting with /) are ambiguous but usually 
        // we store absolute paths for custom icons.
        return convertFileSrc(resolvedPath);
    } catch (e) {
        console.error("Failed to convert file source:", e);
        return resolvedPath;
    }
}
