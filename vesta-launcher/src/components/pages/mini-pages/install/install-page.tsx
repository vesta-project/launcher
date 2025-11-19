import {
	Combobox,
	ComboboxContent,
	ComboboxControl,
	ComboboxInput,
	ComboboxItem,
	ComboboxItemIndicator,
	ComboboxItemLabel,
	ComboboxTrigger,
} from "@ui/combobox/combobox";
import {
	TextFieldDescription,
	TextFieldErrorMessage,
	TextFieldInput,
	TextFieldLabel,
	TextFieldRoot,
	TextFieldTextArea,
} from "@ui/text-field/text-field";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { createSignal } from "solid-js";
import "./install-page.css";

function InstallPage() {
	const ALL_OPTIONS = ["Apple", "Banana", "Blueberry", "Grapes", "Pineapple"];
	const [_values, _setValues] = createSignal(["bold", "underline"]);

	const IconSelect = () => {
		return (
			<div
				style={
					"width: 36px; height: 36px; background-color: orange; border-radius: 5px"
				}
			></div>
		);
	};

	return (
		<div class={"page-root"}>
			<h1 style={"font-size: 2rem"}>Install</h1>
			<div class={"page-wrapper"}>
				{/*Image*/}
				<div style={"display: flex; gap: 20px;"}>
					<div
						style={
							"height: clamp(220px, 30vw, 32px); aspect-ratio: 1; background-color: red; border-radius: 5px;"
						}
					></div>
					<div style={"display: flex; flex-flow: column; gap: 12px;"}>
						<TextFieldRoot required={true}>
							<TextFieldLabel>Instance Name</TextFieldLabel>
							<TextFieldInput />
						</TextFieldRoot>
						<div
							style={
								"display: grid; grid-gap: 5px; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));"
							}
						>
							<IconSelect />
							<IconSelect />
							<IconSelect />
							<IconSelect />
							<IconSelect />
							<IconSelect />
							<IconSelect />
							<IconSelect />
							<IconSelect />
							<IconSelect />
							<IconSelect />
						</div>
					</div>
				</div>
				<div>
					<Combobox
						options={ALL_OPTIONS}
						placeholder="Search a fruit…"
						itemComponent={(props) => (
							<ComboboxItem item={props.item}>
								<ComboboxItemLabel>{props.item.rawValue}</ComboboxItemLabel>
								<ComboboxItemIndicator></ComboboxItemIndicator>
							</ComboboxItem>
						)}
					>
						<ComboboxControl aria-label="Fruit">
							<ComboboxInput />
							<ComboboxTrigger />
						</ComboboxControl>
						<ComboboxContent />
					</Combobox>
				</div>

				{/*<TextFieldRoot required={true}>
					<TextFieldLabel>Instance Name</TextFieldLabel>
					<TextFieldInput />
				</TextFieldRoot>

				<Combobox
					options={ALL_OPTIONS}
					placeholder="Search a fruit…"
					itemComponent={(props) => (
						<ComboboxItem item={props.item}>
							<ComboboxItemLabel>{props.item.rawValue}</ComboboxItemLabel>
							<ComboboxItemIndicator></ComboboxItemIndicator>
						</ComboboxItem>
					)}
				>
					<ComboboxControl aria-label="Fruit">
						<ComboboxInput />
						<ComboboxTrigger />
					</ComboboxControl>
					<ComboboxContent />
				</Combobox>
				<ToggleGroup
					class="toggle-group"
					value={values()}
					onChange={setValues}
					multiple={true}
				>
					<ToggleGroupItem
						class="toggle-group__item"
						value="bold"
						aria-label="Bold"
					>
						Bold
					</ToggleGroupItem>
					<ToggleGroupItem
						class="toggle-group__item"
						value="italic"
						aria-label="Italic"
					>
						Italic
					</ToggleGroupItem>
					<ToggleGroupItem
						class="toggle-group__item"
						value="underline"
						aria-label="Underline"
					>
						Underline
					</ToggleGroupItem>
				</ToggleGroup>*/}
			</div>
		</div>
	);
}

export default InstallPage;
