import CurseForgeIcon from "@assets/curseforge.svg";
import FolderIcon from "@assets/folder.svg";
import ModrinthIcon from "@assets/modrinth.svg";
import { open } from "@tauri-apps/plugin-shell";
import LauncherButton from "@ui/button/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/select/select";
import { TextFieldInput, TextFieldRoot } from "@ui/text-field/text-field";
import type { ExternalInstanceCandidate } from "@utils/launcher-imports";
import { type Component, For, Show } from "solid-js";
import styles from "../install-page.module.css";

interface LauncherDetailsPanelProps {
	basePath: string;
	instances: ExternalInstanceCandidate[];
	selectedInstancePath: string;
	hasScanned: boolean;
	isLoading: boolean;
	isImporting: boolean;
	onPathChange: (path: string) => void;
	onBrowse: () => void;
	onRescan: () => void;
	onSelectInstance: (path: string) => void;
	onImport: () => void;
}

function hasValue(value: string | null | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function hasNumber(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function formatSource(
	platform: string | null | undefined,
): { label: string; icon?: Component<{ class?: string }> } | null {
	const normalized = (platform ?? "").trim().toLowerCase();
	if (!normalized) return null;
	if (normalized.includes("modrinth")) return { label: "Modrinth", icon: ModrinthIcon };
	if (normalized.includes("curse")) return { label: "CurseForge", icon: CurseForgeIcon };
	return { label: platform?.trim() ?? normalized };
}

function formatUnixTime(value: number | null | undefined): string | null {
	if (!hasNumber(value)) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleString();
}

function formatBytes(value: number | null | undefined): string | null {
	if (!hasNumber(value) || value < 0) return null;
	const units = ["B", "KB", "MB", "GB", "TB"];
	let size = value;
	let idx = 0;
	while (size >= 1024 && idx < units.length - 1) {
		size /= 1024;
		idx += 1;
	}
	const rounded = idx === 0 ? `${Math.round(size)}` : size.toFixed(1);
	return `${rounded} ${units[idx]}`;
}

interface StatPill {
	label: string;
	value: number;
}

interface MetaRow {
	label: string;
	value: string;
}

export function LauncherDetailsPanel(props: LauncherDetailsPanelProps) {
	const getInstance = () =>
		props.instances.find((item) => item.instancePath === props.selectedInstancePath) ?? null;

	const instanceLabel = (instancePath: string) => {
		const inst = props.instances.find((item) => item.instancePath === instancePath);
		if (!inst) return "Select an instance";
		const suffix = inst.minecraftVersion ? ` (${inst.minecraftVersion})` : "";
		return `${inst.name}${suffix}`;
	};

	const pills = (): StatPill[] => {
		const inst = getInstance();
		if (!inst) return [];
		const result: StatPill[] = [];
		if (hasNumber(inst.modsCount)) result.push({ label: "Mods", value: inst.modsCount });
		if (hasNumber(inst.resourcepacksCount))
			result.push({ label: "Packs", value: inst.resourcepacksCount });
		if (hasNumber(inst.shaderpacksCount))
			result.push({ label: "Shaders", value: inst.shaderpacksCount });
		if (hasNumber(inst.worldsCount)) result.push({ label: "Worlds", value: inst.worldsCount });
		if (hasNumber(inst.screenshotsCount))
			result.push({ label: "Shots", value: inst.screenshotsCount });
		return result;
	};

	const metaRows = (): MetaRow[] => {
		const inst = getInstance();
		if (!inst) return [];
		const rows: MetaRow[] = [];
		const lastPlayed = formatUnixTime(inst.lastPlayedAtUnixMs);
		if (lastPlayed) rows.push({ label: "Last Played", value: lastPlayed });
		const dirSize = formatBytes(inst.gameDirectorySizeBytes);
		if (dirSize) rows.push({ label: "Size", value: dirSize });
		const source = formatSource(inst.modpackPlatform);
		if (source) rows.push({ label: "Source", value: source.label });
		if (hasValue(inst.modpackId)) rows.push({ label: "Project ID", value: inst.modpackId as string });
		if (hasValue(inst.modloaderVersion))
			rows.push({ label: "Loader", value: inst.modloaderVersion as string });
		return rows;
	};

	const sourceInfo = () => formatSource(getInstance()?.modpackPlatform);
	const gameDirPath = () => getInstance()?.gameDirectory ?? null;
	const minecraftVersion = () => getInstance()?.minecraftVersion ?? null;
	const modloader = () => getInstance()?.modloader ?? null;

	const handleOpenFolder = async () => {
		const path = gameDirPath();
		if (path) {
			try {
				await open(path);
			} catch {
				// Silently ignore if the directory can't be opened
			}
		}
	};

	const hasDetails = () =>
		getInstance() !== null && (pills().length > 0 || metaRows().length > 0 || gameDirPath() !== null);

	return (
		<div
			class={`${styles["url-input-container"]} ${styles["url-input-container--launcher"]} ${
				hasDetails() ? styles["url-input-container--with-side"] : ""
			}`}
		>
			{/* ---------- LEFT COLUMN: controls ---------- */}
			<div class={styles["import-panel-main"]}>
				<div class={styles["launcher-path-row"]}>
					<TextFieldRoot class={styles["launcher-path-input"]}>
						<TextFieldInput
							value={props.basePath}
							placeholder="Detected launcher instances path"
							onInput={(e) => props.onPathChange((e.target as HTMLInputElement).value)}
						/>
					</TextFieldRoot>
					<LauncherButton
						variant="slate"
						onClick={props.onBrowse}
						disabled={props.isLoading || props.isImporting}
					>
						Browse
					</LauncherButton>
					<LauncherButton
						variant="solid"
						onClick={props.onRescan}
						disabled={props.isLoading || props.isImporting}
					>
						{props.isLoading ? "Scanning..." : "Rescan"}
					</LauncherButton>
				</div>

				<Show when={props.instances.length > 0}>
					<div
						class={`${styles["launcher-instance-select"]} ${styles["launcher-instance-select--compact"]}`}
					>
						<Select
							value={props.selectedInstancePath}
							onChange={(value) => props.onSelectInstance(String(value))}
							options={props.instances.map((item) => item.instancePath)}
							itemComponent={(selectProps) => (
								<SelectItem item={selectProps.item}>{instanceLabel(selectProps.item.rawValue)}</SelectItem>
							)}
						>
							<SelectTrigger>
								<SelectValue<string>>{(state) => instanceLabel(state.selectedOption() || "")}</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</div>
				</Show>

				<Show when={props.hasScanned && props.instances.length === 0}>
					<p class={styles["fetching-subtext"]}>
						No instances found for the selected launcher and path.
					</p>
				</Show>

				<div class={styles["url-input-row"]}>
					<LauncherButton
						variant="solid"
						onClick={props.onImport}
						disabled={!props.selectedInstancePath || props.isImporting}
					>
						{props.isImporting ? "Importing..." : "Import Selected"}
					</LauncherButton>
				</div>
			</div>

			{/* ---------- RIGHT COLUMN: instance details ---------- */}
			<Show when={hasDetails()}>
				<div class={styles["import-panel-side"]}>
					<div class={styles["import-details-card"]}>
						{/* Name header */}
						<div class={styles["import-details-name"]}>{getInstance()?.name}</div>

						{/* Badge row: MC version, modloader, source with brand icon */}
						<div class={styles["import-details-badges"]}>
							<Show when={minecraftVersion()}>
								<span class={styles["import-badge"]}>MC {minecraftVersion()}</span>
							</Show>
							<Show when={modloader()}>
								<span class={`${styles["import-badge"]} ${styles["import-badge--loader"]}`}>
									{modloader()}
								</span>
							</Show>
							<Show when={sourceInfo()}>
								<span class={`${styles["import-badge"]} ${styles["import-badge--source"]}`}>
									{(() => {
										const si = sourceInfo();
										if (si?.icon) {
											const Icon = si.icon;
											return (
												<>
													<Icon class={styles["import-brand-icon"]} />
													{si.label}
												</>
											);
										}
										return si?.label;
									})()}
								</span>
							</Show>
						</div>

						{/* Stat pills (no icons, just numbers) */}
						<Show when={pills().length > 0}>
							<div class={styles["import-stat-row"]}>
								<For each={pills()}>
									{(pill) => (
										<div class={styles["import-stat-pill"]}>
											<span class={styles["import-stat-value"]}>{pill.value}</span>
											<span class={styles["import-stat-label"]}>{pill.label}</span>
										</div>
									)}
								</For>
							</div>
						</Show>

						{/* Meta rows */}
						<Show when={metaRows().length > 0}>
							<div class={styles["import-meta-list"]}>
								<For each={metaRows()}>
									{(row) => (
										<div class={styles["import-meta-row"]}>
											<span class={styles["import-meta-label"]}>{row.label}</span>
											<span class={styles["import-meta-value"]}>{row.value}</span>
										</div>
									)}
								</For>
							</div>
						</Show>

						{/* Clickable game directory */}
						<Show when={gameDirPath()}>
							<button
								class={styles["import-path-button"]}
								onClick={handleOpenFolder}
								title="Open game directory in file manager"
								type="button"
							>
								<FolderIcon class={styles["import-path-icon"]} />
								<span class={styles["import-path-text"]}>{gameDirPath()}</span>
								<span class={styles["import-path-hint"]}>Open</span>
							</button>
						</Show>
					</div>
				</div>
			</Show>
		</div>
	);
}
