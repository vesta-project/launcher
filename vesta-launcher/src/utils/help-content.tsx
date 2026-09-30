import type { JSX } from "solid-js";
import { t } from "~/localization";

export interface HelpTopic {
	title: string;
	description: string | JSX.Element;
}

function localizedTopic(titleId: string, descriptionId: string): HelpTopic {
	return {
		get title() {
			return t(titleId);
		},
		get description() {
			return t(descriptionId);
		},
	};
}

export const HELP_CONTENT: Record<string, HelpTopic> = {
	MODLOADER_EXPLAINED: localizedTopic(
		"secondary-help-modloader-explained-title",
		"secondary-help-modloader-explained-description",
	),
	MODLOADER_FABRIC: localizedTopic(
		"secondary-help-modloader-fabric-title",
		"secondary-help-modloader-fabric-description",
	),
	MODLOADER_FORGE: localizedTopic(
		"secondary-help-modloader-forge-title",
		"secondary-help-modloader-forge-description",
	),
	MODLOADER_NEOFORGE: localizedTopic(
		"secondary-help-modloader-neoforge-title",
		"secondary-help-modloader-neoforge-description",
	),
	MODLOADER_QUILT: localizedTopic(
		"secondary-help-modloader-quilt-title",
		"secondary-help-modloader-quilt-description",
	),
	MODLOADER_VANILLA: localizedTopic(
		"secondary-help-modloader-vanilla-title",
		"secondary-help-modloader-vanilla-description",
	),
	JAVA_MANAGED: localizedTopic(
		"secondary-help-java-managed-title",
		"secondary-help-java-managed-description",
	),
	MEMORY_ALLOCATION: localizedTopic(
		"secondary-help-memory-allocation-title",
		"secondary-help-memory-allocation-description",
	),
	MODPACK_MEMORY_TARGETS: {
		get title() {
			return t("secondary-help-modpack-memory-targets-title");
		},
		get description() {
			return (
				<div
					style={{ display: "flex", "flex-direction": "column", gap: "8px" }}
				>
					<div>{t("secondary-help-modpack-memory-targets-intro")}</div>
					<div
						style={{
							padding: "6px 8px",
							"border-radius": "6px",
							background: "var(--surface-low)",
							"font-family": "var(--font-mono)",
							"font-size": "12px",
						}}
					>
						{t("secondary-help-modpack-memory-targets-rule")}
					</div>
					<div>
						<strong>
							{t("secondary-help-modpack-memory-targets-default-label")}
						</strong>{" "}
						{t("secondary-help-modpack-memory-targets-default-description")}
					</div>
					<div>
						<strong>
							{t("secondary-help-modpack-memory-targets-suggested-label")}
						</strong>{" "}
						{t("secondary-help-modpack-memory-targets-suggested-description")}
					</div>
					<div>{t("secondary-help-modpack-memory-targets-warning")}</div>
				</div>
			);
		},
	},
	JVM_ARGS: localizedTopic(
		"secondary-help-jvm-args-title",
		"secondary-help-jvm-args-description",
	),
	GRADIENT_HARMONY: localizedTopic(
		"secondary-help-gradient-harmony-title",
		"secondary-help-gradient-harmony-description",
	),
	MINECRAFT_VERSION: localizedTopic(
		"secondary-help-minecraft-version-title",
		"secondary-help-minecraft-version-description",
	),
	MODPACKS_CONCEPT: localizedTopic(
		"resources-type-modpacks",
		"secondary-help-modpacks-concept-description",
	),
	GUIDE_PAGE: localizedTopic(
		"secondary-help-guide-page-title",
		"secondary-help-guide-page-description",
	),
};
