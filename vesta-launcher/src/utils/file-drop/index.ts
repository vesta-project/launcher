import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { createSignal } from "solid-js";

export interface DropZoneOptions {
	accept?: "files" | "folders" | "all";
	allowedExtensions?: string[];
}

type NormalizedDropZoneOptions = {
	accept: "files" | "folders" | "all";
	allowedExtensions: string[];
};

const DEFAULT_OPTIONS: NormalizedDropZoneOptions = {
	accept: "all",
	allowedExtensions: [],
};

export interface SniffedPath {
	path: string;
	is_directory: boolean;
}

const [sniffedPaths, setSniffedPaths] = createSignal<SniffedPath[]>([]);
const [isDragging, setIsDragging] = createSignal(false);

function normalizeOptions(
	options: DropZoneOptions = {},
): NormalizedDropZoneOptions {
	return {
		accept: options.accept ?? "all",
		allowedExtensions:
			options.allowedExtensions?.map((ext) => ext.toLowerCase()) ?? [],
	};
}

class DropZoneManager {
	private unlisten: UnlistenFn | null = null;
	private unlistenHide: UnlistenFn | null = null;
	private initialized = false;
	private isSummoning = false;
	private hasSniffedThisSession = false;
	private cooldownUntil = 0;

	async initialize(): Promise<void> {
		if (this.initialized || !hasTauriRuntime()) {
			return;
		}

		console.log("[FileDrop] Initializing file drop manager");

		this.unlisten = await listen<SniffedPath[]>(
			"vesta://sniffed-file-drop",
			(event) => {
				console.log("[FileDrop] Sniffed paths received:", event.payload);
				setSniffedPaths(event.payload);

				if (event.payload.length > 0) {
					setIsDragging(true);
					this.hasSniffedThisSession = true;
					this.cooldownUntil = Date.now() + 1000; // Don't re-summon for 1s
					// Immediately hide the sniffer once we have the paths
					this.hideSniffer();
				}
			},
		);

		this.unlistenHide = await listen("vesta://hide-sniffer-request", () => {
			console.log("[FileDrop] Hide request received from native sniffer");
			this.hideSniffer();
		});

		this.initialized = true;
	}

	async showSniffer(): Promise<void> {
		if (!hasTauriRuntime() || this.isSummoning || this.hasSniffedThisSession)
			return;

		// Cooldown check to prevent flickering after a successful sniff
		if (Date.now() < this.cooldownUntil) return;

		try {
			this.isSummoning = true;
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			const win = getCurrentWindow();
			const factor = await win.scaleFactor();
			const size = await win.innerSize();
			const pos = await win.innerPosition();

			console.log("[FileDrop] Showing sniffer overlay over main window");
			await invoke("position_overlay", {
				x: pos.x,
				y: pos.y,
				width: size.width,
				height: size.height,
			});
		} catch (e) {
			this.isSummoning = false;
			console.error("[FileDrop] Failed to show sniffer:", e);
		}
	}

	async hideSniffer(): Promise<void> {
		if (!hasTauriRuntime()) return;
		try {
			this.isSummoning = false;
			console.log("[FileDrop] Hiding sniffer overlay (moving off-screen)");
			await invoke("hide_overlay");
		} catch (e) {
			console.error("[FileDrop] Failed to hide sniffer:", e);
		}
	}

	cleanup(): void {
		if (this.unlisten) {
			this.unlisten();
			this.unlisten = null;
		}
		if (this.unlistenHide) {
			this.unlistenHide();
			this.unlistenHide = null;
		}
		this.initialized = false;
	}

	getSniffedPaths(): SniffedPath[] {
		return sniffedPaths();
	}

	isDragging(): boolean {
		return isDragging();
	}

	isSnifferVisible(): boolean {
		return this.isSummoning;
	}

	setIsDragActive(active: boolean): void {
		const currentlyDragging = isDragging();
		if (active === currentlyDragging) return;

		console.log("[FileDrop] setIsDragActive:", active);
		setIsDragging(active);
	}

	clearSniffedPaths(): void {
		console.log("[FileDrop] Clearing sniffed paths and resetting session lock");
		setSniffedPaths([]);
		setIsDragging(false);
		this.hasSniffedThisSession = false;
		this.cooldownUntil = 0; // Immediate reset for new drag session
	}

	filterPaths(
		paths: SniffedPath[],
		options: DropZoneOptions = {},
	): SniffedPath[] {
		const normalized = normalizeOptions(options);
		return paths.filter((item) => {
			const isDir = item.is_directory;

			if (normalized.accept === "files" && isDir) {
				return false;
			}
			if (normalized.accept === "folders" && !isDir) {
				return false;
			}
			if (!isDir && normalized.allowedExtensions.length > 0) {
				const ext = this.getExtension(item.path);
				return normalized.allowedExtensions.includes(ext.toLowerCase());
			}
			return true;
		});
	}

	private getExtension(path: string): string {
		const parts = path.split(/[/\\]/);
		const lastSegment = parts[parts.length - 1] ?? "";
		const lastDotIndex = lastSegment.lastIndexOf(".");
		if (lastDotIndex === -1) return "";
		return lastSegment.substring(lastDotIndex).toLowerCase();
	}
}

let dropZoneManager: DropZoneManager | null = null;

export function getDropZoneManager(): DropZoneManager {
	if (!dropZoneManager) {
		dropZoneManager = new DropZoneManager();
	}
	return dropZoneManager;
}

export async function initializeFileDropSystem(): Promise<void> {
	const manager = getDropZoneManager();
	await manager.initialize();
}

export function cleanupFileDropSystem(): void {
	if (dropZoneManager) {
		dropZoneManager.cleanup();
		dropZoneManager = null;
	}
}
