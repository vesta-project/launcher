import {
	dismissToLibrary,
	openMiniPage,
	pageViewerOpen,
	router,
} from "@components/page-viewer/page-viewer";
import { pinning, type PinnedPage } from "@stores/pinning";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { handleNavigationBack, handleNavigationForward } from "@utils/flat-shell-navigation";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import type { CommandDefinition } from "./types";

function isMainWindow(): boolean {
	return !hasTauriRuntime() || getCurrentWindow().label === "main";
}

function canNavigateBack(): boolean {
	return Boolean(router()?.canGoBack());
}

function canNavigateForward(): boolean {
	return Boolean(router()?.canGoForward());
}

async function closeCurrentPage(): Promise<void> {
	const activeRouter = router();
	const canExit = activeRouter?.getCanExit();
	if (canExit && !(await canExit())) return;

	if (!isMainWindow()) {
		await invoke("hide_mini_window");
		return;
	}

	if (pageViewerOpen()) dismissToLibrary();
}

function openPinnedPage(pin: PinnedPage): void {
	if (pin.page_type === "instance") {
		openMiniPage("/instance", { slug: pin.target_id });
		return;
	}
	if (pin.page_type === "settings") {
		openMiniPage("/config");
		return;
	}
	openMiniPage("/resource-details", {
		projectId: pin.target_id,
		platform: pin.platform,
		name: pin.label,
		iconUrl: pin.icon_url ?? undefined,
	});
}

function pinnedAtSlot(slot: number): PinnedPage | undefined {
	return pinning.pins[slot - 1];
}

function lastPinned(): PinnedPage | undefined {
	return pinning.pins.at(-1);
}

function currentSearchTarget(): HTMLElement | null {
	return document.querySelector<HTMLElement>(
		"[data-keybinding-search] input:not([disabled]), input[data-keybinding-search]:not([disabled])",
	);
}

function pinnedCommand(slot: number, chord: string): CommandDefinition {
	return {
		commandId: `navigation.pinned.${slot}`,
		handlerId: `navigation.pinned.${slot}`,
		label: "settings-extra-keybinding-pinned-item",
		description: "settings-extra-keybinding-open-pinned-item",
		category: "settings-extra-keybinding-category-navigation",
		defaultChord: chord,
		sortOrder: 30 + slot,
		canExecute: () => isMainWindow() && Boolean(pinnedAtSlot(slot)),
		execute: () => {
			const pin = pinnedAtSlot(slot);
			if (pin) openPinnedPage(pin);
		},
	};
}

export const commandDefinitions: readonly CommandDefinition[] = [
	{
		commandId: "app.reload",
		handlerId: "app.reload",
		label: "settings-extra-keybinding-reload-label",
		description: "settings-extra-keybinding-reload-description",
		category: "settings-extra-keybinding-category-application",
		defaultChord: "Mod+KeyR",
		sortOrder: 10,
		execute: async () => {
			const activeRouter = router();
			if (activeRouter?.canReload()) {
				await activeRouter.reload();
				return;
			}
			if (!(hasTauriRuntime() && import.meta.env.DEV)) window.location.reload();
		},
	},
	{
		commandId: "app.close",
		handlerId: "app.close",
		label: "settings-extra-keybinding-close-label",
		description: "settings-extra-keybinding-close-description",
		category: "settings-extra-keybinding-category-application",
		defaultChord: "Mod+KeyW",
		sortOrder: 20,
		canExecute: () => !isMainWindow() || pageViewerOpen(),
		execute: closeCurrentPage,
	},
	{
		commandId: "navigation.back",
		handlerId: "navigation.back",
		label: "settings-extra-keybinding-back-label",
		description: "settings-extra-keybinding-back-description",
		category: "settings-extra-keybinding-category-navigation",
		defaultChord: "Alt+ArrowLeft",
		sortOrder: 10,
		canExecute: canNavigateBack,
		execute: async () => {
			const activeRouter = router();
			if (activeRouter) await handleNavigationBack(activeRouter);
		},
	},
	{
		commandId: "navigation.forward",
		handlerId: "navigation.forward",
		label: "settings-extra-keybinding-forward-label",
		description: "settings-extra-keybinding-forward-description",
		category: "settings-extra-keybinding-category-navigation",
		defaultChord: "Alt+ArrowRight",
		sortOrder: 20,
		canExecute: canNavigateForward,
		execute: () => {
			const activeRouter = router();
			if (activeRouter) handleNavigationForward(activeRouter);
		},
	},
	{
		commandId: "navigation.library",
		handlerId: "navigation.library",
		label: "settings-extra-keybinding-library-label",
		description: "settings-extra-keybinding-library-description",
		category: "settings-extra-keybinding-category-navigation",
		defaultChord: "Mod+Digit1",
		sortOrder: 21,
		canExecute: isMainWindow,
		execute: dismissToLibrary,
	},
	{
		commandId: "navigation.new-instance",
		handlerId: "navigation.new-instance",
		label: "app-shell-new-instance",
		description: "settings-extra-keybinding-new-instance-description",
		category: "settings-extra-keybinding-category-navigation",
		defaultChord: "Mod+Digit2",
		sortOrder: 22,
		canExecute: isMainWindow,
		execute: () => openMiniPage("/install"),
	},
	{
		commandId: "navigation.explore",
		handlerId: "navigation.explore",
		label: "app-shell-explore",
		description: "settings-extra-keybinding-explore-description",
		category: "settings-extra-keybinding-category-navigation",
		defaultChord: "Mod+Digit3",
		sortOrder: 23,
		canExecute: isMainWindow,
		execute: () => openMiniPage("/resources"),
	},
	pinnedCommand(1, "Mod+Digit4"),
	pinnedCommand(2, "Mod+Digit5"),
	pinnedCommand(3, "Mod+Digit6"),
	pinnedCommand(4, "Mod+Digit7"),
	pinnedCommand(5, "Mod+Digit8"),
	{
		commandId: "navigation.pinned.last",
		handlerId: "navigation.pinned.last",
		label: "settings-extra-keybinding-last-pinned-label",
		description: "settings-extra-keybinding-last-pinned-description",
		category: "settings-extra-keybinding-category-navigation",
		defaultChord: "Mod+Digit9",
		sortOrder: 39,
		canExecute: () => isMainWindow() && Boolean(lastPinned()),
		execute: () => {
			const pin = lastPinned();
			if (pin) openPinnedPage(pin);
		},
	},
	{
		commandId: "navigation.settings",
		handlerId: "navigation.settings",
		label: "settings-extra-keybinding-settings-label",
		description: "settings-extra-keybinding-settings-description",
		category: "settings-extra-keybinding-category-navigation",
		defaultChord: "Mod+Comma",
		sortOrder: 50,
		canExecute: isMainWindow,
		execute: () => openMiniPage("/config"),
	},
	{
		commandId: "navigation.notifications",
		handlerId: "navigation.notifications",
		label: "settings-extra-keybinding-notifications-label",
		description: "settings-extra-keybinding-notifications-description",
		category: "settings-extra-keybinding-category-navigation",
		defaultChord: null,
		sortOrder: 60,
		canExecute: isMainWindow,
		execute: () => {
			window.dispatchEvent(new CustomEvent("vesta:toggle-notifications"));
		},
	},
	{
		commandId: "navigation.focus-search",
		handlerId: "navigation.focus-search",
		label: "settings-extra-keybinding-focus-search-label",
		description: "settings-extra-keybinding-focus-search-description",
		category: "settings-extra-keybinding-category-navigation",
		defaultChord: "Mod+KeyF",
		sortOrder: 70,
		canExecute: () => Boolean(currentSearchTarget()),
		execute: () => {
			currentSearchTarget()?.focus();
		},
	},
];

export const commandHandlers = new Map(
	commandDefinitions.map((definition) => [definition.handlerId, definition]),
);
