import type { ThemeConfig } from "../../../themes/types";
import styles from "../init.module.css";

interface ThemePreviewCardProps {
	theme: ThemeConfig;
	isSelected: boolean;
	onClick: () => void;
}

function ThemePreviewCard(props: ThemePreviewCardProps) {
	const primaryColor = () => {
		const hue = props.theme.primaryHue ?? 180;
		return `hsl(${hue} 70% 55%)`;
	};

	const secondaryColor = () => {
		const hue = props.theme.primaryHue ?? 180;
		return `hsl(${(hue + 120) % 360} 60% 50%)`;
	};

	const bgStyle = () => {
		if (props.theme.gradientEnabled) {
			return {
				background: `linear-gradient(${props.theme.rotation ?? 180}deg, ${primaryColor()}, ${secondaryColor()})`,
			};
		}
		return {
			background: primaryColor(),
		};
	};

	const surfaceStyle = () => {
		const opacity = props.theme.opacity ?? 0;
		return {
			background: `rgba(255, 255, 255, ${opacity / 200})`,
			backdropFilter: props.theme.style === "glass" || props.theme.style === "frosted"
				? "blur(8px)"
				: "none",
		};
	};

	return (
		<button
			class={styles["theme-preview-card"]}
			classList={{ [styles["theme-preview-card--selected"]]: props.isSelected }}
			onClick={props.onClick}
			aria-pressed={props.isSelected}
		>
			<div class={styles["theme-preview-canvas"]} style={bgStyle()}>
				<div class={styles["theme-preview-ui"]}>
					<div class={styles["theme-preview-header"]} style={surfaceStyle()} />
					<div class={styles["theme-preview-content"]}>
						<div class={styles["theme-preview-block"]} style={surfaceStyle()} />
						<div class={styles["theme-preview-block"]} style={surfaceStyle()} />
					</div>
					<div class={styles["theme-preview-btn"]} style={{ background: primaryColor() }} />
				</div>
			</div>
			<span class={styles["theme-preview-name"]}>{props.theme.name}</span>
		</button>
	);
}

export default ThemePreviewCard;
