import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import type { JSX } from "solid-js";
import styles from "./sync-tab.module.css";

export function SquareToggle(props: {
	label: string;
	pressed: boolean;
	disabled?: boolean;
	iconOnly?: boolean;
	children: JSX.Element;
	onChange: (pressed: boolean) => void;
}) {
	return (
		<ToggleGroup
			class={styles.squareToggle}
			value={props.pressed ? "on" : ""}
			disabled={props.disabled}
			aria-label={props.label}
			onChange={(next) => props.onChange(next === "on")}
		>
			<ToggleGroupItem
				value="on"
				size="sm"
				icon_only={props.iconOnly}
				aria-label={props.label}
			>
				{props.children}
			</ToggleGroupItem>
		</ToggleGroup>
	);
}
