import { type Component, Show } from "solid-js";
import { type ThemeConfig } from "../../themes/presets";
import styles from "./theme-preset-card.module.css";

interface ThemePresetCardProps {
	theme: ThemeConfig;
	source?: "builtin" | "imported";
	viewMode?: "grid" | "list";
	isSelected: boolean;
	isDeletable?: boolean;
	onDelete?: () => void;
	onClick: () => void;
}

/**
 * A miniature preview card showing what a theme looks like
 * This gives users a visual preview before selecting
 */
export const ThemePresetCard: Component<ThemePresetCardProps> = (props) => {
	return (
		<div
			class={styles["theme-preset-card-wrapper"]}
			classList={{
				[styles["theme-preset-card--list"]]: props.viewMode === "list",
			}}
		>
			<button
				type="button"
				class={styles["theme-preset-card"]}
				classList={{
					[styles["theme-preset-card--selected"]]: props.isSelected,
					[styles["theme-preset-card--list"]]: props.viewMode === "list",
				}}
				onClick={props.onClick}
				data-preview-style={props.theme.style}
				data-preview-gradient={props.theme.gradientEnabled ? "1" : "0"}
				style={{
					"--preview-hue": props.theme.primaryHue,
					"--preview-style": props.theme.style,
					"--preview-gradient": props.theme.gradientEnabled ? "1" : "0",
					"--preview-angle": props.theme.rotation ?? 135,
				}}
			>
				{/* Mini UI Preview */}
				<div class={styles["theme-preview"]}>
					<div class={styles["theme-preview__bg"]}></div>
					<div class={styles["theme-preview__sidebar"]}>
						<div class={styles["theme-preview__sidebar-item"]}></div>
						<div
							class={styles["theme-preview__sidebar-item"]}
							classList={{
								[styles["theme-preview__sidebar-item--active"]]: true,
							}}
						></div>
						<div class={styles["theme-preview__sidebar-item"]}></div>
					</div>
					<div class={styles["theme-preview__main"]}>
						<div class={styles["theme-preview__card"]}>
							<div class={styles["theme-preview__card-header"]}></div>
							<div class={styles["theme-preview__card-body"]}>
								<div class={styles["theme-preview__card-line"]}></div>
								<div
									class={styles["theme-preview__card-line"]}
									classList={{
										[styles["theme-preview__card-line--short"]]: true,
									}}
								></div>
							</div>
						</div>
					</div>
				</div>

				{/* Theme Name */}
				<div class={styles["theme-preset-card__info"]}>
					<Show when={props.source === "imported"}>
						<div class={styles["theme-preset-card__meta"]}>
							<span class={styles["theme-preset-card__source"]}>Imported</span>
						</div>
					</Show>
					<span class={styles["theme-preset-card__name"]}>{props.theme.name}</span>
					<span class={styles["theme-preset-card__description"]}>
						{props.theme.author
							? `by ${props.theme.author}`
							: props.theme.description || props.theme.style}
					</span>
				</div>
			</button>
			<Show when={props.isDeletable && props.onDelete}>
				<button
					type="button"
					class={styles["theme-preset-card__delete"]}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						props.onDelete?.();
					}}
				>
					Delete
				</button>
			</Show>
		</div>
	);
};
