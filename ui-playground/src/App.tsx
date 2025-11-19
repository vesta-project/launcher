import type { Component } from "solid-js";
import "../../vesta-launcher/.storybook/styles.css";

import {
	Combobox,
	ComboboxContent,
	ComboboxControl,
	ComboboxInput,
	ComboboxItem,
	ComboboxItemIndicator,
	ComboboxItemLabel,
	ComboboxTrigger,
} from "../../vesta-launcher/ui/combobox/combobox";

import {
	ToggleGroup,
	ToggleGroupItem,
} from "../../vesta-launcher/ui/toggle-group/toggle-group";

import styles from "./App.module.css";
import logo from "./logo.svg";

const App: Component = () => {
	const ALL_OPTIONS = ["Apple", "Banana", "Blueberry", "Grapes", "Pineapple"];

	return (
		<div class={styles.App}>
			<Combobox
				options={ALL_OPTIONS}
				placeholder="Search a fruit…"
				itemComponent={(props) => (
					<ComboboxItem item={props.item} class="combobox__item">
						<ComboboxItemLabel>{props.item.rawValue}</ComboboxItemLabel>
						<ComboboxItemIndicator class="combobox__item-indicator"></ComboboxItemIndicator>
					</ComboboxItem>
				)}
			>
				<ComboboxControl aria-label="Fruit">
					<ComboboxInput />
					<ComboboxTrigger />
				</ComboboxControl>
				<ComboboxContent />
			</Combobox>

			<ToggleGroup>
				<ToggleGroupItem value={1}>Apple</ToggleGroupItem>
			</ToggleGroup>
		</div>
	);
};

export default App;
