import FolderIcon from "@assets/folder.svg";
import CopyIcon from "@assets/link.svg";
import RefreshIcon from "@assets/refresh.svg";
import TrashIcon from "@assets/trash.svg";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import { ImageViewer } from "@ui/image-viewer/image-viewer";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { showToast } from "@ui/toast/toast";
import { formatDate } from "@utils/date";
import { createResource, createSignal, For, Show, Suspense } from "solid-js";
import styles from "./ScreenshotsTab.module.css";

interface Screenshot {
	name: string;
	path: string;
	createdAt: number;
	size: number;
}

interface ScreenshotsTabProps {
	instanceIdSlug: string;
}

export function ScreenshotsTab(props: ScreenshotsTabProps) {
	const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid");
	const [sortBy, setSortBy] = createSignal<"newest" | "oldest" | "name">(
		"newest",
	);
	const [selectedScreenshot, setSelectedScreenshot] =
		createSignal<Screenshot | null>(null);

	const [screenshots, { mutate, refetch }] = createResource(
		() => props.instanceIdSlug,
		async (slug) => {
			const data = await invoke<Screenshot[]>("get_screenshots", {
				instanceIdSlug: slug,
			});
			return data;
		},
	);

	const sortedScreenshots = () => {
		const data = [...(screenshots() || [])];
		if (sortBy() === "newest") {
			return data.sort((a, b) => b.createdAt - a.createdAt);
		} else if (sortBy() === "oldest") {
			return data.sort((a, b) => a.createdAt - b.createdAt);
		} else {
			return data.sort((a, b) => a.name.localeCompare(b.name));
		}
	};

	const handleCopy = async (screenshot: Screenshot) => {
		try {
			await invoke("copy_screenshot_to_clipboard", { path: screenshot.path });
			showToast({
				title: "Copied!",
				description: "Screenshot copied to clipboard.",
				severity: "success",
			});
		} catch (e) {
			console.error(e);
			showToast({
				title: "Error",
				description: "Failed to copy screenshot.",
				severity: "error",
			});
		}
	};

	const handleDelete = async (screenshot: Screenshot) => {
		if (!confirm(`Are you sure you want to delete ${screenshot.name}?`)) return;

		try {
			await invoke("delete_screenshot", { path: screenshot.path });
			mutate((prev) =>
				prev ? prev.filter((s) => s.path !== screenshot.path) : [],
			);
			showToast({
				title: "Deleted",
				description: "Screenshot removed.",
				severity: "success",
			});
		} catch (e) {
			console.error(e);
			showToast({
				title: "Error",
				description: "Failed to delete screenshot.",
				severity: "error",
			});
		}
	};

	const openInFolder = async (screenshot: Screenshot) => {
		try {
			await invoke("open_screenshot_in_folder", { path: screenshot.path });
		} catch (e) {
			console.error(e);
		}
	};

	return (
		<div class={styles.container}>
			<div class={styles.toolbar}>
				<div class={styles.group}>
					<Button
						variant={viewMode() === "grid" ? "solid" : "ghost"}
						size="sm"
						onClick={() => setViewMode("grid")}
						title="Grid View"
					>
						Grid
					</Button>
					<Button
						variant={viewMode() === "list" ? "solid" : "ghost"}
						size="sm"
						onClick={() => setViewMode("list")}
						title="List View"
					>
						List
					</Button>
				</div>

				<div class={styles.group}>
					<Select
						value={sortBy()}
						onChange={(val) => setSortBy(val as any)}
						options={["newest", "oldest", "name"]}
						itemComponent={(props) => (
							<SelectItem item={props.item}>
								{(() => {
									if (props.item.rawValue === "newest") return "Newest First";
									if (props.item.rawValue === "oldest") return "Oldest First";
									if (props.item.rawValue === "name") return "Name";
									return props.item.rawValue;
								})()}
							</SelectItem>
						)}
					>
						<SelectTrigger class={styles.selectTrigger}>
							<SelectValue<string>>
								{(state) => {
									const val = state.selectedOption();
									if (val === "newest") return "Newest First";
									if (val === "oldest") return "Oldest First";
									if (val === "name") return "Name";
									return val;
								}}
							</SelectValue>
						</SelectTrigger>
						<SelectContent />
					</Select>

					<Button variant="ghost" size="sm" onClick={refetch} title="Refresh">
						<RefreshIcon />
					</Button>
				</div>
			</div>

			<Suspense
				fallback={<div class={styles.loading}>Loading screenshots...</div>}
			>
				<Show
					when={(screenshots()?.length ?? 0) > 0}
					fallback={
						<div class={styles.empty}>
							<p>No screenshots found for this instance.</p>
						</div>
					}
				>
					<div class={viewMode() === "grid" ? styles.grid : styles.list}>
						<For each={sortedScreenshots()}>
							{(screenshot) => (
								<ContextMenu>
									<ContextMenuTrigger>
										<div
											class={
												viewMode() === "grid"
													? styles.gridItem
													: styles.listItem
											}
											onClick={() => setSelectedScreenshot(screenshot)}
										>
											<div class={styles.preview}>
												<img
													src={convertFileSrc(screenshot.path)}
													alt={screenshot.name}
													loading="lazy"
												/>
											</div>
											<div class={styles.details}>
												<span class={styles.name}>{screenshot.name}</span>
												<span class={styles.date}>
													{formatDate(
														new Date(screenshot.createdAt * 1000).toISOString(),
													)}
												</span>
											</div>
										</div>
									</ContextMenuTrigger>
									<ContextMenuContent>
										<ContextMenuItem onClick={() => handleCopy(screenshot)}>
											<div class={styles.menuItem}>
												<CopyIcon /> Copy to Clipboard
											</div>
										</ContextMenuItem>
										<ContextMenuItem onClick={() => openInFolder(screenshot)}>
											<div class={styles.menuItem}>
												<FolderIcon /> Open in Folder
											</div>
										</ContextMenuItem>
										<ContextMenuItem
											class={styles.deleteAction}
											onClick={() => handleDelete(screenshot)}
										>
											<div class={styles.menuItem}>
												<TrashIcon /> Delete
											</div>
										</ContextMenuItem>
									</ContextMenuContent>
								</ContextMenu>
							)}
						</For>
					</div>
				</Show>
			</Suspense>

			<ImageViewer
				src={(() => {
					const s = selectedScreenshot();
					return s ? convertFileSrc(s.path) : null;
				})()}
				images={screenshots()?.map((s) => ({
					src: convertFileSrc(s.path),
					title: s.name,
					date: formatDate(new Date(s.createdAt * 1000).toISOString()),
				}))}
				title={selectedScreenshot()?.name}
				date={(() => {
					const s = selectedScreenshot();
					return s
						? formatDate(new Date(s.createdAt * 1000).toISOString())
						: undefined;
				})()}
				onClose={() => setSelectedScreenshot(null)}
				onCopy={(src) => {
					// Map back to original screenshot object if needed
					const s = screenshots()?.find(
						(ss) => convertFileSrc(ss.path) === src,
					);
					if (s) handleCopy(s);
				}}
				onOpenFolder={(src) => {
					const s = screenshots()?.find(
						(ss) => convertFileSrc(ss.path) === src,
					);
					if (s) openInFolder(s);
				}}
				onDelete={(src) => {
					const s = screenshots()?.find(
						(ss) => convertFileSrc(ss.path) === src,
					);
					if (s) {
						handleDelete(s).then(() => {
							// If it was the only one, close
							if ((screenshots()?.length || 0) <= 1) {
								setSelectedScreenshot(null);
							}
						});
					}
				}}
			/>
		</div>
	);
}
