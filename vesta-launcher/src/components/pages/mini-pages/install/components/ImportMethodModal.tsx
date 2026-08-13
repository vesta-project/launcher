import BackArrowIcon from "@assets/icons/navigation/arrow-back.svg";
import CubeIcon from "@assets/icons/content/cube.svg";
import CurseForgeIcon from "@assets/branding/sources/curseforge.svg";
import LinkIcon from "@assets/icons/content/link.svg";
import PrismLauncherIcon from "@assets/branding/launchers/prism-launcher.svg";
import SearchIcon from "@assets/icons/content/search.svg";
import LauncherButton from "@ui/button/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ui/dialog/dialog";
import type { LauncherKind } from "@utils/launcher-imports";
import { createEffect, createSignal, For, Show, type JSX } from "solid-js";
import { launcherOptions } from "../config/launcher-options";
import {
	isHttpUrl,
	pickLocalModpackFile,
} from "../install-entry-actions";
import styles from "../install-page.module.css";

export type ImportMethodModalStep = "methods" | "launchers";

export interface ImportMethodModalProps {
	isOpen: boolean;
	onClose: () => void;
	/** Prefill + expand the URL row (e.g. after a failed URL import). */
	initialUrl?: string;
	expandUrlOnOpen?: boolean;
	/** Which step to show when the modal opens. */
	initialStep?: ImportMethodModalStep;
	onSelectLocal: (path: string) => void;
	onSelectBrowseModpacks: () => void;
	onSelectLauncher: (kind: LauncherKind) => void;
	onSelectUrl: (url: string) => void;
}

export function ImportMethodModal(props: ImportMethodModalProps): JSX.Element {
	const [step, setStep] = createSignal<ImportMethodModalStep>("methods");
	const [showUrlInput, setShowUrlInput] = createSignal(false);
	const [urlValue, setUrlValue] = createSignal("");
	const [urlError, setUrlError] = createSignal<string | undefined>();

	createEffect(() => {
		if (!props.isOpen) return;
		const initial = props.initialUrl?.trim() || "";
		setUrlValue(initial);
		setUrlError(undefined);
		setShowUrlInput(!!props.expandUrlOnOpen || !!initial);
		setStep(props.initialStep ?? "methods");
	});

	const handleLocal = async () => {
		const path = await pickLocalModpackFile();
		if (!path) return;
		props.onSelectLocal(path);
	};

	const handleUrlSubmit = () => {
		const value = urlValue().trim();
		if (!value) {
			setUrlError("Enter a modpack URL.");
			return;
		}
		if (!isHttpUrl(value)) {
			setUrlError("URL must start with http:// or https://");
			return;
		}
		setUrlError(undefined);
		props.onSelectUrl(value);
	};

	return (
		<Dialog
			open={props.isOpen}
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
		>
			<DialogContent class={styles["import-method-dialog"]}>
				<Show
					when={step() === "launchers"}
					fallback={
						<>
							<DialogHeader>
								<DialogTitle>Import instance</DialogTitle>
								<DialogDescription>
									Choose how you want to bring in a modpack or existing
									instance.
								</DialogDescription>
							</DialogHeader>

							<div class={styles["import-method-list"]}>
								<button
									type="button"
									class={styles["import-method-row"]}
									onClick={() => void handleLocal()}
								>
									<span class={styles["import-method-row-icon"]}>
										<CubeIcon />
									</span>
									<span class={styles["import-method-row-copy"]}>
										<span class={styles["import-method-row-title"]}>
											Local file
										</span>
										<span class={styles["import-method-row-desc"]}>
											Upload a .zip or .mrpack
										</span>
									</span>
								</button>

								<button
									type="button"
									class={styles["import-method-row"]}
									onClick={props.onSelectBrowseModpacks}
								>
									<span class={styles["import-method-row-icon"]}>
										<SearchIcon />
									</span>
									<span class={styles["import-method-row-copy"]}>
										<span class={styles["import-method-row-title"]}>
											Browse modpacks
										</span>
										<span class={styles["import-method-row-desc"]}>
											Search Modrinth &amp; CurseForge
										</span>
									</span>
								</button>

								<button
									type="button"
									class={styles["import-method-row"]}
									onClick={() => setStep("launchers")}
								>
									<span
										class={`${styles["import-method-row-icon"]} ${styles["import-launcher-icon-stack"]}`}
									>
										<PrismLauncherIcon class={styles["stack-icon"]} />
										<CurseForgeIcon
											class={`${styles["stack-icon"]} ${styles["stack-icon--curseforge"]}`}
										/>
									</span>
									<span class={styles["import-method-row-copy"]}>
										<span class={styles["import-method-row-title"]}>
											Import from launcher
										</span>
										<span class={styles["import-method-row-desc"]}>
											Prism, CurseForge, GDLauncher, and more
										</span>
									</span>
								</button>

								<Show
									when={showUrlInput()}
									fallback={
										<button
											type="button"
											class={styles["import-method-row"]}
											onClick={() => {
												setShowUrlInput(true);
												setUrlError(undefined);
											}}
										>
											<span class={styles["import-method-row-icon"]}>
												<LinkIcon />
											</span>
											<span class={styles["import-method-row-copy"]}>
												<span class={styles["import-method-row-title"]}>
													From URL
												</span>
												<span class={styles["import-method-row-desc"]}>
													Paste a Modrinth, CurseForge, or direct link
												</span>
											</span>
										</button>
									}
								>
									<div class={styles["import-method-url-panel"]}>
										<div class={styles["import-method-url-row"]}>
											<input
												type="text"
												placeholder="https://…"
												value={urlValue()}
												onInput={(e) => {
													setUrlValue(e.currentTarget.value);
													setUrlError(undefined);
												}}
												onKeyDown={(e) => {
													if (e.key === "Enter") handleUrlSubmit();
												}}
												autofocus
											/>
											<LauncherButton
												color="primary"
												onClick={handleUrlSubmit}
												disabled={!urlValue().trim()}
											>
												Import
											</LauncherButton>
										</div>
										<Show when={urlError()}>
											{(err) => (
												<p class={styles["import-method-url-error"]}>
													{err()}
												</p>
											)}
										</Show>
									</div>
								</Show>
							</div>
						</>
					}
				>
					<DialogHeader>
						<div class={styles["import-method-header-row"]}>
							<button
								type="button"
								class={styles["import-method-back-btn"]}
								onClick={() => setStep("methods")}
								aria-label="Back to import methods"
							>
								<BackArrowIcon width={16} height={16} />
							</button>
							<div class={styles["import-method-header-copy"]}>
								<DialogTitle>Import from launcher</DialogTitle>
								<DialogDescription>
									Choose which launcher you want to import from.
								</DialogDescription>
							</div>
						</div>
					</DialogHeader>

					<div
						class={`${styles["import-method-list"]} ${styles["import-method-list--launchers"]}`}
					>
						<For each={launcherOptions}>
							{(launcher) => (
								<button
									type="button"
									class={`${styles["import-method-row"]} ${
										launcher.tone === "modrinth" ||
										launcher.tone === "curseforge"
											? styles[`launcher-row--${launcher.tone}`]
											: ""
									}`}
									onClick={() => props.onSelectLauncher(launcher.kind)}
								>
									<span class={styles["import-method-row-icon"]}>
										{launcher.icon && <launcher.icon />}
									</span>
									<span class={styles["import-method-row-copy"]}>
										<span class={styles["import-method-row-title"]}>
											{launcher.label}
										</span>
									</span>
								</button>
							)}
						</For>
					</div>
				</Show>
			</DialogContent>
		</Dialog>
	);
}
