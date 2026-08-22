import { SettingsCard, SettingsField } from "@components/settings";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { t } from "~/localization";
import type { UiChromeMode } from "~/themes/ui-chrome";

interface UiChromeModeControlProps {
	value: UiChromeMode;
	onChange: (value: UiChromeMode) => void;
}

export function UiChromeModeControl(props: UiChromeModeControlProps) {
	return (
		<SettingsCard
			header={t("settings-appearance-chrome-title")}
			subHeader={t("settings-appearance-chrome-subheader")}
		>
			<SettingsField
				label={t("settings-appearance-chrome-page-style-label")}
				description={t("settings-appearance-chrome-page-style-description")}
				headerRight={
					<ToggleGroup
						value={props.value}
						onChange={(value) => {
							if (value === "windowed" || value === "flat") {
								props.onChange(value);
							}
						}}
					>
						<ToggleGroupItem value="windowed">
							{t("settings-appearance-chrome-windowed")}
						</ToggleGroupItem>
						<ToggleGroupItem value="flat">
							{t("settings-appearance-chrome-flat")}
						</ToggleGroupItem>
					</ToggleGroup>
				}
			/>
		</SettingsCard>
	);
}
