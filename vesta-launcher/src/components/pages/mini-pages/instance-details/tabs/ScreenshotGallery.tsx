import FolderIcon from "@assets/icons/content/folder.svg";
import CopyIcon from "@assets/icons/content/link.svg";
import RefreshIcon from "@assets/icons/actions/refresh.svg";
import TrashIcon from "@assets/icons/actions/delete.svg";
import GridIcon from "@assets/icons/content/grid.svg";
import ListIcon from "@assets/icons/content/list.svg";
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
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { formatDate } from "@utils/date";
import { createResource, createSignal, For, Show, Suspense } from "solid-js";
import styles from "./ScreenshotGallery.module.css";

interface Screenshot {
	name: string;
	path: string;
	createdAt: number;
	size: number;
}

interface ScreenshotGalleryProps {
	instanceIdSlug: string;
}

export function ScreenshotGallery(props: ScreenshotGalleryProps) {
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
		<section class={styles.container} aria-labelledby="screenshots-heading">
			<div class={styles.sectionHeading}>
				<div class={styles.headingCopy}>
					<h2 id="screenshots-heading">Screenshots</h2>
					<Show
						when={
							!screenshots.loading &&
							!screenshots.error &&
							(screenshots()?.length ?? 0) > 0
						}
					>
						<span>{screenshots()?.length ?? 0} files</span>
					</Show>
				</div>
				<Show when={!screenshots.error && (screenshots()?.length ?? 0) > 0}>
					<div class={styles.toolbar}>
						<div class={styles.group}>
							<ToggleGroup
								value={viewMode()}
								onChange={(next) => {
									if (next) setViewMode(next as "grid" | "list");
								}}
							>
								<ToggleGroupItem
									value="list"
									icon_only={true}
									title="List View"
									aria-label="List View"
								>
									<ListIcon width="14" height="14" />
								</ToggleGroupItem>
								<ToggleGroupItem
									value="grid"
									icon_only={true}
									title="Grid View"
									aria-label="Grid View"
								>
									<GridIcon width="14" height="14" />
								</ToggleGroupItem>
							</ToggleGroup>
						</div>

						<div class={styles.group}>
							<Select
								value={sortBy()}
								onChange={(val) => setSortBy(val as any)}
								options={["newest", "oldest", "name"]}
								itemComponent={(props) => (
									<SelectItem item={props.item}>
										{(() => {
											if (props.item.rawValue === "newest")
												return "Newest First";
											if (props.item.rawValue === "oldest")
												return "Oldest First";
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
							<Button
								variant="slate"
								size="sm"
								icon_only={true}
								onClick={refetch}
								title="Refresh screenshots"
							>
								<RefreshIcon />
							</Button>
						</div>
					</div>
				</Show>
			</div>

			<Suspense
				fallback={<div class={styles.loading}>Loading screenshots…</div>}
			>
				<Show when={screenshots.error}>
					<div class={styles.empty} role="alert">
						<p>Could not load screenshots.</p>
						<Button size="sm" variant="outline" onClick={() => void refetch()}>
							Retry
						</Button>
					</div>
				</Show>
				<Show
					when={!screenshots.error && (screenshots()?.length ?? 0) > 0}
					fallback={
						<Show when={!screenshots.error}>
							<div class={styles.empty}>
								<p>No screenshots yet.</p>
							</div>
						</Show>
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
		</section>
	);
}
