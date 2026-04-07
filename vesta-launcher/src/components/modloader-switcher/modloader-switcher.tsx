import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { For } from "solid-js";
import styles from "./modloader-switcher.module.css";

export interface ModloaderSwitcherOption {
	value: string;
	label: string;
	supported?: boolean;
	disabled?: boolean;
}

interface ModloaderSwitcherProps {
	options: ModloaderSwitcherOption[];
	value: string;
	onChange: (nextValue: string) => void;
	disabled?: boolean;
	class?: string;
}

export function ModloaderSwitcher(props: ModloaderSwitcherProps) {
	return (
		<ToggleGroup
			value={props.value}
			onChange={(nextValue: string | null) => {
				if (nextValue) {
					props.onChange(nextValue);
				}
			}}
			disabled={props.disabled}
			class={`${styles["modloader-switcher"]}${props.class ? ` ${props.class}` : ""}`}
		>
			<For each={props.options}>
				{(option) => (
					<ToggleGroupItem
						value={option.value}
						disabled={props.disabled || option.disabled}
						class={styles["modloader-switcher__item"]}
						classList={{
							[styles["modloader-switcher__item--unsupported"]]:
								option.supported === false,
						}}
					>
						{option.label}
					</ToggleGroupItem>
				)}
			</For>
		</ToggleGroup>
	);
}
