import { GameKeybindings } from "@components/settings/GameKeybindings";
import { SubpageBackButton } from "@components/settings/SubpageBackButton";
import { t } from "~/localization";
import {
	type Preferences,
	type Snapshot,
	selectedSharedKeys,
} from "~/settings-sync/model";
import { formatGameOptionName } from "~/utils/game-option-label";
import styles from "./sync-tab.module.css";

export function SharedKeybindsPage(props: {
	snapshot: Snapshot;
	busy: boolean;
	onBack: () => void;
	onSave: (
		preferences: Preferences,
		changes?: Record<string, string>,
	) => Promise<boolean>;
}) {
	const keys = () =>
		Object.keys(props.snapshot.sharedValues ?? {}).filter((key) =>
			key.startsWith("key_"),
		);
	const selected = () => selectedSharedKeys(props.snapshot.preferences, keys());
	const disabled = () => props.busy || !props.snapshot.preferences.enabled;
	return (
		<div class={styles.sharedPage}>
			<div class={styles.heading}>
				<SubpageBackButton label={t("common-back")} onClick={props.onBack} />
				<h2 class={styles.headingTitle}>{t("sync-keybinds-page-title")}</h2>
			</div>
			<div class={styles.keybindsBody}>
				<GameKeybindings
					embedded
					state={{
						rows: () => keys().map((key) => ({ key, category: "keybinds" })),
						value: (key) => props.snapshot.sharedValues?.[key] ?? "",
						label: (row) => formatGameOptionName(row.key),
						busy: disabled,
						change: async (key, value) => {
							await props.onSave(props.snapshot.preferences, { [key]: value });
						},
					}}
					selected={(key) => selected().includes(key)}
					onSelectionChange={(key, enabled) => {
						if (!disabled())
							void props.onSave({
								...props.snapshot.preferences,
								selectedKeys: enabled
									? [...new Set([...selected(), key])]
									: selected().filter((entry) => entry !== key),
							});
					}}
					allSelected={() =>
						keys().length > 0 && keys().every((key) => selected().includes(key))
					}
					onToggleAll={() => {
						if (!disabled())
							void props.onSave({
								...props.snapshot.preferences,
								selectedKeys: keys().every((key) => selected().includes(key))
									? []
									: keys(),
							});
					}}
				/>
			</div>
		</div>
	);
}
