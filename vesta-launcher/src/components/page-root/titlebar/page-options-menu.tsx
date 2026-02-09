import EllipsisVIcon from "@assets/ellipsis-v.svg";
import PinIcon from "@assets/pin.svg";
import PinOffIcon from "@assets/pin-off.svg";
import DesktopAddIcon from "@assets/desktop-add.svg";
import LinkIcon from "@assets/link.svg";
import { router } from "@components/page-viewer/page-viewer";
import { pinning, isPinned, pinPage, unpinPage } from "@stores/pinning";
import { instancesState } from "@stores/instances";
import { getInstanceSlug } from "@utils/instances";
import { invoke } from "@tauri-apps/api/core";
import { Popover, PopoverContent, PopoverTrigger } from "@ui/popover/popover";
import { showToast } from "@ui/toast/toast";
import { type MiniRouter } from "@components/page-viewer/mini-router";
import styles from "./page-options-menu.module.css";
import { createMemo, createSignal, Show } from "solid-js";

export function PageOptionsMenu(props: { router?: MiniRouter }) {
	const [isOpen, setIsOpen] = createSignal(false);
	const activeRouter = () => props.router || router();
	const currentPath = () => activeRouter()?.currentPath.get();
	const currentParams = () => activeRouter()?.currentParams.get();

	const pageInfo = createMemo(() => {
		const path = currentPath();
		const params = currentParams();

		if (path === "/instance" && params?.slug) {
			const slug = String(params.slug);
			const instance = instancesState.instances.find(
				(i) => getInstanceSlug(i) === slug
			);
			return {
				type: "instance" as const,
				id: slug,
				label: instance?.name || slug,
				icon: null, // Could use instance icon path
				platform: null,
			};
		}

		if (path === "/resource-details" && params?.projectId) {
			const projectId = String(params.projectId);
			return {
				type: "resource" as const,
				id: projectId,
				label: (params as any).name ? String((params as any).name) : "Resource",
				icon: (params as any).iconUrl ? String((params as any).iconUrl) : null,
				platform: params.platform ? String(params.platform) : "modrinth",
			};
		}

		if (path === "/config") {
			return {
				type: "settings" as const,
				id: "app-settings",
				label: "Settings",
				icon: null,
				platform: null,
			};
		}

		return null;
	});

	const pinned = createMemo(() => {
		const info = pageInfo();
		if (!info) return false;
		return isPinned(info.type, info.id);
	});

	const handlePinToggle = async () => {
		const info = pageInfo();
		if (!info) return;

		setIsOpen(false);

		if (pinned()) {
			const pin = pinning.pins.find(
				(p) => p.page_type === info.type && p.target_id === info.id,);
			if (pin) await unpinPage(pin.id);
		} else {
			await pinPage({
				page_type: info.type,
				target_id: info.id,
				label: info.label,
				icon_url: info.icon,
				platform: info.platform,
				order_index: pinning.pins.length,
			});
		}
	};

	const handleCreateShortcut = async (quickLaunch = false) => {
		const info = pageInfo();
		if (!info) return;

		setIsOpen(false);

		try {
			const suffix = quickLaunch ? " (Launch)" : " (Open Page)";
			const name = info.label + suffix;
			let args = "";
			
			if (info.type === "instance") {
				args = quickLaunch 
					? `--launch-instance ${info.id}` 
					: `--open-instance ${info.id}`;
			} else {
				args = `--open-resource ${info.platform} ${info.id}`;
			}

			await invoke("create_desktop_shortcut", {
				name,
				targetArgs: args,
				iconPath: info.icon, // Pass the icon URL/path
			});

			showToast({
				title: "Shortcut Created",
				description: `Added ${name} to your desktop`,
				severity: "Success",
			});
		} catch (e) {
			console.error("Failed to create shortcut:", e);
			showToast({
				title: "Shortcut Failed",
				description: String(e),
				severity: "Error",
			});
		}
	};

	const copyUrl = async () => {
		const url = activeRouter()?.generateUrl();
		if (!url) return;

		setIsOpen(false);

		try {
			await navigator.clipboard.writeText(url);
			showToast({
				title: "URL Copied",
				description: "Page URL copied to clipboard",
				severity: "Success",
			});
		} catch (e) {
			console.error("Failed to copy URL:", e);
			showToast({
				title: "Copy Failed",
				description: "Failed to copy URL",
				severity: "Error",
			});
		}
	};

	return (
		<Show when={pageInfo()}>
			<Popover open={isOpen()} onOpenChange={setIsOpen}>
				<PopoverTrigger class={styles["options-trigger"]}>
					<EllipsisVIcon />
				</PopoverTrigger>
				<PopoverContent class={styles["options-content"]}>
					<div class={styles["options-menu"]}>
						<button class={styles["menu-item"]} onClick={handlePinToggle}>
							<Show when={pinned()} fallback={<PinIcon />}>
								<PinOffIcon />
							</Show>
							<span>{pinned() ? "Unpin Page" : "Pin Page"}</span>
						</button>
						
						<Show when={pageInfo()?.type === "instance"}>
							<button class={styles["menu-item"]} onClick={() => handleCreateShortcut(true)}>
								<DesktopAddIcon />
								<span>Add Quick Launch to Desktop</span>
							</button>
						</Show>
						
						<button class={styles["menu-item"]} onClick={() => handleCreateShortcut(false)}>
							<DesktopAddIcon />
							<span>Add Page to Desktop</span>
						</button>
						
						<button class={styles["menu-item"]} onClick={copyUrl}>
							<LinkIcon />
							<span>Copy URL</span>
						</button>
					</div>
				</PopoverContent>
			</Popover>
		</Show>
	);
}
