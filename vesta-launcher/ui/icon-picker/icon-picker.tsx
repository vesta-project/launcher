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
	/** A suggested icon (e.g. from a modpack) that stays even if another is picked */
	suggestedIcon?: string | null;
	/** Whether the current value correctly represents the suggested icon (even if it's internal://icon) */
	isSuggestedSelected?: boolean;
	/** Props to pass to the trigger button */
	triggerProps?: any;
	/** Whether to allow custom image upload (default: true) */
	allowUpload?: boolean;
	/** Whether to show a "click to change" hint (useful for onboarding) */
	showHint?: boolean;
}

export function IconPicker<T extends ValidComponent = "button">(
	props: PolymorphicProps<T, IconPickerProps>,
) {
	const [local, _others] = splitProps(props as IconPickerProps, [
		"class",
		"value",
		"onSelect",
		"uploadedIcons",
		"suggestedIcon",
		"isSuggestedSelected",
		"triggerProps",
		"allowUpload",
		"showHint",
	]);

	const [isOpen, setIsOpen] = createSignal(false);
	
	const uploadedIcons = () => local.uploadedIcons || [];
	const allowUpload = () => local.allowUpload !== false; // Default to true
	
	// Calculate total icons and grid dimensions
	const totalIcons = () => {
		const uploaded = uploadedIcons().length;
		const defaults = DEFAULT_ICONS.length;
		const suggested = local.suggestedIcon ? 1 : 0;
		const uploadBtn = allowUpload() ? 1 : 0;
		return uploaded + defaults + suggested + uploadBtn;
	};
	
	// Dynamic grid columns (max 4, adjust based on icon count)
	const gridColumns = () => Math.min(4, totalIcons());
	
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

	// Determine if the suggested icon is selected
	const isSuggestedSelected = () => {
		if (local.isSuggestedSelected) return true;
		if (local.suggestedIcon && local.value === local.suggestedIcon) return true;
		return false;
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
					{...local.triggerProps}
					class={clsx(
						"icon-picker__trigger", 
						local.class,
						local.showHint && "icon-picker__trigger--hint",
						local.triggerProps?.class
					)}
					style={{
						...getTriggerStyle(),
						...(local.triggerProps?.style as any)
					}}
				>
					<div class="icon-picker__edit-overlay">
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13M18.5 2.5C18.8978 2.10217 19.4374 1.87868 20 1.87868C20.5626 1.87868 21.1022 2.10217 21.5 2.5C21.8978 2.89782 22.1213 3.43739 22.1213 4C22.1213 4.56261 21.8978 5.10217 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</div>
					<Show when={local.showHint}>
						<div class="icon-picker__hint-badge">
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								xmlns="http://www.w3.org/2000/svg"
							>
								<path
									d="M12 5V19M5 12H19"
									stroke="currentColor"
									stroke-width="3"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</div>
					</Show>
				</PopoverTrigger>
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

					{/* Suggested/Modpack icon */}
					<Show when={local.suggestedIcon}>
						<Tooltip placement="top">
							<TooltipTrigger>
								<button
									class={clsx(
										"icon-picker__option",
										isSuggestedSelected() && "icon-picker__option--selected",
									)}
									style={{
										"background-image": `url('${local.suggestedIcon}')`,
										"background-size": "cover",
										"background-position": "center",
									}}
									onClick={() => local.suggestedIcon && handleSelect(local.suggestedIcon)}
								>
									<Show when={isSuggestedSelected()}>
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
									{/* Badge for suggested icon */}
									<div class="icon-picker__option-badge">
										<svg 
											width="10" 
											height="10" 
											viewBox="0 0 24 24" 
											fill="none" 
											xmlns="http://www.w3.org/2000/svg"
										>
											<path 
												d="M19.42 15.635C19.79 15.135 20 14.515 20 13.845V10.845C20 10.125 19.5 9.125 18.89 8.625L14.11 4.635C13.5 4.135 12.5 4.135 11.89 4.635L7.11 8.625C6.5 9.125 6 10.125 6 10.845V13.845C6 14.565 6.5 15.565 7.11 16.065L11.89 20.055C12.5 20.555 13.5 20.555 14.11 20.055L14.75 19.515" 
												stroke="currentColor" 
												stroke-width="2" 
												stroke-linecap="round" 
												stroke-linejoin="round"
											/>
											<path 
												d="M15 12V22M15 12C15 10.3431 16.3431 9 18 9C19.6569 9 21 10.3431 21 12C21 13.6569 19.6569 15 18 15C16.3431 15 15 13.6569 15 12ZM15 12L12 12" 
												stroke="currentColor" 
												stroke-width="2" 
												stroke-linecap="round" 
												stroke-linejoin="round"
											/>
										</svg>
									</div>
								</button>
							</TooltipTrigger>
							<TooltipContent>Original Modpack Icon</TooltipContent>
						</Tooltip>
					</Show>

					{/* Uploaded icons (displayed first after upload button) */}
					<For each={uploadedIcons()}>
						{(icon) => (
							<Show when={icon !== local.suggestedIcon}>
								<button
									class={clsx(
										"icon-picker__option",
										!isSuggestedSelected() && local.value === icon && "icon-picker__option--selected",
									)}
									style={{
										"background-image": `url('${icon}')`,
										"background-size": "cover",
										"background-position": "center",
									}}
									onClick={() => handleSelect(icon)}
								>
									<Show when={!isSuggestedSelected() && local.value === icon}>
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
							</Show>
						)}
					</For>

					{/* Default icons */}
					<For each={DEFAULT_ICONS}>
						{(icon) => (
							<Show when={icon !== local.suggestedIcon}>
								<button
									class={clsx(
										"icon-picker__option",
										!isSuggestedSelected() && local.value === icon && "icon-picker__option--selected",
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
									<Show when={!isSuggestedSelected() && local.value === icon}>
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
							</Show>
						)}
					</For>
				</div>
			</PopoverContent>
		</Popover>
	);
}

export { type IconPickerProps };