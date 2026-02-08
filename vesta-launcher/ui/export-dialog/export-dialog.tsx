import {
	createSignal,
	createResource,
	For,
	Show,
	onMount,
	createEffect,
	createMemo,
} from "solid-js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@ui/dialog/dialog";
import LauncherButton from "@ui/button/button";
import { Checkbox } from "@ui/checkbox/checkbox";
import {
	listExportCandidates,
	exportInstanceToModpack,
	ExportCandidate,
} from "@utils/modpacks";
import { showToast } from "@ui/toast/toast";
import { getActiveAccount } from "@utils/auth";
import {
	TextFieldRoot,
	TextFieldLabel,
	TextFieldInput,
	TextFieldTextArea,
} from "@ui/text-field/text-field";
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from "@ui/select/select";
import { downloadDir, join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import BackIcon from "@assets/back-arrow.svg";
import RightArrowIcon from "@assets/right-arrow.svg";
import styles from "./export-dialog.module.css";

export interface ExportDialogProps {
	isOpen: boolean;
	onClose: () => void;
	instanceId: number;
	instanceName: string;
}

interface TreeItem {
	name: string;
	fullPath: string;
	isMod: boolean;
	size: number;
	candidate?: ExportCandidate;
	children: TreeItem[];
}

function formatBytes(bytes: number, decimals = 2) {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function buildTree(candidates: ExportCandidate[]): TreeItem[] {
	const root: TreeItem[] = [];
	const map = new Map<string, TreeItem>();

	for (const c of candidates) {
		const parts = c.path.split("/");
		let currentLevel = root;
		let currentPath = "";

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const isLast = i === parts.length - 1;

			let item = map.get(currentPath);
			if (!item) {
				item = {
					name: part,
					fullPath: currentPath,
					isMod: isLast && c.isMod,
					size: isLast ? c.size || 0 : 0,
					candidate: isLast ? c : undefined,
					children: [],
				};
				map.set(currentPath, item);
				currentLevel.push(item);
			}
			currentLevel = item.children;
		}
	}

	const calculateFolderSizes = (items: TreeItem[]): number => {
		let total = 0;
		for (const item of items) {
			if (item.children.length > 0) {
				item.size = calculateFolderSizes(item.children);
			}
			total += item.size;
		}
		return total;
	};

	const sortTree = (items: TreeItem[]) => {
		items.sort((a, b) => {
			const aIsFolder = a.children.length > 0;
			const bIsFolder = b.children.length > 0;
			if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
			if (a.isMod !== b.isMod) return a.isMod ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
		for (const item of items) {
			if (item.children.length > 0) sortTree(item.children);
		}
	};

	calculateFolderSizes(root);
	sortTree(root);
	return root;
}

export function ExportDialog(props: ExportDialogProps) {
	const [view, setView] = createSignal<"metadata" | "files">("metadata");
	const [selections, setSelections] = createSignal<Set<string>>(new Set());
	const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
	const [exportFormat, setExportFormat] = createSignal("modrinth");
	const [isExporting, setIsExporting] = createSignal(false);
	const [modpackName, setModpackName] = createSignal(props.instanceName);
	const [version, setVersion] = createSignal("1.0.0");
	const [author, setAuthor] = createSignal("");
	const [description, setDescription] = createSignal("");

	onMount(async () => {
		try {
			const acc = await getActiveAccount();
			if (acc) {
				setAuthor(acc.display_name || acc.username);
			}
		} catch (e) {
			console.warn("Failed to get active account for export author:", e);
		}
	});

	const [candidates] = createResource(
		() => (props.isOpen ? props.instanceId : null),
		async (id) => {
			const files = await listExportCandidates(id);
			const initial = new Set<string>();
			for (const f of files) {
				// Default select mods and common config files, skip backups and 0b files
				if (!f.path.includes("backups/") && (f.size || 0) > 0) {
					initial.add(f.path);
				}
			}
			setSelections(initial);
			return files;
		},
	);

	const tree = createMemo(() => {
		const c = candidates();
		if (!c) return [];
		return buildTree(c);
	});

	const getDescendantFiles = (item: TreeItem): string[] => {
		let result: string[] = [];
		if (item.candidate) {
			result.push(item.candidate.path);
		}
		for (const child of item.children) {
			result = result.concat(getDescendantFiles(child));
		}
		return result;
	};

	const toggleItem = (item: TreeItem, checked: boolean) => {
		const next = new Set(selections());
		const files = getDescendantFiles(item);

		for (const f of files) {
			if (checked) next.add(f);
			else next.delete(f);
		}
		setSelections(next);
	};

	const isSelected = (item: TreeItem) => {
		const files = getDescendantFiles(item);
		if (files.length === 0) return false;
		return files.every((f) => selections().has(f));
	};

	const isIndeterminate = (item: TreeItem) => {
		const files = getDescendantFiles(item);
		if (files.length === 0) return false;
		const selectedCount = files.filter((f) => selections().has(f)).length;
		return selectedCount > 0 && selectedCount < files.length;
	};

	const toggleExpanded = (path: string, e: Event) => {
		e.stopPropagation();
		const next = new Set(expanded());
		if (next.has(path)) next.delete(path);
		else next.add(path);
		setExpanded(next);
	};

	const handleExport = async () => {
		setIsExporting(true);
		try {
			// First, pick the folder
			const selectedDir = await open({
				directory: true,
				multiple: false,
				title: "Select Output Folder",
				defaultPath: await downloadDir(),
			});

			if (!selectedDir || Array.isArray(selectedDir)) {
				setIsExporting(false);
				return;
			}

			const ext = exportFormat() === "modrinth" ? "mrpack" : "zip";
			const baseFileName = `${modpackName()} - ${version()}`;
			let fileName = `${baseFileName}.${ext}`;
			let fullPath = await join(selectedDir, fileName);

			let counter = 1;
			while (await invoke("path_exists", { path: fullPath })) {
				fileName = `${baseFileName} (${counter}).${ext}`;
				fullPath = await join(selectedDir, fileName);
				counter++;
			}

			const allFiles = candidates() || [];
			const selectedCandidates = allFiles.filter((c) =>
				selections().has(c.path),
			);

			// Close dialog immediately after submission
			props.onClose();

			await exportInstanceToModpack(
				props.instanceId,
				fullPath,
				exportFormat(),
				selectedCandidates,
				modpackName(),
				version(),
				author(),
				description(),
			);

			showToast({
				title: "Export Started",
				description: `Exporting modpack to ${fileName} in the background.`,
				severity: "Success",
			});
		} catch (e: any) {
			console.error("Export failed:", e);
			showToast({
				title: "Export Failed",
				description: e.toString() || "Unknown error occurred",
				severity: "Error",
			});
		} finally {
			setIsExporting(false);
		}
	};

	const TreeRow = (p: { item: TreeItem; depth: number }) => {
		const hasChildren = () => p.item.children.length > 0;
		const expandedState = () => expanded().has(p.item.fullPath);
		const selected = () => isSelected(p.item);
		const indeterminate = () => isIndeterminate(p.item);

		return (
			<>
				<div
					style={{
						"padding-left": `${p.depth * 20 + 8}px`,
					}}
					class={styles["export-tree-row"]}
					onClick={() => toggleItem(p.item, !selected())}
				>
					<div
						class={styles["expand-arrow"]}
						style={{
							opacity: hasChildren() ? 0.6 : 0,
							cursor: hasChildren() ? "pointer" : "default",
							transform: expandedState() ? "rotate(90deg)" : "none",
						}}
						onClick={(e) => {
							if (hasChildren()) {
								e.stopPropagation();
								toggleExpanded(p.item.fullPath, e);
							}
						}}
					>
						<RightArrowIcon width={12} height={12} />
					</div>

					<div
						style={{
							display: "flex",
							"align-items": "center",
							"pointer-events": "none",
						}}
					>
						<Checkbox
							checked={selected()}
							indeterminate={indeterminate()}
							onChange={(checked: boolean) => toggleItem(p.item, checked)}
						/>
					</div>

					<span
						style={{
							"font-size": "13px",
							"font-family": "var(--font-mono)",
							opacity: p.item.isMod ? 1 : 0.8,
							color: p.item.isMod ? "var(--accent-primary)" : "inherit",
						}}
					>
						{p.item.name}
					</span>

					<span
						style={{
							"font-size": "11px",
							opacity: 0.4,
							"margin-left": "auto",
							"font-family": "var(--font-mono)",
						}}
					>
						{formatBytes(p.item.size)}
					</span>

					<Show when={p.item.isMod}>
						<span
							style={{
								"font-size": "9px",
								background: "var(--primary-low)",
								color: "var(--accent-primary)",
								padding: "0px 6px",
								"border-radius": "4px",
								"font-weight": 700,
								"text-transform": "uppercase",
								"margin-left": "4px",
							}}
						>
							Mod
						</span>
					</Show>
				</div>

				<Show when={hasChildren() && expandedState()}>
					<For each={p.item.children}>
						{(child) => <TreeRow item={child} depth={p.depth + 1} />}
					</For>
				</Show>
			</>
		);
	};

	return (
		<Dialog
			open={props.isOpen}
			onOpenChange={(open) => {
				if (!open) {
					setView("metadata");
					props.onClose();
				}
			}}
		>
			<DialogContent
				style={{
					width: "600px",
					"max-height": "85vh",
					display: "flex",
					"flex-direction": "column",
					overflow: "visible",
				}}
			>
				<DialogHeader
					style={{
						display: "flex",
						"flex-direction": "row",
						"align-items": "center",
						gap: "16px",
						"padding-bottom": "8px",
					}}
				>
					<Show when={view() === "files"}>
						<LauncherButton
							variant="ghost"
							icon_only={true}
							onClick={() => setView("metadata")}
							style={{
								"border-radius": "8px",
								"margin-left": "-4px",
							}}
							title="Back to Metadata"
						>
							<BackIcon width={18} height={18} fill="currentColor" />
						</LauncherButton>
					</Show>
					<div
						style={{
							flex: 1,
							display: "flex",
							"flex-direction": "column",
							gap: "2px",
						}}
					>
						<DialogTitle style={{ "line-height": 1.2 }}>
							Export Instance: {props.instanceName}
						</DialogTitle>
						<DialogDescription style={{ "line-height": 1.4 }}>
							{view() === "metadata"
								? "Configure modpack metadata and format."
								: "Select the files you want to include in the modpack."}
						</DialogDescription>
					</div>
				</DialogHeader>

				<div
					style={{
						flex: 1,
						overflow: "hidden",
						margin: "10px 0",
						display: "flex",
						"flex-direction": "column",
						gap: "12px",
						padding: view() === "metadata" ? "1px" : "0", // Small padding for metadata view
					}}
				>
					<Show when={view() === "files"}>
						<div
							style={{
								flex: 1,
								overflow: "auto",
								padding: "4px",
								display: "flex",
								"flex-direction": "column",
								gap: "2px",
								border: "1px solid var(--border-subtle)",
								"border-radius": "8px",
								background: "var(--surface-sunken)",
							}}
						>
							<Show when={candidates.loading}>
								<div
									style={{
										"text-align": "center",
										padding: "40px",
										opacity: 0.6,
									}}
								>
									Scanning instance directory...
								</div>
							</Show>

							<Show when={!candidates.loading && tree().length === 0}>
								<div
									style={{
										"text-align": "center",
										padding: "40px",
										opacity: 0.6,
									}}
								>
									No exportable files found.
								</div>
							</Show>

							<For each={tree()}>
								{(item) => <TreeRow item={item} depth={0} />}
							</For>
						</div>
					</Show>

					<Show when={view() === "metadata"}>
						<div
							style={{
								display: "flex",
								"flex-direction": "column",
								gap: "12px",
								flex: 1,
								"overflow-y": "visible",
							}}
						>
							<div style={{ display: "flex", gap: "12px" }}>
								<TextFieldRoot style={{ flex: 1 }}>
									<TextFieldLabel>Modpack Name</TextFieldLabel>
									<TextFieldInput
										value={modpackName()}
										onInput={(e: any) => setModpackName(e.currentTarget.value)}
										placeholder="My Modpack"
									/>
								</TextFieldRoot>
								<TextFieldRoot style={{ width: "120px" }}>
									<TextFieldLabel>Version</TextFieldLabel>
									<TextFieldInput
										value={version()}
										onInput={(e: any) => setVersion(e.currentTarget.value)}
										placeholder="1.0.0"
									/>
								</TextFieldRoot>
							</div>

							<div style={{ display: "flex", gap: "12px" }}>
								<TextFieldRoot style={{ flex: 1 }}>
									<TextFieldLabel>Author</TextFieldLabel>
									<TextFieldInput
										value={author()}
										onInput={(e: any) => setAuthor(e.currentTarget.value)}
										placeholder="Username"
									/>
								</TextFieldRoot>
								<TextFieldRoot style={{ flex: 1 }}>
									<TextFieldLabel>Format</TextFieldLabel>
									<Select
										options={["modrinth", "curseforge"]}
										value={exportFormat()}
										onChange={setExportFormat}
										itemComponent={(props) => (
											<SelectItem item={props.item}>
												{props.item.rawValue.charAt(0).toUpperCase() +
													props.item.rawValue.slice(1)}
											</SelectItem>
										)}
									>
										<SelectTrigger>
											<SelectValue<string>>
												{(s) => s.selectedOption()}
											</SelectValue>
										</SelectTrigger>
										<SelectContent />
									</Select>
								</TextFieldRoot>
							</div>

							<TextFieldRoot
								style={{ flex: 1, display: "flex", "flex-direction": "column" }}
							>
								<TextFieldLabel>Description</TextFieldLabel>
								<TextFieldTextArea
									value={description()}
									onInput={(e: any) => setDescription(e.currentTarget.value)}
									placeholder="A short description of your modpack..."
									style={{ flex: 1, "min-height": "100px", resize: "none" }}
								/>
							</TextFieldRoot>

							<LauncherButton
								variant="outline"
								onClick={() => setView("files")}
								class={styles["select-files-button"]}
								style={{
									"margin-top": "4px",
									width: "100%",
									"justify-content": "space-between",
								}}
							>
								<div
									style={{
										display: "flex",
										"align-items": "center",
										gap: "8px",
									}}
								>
									<span style={{ "font-weight": "inherit" }}>
										Select Files to Include
									</span>
									<span
										style={{
											opacity: 0.5,
											"font-size": "11px",
											"font-weight": "400",
										}}
									>
										({selections().size} items selected)
									</span>
								</div>
								<RightArrowIcon width={14} height={14} />
							</LauncherButton>
						</div>
					</Show>
				</div>

				<div
					style={{
						"border-top": "1px solid var(--border-subtle)",
						"padding-top": "16px",
						display: "flex",
						"justify-content": "flex-end",
						gap: "10px",
						"margin-top": "4px",
						"flex-shrink": 0,
					}}
				>
					<LauncherButton variant="ghost" onClick={props.onClose}>
						Cancel
					</LauncherButton>
					<LauncherButton
						color="primary"
						onClick={handleExport}
						disabled={selections().size === 0 || isExporting()}
					>
						{isExporting() ? "Exporting..." : "Export"}
					</LauncherButton>
				</div>
			</DialogContent>
		</Dialog>
	);
}
