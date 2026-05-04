import { router } from "@components/page-viewer/page-viewer";
import { resources } from "@stores/resources";
import LauncherButton from "@ui/button/button";
import { createSignal, Show } from "solid-js";
import { InstallStageHeader } from "./components/InstallStageHeader";
import { SourceOptionsGrid } from "./components/SourceOptionsGrid";
import styles from "./install-page.module.css";

/**
 * SourceSelectPage is the entry point for choosing how to create an instance.
 * Combines the classic grid layout with a modern inline URL import.
 */
function SourceSelectPage(props: { router?: any }) {
	const activeRouter = () => props.router || router();
	const [showUrlInput, setShowUrlInput] = createSignal(false);
	const [urlValue, setUrlValue] = createSignal("");

	const handleUrlSubmit = () => {
		if (urlValue().trim()) {
			activeRouter()?.navigate("/install", { modpackUrl: urlValue().trim(), isModpack: true });
		}
	};

	return (
		<div class={styles["page-root"]}>
			<InstallStageHeader
				title="Installation Source"
				description="How would you like to create your new instance?"
			/>

			<div class={styles["page-wrapper"]}>
				<div class={styles["import-selection-wrapper"]}>
					<SourceOptionsGrid
						onStandard={() => activeRouter()?.navigate("/install")}
						onLocalImport={async () => {
							const { open } = await import("@tauri-apps/plugin-dialog");
							const selected = await open({
								multiple: false,
								filters: [{ name: "Modpack", extensions: ["zip", "mrpack"] }],
							});
							if (selected && typeof selected === "string") {
								activeRouter()?.navigate("/install", {
									modpackPath: selected,
									isModpack: true,
								});
							}
						}}
						onExplore={() => {
							resources.setType("modpack");
							activeRouter()?.navigate("/resources");
						}}
						onLauncher={() => activeRouter()?.navigate("/install/import")}
					/>

					<div class={styles["source-footer"]}>
						<Show
							when={!showUrlInput()}
							fallback={
								<div class={styles["url-input-box"]}>
									<input
										type="text"
										placeholder="Paste modpack URL (Modrinth, CurseForge, or Direct)..."
										value={urlValue()}
										onInput={(e) => setUrlValue(e.currentTarget.value)}
										onKeyDown={(e) => e.key === "Enter" && handleUrlSubmit()}
										autofocus
									/>
									<LauncherButton
										color="primary"
										onClick={handleUrlSubmit}
										disabled={!urlValue().trim()}
									>
										Import URL
									</LauncherButton>
									<LauncherButton variant="ghost" onClick={() => setShowUrlInput(false)}>
										Cancel
									</LauncherButton>
								</div>
							}
						>
							<button class={styles["url-toggle"]} onClick={() => setShowUrlInput(true)}>
								Or import from a Direct URL
							</button>
						</Show>
					</div>
					<div class={styles["page-bottom-spacer"]} />
				</div>
			</div>
		</div>
	);
}

export default SourceSelectPage;
