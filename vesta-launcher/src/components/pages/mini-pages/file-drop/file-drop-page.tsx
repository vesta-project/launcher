import UploadIcon from "@assets/icons/actions/upload.svg";
import FileAddIcon from "@assets/icons/content/file-add.svg";
import FolderIcon from "@assets/icons/content/folder.svg";
import { DropZone } from "@ui/drop-zone/drop-zone";
import type {
	RejectedDropItem,
	RejectionReason,
} from "@utils/file-drop/drop-controller";
import { nativeDropPointer } from "@utils/file-drop/native-bridge";
import {
	isNativeDropProbeEnabled,
	nativeDropDiagnostic,
} from "@utils/file-drop/native-probe";
import { createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import styles from "./file-drop-page.module.css";

const REJECTION_LABELS: Record<RejectionReason, string> = {
	"not-accepted-type": "wrong type",
	extension: "extension not allowed",
	unreadable: "unreadable",
};

/** Summary only. Rejection notes never show paths. */
function describeRejections(items: RejectedDropItem[]): string {
	const reasons = [
		...new Set(items.map((item) => REJECTION_LABELS[item.reason])),
	];
	return `Rejected: ${items.length} item(s) (${reasons.join(", ")})`;
}

interface DroppedFile {
	path: string;
	timestamp: number;
}

function FileDropPage() {
	const [singleFile, setSingleFile] = createSignal<DroppedFile | null>(null);
	const [multipleFiles, setMultipleFiles] = createSignal<DroppedFile[]>([]);
	const [folderContents, setFolderContents] = createSignal<DroppedFile[]>([]);
	const [singleRejected, setSingleRejected] = createSignal<RejectedDropItem[]>(
		[],
	);
	const [multipleRejected, setMultipleRejected] = createSignal<
		RejectedDropItem[]
	>([]);
	const [folderRejected, setFolderRejected] = createSignal<RejectedDropItem[]>(
		[],
	);

	// Calibration marker: only with the probe flag, and only while a native drag is over the window.
	const pointerMarker = () => {
		const pointer = nativeDropPointer();
		return isNativeDropProbeEnabled() && pointer?.visible ? pointer : null;
	};

	const handleSingleFileDrop = (files: string[]) => {
		setSingleRejected([]);
		if (files.length > 0) {
			setSingleFile({
				path: files[0],
				timestamp: Date.now(),
			});
		}
	};

	const handleMultipleFilesDrop = (files: string[]) => {
		setMultipleRejected([]);
		const newFiles = files.map((path) => ({
			path,
			timestamp: Date.now(),
		}));
		setMultipleFiles((prev) => [...prev, ...newFiles]);
	};

	const handleFolderDrop = (files: string[]) => {
		setFolderRejected([]);
		const newFiles = files.map((path) => ({
			path,
			timestamp: Date.now(),
		}));
		setFolderContents(newFiles);
	};

	const clearSingleFile = () => {
		setSingleFile(null);
		setSingleRejected([]);
	};
	const clearMultipleFiles = () => {
		setMultipleFiles([]);
		setMultipleRejected([]);
	};
	const clearFolderContents = () => {
		setFolderContents([]);
		setFolderRejected([]);
	};

	return (
		<div class={styles["file-drop-page"]}>
			<h1>File Drop Test</h1>
			<Show when={pointerMarker()}>
				{(pointer) => (
					// Portalled to <body>: the page viewer has a transformed ancestor, which
					// would otherwise become the containing block of this fixed marker.
					<Portal>
						<div
							class={styles["file-drop-page__pointer"]}
							style={{
								transform: `translate(${pointer().cssX}px, ${pointer().cssY}px)`,
							}}
							aria-hidden="true"
						>
							<span class={styles["file-drop-page__pointer-dot"]} />
						</div>
					</Portal>
				)}
			</Show>
			<p class={styles["file-drop-page__description"]}>
				Test the file drop functionality by dragging files or folders onto the
				drop zones below.
			</p>

			<Show when={isNativeDropProbeEnabled()}>
				<section class={styles["file-drop-page__result"]}>
					<p class={styles["file-drop-page__result-label"]}>
						Native drop probe (diagnostics only, no routing)
					</p>
					<Show
						when={nativeDropDiagnostic()}
						fallback={
							<code class={styles["file-drop-page__path"]}>not running</code>
						}
					>
						{(diagnostic) => (
							<code
								class={`${styles["file-drop-page__path"]} ${styles["file-drop-page__diagnostic"]}`}
							>
								{JSON.stringify(diagnostic(), null, 2)}
							</code>
						)}
					</Show>
				</section>
			</Show>

			<div class={styles["file-drop-page__zones"]}>
				{/* Single File Drop Zone */}
				<section class={styles["file-drop-page__section"]}>
					<div class={styles["file-drop-page__section-header"]}>
						<h2>Single File Drop</h2>
						<button
							class={styles["file-drop-page__clear-btn"]}
							onClick={clearSingleFile}
							disabled={!singleFile() && singleRejected().length === 0}
						>
							Clear
						</button>
					</div>
					<DropZone
						onFileDrop={handleSingleFileDrop}
						onFilesRejected={(items) => setSingleRejected(items)}
						accept="files"
					>
						<div
							class={`${styles["file-drop-page__zone"]} ${styles["file-drop-page__zone--single"]}`}
						>
							<UploadIcon class={styles["file-drop-page__icon"]} />
							<p>Drop a single file here</p>
							<p class={styles["file-drop-page__hint"]}>
								Files only (no folders)
							</p>
						</div>
					</DropZone>
					<Show when={singleRejected().length > 0}>
						<p class={styles["file-drop-page__rejected"]} role="status">
							{describeRejections(singleRejected())}
						</p>
					</Show>
					{singleFile() && (
						<div class={styles["file-drop-page__result"]}>
							<p class={styles["file-drop-page__result-label"]}>
								Dropped file:
							</p>
							<code class={styles["file-drop-page__path"]}>
								{singleFile()?.path}
							</code>
						</div>
					)}
				</section>

				{/* Multiple Files Drop Zone */}
				<section class={styles["file-drop-page__section"]}>
					<div class={styles["file-drop-page__section-header"]}>
						<h2>Multiple Files Drop</h2>
						<button
							class={styles["file-drop-page__clear-btn"]}
							onClick={clearMultipleFiles}
							disabled={
								multipleFiles().length === 0 && multipleRejected().length === 0
							}
						>
							Clear
						</button>
					</div>
					<DropZone
						onFileDrop={handleMultipleFilesDrop}
						onFilesRejected={(items) => setMultipleRejected(items)}
						accept="files"
					>
						<div
							class={`${styles["file-drop-page__zone"]} ${styles["file-drop-page__zone--multiple"]}`}
						>
							<FileAddIcon class={styles["file-drop-page__icon"]} />
							<p>Drop multiple files here</p>
							<p class={styles["file-drop-page__hint"]}>
								Files only (no folders)
							</p>
						</div>
					</DropZone>
					<Show when={multipleRejected().length > 0}>
						<p class={styles["file-drop-page__rejected"]} role="status">
							{describeRejections(multipleRejected())}
						</p>
					</Show>
					{multipleFiles().length > 0 && (
						<div class={styles["file-drop-page__result"]}>
							<p class={styles["file-drop-page__result-label"]}>
								Dropped {multipleFiles().length} file(s):
							</p>
							<div class={styles["file-drop-page__file-list"]}>
								<For each={multipleFiles()}>
									{(file) => (
										<code class={styles["file-drop-page__path"]}>
											{file.path}
										</code>
									)}
								</For>
							</div>
						</div>
					)}
				</section>

				{/* Folder Drop Zone */}
				<section class={styles["file-drop-page__section"]}>
					<div class={styles["file-drop-page__section-header"]}>
						<h2>Folder Drop</h2>
						<button
							class={styles["file-drop-page__clear-btn"]}
							onClick={clearFolderContents}
							disabled={
								folderContents().length === 0 && folderRejected().length === 0
							}
						>
							Clear
						</button>
					</div>
					<DropZone
						onFileDrop={handleFolderDrop}
						onFilesRejected={(items) => setFolderRejected(items)}
						accept="folders"
					>
						<div
							class={`${styles["file-drop-page__zone"]} ${styles["file-drop-page__zone--folder"]}`}
						>
							<FolderIcon class={styles["file-drop-page__icon"]} />
							<p>Drop a folder here</p>
							<p class={styles["file-drop-page__hint"]}>
								Folders only (no files)
							</p>
						</div>
					</DropZone>
					<Show when={folderRejected().length > 0}>
						<p class={styles["file-drop-page__rejected"]} role="status">
							{describeRejections(folderRejected())}
						</p>
					</Show>
					{folderContents().length > 0 && (
						<div class={styles["file-drop-page__result"]}>
							<p class={styles["file-drop-page__result-label"]}>
								Folder contents ({folderContents().length} item(s)):
							</p>
							<div class={styles["file-drop-page__file-list"]}>
								<For each={folderContents()}>
									{(file) => (
										<code class={styles["file-drop-page__path"]}>
											{file.path}
										</code>
									)}
								</For>
							</div>
						</div>
					)}
				</section>
			</div>
		</div>
	);
}

export default FileDropPage;
