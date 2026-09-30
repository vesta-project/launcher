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
import { t } from "~/localization";
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
		label: t("settings-extra-keybinding-pinned-item", { slot }),
		description: t("settings-extra-keybinding-open-pinned-item", { slot }),
		category: t("settings-extra-keybinding-category-navigation"),
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
		label: t("settings-extra-keybinding-reload-label"),
		description: t("settings-extra-keybinding-reload-description"),
		category: t("settings-extra-keybinding-category-application"),
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
		label: t("settings-extra-keybinding-close-label"),
		description: t("settings-extra-keybinding-close-description"),
		category: t("settings-extra-keybinding-category-application"),
		defaultChord: "Mod+KeyW",
		sortOrder: 20,
		canExecute: () => !isMainWindow() || pageViewerOpen(),
		execute: closeCurrentPage,
	},
	{
		commandId: "navigation.back",
		handlerId: "navigation.back",
		label: t("settings-extra-keybinding-back-label"),
		description: t("settings-extra-keybinding-back-description"),
		category: t("settings-extra-keybinding-category-navigation"),
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
		label: t("settings-extra-keybinding-forward-label"),
		description: t("settings-extra-keybinding-forward-description"),
		category: t("settings-extra-keybinding-category-navigation"),
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
		label: t("settings-extra-keybinding-library-label"),
		description: t("settings-extra-keybinding-library-description"),
		category: t("settings-extra-keybinding-category-navigation"),
		defaultChord: "Mod+Digit1",
		sortOrder: 21,
		canExecute: isMainWindow,
		execute: dismissToLibrary,
	},
	{
		commandId: "navigation.new-instance",
		handlerId: "navigation.new-instance",
		label: t("app-shell-new-instance"),
		description: t("settings-extra-keybinding-new-instance-description"),
		category: t("settings-extra-keybinding-category-navigation"),
		defaultChord: "Mod+Digit2",
		sortOrder: 22,
		canExecute: isMainWindow,
		execute: () => openMiniPage("/install"),
	},
	{
		commandId: "navigation.explore",
		handlerId: "navigation.explore",
		label: t("app-shell-explore"),
		description: t("settings-extra-keybinding-explore-description"),
		category: t("settings-extra-keybinding-category-navigation"),
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
		label: t("settings-extra-keybinding-last-pinned-label"),
		description: t("settings-extra-keybinding-last-pinned-description"),
		category: t("settings-extra-keybinding-category-navigation"),
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
		label: t("settings-extra-keybinding-settings-label"),
		description: t("settings-extra-keybinding-settings-description"),
		category: t("settings-extra-keybinding-category-navigation"),
		defaultChord: "Mod+Comma",
		sortOrder: 50,
		canExecute: isMainWindow,
		execute: () => openMiniPage("/config"),
	},
	{
		commandId: "navigation.notifications",
		handlerId: "navigation.notifications",
		label: t("settings-extra-keybinding-notifications-label"),
		description: t("settings-extra-keybinding-notifications-description"),
		category: t("settings-extra-keybinding-category-navigation"),
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
		label: t("settings-extra-keybinding-focus-search-label"),
		description: t("settings-extra-keybinding-focus-search-description"),
		category: t("settings-extra-keybinding-category-navigation"),
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
