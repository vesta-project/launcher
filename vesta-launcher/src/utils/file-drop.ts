import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriRuntime } from "@utils/tauri-runtime";

export interface DropZoneOptions {
	accept?: "files" | "folders" | "all";
	allowedExtensions?: string[];
}

type NormalizedDropZoneOptions = {
	accept: "files" | "folders" | "all";
	allowedExtensions: string[];
};

interface RegisteredZone {
	element: HTMLElement;
	callback: (files: string[]) => void;
	options: NormalizedDropZoneOptions;
}

interface BroadcastMessage {
	source: string | null;
	type: "hover-start" | "hover-update" | "hover-end" | "drop";
	zoneId: string | null;
}

interface OverlayVisualState {
	backgroundColor: string;
	borderColor: string;
	borderRadius: string;
	outline: string;
	opacity: string;
}

type OverlayEventType =
	| "overlay-enter"
	| "overlay-over"
	| "overlay-leave"
	| "overlay-drop"
	| "overlay-html-drop";

interface OverlayPosition {
	x?: number;
	y?: number;
	screenX?: number;
	screenY?: number;
}

interface OverlayBridgeMessage {
	source?: string;
	type: OverlayEventType;
	paths?: string[];
	position?: OverlayPosition | null;
}

const DEFAULT_OPTIONS: NormalizedDropZoneOptions = {
	accept: "all",
	allowedExtensions: [],
};

let zoneIdCounter = 0;

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
	private zones: Map<HTMLElement, RegisteredZone> = new Map();
	private activeZone: HTMLElement | null = null;
	private broadcastChannel: BroadcastChannel | null = null;
	private debugLogging = false;
	private initialized = false;
	private windowLabel: string | null = null;
	private lastHoverZoneId: string | null = null;
	private windowHandle: ReturnType<typeof getCurrentWindow> | null = null;
	private overlayInitPromise: Promise<void> | null = null;
	private overlayReady = false;
	private overlayVisible = false;
	private overlayChannelListener:
		| ((event: MessageEvent<OverlayBridgeMessage>) => void)
		| null = null;

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		this.initialized = true;
		this.windowHandle = getCurrentWindow();
		this.windowLabel = this.windowHandle.label ?? null;
		console.log("[FileDrop] Initializing for window:", this.windowLabel);

		this.broadcastChannel = this.createBroadcastChannel();
		this.attachOverlayChannelListener();

		await this.ensureOverlayReady().catch((error) => {
			console.warn("[FileDrop] Overlay creation failed:", error);
		});

		await this.attachDragDropListener();

		await this.loadInitialDebugFlag();
		// Config watching is now handled centrally by config-sync
		console.log("[FileDrop] Initialization complete");
	}

	cleanup(): void {
		if (this.broadcastChannel) {
			try {
				if (this.overlayChannelListener) {
					this.broadcastChannel.removeEventListener(
						"message",
						this.overlayChannelListener,
					);
				}
				this.broadcastChannel.close();
			} catch (error) {
				this.logDebug("Failed closing BroadcastChannel", error);
			}
		}
		this.broadcastChannel = null;

		this.zones.forEach(({ element }) =>
			element.classList.remove("drop-zone--active"),
		);
		this.zones.clear();
		this.activeZone = null;
		this.lastHoverZoneId = null;
		void this.hideOverlay();
		this.overlayVisible = false;
		this.overlayReady = false;
		this.overlayInitPromise = null;
		this.windowHandle = null;
		this.initialized = false;
	}

	registerZone(
		element: HTMLElement,
		callback: (files: string[]) => void,
		options: DropZoneOptions = DEFAULT_OPTIONS,
	): void {
		const normalized = normalizeOptions(options);
		this.zones.set(element, { element, callback, options: normalized });

		if (!element.dataset.dropZoneId) {
			element.dataset.dropZoneId = `drop-zone-${++zoneIdCounter}`;
		}

		console.log(
			"[FileDrop] Registered zone:",
			element.dataset.dropZoneId,
			"total zones:",
			this.zones.size,
		);
		this.logDebug("Registered drop zone", {
			id: element.dataset.dropZoneId,
			accept: normalized.accept,
			allowedExtensions: normalized.allowedExtensions,
		});
	}

	unregisterZone(element: HTMLElement): void {
		if (this.activeZone === element) {
			this.clearActiveZone();
		}
		this.zones.delete(element);
		this.logDebug(
			"Unregistered drop zone",
			element.dataset.dropZoneId ?? "unknown",
		);
	}

	private attachDragDropListener(): Promise<void> {
		console.log("[FileDrop] Setting up overlay-based drag detection");

		if (!hasTauriRuntime()) {
			console.log("[FileDrop] Skipping overlay setup (no Tauri runtime)");
			return Promise.resolve();
		}

		// The overlay window will capture all HTML5 drag events via the overlay.html
		// When it detects a drag, it will show itself and broadcast events to us
		console.log("[FileDrop] Overlay-based drag detection ready");
		return Promise.resolve();
	}

	private async showOverlayForDrag(): Promise<void> {
		console.log("[FileDrop] showOverlayForDrag called");
		if (!this.overlayReady) {
			await this.ensureOverlayReady();
		}
		if (!this.overlayReady) {
			console.log("[FileDrop] Overlay not ready for drag");
			return;
		}

		try {
			// Overlay window is already full-screen (9999x9999), just make it visible
			if (!this.overlayVisible) {
				await invoke("show_overlay");
				this.overlayVisible = true;
				console.log(
					"[FileDrop] Overlay shown for drag detection (DEBUG VISIBLE)",
				);
			}
		} catch (error) {
			console.error("[FileDrop] Failed to show overlay for drag:", error);
		}
	}

	private async loadInitialDebugFlag(): Promise<void> {
		try {
			const config = await invoke<{ debug_logging?: boolean }>("get_config");
			this.debugLogging = Boolean(config?.debug_logging);
			this.logDebug("Loaded debug logging flag", this.debugLogging);
		} catch (error) {
			console.warn("FileDropManager: failed to load debug flag", error);
		}
	}

	private handleHover(position: PhysicalPosition | null): void {
		console.log("[FileDrop] handleHover called with position:", position);
		if (!position) {
			this.logDebug("Hover position missing");
			return;
		}

		const zoneElement = this.resolveZoneFromPosition(position);
		console.log(
			"[FileDrop] Found zone element:",
			zoneElement?.dataset?.dropZoneId || "none",
		);
		if (!zoneElement) {
			this.clearActiveZone();
			return;
		}

		this.setActiveZone(zoneElement);
		this.broadcastHover("hover-update", zoneElement);
	}

	private handleDrop(paths: string[], position: PhysicalPosition | null): void {
		console.log(
			"[FileDrop] handleDrop called with",
			paths.length,
			"paths:",
			paths,
		);
		let zoneElement = this.activeZone;

		// If we don't have an active zone but received native drop (no position from HTML5),
		// check if there are any zones and use the first one as fallback
		if (!zoneElement && !position && this.zones.size > 0) {
			console.log(
				"[FileDrop] No active zone or position, using first registered zone",
			);
			zoneElement = Array.from(this.zones.keys())[0] ?? null;
		}

		if (!zoneElement && position) {
			zoneElement = this.resolveZoneFromPosition(position);
			console.log(
				"[FileDrop] Resolved zone from position:",
				zoneElement?.dataset.dropZoneId ?? "none",
			);
		} else if (zoneElement) {
			console.log(
				"[FileDrop] Using active zone:",
				zoneElement?.dataset.dropZoneId ?? "none",
			);
		}

		if (!zoneElement) {
			console.log("[FileDrop] Drop occurred outside registered zones");
			this.logDebug("Drop occurred outside registered zones");
			this.broadcastHover("drop", null);
			this.clearActiveZone();
			return;
		}

		const zone = this.zones.get(zoneElement);
		if (!zone) {
			console.log("[FileDrop] Zone element not found in zones map");
			return;
		}

		const filtered = this.filterPaths(paths, zone.options);
		console.log(
			"[FileDrop] Filtered",
			paths.length,
			"paths to",
			filtered.length,
			"based on zone options",
		);
		if (filtered.length === 0) {
			console.log("[FileDrop] No paths satisfied zone filters:", zone.options);
			this.logDebug("No dropped paths satisfied zone filters", {
				zone: zoneElement.dataset.dropZoneId,
				accept: zone.options.accept,
				allowedExtensions: zone.options.allowedExtensions,
				paths,
			});
			this.clearActiveZone();
			this.broadcastHover("drop", zoneElement);
			return;
		}

		console.log(
			"[FileDrop] Dispatching drop to zone:",
			zoneElement.dataset.dropZoneId,
			"with",
			filtered.length,
			"files",
		);
		this.logDebug("Dispatching drop to zone", {
			zone: zoneElement.dataset.dropZoneId,
			paths: filtered,
		});
		try {
			zone.callback(filtered);
			console.log(
				"[FileDrop] File(s) dropped successfully:",
				filtered.length,
				"files in zone",
				zoneElement.dataset.dropZoneId,
			);
		} catch (error) {
			console.error("[FileDrop] DropZone callback threw:", error);
		}

		this.broadcastHover("drop", zoneElement);
		this.clearActiveZone();
	}

	private handleLeave(): void {
		if (this.activeZone) {
			this.logDebug(
				"Drag left active zone",
				this.activeZone.dataset.dropZoneId,
			);
		}
		this.clearActiveZone();
		this.broadcastHover("hover-end", null);
	}

	private resolveZoneFromPosition(
		position: PhysicalPosition,
	): HTMLElement | null {
		const scaleFactor = window.devicePixelRatio || 1;
		const clientX = position.x / scaleFactor;
		const clientY = position.y / scaleFactor;
		const target = document.elementFromPoint(
			clientX,
			clientY,
		) as HTMLElement | null;
		return this.findZoneElement(target);
	}

	private findZoneElement(element: HTMLElement | null): HTMLElement | null {
		let current: HTMLElement | null = element;
		while (current) {
			if (this.zones.has(current)) {
				return current;
			}
			current = current.parentElement;
		}
		return null;
	}

	private setActiveZone(element: HTMLElement): void {
		if (this.activeZone === element) {
			return;
		}

		this.activeZone?.classList.remove("drop-zone--active");
		this.activeZone = element;
		this.activeZone.classList.add("drop-zone--active");

		this.lastHoverZoneId = element.dataset.dropZoneId ?? null;
		this.broadcastHover("hover-start", element);
		console.log("[FileDrop] File hovered over zone:", this.lastHoverZoneId);
		this.logDebug("Active zone set", this.lastHoverZoneId);
		console.log("[FileDrop] About to sync overlay with zone");
		void this.syncOverlayWithZone(element);
	}

	private clearActiveZone(): void {
		if (!this.activeZone) {
			return;
		}
		this.activeZone.classList.remove("drop-zone--active");
		this.activeZone = null;
		this.lastHoverZoneId = null;
		void this.hideOverlay();
	}

	private filterPaths(
		paths: string[],
		options: NormalizedDropZoneOptions,
	): string[] {
		console.log(
			"[FileDrop] Filtering",
			paths.length,
			"paths with options:",
			options,
		);
		const filtered = paths.filter((path) => {
			const directory = this.isLikelyDirectory(path);
			console.log("[FileDrop] Path:", path, "-> isDirectory:", directory);

			if (options.accept === "files" && directory) {
				console.log(
					"[FileDrop] Rejected (zone accepts files only, got directory)",
				);
				return false;
			}
			if (options.accept === "folders" && !directory) {
				console.log(
					"[FileDrop] Rejected (zone accepts folders only, got file)",
				);
				return false;
			}
			if (!directory && options.allowedExtensions.length > 0) {
				const ext = this.getExtension(path);
				const allowed = options.allowedExtensions.includes(ext.toLowerCase());
				console.log("[FileDrop] Extension check:", ext, "allowed:", allowed);
				return allowed;
			}
			console.log("[FileDrop] Accepted");
			return true;
		});
		console.log(
			"[FileDrop] Filter result:",
			filtered.length,
			"of",
			paths.length,
			"paths accepted",
		);
		return filtered;
	}

	private isLikelyDirectory(path: string): boolean {
		if (!path) return false;
		if (path.endsWith("/") || path.endsWith("\\")) {
			return true;
		}
		const normalized = path.replace(/\\/g, "/");
		const lastSegment = normalized.split("/").pop() ?? "";
		return !lastSegment.includes(".");
	}

	private getExtension(path: string): string {
		const normalized = path.replace(/\\/g, "/");
		const filename = normalized.split("/").pop() ?? "";
		const dotIndex = filename.lastIndexOf(".");
		return dotIndex >= 0 ? filename.substring(dotIndex).toLowerCase() : "";
	}

	private createBroadcastChannel(): BroadcastChannel | null {
		if (typeof BroadcastChannel === "undefined") {
			console.warn("[FileDrop] BroadcastChannel not available");
			return null;
		}
		try {
			const channel = new BroadcastChannel("vesta-file-drop");
			console.log("[FileDrop] BroadcastChannel created");
			return channel;
		} catch (error) {
			console.warn("FileDropManager: failed to create BroadcastChannel", error);
			return null;
		}
	}

	private broadcastHover(
		type: BroadcastMessage["type"],
		element: HTMLElement | null,
	): void {
		if (!this.broadcastChannel) {
			return;
		}
		const message: BroadcastMessage = {
			source: this.windowLabel,
			type,
			zoneId: element?.dataset.dropZoneId ?? this.lastHoverZoneId ?? null,
		};
		try {
			this.broadcastChannel.postMessage(message);
		} catch (error) {
			this.logDebug("Failed to post hover broadcast", error);
		}
	}

	private logDebug(message: string, details?: unknown): void {
		if (!this.debugLogging) {
			return;
		}
		if (details !== undefined) {
			console.debug(`[FileDrop] ${message}`, details);
		} else {
			console.debug(`[FileDrop] ${message}`);
		}
	}

	private attachOverlayChannelListener(): void {
		if (!this.broadcastChannel || this.overlayChannelListener) {
			return;
		}
		console.log("[FileDrop] Attaching overlay channel listener");
		this.overlayChannelListener = (
			event: MessageEvent<OverlayBridgeMessage>,
		) => {
			console.log("[FileDrop] Received broadcast message:", event.data?.type);
			this.handleOverlayBridgeMessage(event.data);
		};
		this.broadcastChannel.addEventListener(
			"message",
			this.overlayChannelListener,
		);
	}

	private handleOverlayBridgeMessage(
		message: OverlayBridgeMessage | null | undefined,
	): void {
		if (!message || message.source !== "overlay") {
			return;
		}
		console.log(
			"[FileDrop] Received overlay message:",
			message.type,
			"at position:",
			message.position,
		);
		switch (message.type) {
			case "overlay-enter":
			case "overlay-over":
				void this.handleOverlayHover(message.position ?? null);
				break;
			case "overlay-leave":
				this.handleLeave();
				break;
			case "overlay-drop":
			case "overlay-html-drop":
				void this.handleOverlayDrop(
					message.paths ?? [],
					message.position ?? null,
				);
				break;
			default:
				break;
		}
	}

	private async handleOverlayHover(
		position: OverlayPosition | null,
	): Promise<void> {
		console.log("[FileDrop] Processing overlay hover with position:", position);
		const physical = await this.convertOverlayPosition(position);
		console.log("[FileDrop] Converted to physical position:", physical);
		this.handleHover(physical);
	}

	private async handleOverlayDrop(
		paths: string[],
		position: OverlayPosition | null,
	): Promise<void> {
		const physical = await this.convertOverlayPosition(position);
		this.handleDrop(paths, physical);
	}

	private async convertOverlayPosition(
		position: OverlayPosition | null,
	): Promise<PhysicalPosition | null> {
		if (!position) {
			return null;
		}

		try {
			if (!this.windowHandle) {
				this.windowHandle = getCurrentWindow();
			}
			const windowHandle = this.windowHandle;
			const outer = await windowHandle.outerPosition();
			const scaleFactor = window.devicePixelRatio || 1;

			const screenX =
				typeof position.screenX === "number"
					? position.screenX
					: (window.screenX || 0) + (position.x ?? 0);
			const screenY =
				typeof position.screenY === "number"
					? position.screenY
					: (window.screenY || 0) + (position.y ?? 0);

			const clientX = screenX - outer.x;
			const clientY = screenY - outer.y;

			return new PhysicalPosition(clientX * scaleFactor, clientY * scaleFactor);
		} catch (error) {
			this.logDebug("Failed converting overlay position", error);
			return null;
		}
	}

	private async ensureOverlayReady(): Promise<void> {
		if (this.overlayReady) {
			console.log("[FileDrop] Overlay already ready");
			return;
		}
		if (!hasTauriRuntime()) {
			console.log("[FileDrop] Skipping overlay creation (no Tauri runtime)");
			return;
		}
		if (!this.overlayInitPromise) {
			console.log("[FileDrop] Creating overlay window...");
			this.overlayInitPromise = invoke("create_file_drop_overlay")
				.then(() => {
					this.overlayReady = true;
					console.log("[FileDrop] Overlay window created successfully");
					this.logDebug("File drop overlay ready");
				})
				.catch((error) => {
					this.overlayReady = false;
					console.error("[FileDrop] Failed to create overlay:", error);
					this.logDebug("Failed creating file drop overlay", error);
					throw error;
				});
		}
		try {
			await this.overlayInitPromise;
		} catch {
			this.overlayInitPromise = null;
		}
	}

	private async syncOverlayWithZone(element: HTMLElement): Promise<void> {
		console.log(
			"[FileDrop] syncOverlayWithZone called for element:",
			element.dataset.dropZoneId,
		);
		if (!this.overlayReady) {
			await this.ensureOverlayReady();
		}
		if (!this.overlayReady) {
			console.log("[FileDrop] Overlay not ready, cannot sync");
			return;
		}
		const windowHandle = this.windowHandle ?? getCurrentWindow();
		this.windowHandle = windowHandle;

		try {
			const rect = element.getBoundingClientRect();
			const scaleFactor = window.devicePixelRatio || 1;
			const outerPosition = await windowHandle.outerPosition();
			const x = Math.round(outerPosition.x + rect.left * scaleFactor);
			const y = Math.round(outerPosition.y + rect.top * scaleFactor);
			const width = Math.max(1, Math.round(rect.width * scaleFactor));
			const height = Math.max(1, Math.round(rect.height * scaleFactor));

			const visualState = this.resolveOverlayVisualState(element);

			await invoke("position_overlay", {
				x,
				y,
				width,
				height,
			});
			console.log("[FileDrop] Drop window positioned at:", {
				x,
				y,
				width,
				height,
			});

			await invoke("set_overlay_visual_state", {
				background_color: visualState.backgroundColor,
				border_color: visualState.borderColor,
				border_radius: visualState.borderRadius,
				outline: visualState.outline,
				opacity: visualState.opacity,
			});
			console.log("[FileDrop] Visual state set");

			if (!this.overlayVisible) {
				await invoke("show_overlay");
				this.overlayVisible = true;
				console.log("[FileDrop] Drop window opened");
			}
		} catch (error) {
			this.logDebug("Failed to synchronize overlay", error);
		}
	}

	private async hideOverlay(): Promise<void> {
		if (!this.overlayVisible) {
			return;
		}
		try {
			await this.ensureOverlayReady();
			if (!this.overlayReady) {
				return;
			}
			// Reset visual state to transparent before hiding
			await invoke("set_overlay_visual_state", {
				background_color: "transparent",
				border_color: "transparent",
				border_radius: "0px",
				outline: "none",
				opacity: "0",
			});
			await invoke("hide_overlay");
			this.overlayVisible = false;
			console.log("[FileDrop] Overlay hidden (DEBUG)");
		} catch (error) {
			this.logDebug("Failed to hide overlay", error);
		}
	}

	private resolveOverlayVisualState(element: HTMLElement): OverlayVisualState {
		const computed = window.getComputedStyle(element);
		const defaultBorderColor = "hsl(var(--color__primary-hue, 240) 60% 50%)";
		const backgroundColor =
			computed.backgroundColor &&
			computed.backgroundColor !== "rgba(0, 0, 0, 0)"
				? computed.backgroundColor
				: "hsl(var(--color__primary-hue, 240) 60% 50% / 0.05)";
		const outlineColor =
			computed.outlineColor && computed.outlineColor !== "rgba(0, 0, 0, 0)"
				? computed.outlineColor
				: computed.borderColor && computed.borderColor !== "rgba(0, 0, 0, 0)"
					? computed.borderColor
					: defaultBorderColor;

		const borderRadius = computed.borderRadius || "12px";
		const outlineWidth =
			computed.outlineWidth && computed.outlineWidth !== "0px"
				? computed.outlineWidth
				: "2px";
		const outlineStyle =
			computed.outlineStyle && computed.outlineStyle !== "none"
				? computed.outlineStyle
				: "dashed";

		return {
			backgroundColor,
			borderColor: outlineColor,
			borderRadius,
			outline: `${outlineWidth} ${outlineStyle} ${outlineColor}`,
			opacity: "1",
		};
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
