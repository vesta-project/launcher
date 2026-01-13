import LauncherButton from "@ui/button/button";
import { Checkbox } from "@ui/checkbox/checkbox";
import {
	Combobox,
	ComboboxContent,
	ComboboxControl,
	ComboboxInput,
	ComboboxItem,
	ComboboxItemIndicator,
	ComboboxItemLabel,
	ComboboxTrigger,
} from "@ui/combobox/combobox";
import { IconPicker } from "@ui/icon-picker/icon-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@ui/popover/popover";
import {
	Slider,
	SliderFill,
	SliderLabel,
	SliderThumb,
	SliderTrack,
	SliderValueLabel,
} from "@ui/slider/slider";
import {
	TextFieldInput,
	TextFieldLabel,
	TextFieldRoot,
} from "@ui/text-field/text-field";
import { showToast } from "@ui/toast/toast";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import {
	type CreateInstanceData,
	createInstance,
	DEFAULT_ICONS,
	getMinecraftVersions,
	type Instance,
	installInstance,
	type PistonMetadata,
	reloadMinecraftVersions,
} from "@utils/instances";
import {
	createEffect,
	createResource,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import "./install-page.css";
import { useNavigate } from "@solidjs/router";
import { listen } from "@tauri-apps/api/event";

interface InstallPageProps {
	close?: () => void;
}

function InstallPage(props: InstallPageProps) {
	// Safe navigation wrapper
	const _navigate = (() => {
		try {
			return useNavigate();
		} catch (_e) {
			console.warn("Router context not found, navigation disabled");
			return (path: string) => console.log("Mock navigation to:", path);
		}
	})();

	// Basic State
	const [activeTab, setActiveTab] = createSignal("basic");
	const [instanceName, setInstanceName] = createSignal("");
	const [selectedVersion, setSelectedVersion] = createSignal<string>("");
	const [selectedModloader, setSelectedModloader] =
		createSignal<string>("vanilla");
	const [selectedModloaderVersion, setSelectedModloaderVersion] =
		createSignal<string>("");
	const [iconPath, setIconPath] = createSignal<string | null>(null);
	const _effectiveIcon = () => iconPath() || DEFAULT_ICONS[0];

	// Create uploadedIcons array that includes current iconPath if it's an uploaded image (base64 or custom URL)
	const uploadedIcons = () => {
		const current = iconPath();
		// Check if current icon is uploaded (not null, not a default gradient/image)
		if (current && !DEFAULT_ICONS.includes(current)) {
			return [current];
		}
		return [];
	};

	// Advanced State
	const [javaArgs, setJavaArgs] = createSignal("");
	const [memory, setMemory] = createSignal([2048]); // Slider uses array
	const [resolutionWidth, setResolutionWidth] = createSignal("854");
	const [resolutionHeight, setResolutionHeight] = createSignal("480");
	const [includeUnstableVersions, setIncludeUnstableVersions] =
		createSignal(false);

	const [isInstalling, setIsInstalling] = createSignal(false);
	const [isReloading, setIsReloading] = createSignal(false);

	// Fetch Minecraft versions
	const [metadata, { refetch: refetchVersions }] =
		createResource<PistonMetadata>(getMinecraftVersions);

	const isMetadataLoading = () => Boolean(metadata.loading);
	const getMetadataError = () => metadata.error;

	// Initialize selectedVersion with latest stable release after metadata loads
	createEffect(() => {
		const meta = metadata();
		if (meta && !selectedVersion()) {
			const latestRelease = meta.game_versions.find((v) => v.stable);
			if (latestRelease) {
				setSelectedVersion(latestRelease.id);
			}
		}
	});

	// Get stable versions list for dropdown, filtered by modloader
	const filteredVersions = () => {
		const loader = selectedModloader();
		if (!metadata()) return [];

		return metadata()?.game_versions.filter((v) => {
			// Filter by stability (only show unstable if enabled)
			if (!includeUnstableVersions() && !v.stable) return false;

			// If vanilla, show all versions (stable or unstable based on setting)
			if (loader === "vanilla") return true;

			// Otherwise, only show versions that support the selected loader
			return !!v.loaders[loader];
		});
	};

	// Get all unique modloaders across all versions
	const uniqueModloaders = () => {
		if (!metadata()) return ["vanilla"];

		const loaders = new Set<string>(["vanilla"]);
		metadata()?.game_versions.forEach((v) => {
			Object.keys(v.loaders).forEach((l) => loaders.add(l));
		});

		return Array.from(loaders);
	};

	// Get available modloader versions for selected game version and modloader
	const availableModloaderVersions = () => {
		const version = selectedVersion();
		const modloader = selectedModloader();
		if (!version || !modloader || modloader === "vanilla" || !metadata())
			return [];

		const gameVersion = metadata()?.game_versions.find((v) => v.id === version);
		if (!gameVersion) return [];

		return gameVersion.loaders[modloader] || [];
	};

	// Reset version if it becomes invalid when switching modloaders
	createEffect(() => {
		const versions = filteredVersions() || [];
		const current = selectedVersion();
		// If we have a selected version, but it's not in the new filtered list
		if (
			current &&
			versions.length > 0 &&
			!versions.find((v) => v.id === current)
		) {
			setSelectedVersion("");
		}
	});

	// Auto-select first modloader version when modloader changes
	createEffect(() => {
		const modloader = selectedModloader();
		if (modloader !== "vanilla") {
			const versions = availableModloaderVersions();
			if (versions.length > 0) {
				setSelectedModloaderVersion(versions[0].version);
			}
		} else {
			setSelectedModloaderVersion("");
		}
	});

	// Handle reload button
	const handleReload = async () => {
		try {
			setIsReloading(true);
			await reloadMinecraftVersions();
			setTimeout(() => {
				refetchVersions();
			}, 500);
		} catch (e) {
			showToast({
				title: "Reload Failed",
				description: String(e),
				severity: "Error",
				duration: 4000,
			});
		} finally {
			setIsReloading(false);
		}
	};

	// Icon path is now handled by the IconPicker component

	// Handle install button click
	const handleInstall = async () => {
		const name = instanceName().trim();
		const version = selectedVersion();

		if (!name) {
			showToast({
				title: "Invalid Input",
				description: "Please enter an instance name",
				severity: "Error",
				duration: 3000,
			});
			return;
		}

		if (!version) {
			showToast({
				title: "Invalid Input",
				description: "Please select a Minecraft version",
				severity: "Error",
				duration: 3000,
			});
			return;
		}

		setIsInstalling(true);

		try {
			// Create instance data
			const instanceData: CreateInstanceData = {
				name,
				minecraftVersion: version,
				modloader: selectedModloader() || "vanilla",
				modloaderVersion: selectedModloaderVersion() || undefined,
				iconPath: iconPath() || undefined,
			};

			// Create instance in database
			const instanceId = await createInstance(instanceData);

			// Get full instance and queue installation
			const fullInstance: Instance = {
				id: instanceId,
				name,
				minecraftVersion: version,
				modloader: selectedModloader() || "vanilla",
				modloaderVersion: selectedModloaderVersion() || null,
				javaPath: null,
				javaArgs: javaArgs() || null,
				gameDirectory: null,
				width: parseInt(resolutionWidth()) || 854,
				height: parseInt(resolutionHeight()) || 480,
				memoryMb: memory()[0],
				iconPath: iconPath(),
				lastPlayed: null,
				totalPlaytimeMinutes: 0,
				createdAt: null,
				updatedAt: null,
			};

			// Close mini-router immediately when installation begins
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			const currentWindow = getCurrentWindow();
			const label = currentWindow.label;
			if (!label.startsWith("page-viewer-")) {
				// Not a standalone window, so close the mini-window overlay
				props.close?.();
			}

			await installInstance(fullInstance);

			// // Close standalone windows after installation completes
			// if (label.startsWith("page-viewer-")) {
			// 	await currentWindow.close();
			// }

			// Reset form
			setInstanceName("");
			setSelectedVersion("");
			setSelectedModloader("vanilla");
			setSelectedModloaderVersion("");
			setIconPath(null);
			setJavaArgs("");
			setMemory([2048]);
		} catch (error) {
			console.error("[Install] Installation failed:", error);
			showToast({
				title: "Installation Failed",
				description: String(error),
				severity: "Error",
				duration: 5000,
			});
		} finally {
			setIsInstalling(false);
		}
	};

	return (
		<div class={"page-root"}>
			<div class="header-container">
				<ToggleGroup
					value={activeTab()}
					onChange={(val) => val && setActiveTab(val)}
					class="install-tabs"
				>
					<ToggleGroupItem value="basic">Basic Settings</ToggleGroupItem>
					<ToggleGroupItem value="advanced">Advanced Settings</ToggleGroupItem>
				</ToggleGroup>
			</div>

			<Show when={isMetadataLoading()}>
				<div class="instance-loading">
					<p>Fetching Minecraft versions...</p>
				</div>
			</Show>

			<Show when={getMetadataError()}>
				<div class="instance-error">
					<p class="error-text">
						Failed to load Minecraft versions: {String(getMetadataError())}
					</p>
					<LauncherButton onClick={handleReload}>Retry</LauncherButton>
				</div>
			</Show>

			<Show when={metadata()}>
				<div class={"page-wrapper"}>
					<div class="install-form">
						{/* Left Column: Identity & Version */}
						<div class="form-section">
							<div class="form-row" style={{ "align-items": "flex-start" }}>
								<IconPicker
									value={iconPath()}
									onSelect={(icon) => setIconPath(icon)}
									uploadedIcons={uploadedIcons()}
									allowUpload={true}
									showHint={true}
								/>
								<TextFieldRoot
									required={true}
									style={"flex: 1; min-width: 200px;"}
								>
									<TextFieldLabel>Instance Name</TextFieldLabel>
									<TextFieldInput
										placeholder="My Awesome Instance"
										value={instanceName()}
										onInput={(e: any) => {
											setInstanceName(e.currentTarget.value);
										}}
									/>
								</TextFieldRoot>
							</div>

							<h2 class="form-section-title" style="margin-top: 12px;">
								Version
							</h2>
							<div class="form-field">
								<label class="form-label">Modloader</label>
								<ToggleGroup
									value={selectedModloader()}
									onChange={(val) => val && setSelectedModloader(val)}
									class="modloader-pills"
								>
									<For each={uniqueModloaders()}>
										{(loader) => (
											<ToggleGroupItem value={loader}>
												{loader.charAt(0).toUpperCase() + loader.slice(1)}
											</ToggleGroupItem>
										)}
									</For>
								</ToggleGroup>
							</div>

							<div class="form-row">
								<div class="form-field">
									<div
										style={{
											display: "flex",
											"align-items": "center",
											gap: "8px",
										}}
									>
										<label class="form-label">Minecraft Version</label>
										<LauncherButton
											onClick={handleReload}
											disabled={isReloading()}
											style={{ padding: "2px 6px", "font-size": "0.7rem" }}
										>
											{isReloading() ? "..." : "Reload"}
										</LauncherButton>
									</div>
									<Combobox
										options={(filteredVersions() || []).map((v) => v.id)}
										value={selectedVersion()}
										onChange={(val) => val && setSelectedVersion(val)}
										placeholder="Select version..."
										itemComponent={(props) => (
											<ComboboxItem item={props.item}>
												<ComboboxItemLabel>
													{props.item.rawValue}
												</ComboboxItemLabel>
												<ComboboxItemIndicator />
											</ComboboxItem>
										)}
									>
										<ComboboxControl aria-label="Minecraft Version">
											<ComboboxInput />
											<ComboboxTrigger />
										</ComboboxControl>
										<ComboboxContent />
									</Combobox>
								</div>
							</div>
						</div>

						{/* Right Column: Advanced Settings */}
						<Show when={activeTab() === "advanced"}>
							<div class="form-section">
								<h2 class="form-section-title">Version Options</h2>
								<div class="form-field">
									<Checkbox
										checked={includeUnstableVersions()}
										onChange={setIncludeUnstableVersions}
									>
										Include unstable versions (snapshots, alphas, betas)
									</Checkbox>
									<div class="helper-text" style="margin-top: 4px;">
										⚠️ Unstable versions may be unstable and incompatible with
										mods
									</div>
								</div>

								<Show when={selectedModloader() !== "vanilla"}>
									<h2 class="form-section-title">Modloader</h2>
									<div class="form-field">
										<label class="form-label">
											{selectedModloader().charAt(0).toUpperCase() +
												selectedModloader().slice(1)}{" "}
											Version
										</label>
										<Show
											when={selectedVersion()}
											fallback={
												<div class="helper-text">
													Select a Minecraft version first
												</div>
											}
										>
											<Combobox
												options={availableModloaderVersions().map(
													(v) => v.version,
												)}
												value={selectedModloaderVersion()}
												onChange={(val) =>
													val && setSelectedModloaderVersion(val)
												}
												placeholder="Select loader version..."
												itemComponent={(props) => (
													<ComboboxItem item={props.item}>
														<ComboboxItemLabel>
															{props.item.rawValue}
														</ComboboxItemLabel>
														<ComboboxItemIndicator />
													</ComboboxItem>
												)}
											>
												<ComboboxControl aria-label="Modloader Version">
													<ComboboxInput />
													<ComboboxTrigger />
												</ComboboxControl>
												<ComboboxContent />
											</Combobox>
										</Show>
									</div>
								</Show>

								<h2 class="form-section-title">Performance</h2>
								<div class="form-field">
									<div
										style={{
											display: "flex",
											"justify-content": "space-between",
											"align-items": "center",
										}}
									>
										<label class="form-label">Memory Allocation</label>
										<span style="font-size: 0.85rem; opacity: 0.7;">
											{memory()[0]} MB
										</span>
									</div>
									<Slider
										value={memory()}
										onChange={setMemory}
										minValue={1024}
										maxValue={16384}
										step={512}
									>
										<SliderTrack>
											<SliderFill />
											<SliderThumb />
										</SliderTrack>
									</Slider>
								</div>

								<h2 class="form-section-title" style="margin-top: 12px;">
									Display
								</h2>
								<div class="form-row">
									<TextFieldRoot style="flex: 1;">
										<TextFieldLabel>Width</TextFieldLabel>
										<TextFieldInput
											value={resolutionWidth()}
											onInput={(e: any) => setResolutionWidth(e.target.value)}
										/>
									</TextFieldRoot>
									<TextFieldRoot style="flex: 1;">
										<TextFieldLabel>Height</TextFieldLabel>
										<TextFieldInput
											value={resolutionHeight()}
											onInput={(e: any) => setResolutionHeight(e.target.value)}
										/>
									</TextFieldRoot>
								</div>

								<h2 class="form-section-title" style="margin-top: 12px;">
									Java
								</h2>
								<TextFieldRoot>
									<TextFieldLabel>JVM Arguments</TextFieldLabel>
									<TextFieldInput
										placeholder="-Xmx2G -XX:+UseG1GC..."
										value={javaArgs()}
										onInput={(e: any) => setJavaArgs(e.target.value)}
									/>
								</TextFieldRoot>
							</div>
						</Show>
					</div>

					<div
						style={{
							display: "flex",
							"justify-content": "flex-end",
							gap: "12px",
							"margin-top": "12px",
						}}
					>
						<LauncherButton
							color="primary"
							size="md"
							disabled={!instanceName() || !selectedVersion() || isInstalling()}
							onClick={handleInstall}
							style="min-width: 200px;"
						>
							{isInstalling() ? "Installing..." : "Create & Install"}
						</LauncherButton>
					</div>
				</div>
			</Show>
		</div>
	);
}

export default InstallPage;
