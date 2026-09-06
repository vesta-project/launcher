import AddIcon from "@assets/icons/actions/add.svg";
import DeleteIcon from "@assets/icons/actions/delete.svg";
import FolderIcon from "@assets/icons/content/folder.svg";
import Button from "@ui/button/button";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { For, Show } from "solid-js";
import styles from "./path-list-editor.module.css";

export interface PathListEditorProps {
	paths: string[];
	onChange: (paths: string[]) => void;
	inheritedPaths?: string[];
	addLabel?: string;
	emptyLabel?: string;
}

export function PathListEditor(props: PathListEditorProps) {
	const inherited = () => props.inheritedPaths ?? [];
	const editablePaths = () => props.paths;

	const handleAdd = async () => {
		const selected = await openDialog({ directory: true, multiple: false });
		if (!selected || typeof selected !== "string") return;

		const next = selected.trim();
		if (!next) return;
		if (
			inherited().some((path) => path === next) ||
			editablePaths().some((path) => path === next)
		) {
			return;
		}
		props.onChange([...editablePaths(), next]);
	};

	const handleRemove = (index: number) => {
		props.onChange(editablePaths().filter((_, i) => i !== index));
	};

	return (
		<div class={styles.pathList}>
			<Show when={inherited().length > 0}>
				<For each={inherited()}>
					{(path) => (
						<div
							class={`${styles.pathRow} ${styles.pathRowInherited}`}
							title={path}
						>
							<span class={styles.pathIcon} aria-hidden="true">
								<FolderIcon />
							</span>
							<span class={styles.pathText}>{path}</span>
							<span class={styles.pathTag}>Global</span>
						</div>
					)}
				</For>
			</Show>

			<Show
				when={editablePaths().length > 0}
				fallback={
					<Show when={inherited().length === 0}>
						<p class={styles.emptyHint}>
							{props.emptyLabel ?? "No path exclusions."}
						</p>
					</Show>
				}
			>
				<For each={editablePaths()}>
					{(path, index) => (
						<div class={styles.pathRow} title={path}>
							<span class={styles.pathIcon} aria-hidden="true">
								<FolderIcon />
							</span>
							<span class={styles.pathText}>{path}</span>
							<div class={styles.pathActions}>
								<button
									type="button"
									class={styles.removeButton}
									aria-label={`Remove exclusion ${path}`}
									onClick={() => handleRemove(index())}
								>
									<DeleteIcon />
								</button>
							</div>
						</div>
					)}
				</For>
			</Show>

			<div class={styles.addRow}>
				<Button variant="ghost" size="sm" onClick={() => void handleAdd()}>
					<span class={styles.pathIcon} aria-hidden="true">
						<AddIcon />
					</span>
					{props.addLabel ?? "Add path exclusion…"}
				</Button>
			</div>
		</div>
	);
}
