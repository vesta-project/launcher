import { invoke } from "@tauri-apps/api/core";

export type DropPathKind =
	| "file"
	| "directory"
	| "other"
	| "missing"
	| "inaccessible";

export interface ClassifiedDropPath {
	path: string;
	kind: DropPathKind;
	isSymlink: boolean;
}

/**
 * Asks the Rust side what each dropped path is (`classify_dropped_paths`).
 *
 * Never throws and never logs paths. Any IPC failure, or a malformed response,
 * resolves every path as "inaccessible" so the drop is rejected as unreadable.
 */
export async function classifyDroppedPaths(
	paths: string[],
): Promise<ClassifiedDropPath[]> {
	if (paths.length === 0) {
		return [];
	}
	try {
		const result = await invoke<ClassifiedDropPath[]>(
			"classify_dropped_paths",
			{ paths },
		);
		if (Array.isArray(result)) {
			return result;
		}
	} catch {
		// Deliberately silent: error details can contain paths.
	}
	return paths.map(
		(path): ClassifiedDropPath => ({
			path,
			kind: "inaccessible",
			isSymlink: false,
		}),
	);
}
