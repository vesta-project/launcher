import { PolymorphicProps } from "@kobalte/core";
import * as ButtonPrimitive from "@kobalte/core/button";
import { ClassProp } from "@ui/props";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@ui/popover/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { clsx } from "clsx";
import { createSignal, For, Show, splitProps, ValidComponent } from "solid-js";
import { DEFAULT_ICONS } from "@utils/instances";
import "./icon-picker.css";

// Icon picker props interface
interface IconPickerProps extends ClassProp {
	/** Current selected icon (can be image URL, gradient, or null) */
	value?: string | null;
	/** Callback when icon is selected */
	onSelect?: (icon: string) => void;
	/** Array of uploaded custom icons (stored separately from defaults) */
	uploadedIcons?: string[];
	/** Props to pass to the trigger button */
	triggerProps?: ButtonPrimitive.ButtonRootProps;
	/** Whether to allow custom image upload (default: true) */
	allowUpload?: boolean;
}

export function IconPicker<T extends ValidComponent = "button">(
	props: PolymorphicProps<T, IconPickerProps>,
) {
	const [local, others] = splitProps(props as IconPickerProps, [
		"class",
		"value",
		"onSelect",
		"uploadedIcons",
		"triggerProps",
		"allowUpload",
	]);

	const [isOpen, setIsOpen] = createSignal(false);
	
	const uploadedIcons = () => local.uploadedIcons || [];
	const allowUpload = () => local.allowUpload !== false; // Default to true
	
	// Calculate total icons and grid dimensions
	const totalIcons = () => {
		const uploaded = uploadedIcons().length;
		const defaults = DEFAULT_ICONS.length;
		const uploadBtn = allowUpload() ? 1 : 0;
		return uploaded + defaults + uploadBtn;
	};
	
	// Dynamic grid columns (max 4, adjust based on icon count)
	const gridColumns = () => Math.min(4, totalIcons());
	
	// Dynamic grid rows (max 3 rows to avoid scrolling)
	const maxRows = 3;
	const iconsPerPage = () => gridColumns() * maxRows;
	
	// Determine if an icon is a gradient or image URL
	const isGradient = (icon: string) => icon.startsWith("linear-gradient");
	
	// Handle file upload
	const handleFileUpload = () => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.onchange = (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (file) {
				const reader = new FileReader();
				reader.onload = (event) => {
					const base64 = event.target?.result as string;
					if (base64 && local.onSelect) {
						local.onSelect(base64);
						setIsOpen(false);
					}
				};
				reader.readAsDataURL(file);
			}
		};
		input.click();
	};

	// Handle icon selection
	const handleSelect = (icon: string) => {
		if (local.onSelect) {
			local.onSelect(icon);
		}
		setIsOpen(false);
	};

	// Get current icon style for trigger display
	const getTriggerStyle = () => {
		const icon = local.value || DEFAULT_ICONS[0];
		if (isGradient(icon)) {
			return { background: icon };
		}
		return { "background-image": `url('${icon}')` };
	};

	return (
		<Popover open={isOpen()} onOpenChange={setIsOpen}>
			<PopoverAnchor as="div" class="icon-picker__anchor">
				<PopoverTrigger
					as={ButtonPrimitive.Root}
					class={clsx("icon-picker__trigger", local.class)}
					style={getTriggerStyle()}
					{...local.triggerProps}
				/>
			</PopoverAnchor>
			<PopoverContent 
				class="icon-picker__content" 
				style={{ width: `${gridColumns() * 64 + (gridColumns() - 1) * 8 + 32}px` }}
			>
				<div 
					class="icon-picker__grid" 
					style={{ "grid-template-columns": `repeat(${gridColumns()}, 1fr)` }}
				>
					{/* Upload button as first "icon" (plus symbol) */}
					<Show when={allowUpload()}>
						<Tooltip placement="top">
							<TooltipTrigger>
								<button
									class="icon-picker__option icon-picker__upload-btn"
									onClick={handleFileUpload}
								>
									<svg
										width="24"
										height="24"
										viewBox="0 0 24 24"
										fill="none"
										xmlns="http://www.w3.org/2000/svg"
									>
										<path
											d="M12 5V19M5 12H19"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</button>
							</TooltipTrigger>
							<TooltipContent>Upload custom icon</TooltipContent>
						</Tooltip>
					</Show>

					{/* Uploaded icons (displayed first after upload button) */}
					<For each={uploadedIcons()}>
						{(icon) => (
							<button
								class={clsx(
									"icon-picker__option",
									local.value === icon && "icon-picker__option--selected",
								)}
								style={{
									"background-image": `url('${icon}')`,
									"background-size": "cover",
									"background-position": "center",
								}}
								onClick={() => handleSelect(icon)}
							>
								<Show when={local.value === icon}>
									<svg
										class="icon-picker__tick"
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										xmlns="http://www.w3.org/2000/svg"
									>
										<path
											d="M20 6L9 17L4 12"
											stroke="white"
											stroke-width="3"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</Show>
							</button>
						)}
					</For>

					{/* Default icons */}
					<For each={DEFAULT_ICONS}>
						{(icon) => (
							<button
								class={clsx(
									"icon-picker__option",
									local.value === icon && "icon-picker__option--selected",
								)}
								style={
									isGradient(icon)
										? { background: icon }
										: {
												"background-image": `url('${icon}')`,
												"background-size": "cover",
												"background-position": "center",
											}
								}
								onClick={() => handleSelect(icon)}
							>
								<Show when={local.value === icon}>
									<svg
										class="icon-picker__tick"
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										xmlns="http://www.w3.org/2000/svg"
									>
										<path
											d="M20 6L9 17L4 12"
											stroke="white"
											stroke-width="3"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</Show>
							</button>
						)}
					</For>
				</div>
			</PopoverContent>
		</Popover>
	);
}

export { type IconPickerProps };