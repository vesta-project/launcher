import { t } from "~/localization";

export type LabeledOption<T extends string = string> = {
	label: string;
	value: T;
};

export function launchBehaviorOptions(): LabeledOption[] {
	return [
		{ label: t("common-launcher-action-stay-open"), value: "stay-open" },
		{ label: t("common-launcher-action-minimize"), value: "minimize" },
		{ label: t("common-launcher-action-hide-to-tray"), value: "hide-to-tray" },
		{ label: t("common-launcher-action-quit"), value: "quit" },
	];
}

export function findLaunchBehaviorOption(value: string | null | undefined) {
	const options = launchBehaviorOptions();
	return options.find((option) => option.value === value) ?? options[0];
}

export function formatMemoryLabel(value: number): string {
	return value >= 1024
		? `${(value / 1024).toFixed(value % 1024 === 0 ? 0 : 1)}GB`
		: `${value}MB`;
}
