import LauncherButton from "@ui/button/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/select/select";
import { TextFieldInput, TextFieldRoot } from "@ui/text-field/text-field";
import type { ExternalInstanceCandidate } from "@utils/launcher-imports";
import { Show } from "solid-js";
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

export function LauncherDetailsPanel(props: LauncherDetailsPanelProps) {
	const selectedInstance = () =>
		props.instances.find((item) => item.instancePath === props.selectedInstancePath) ?? null;

	const instanceLabel = (instancePath: string) => {
		const instance = props.instances.find((item) => item.instancePath === instancePath);
		if (!instance) return "Select an instance";
		return `${instance.name}${instance.minecraftVersion ? ` (${instance.minecraftVersion})` : ""}`;
	};

	const hasValue = (value?: string | null) => !!value && value.trim().length > 0;
	const hasNumber = (value?: number | null) => typeof value === "number" && Number.isFinite(value);
	const formatSource = (platform?: string | null) => {
		const normalized = (platform ?? "").trim().toLowerCase();
		if (!normalized) return null;
		if (normalized.includes("modrinth")) return "Modrinth";
		if (normalized.includes("curse")) return "CurseForge";
		return platform ?? null;
	};
	const formatUnixTime = (value?: number | null) => {
		if (!hasNumber(value)) return null;
		const date = new Date(value!);
		if (Number.isNaN(date.getTime())) return null;
		return date.toLocaleString();
	};
	const formatBytes = (value?: number | null) => {
		if (!hasNumber(value) || value! < 0) return null;
		const units = ["B", "KB", "MB", "GB", "TB"];
		let size = value!;
		let idx = 0;
		while (size >= 1024 && idx < units.length - 1) {
			size /= 1024;
			idx += 1;
		}
		const rounded = idx === 0 ? `${Math.round(size)}` : size.toFixed(1);
		return `${rounded} ${units[idx]}`;
	};
	const selectedDetails = () => {
		const instance = selectedInstance();
		if (!instance) return [];
		const details: Array<{ label: string; value: string }> = [];
		if (hasValue(instance.minecraftVersion)) {
			details.push({ label: "Minecraft", value: instance.minecraftVersion!.trim() });
		}
		if (hasValue(instance.modloader)) {
			details.push({ label: "Modloader", value: instance.modloader!.trim() });
		}
		if (hasValue(instance.modloaderVersion)) {
			details.push({ label: "Loader Version", value: instance.modloaderVersion!.trim() });
		}
		const source = formatSource(instance.modpackPlatform);
		if (source && source.trim().length > 0) {
			details.push({ label: "Source", value: source.trim() });
		}
		if (hasValue(instance.modpackId)) {
			details.push({ label: "Modpack ID", value: instance.modpackId!.trim() });
		}
		if (hasValue(instance.modpackVersionId)) {
			details.push({ label: "Version ID", value: instance.modpackVersionId!.trim() });
		}
		const modsCount = hasNumber(instance.modsCount) ? `${instance.modsCount}` : null;
		if (modsCount) details.push({ label: "Mods", value: modsCount });
		const resourcepacksCount = hasNumber(instance.resourcepacksCount)
			? `${instance.resourcepacksCount}`
			: null;
		if (resourcepacksCount) details.push({ label: "Resourcepacks", value: resourcepacksCount });
		const shaderpacksCount = hasNumber(instance.shaderpacksCount)
			? `${instance.shaderpacksCount}`
			: null;
		if (shaderpacksCount) details.push({ label: "Shaderpacks", value: shaderpacksCount });
		const worldsCount = hasNumber(instance.worldsCount) ? `${instance.worldsCount}` : null;
		if (worldsCount) details.push({ label: "Worlds", value: worldsCount });
		const screenshotsCount = hasNumber(instance.screenshotsCount)
			? `${instance.screenshotsCount}`
			: null;
		if (screenshotsCount) details.push({ label: "Screenshots", value: screenshotsCount });
		const lastPlayed = formatUnixTime(instance.lastPlayedAtUnixMs);
		if (lastPlayed) details.push({ label: "Last Played", value: lastPlayed });
		const dirSize = formatBytes(instance.gameDirectorySizeBytes);
		if (dirSize) details.push({ label: "Instance Size", value: dirSize });
		if (hasValue(instance.gameDirectory)) {
			details.push({ label: "Game Directory", value: instance.gameDirectory.trim() });
		}
		return details;
	};

	return (
		<>
			<div class={`${styles["url-input-container"]} ${styles["url-input-container--launcher"]}`}>
				<div class={styles["launcher-path-row"]}>
					<TextFieldRoot class={styles["launcher-path-input"]}>
						<TextFieldInput
							value={props.basePath}
							placeholder="Detected launcher instances path"
							onInput={(e) => props.onPathChange(e.currentTarget.value)}
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
				<Show when={selectedInstance() && selectedDetails().length > 0}>
					{() => (
						<div class={styles["launcher-instance-details"]}>
							<div class={styles["launcher-instance-details-header"]}>Selected Instance Details</div>
							<div class={styles["launcher-instance-details-grid"]}>
								{selectedDetails().map((detail) => (
									<div class={styles["launcher-detail-item"]}>
										<span class={styles["launcher-detail-label"]}>{detail.label}</span>
										<span class={styles["launcher-detail-value"]}>{detail.value}</span>
									</div>
								))}
							</div>
						</div>
					)}
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
		</>
	);
}
