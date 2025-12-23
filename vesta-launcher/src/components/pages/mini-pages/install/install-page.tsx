import LauncherButton from "@ui/button/button";
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

function InstallPage() {
	// Safe navigation wrapper
	const navigate = (() => {
		try {
			return useNavigate();
		} catch (e) {
			console.warn("Router context not found, navigation disabled");
			return (path: string) => console.log("Mock navigation to:", path);
		}
	})();

	onMount(async () => {
		await listen<{ name: string }>("core://instance-installed", async (ev) => {
			showToast({
				title: "Installation Complete",
				description: `Instance \"${ev.payload.name}\" installed successfully`,
				severity: "Success",
				duration: 4000,
			});

			// Check if we're in a mini window and close it
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			const currentWindow = getCurrentWindow();
			const label = currentWindow.label;
			console.log("[InstallPage] Current window label:", label);

			if (label.startsWith("mini-")) {
				console.log("[InstallPage] Closing mini window");
				await currentWindow.close();
			} else {
				console.log("[InstallPage] Navigating to home");
				navigate("/home");
			}
		});
	});

	// Basic State
	const [activeTab, setActiveTab] = createSignal("basic");
	const [instanceName, setInstanceName] = createSignal("");
	const [selectedVersion, setSelectedVersion] = createSignal<string>("");
	const [selectedModloader, setSelectedModloader] =
		createSignal<string>("vanilla");
	const [selectedModloaderVersion, setSelectedModloaderVersion] =
		createSignal<string>("");
	const [iconPath, setIconPath] = createSignal<string | null>(null);

	// Advanced State
	const [javaArgs, setJavaArgs] = createSignal("");
	const [memory, setMemory] = createSignal([2048]); // Slider uses array
	const [resolutionWidth, setResolutionWidth] = createSignal("854");
	const [resolutionHeight, setResolutionHeight] = createSignal("480");

	const [isInstalling, setIsInstalling] = createSignal(false);
	const [isReloading, setIsReloading] = createSignal(false);

	let fileInputRef: HTMLInputElement | undefined;

	// Fetch Minecraft versions
	const [
		metadata,
		{
			refetch: refetchVersions,
			loading: metadataLoading,
			error: metadataError,
		},
	] = createResource<PistonMetadata>(getMinecraftVersions);

	const isMetadataLoading = () =>
		typeof metadataLoading === "function"
			? (metadataLoading as () => boolean)()
			: Boolean(metadataLoading);
	const getMetadataError = () =>
		typeof metadataError === "function"
			? (metadataError as () => any)()
			: metadataError;

	// Get stable versions list for dropdown, filtered by modloader
	const filteredVersions = () => {
		const loader = selectedModloader();
		if (!metadata()) return [];

		return metadata()!.game_versions.filter((v) => {
			// Only show stable versions
			if (!v.stable) return false;

			// If vanilla, show all stable versions
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
		const versions = filteredVersions();
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

	// Handle image upload
	const handleImageUpload = () => {
		fileInputRef?.click();
	};

	const onFileSelected = (e: Event) => {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const file = target.files[0];
			console.log("File selected:", file.name);
			const reader = new FileReader();
			reader.onload = (e) => {
				setIconPath(e.target?.result as string);
			};
			reader.readAsDataURL(file);
		}
	};

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
				minecraft_version: version,
				modloader: selectedModloader() || "vanilla",
				modloader_version: selectedModloaderVersion() || undefined,
				icon_path: iconPath() || undefined,
			};

			// Create instance in database
			const instanceId = await createInstance(instanceData);

			// Get full instance and queue installation
			const fullInstance: Instance = {
				id: { VALUE: instanceId },
				name,
				minecraft_version: version,
				modloader: selectedModloader() || "vanilla",
				modloader_version: selectedModloaderVersion() || null,
				java_path: null,
				java_args: javaArgs() || null,
				game_directory: null,
				width: parseInt(resolutionWidth()) || 854,
				height: parseInt(resolutionHeight()) || 480,
				memory_mb: memory()[0],
				icon_path: iconPath(),
				last_played: null,
				total_playtime_minutes: 0,
				created_at: null,
				updated_at: null,
			};

			await installInstance(fullInstance);

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
					<ToggleGroupItem value="basic">Basic</ToggleGroupItem>
					<ToggleGroupItem value="advanced">Advanced</ToggleGroupItem>
				</ToggleGroup>
				<h1 style={"font-size: 2rem; margin: 0;"}>Create New Instance</h1>
			</div>

			<Show when={isMetadataLoading()}>
				<p>Loading Minecraft versions...</p>
			</Show>

			<Show when={getMetadataError()}>
				<p class="error-text">
					Failed to load Minecraft versions: {String(getMetadataError())}
				</p>
			</Show>

			<Show when={metadata()}>
				<div class={"page-wrapper install-form"}>
					{/* Basic Content (Always Visible) */}

					{/* Icon & Name */}
					<div class="form-row icon-name-row">
						<div
							class={"instance-icon-placeholder"}
							title="Click to upload icon"
							onClick={handleImageUpload}
							style={
								iconPath()
									? {
											"background-image": `url('${iconPath()}')`,
											"background-size": "cover",
										}
									: {}
							}
						>
							{!iconPath() && <span>Icon</span>}
						</div>
						<input
							type="file"
							ref={fileInputRef}
							style="display: none"
							accept="image/*"
							onChange={onFileSelected}
						/>

						<TextFieldRoot required={true} style={"flex: 1; min-width: 200px;"}>
							<TextFieldLabel>Instance Name</TextFieldLabel>
							<TextFieldInput
								placeholder="My Awesome Instance"
								value={instanceName()}
								onInput={(e: Event & { currentTarget: HTMLInputElement }) => {
									setInstanceName(e.currentTarget.value);
								}}
							/>
						</TextFieldRoot>
					</div>

					{/* Modloader Pills (Now First) */}
					<div class={"form-field"}>
						<label class={"form-label"}>Modloader</label>
						<ToggleGroup
							value={selectedModloader()}
							onChange={(val) => val && setSelectedModloader(val)}
							class="modloader-pills"
						>
							<For each={uniqueModloaders()}>
								{(loader) => (
									<ToggleGroupItem
										value={loader}
										style="text-transform: capitalize"
									>
										{loader}
									</ToggleGroupItem>
								)}
							</For>
						</ToggleGroup>
					</div>

					{/* Minecraft Version & Modloader Version */}
					<div class="form-row version-row">
						<div class={"form-field"} style="flex: 1; min-width: 200px;">
							<div
								style={{ display: "flex", "align-items": "center", gap: "8px" }}
							>
								<label class={"form-label"}>Minecraft Version</label>
								<LauncherButton
									onClick={handleReload}
									disabled={isReloading()}
									style={{ padding: "4px 8px", "font-size": "0.8rem" }}
								>
									{isReloading() ? "..." : "Reload"}
								</LauncherButton>
							</div>
							<Combobox<string>
								options={filteredVersions().map((v) => v.id)}
								placeholder="Select Minecraft version..."
								value={selectedVersion()}
								onChange={setSelectedVersion}
								itemComponent={(props) => (
									<ComboboxItem item={props.item}>
										<ComboboxItemLabel>{props.item.rawValue}</ComboboxItemLabel>
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

						{/* Modloader Version (Only if not vanilla AND Advanced tab) */}
						<Show
							when={
								activeTab() === "advanced" &&
								selectedModloader() !== "vanilla" &&
								availableModloaderVersions().length > 0
							}
						>
							<div
								class={"form-field"}
								style="flex: 1; min-width: 200px; padding: 4px 0px;"
							>
								<label class={"form-label"}>Modloader Version</label>
								<Combobox
									options={availableModloaderVersions().map((v) => v.version)}
									placeholder="Select version..."
									value={selectedModloaderVersion()}
									onChange={setSelectedModloaderVersion}
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
							</div>
						</Show>
					</div>

					<Show when={activeTab() === "advanced"}>
						{/* Advanced Tab Content */}

						{/* Memory Slider */}
						<div class={"form-field"}>
							<div style="display: flex; justify-content: space-between;">
								<label class={"form-label"}>Memory Allocation</label>
								<span style="font-size: 0.9rem; color: #aaa;">
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

						{/* Java Arguments */}
						<TextFieldRoot>
							<TextFieldLabel>Java Arguments</TextFieldLabel>
							<TextFieldInput
								placeholder="-Xmx4G -XX:+UseG1GC"
								value={javaArgs()}
								onInput={(e: Event & { currentTarget: HTMLInputElement }) => {
									setJavaArgs(e.currentTarget.value);
								}}
							/>
						</TextFieldRoot>

						{/* Resolution */}
						<div class="form-row resolution-row">
							<TextFieldRoot style="flex: 1; min-width: 150px;">
								<TextFieldLabel>Window Width</TextFieldLabel>
								<TextFieldInput
									type="number"
									value={resolutionWidth()}
									onInput={(e: Event & { currentTarget: HTMLInputElement }) => {
										setResolutionWidth(e.currentTarget.value);
									}}
								/>
							</TextFieldRoot>
							<TextFieldRoot style="flex: 1; min-width: 150px;">
								<TextFieldLabel>Window Height</TextFieldLabel>
								<TextFieldInput
									type="number"
									value={resolutionHeight()}
									onInput={(e: Event & { currentTarget: HTMLInputElement }) => {
										setResolutionHeight(e.currentTarget.value);
									}}
								/>
							</TextFieldRoot>
						</div>
					</Show>

					{/* Install Button (Always visible) */}
					<LauncherButton
						onClick={handleInstall}
						disabled={isInstalling() || !instanceName() || !selectedVersion()}
						style={"margin-top: 1rem;"}
					>
						{isInstalling() ? "Creating..." : "Create Instance"}
					</LauncherButton>
				</div>
			</Show>
		</div>
	);
}

export default InstallPage;
