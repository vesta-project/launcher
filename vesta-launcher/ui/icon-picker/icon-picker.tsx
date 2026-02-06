import {
	Popover,
	PopoverContent,
	PopoverTrigger,
	PopoverCloseButton,
} from "@ui/popover/popover";
import { clsx } from "clsx";
import { createSignal, For, Show, splitProps } from "solid-js";
import { DEFAULT_ICONS } from "@utils/instances";
import CubeIcon from "@assets/cube.svg";
import styles from "./icon-picker.module.css";
import { ClassProp } from "@ui/props";

// Icon picker props interface
interface IconPickerProps extends ClassProp {
	/** Current selected icon (can be image URL, gradient, or null) */
	value?: string | null;
	/** Callback when icon is selected */
	onSelect?: (icon: string) => void;
	/** Array of uploaded custom icons (stored separately from defaults) */
	uploadedIcons?: string[];
	/** Icon that should be marked as a modpack icon with a badge */
	modpackIcon?: string | null;
	/** Whether the modpack icon should be shown as selected even if value doesn't match exactly */
	isSuggestedSelected?: boolean;
	/** Props to pass to the trigger button */
	triggerProps?: any;
	/** Whether to allow custom image upload (default: true) */
	allowUpload?: boolean;
	/** Whether to show a "click to change" hint (useful for onboarding) */
	showHint?: boolean;
}

export function IconPicker(props: IconPickerProps) {
	const [local] = splitProps(props, [
		"class",
		"value",
		"onSelect",
		"uploadedIcons",
		"modpackIcon",
		"isSuggestedSelected",
		"triggerProps",
		"allowUpload",
		"showHint",
	]);

	const handleOpenChange = (open: boolean) => {
		setIsOpen(open);
		console.log('IconPicker popover', open ? 'opened' : 'closed');
		console.log('IconPicker state:', {
			value: local.value?.substring(0, 50),
			modpackIcon: local.modpackIcon?.substring(0, 50),
			isSuggestedSelected: local.isSuggestedSelected,
			uploadedIconsCount: local.uploadedIcons?.length
		});
	};
	
	const [isOpen, setIsOpen] = createSignal(false);
	
	const totalIcons = () => {
		const uploaded = (local.uploadedIcons || []).length;
		const uploadBtn = local.allowUpload !== false ? 1 : 0;
		return uploaded + DEFAULT_ICONS.length + uploadBtn;
	};
	
	const gridColumns = () => Math.min(4, totalIcons());

	const getIconStyle = (icon?: string | null) => {
		let target = icon || DEFAULT_ICONS[0];
		if (target.startsWith("linear-gradient")) return { background: target };
		return {
			"background-image": `url('${target}')`,
			"background-size": "cover",
			"background-position": "center",
		};
	};
	
	const handleFileUpload = () => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.onchange = (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (event) => {
				const img = new Image();
				img.onload = () => {
					const canvas = document.createElement("canvas");
					const ctx = canvas.getContext("2d");
					const MAX_SIZE = 512;
					let { width, height } = img;

					if (width > height) {
						if (width > MAX_SIZE) {
							height *= MAX_SIZE / width;
							width = MAX_SIZE;
						}
					} else if (height > MAX_SIZE) {
						width *= MAX_SIZE / height;
						height = MAX_SIZE;
					}
					
					canvas.width = width;
					canvas.height = height;
					
					if (ctx) {
						ctx.imageSmoothingEnabled = true;
						ctx.imageSmoothingQuality = "high";
						ctx.drawImage(img, 0, 0, width, height);
						const compressedBase64 = canvas.toDataURL("image/png");
						local.onSelect?.(compressedBase64);
						console.log('Icon uploaded:', compressedBase64);
					}
				};
				img.src = event.target?.result as string;
			};
			reader.readAsDataURL(file);
		};
		input.click();
	};

	return (
		<div class={styles["icon-picker__anchor"]}>
			<Popover open={isOpen()} onOpenChange={handleOpenChange}>
				<PopoverTrigger
					{...local.triggerProps}
					class={clsx(
						styles["icon-picker__trigger"],
						local.class,
						local.showHint && styles["icon-picker__trigger--hint"],
						local.triggerProps?.class,
					)}
					style={{
						...getIconStyle(local.value),
						...(local.triggerProps?.style as any),
					}}
				>
					<div class={styles["icon-picker__edit-overlay"]}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
							<path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13M18.5 2.5C18.8978 2.10217 19.4374 1.87868 20 1.87868C20.5626 1.87868 21.1022 2.10217 21.5 2.5C21.8978 2.89782 22.1213 3.43739 22.1213 4C22.1213 4.56261 21.8978 5.10217 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</div>
					<Show when={local.showHint}>
						<div class={styles["icon-picker__hint-badge"]}>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none">
								<path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						</div>
					</Show>
					<Show when={local.modpackIcon && (local.value === local.modpackIcon || local.isSuggestedSelected)}>
						<div class={styles["icon-picker__trigger-badge"]}>
							<CubeIcon fill="currentColor" width="12" height="12" />
						</div>
					</Show>
				</PopoverTrigger>
				<PopoverContent
					class={styles["icon-picker__content"]}
					style={{ width: `${gridColumns() * 64 + (gridColumns() - 1) * 8 + 32}px` }}
				>
					<div 
						class={styles["icon-picker__grid"]} 
						style={{ "grid-template-columns": `repeat(${gridColumns()}, 1fr)` }}
					>
						<Show when={local.allowUpload !== false}>
							<PopoverCloseButton
								class={clsx(styles["icon-picker__option"], styles["icon-picker__upload-btn"])}
								onClick={(e) => { e.stopPropagation(); console.log('Upload button clicked'); handleFileUpload(); }}
							>
								<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
									<path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
								</svg>
							</PopoverCloseButton>
						</Show>

						<For each={local.uploadedIcons || []}>
							{(icon) => {
								const isSelected = local.value === icon || (icon === local.modpackIcon && local.isSuggestedSelected);
								console.log('IconPicker uploaded icon:', {
									icon: icon?.substring(0, 30) + '...',
									isValueMatch: local.value === icon,
									isModpackMatch: icon === local.modpackIcon,
									isSuggestedSelected: local.isSuggestedSelected,
									isSelected: isSelected
								});
								return (
								<PopoverCloseButton
									class={clsx(styles["icon-picker__option"], isSelected && styles["icon-picker__option--selected"])}
									style={getIconStyle(icon)}
									onClick={() => { local.onSelect?.(icon); console.log('Icon selected:', icon); }}
								>
									<Show when={isSelected}>
										<svg class={styles["icon-picker__tick"]} width="20" height="20" viewBox="0 0 24 24" fill="none">
											<path d="M20 6L9 17L4 12" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
										</svg>
									</Show>
									<Show when={icon === local.modpackIcon}>
										<div class={styles["icon-picker__option-badge"]}>
											<CubeIcon fill="currentColor" width="12" height="12" />
										</div>
									</Show>
								</PopoverCloseButton>
							)}}
						</For>

						<For each={DEFAULT_ICONS}>
							{(icon) => (
								<PopoverCloseButton
									class={clsx(styles["icon-picker__option"], (local.value === icon || (icon === local.modpackIcon && local.isSuggestedSelected)) && styles["icon-picker__option--selected"])}
									style={getIconStyle(icon)}
									onClick={() => { local.onSelect?.(icon); console.log('Icon selected:', icon); }}
								>
									<Show when={local.value === icon || (icon === local.modpackIcon && local.isSuggestedSelected)}>
										<svg class={styles["icon-picker__tick"]} width="20" height="20" viewBox="0 0 24 24" fill="none">
											<path d="M20 6L9 17L4 12" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
										</svg>
									</Show>
									<Show when={icon === local.modpackIcon}>
										<div class={styles["icon-picker__option-badge"]}>
											<CubeIcon fill="currentColor" width="12" height="12" />
										</div>
									</Show>
								</PopoverCloseButton>
							)}
						</For>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}

export { type IconPickerProps };