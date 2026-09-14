import { GameKeybindings } from "@components/settings/GameKeybindings";
import Button from "@ui/button/button";
import { t } from "~/localization";
import {
	selectedSharedKeys,
	type Preferences,
	type Snapshot,
} from "~/settings-sync/model";
import { formatGameOptionName } from "~/utils/game-option-label";

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
		<>
			<Button variant="ghost" size="sm" onClick={props.onBack}>
				{t("sync-back")}
			</Button>
			<GameKeybindings
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
								: selected().filter((k) => k !== key),
						});
				}}
				allSelected={() => keys().every((key) => selected().includes(key))}
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
		</>
	);
}
