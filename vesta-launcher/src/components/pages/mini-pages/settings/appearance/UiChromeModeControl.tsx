import { SettingsCard, SettingsField } from "@components/settings";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import type { UiChromeMode } from "~/themes/ui-chrome";

interface UiChromeModeControlProps {
	value: UiChromeMode;
	onChange: (value: UiChromeMode) => void;
}

export function UiChromeModeControl(props: UiChromeModeControlProps) {
	return (
		<SettingsCard header="Launcher Layout" subHeader="Choose how launcher pages are displayed.">
			<SettingsField
				label="Page style"
				description="Windowed keeps the framed page viewer. Flat uses sidebar tabs."
				headerRight={
					<ToggleGroup
						value={props.value}
						onChange={(value) => {
							if (value === "windowed" || value === "flat") {
								props.onChange(value);
							}
						}}
					>
						<ToggleGroupItem value="windowed">Windowed</ToggleGroupItem>
						<ToggleGroupItem value="flat">Flat</ToggleGroupItem>
					</ToggleGroup>
				}
			/>
		</SettingsCard>
	);
}
