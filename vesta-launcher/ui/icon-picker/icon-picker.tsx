import AddIcon from "@assets/icons/actions/add.svg";
import EditIcon from "@assets/icons/actions/edit.svg";
import CheckIcon from "@assets/icons/controls/check.svg";
import CubeIcon from "@assets/icons/content/cube.svg";
import {
	Popover,
	PopoverCloseButton,
	PopoverContent,
	PopoverTrigger,
} from "@ui/popover/popover";
import type { ClassProp } from "@ui/props";
import { resolveResourceUrl } from "@utils/assets";
import { DEFAULT_ICONS, getStableIconId } from "@utils/instances";
import { clsx } from "clsx";
import { createMemo, createSignal, For, Show, splitProps } from "solid-js";
import styles from "./icon-picker.module.css";

/**
 * Robustly compares two icon paths/values.
 * If both are data URLs, compares only the base64 content to ignore mime-type differences.
 */
export const areIconsEqual = (a?: string | null, b?: string | null) => {
	if (a === b) return true;
	if (!a || !b) return false;

	// Normalize builtin icons for comparison
	const stableA = getStableIconId(a);
	const stableB = getStableIconId(b);
	if (stableA === stableB) return true;

	if (a.startsWith("data:image/") && b.startsWith("data:image/")) {
		const partA = a.split(",")[1];
		const partB = b.split(",")[1];
		if (partA && partB) return partA === partB;
	}

	return false;
};

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
	/** Props to pass to the trigger button */
	triggerProps?: any;
	/** Whether to allow custom image upload (default: true) */
	allowUpload?: boolean;
	/** Whether to show a "click to change" hint (useful for onboarding) */
	showHint?: boolean;
}

type IconOption = {
	icon: string;
	kind: "uploaded" | "default";
	isModpackOption: boolean;
};

export function IconPicker(props: IconPickerProps) {
	const [local] = splitProps(props, [
		"class",
		"value",
		"onSelect",
		"uploadedIcons",
		"modpackIcon",
		"triggerProps",
		"allowUpload",
		"showHint",
	]);

	const handleOpenChange = (open: boolean) => {
		setIsOpen(open);
	};

	const [isOpen, setIsOpen] = createSignal(false);

	const iconOptions = createMemo<IconOption[]>(() => {
		const options: IconOption[] = [];

		const addOption = (
			icon: string | null | undefined,
			kind: IconOption["kind"],
		) => {
			if (!icon) return;
			const isModpackOption = areIconsEqual(icon, local.modpackIcon);
			const duplicateIndex = options.findIndex((option) =>
				areIconsEqual(option.icon, icon),
			);

			if (duplicateIndex === -1) {
				options.push({ icon, kind, isModpackOption });
				return;
			}

			const existing = options[duplicateIndex];
			const shouldReplace =
				areIconsEqual(local.value, icon) &&
				!areIconsEqual(local.value, existing.icon);
			if (shouldReplace || (isModpackOption && !existing.isModpackOption)) {
				options[duplicateIndex] = {
					icon: shouldReplace ? icon : existing.icon,
					kind: shouldReplace ? kind : existing.kind,
					isModpackOption: existing.isModpackOption || isModpackOption,
				};
			}
		};

		for (const icon of local.uploadedIcons || []) {
			addOption(icon, "uploaded");
		}

		if (
			local.modpackIcon &&
			!DEFAULT_ICONS.some((icon) => areIconsEqual(icon, local.modpackIcon))
		) {
			addOption(local.modpackIcon, "uploaded");
		}

		for (const icon of DEFAULT_ICONS) {
			addOption(icon, "default");
		}

		return options;
	});

	const totalIcons = () => {
		const uploadBtn = local.allowUpload !== false ? 1 : 0;
		return iconOptions().length + uploadBtn;
	};

	const gridColumns = () => Math.min(4, totalIcons());

	const getIconStyle = (icon?: string | null) => {
		const target = icon || DEFAULT_ICONS[0];
		if (target.startsWith("linear-gradient")) return { background: target };

		const resolved = resolveResourceUrl(target);
		return {
			"background-image": `url('${resolved}')`,
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
						<EditIcon width="20" height="20" />
					</div>
					<Show when={local.showHint}>
						<div class={styles["icon-picker__hint-badge"]}>
							<AddIcon width="12" height="12" />
						</div>
					</Show>
					<Show
						when={
							local.modpackIcon && areIconsEqual(local.value, local.modpackIcon)
						}
					>
						<div class={styles["icon-picker__trigger-badge"]}>
							<CubeIcon fill="currentColor" width="12" height="12" />
						</div>
					</Show>
				</PopoverTrigger>
				<PopoverContent
					class={styles["icon-picker__content"]}
					style={{
						width: `${gridColumns() * 64 + (gridColumns() - 1) * 8 + 32}px`,
					}}
				>
					<div
						class={styles["icon-picker__grid"]}
						style={{ "grid-template-columns": `repeat(${gridColumns()}, 1fr)` }}
					>
						<Show when={local.allowUpload !== false}>
							<PopoverCloseButton
								class={clsx(
									styles["icon-picker__option"],
									styles["icon-picker__upload-btn"],
								)}
								onClick={(e) => {
									e.stopPropagation();
									handleFileUpload();
								}}
							>
								<AddIcon width="24" height="24" />
							</PopoverCloseButton>
						</Show>

						<For each={iconOptions()}>
							{(option) => {
								const isSelected = areIconsEqual(local.value, option.icon);
								return (
									<PopoverCloseButton
										aria-label={`${option.kind} icon option`}
										data-icon-option={option.kind}
										data-modpack-option={
											option.isModpackOption ? "true" : "false"
										}
										data-selected={isSelected ? "true" : "false"}
										class={clsx(
											styles["icon-picker__option"],
											isSelected && styles["icon-picker__option--selected"],
										)}
										style={getIconStyle(option.icon)}
										onClick={() => {
											const stableId = getStableIconId(option.icon);
											local.onSelect?.(stableId || option.icon);
										}}
									>
										<Show when={isSelected}>
											<CheckIcon
												class={styles["icon-picker__tick"]}
												width="20"
												height="20"
												stroke="white"
												stroke-width="3"
											/>
										</Show>
										<Show when={option.isModpackOption}>
											<div class={styles["icon-picker__option-badge"]}>
												<CubeIcon fill="currentColor" width="12" height="12" />
											</div>
										</Show>
									</PopoverCloseButton>
								);
							}}
						</For>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}

export type { IconPickerProps };
