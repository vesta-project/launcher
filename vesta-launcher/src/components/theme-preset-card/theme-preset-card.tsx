import { type Component } from "solid-js";
import { type ThemeConfig } from "../../../../themes/presets";
import "./theme-preset-card.css";

interface ThemePresetCardProps {
	theme: ThemeConfig;
	isSelected: boolean;
	onClick: () => void;
}

/**
 * A miniature preview card showing what a theme looks like
 * This gives users a visual preview before selecting
 */
export const ThemePresetCard: Component<ThemePresetCardProps> = (props) => {
	return (
		<button
			class={`theme-preset-card ${props.isSelected ? "theme-preset-card--selected" : ""}`}
			onClick={props.onClick}
			data-preview-style={props.theme.style}
			data-preview-gradient={props.theme.gradientEnabled ? "1" : "0"}
			style={{
				"--preview-hue": props.theme.primaryHue,
				"--preview-style": props.theme.style,
				"--preview-gradient": props.theme.gradientEnabled ? "1" : "0",
				"--preview-angle": props.theme.gradientAngle ?? 135,
			}}
		>
			{/* Mini UI Preview */}
			<div class="theme-preview">
				<div class="theme-preview__bg"></div>
				<div class="theme-preview__sidebar">
					<div class="theme-preview__sidebar-item"></div>
					<div class="theme-preview__sidebar-item theme-preview__sidebar-item--active"></div>
					<div class="theme-preview__sidebar-item"></div>
				</div>
				<div class="theme-preview__main">
					<div class="theme-preview__card">
						<div class="theme-preview__card-header"></div>
						<div class="theme-preview__card-body">
							<div class="theme-preview__card-line"></div>
							<div class="theme-preview__card-line theme-preview__card-line--short"></div>
						</div>
					</div>
				</div>
			</div>

			{/* Theme Name */}
			<div class="theme-preset-card__info">
				<span class="theme-preset-card__name">{props.theme.name}</span>
				<span class="theme-preset-card__description">
					{props.theme.description || props.theme.style}
				</span>
			</div>
		</button>
	);
};
