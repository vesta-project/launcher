import type { Instance } from "@stores/instances";
import Button from "@ui/button/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ui/dialog/dialog";
import {
	createAnimatedIconPreview,
	iconBackgroundStyle,
} from "@utils/icon-animation";
import { DEFAULT_ICONS } from "@utils/instances";
import {
	type Component,
	createMemo,
	For,
	Show,
} from "solid-js";
import styles from "./instance-selection-dialog.module.css";

export type InstanceSelectionTone =
	| "neutral"
	| "accent"
	| "warning"
	| "danger";

export type InstanceSelectionOption = {
	instance: Instance;
	disabled?: boolean;
	detail?: string;
	badge?: string;
	tone?: InstanceSelectionTone;
};

type InstanceSelectionDialogProps = {
	isOpen: boolean;
	title?: string;
	description: string;
	options: readonly InstanceSelectionOption[];
	emptyMessage?: string;
	onClose: () => void;
	onSelect: (instance: Instance) => void;
	footerAction?: {
		label: string;
		onSelect: () => void;
	};
};

const InstanceIcon: Component<{ instance: Instance }> = (props) => {
	const iconPath = () => props.instance.iconPath || DEFAULT_ICONS[0];
	const iconPreview = createAnimatedIconPreview(iconPath);
	const displayChar = createMemo(() => {
		const name = props.instance.name || "?";
		const match = name.match(/[a-zA-Z]/);
		return match ? match[0].toUpperCase() : name.charAt(0).toUpperCase();
	});

	return (
		<Show
			when={iconPreview.displaySource()}
			fallback={
				<div class={styles["instance-icon-placeholder"]} aria-hidden="true">
					{displayChar()}
				</div>
			}
		>
			<div
				class={styles["instance-icon"]}
				style={iconBackgroundStyle(iconPreview.displaySource())}
				onMouseEnter={iconPreview.activate}
				onMouseLeave={iconPreview.deactivate}
				onFocusIn={iconPreview.activate}
				onFocusOut={iconPreview.deactivate}
				aria-hidden="true"
			/>
		</Show>
	);
};

const InstanceSelectionDialog: Component<InstanceSelectionDialogProps> = (
	props,
) => {
	const sortedOptions = createMemo(() =>
		[...props.options].sort((left, right) => {
			const leftTime = left.instance.lastPlayed
				? new Date(left.instance.lastPlayed).getTime()
				: 0;
			const rightTime = right.instance.lastPlayed
				? new Date(right.instance.lastPlayed).getTime()
				: 0;
			return (
				rightTime - leftTime ||
				left.instance.name.localeCompare(right.instance.name, undefined, {
					sensitivity: "base",
				})
			);
		}),
	);

	return (
		<Dialog
			open={props.isOpen}
			onOpenChange={(open) => !open && props.onClose()}
		>
			<DialogContent class={styles.dialog}>
				<DialogHeader>
					<DialogTitle class={styles.title}>
						{props.title ?? "Select Instance"}
					</DialogTitle>
					<DialogDescription class={styles.description}>
						{props.description}
					</DialogDescription>
				</DialogHeader>

				<Show
					when={sortedOptions().length > 0}
					fallback={
						<div class={styles.empty}>
							{props.emptyMessage ?? "No instances are available."}
						</div>
					}
				>
					<div class={styles.list}>
						<For each={sortedOptions()}>
							{(option) => (
								<button
									type="button"
									class={styles.option}
									classList={{
										[styles.disabled]: Boolean(option.disabled),
										[styles.accent]: option.tone === "accent",
										[styles.warning]: option.tone === "warning",
										[styles.danger]: option.tone === "danger",
									}}
									disabled={option.disabled}
									onClick={() => props.onSelect(option.instance)}
								>
									<div class={styles["option-main"]}>
										<InstanceIcon instance={option.instance} />
										<div class={styles["option-info"]}>
											<span class={styles["option-name"]}>
												{option.instance.name}
											</span>
											<span class={styles["option-meta"]}>
												{option.instance.minecraftVersion} ·{" "}
												{option.instance.modloader || "Vanilla"}
											</span>
											<Show when={option.detail}>
												<span class={styles["option-detail"]}>
													{option.detail}
												</span>
											</Show>
										</div>
									</div>
									<Show when={option.badge}>
										<span class={styles.badge}>{option.badge}</span>
									</Show>
								</button>
							)}
						</For>
					</div>
				</Show>

				<Show when={props.footerAction}>
					{(action) => (
						<div class={styles.footer}>
							<Button
								variant="outline"
								onClick={action().onSelect}
								style={{ width: "100%" }}
							>
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									aria-hidden="true"
								>
									<path d="M12 5v14M5 12h14" />
								</svg>
								{action().label}
							</Button>
						</div>
					)}
				</Show>
			</DialogContent>
		</Dialog>
	);
};

export default InstanceSelectionDialog;
