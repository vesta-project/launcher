import FileAddIcon from "@assets/icons/content/file-add.svg";
import FolderIcon from "@assets/icons/content/folder.svg";
import UploadIcon from "@assets/icons/actions/upload.svg";
import { DropZone } from "@ui/drop-zone/drop-zone";
import { createSignal, For } from "solid-js";
import styles from "./file-drop-page.module.css";

interface DroppedFile {
	path: string;
	timestamp: number;
}

function FileDropPage() {
	const [singleFile, setSingleFile] = createSignal<DroppedFile | null>(null);
	const [multipleFiles, setMultipleFiles] = createSignal<DroppedFile[]>([]);
	const [folderContents, setFolderContents] = createSignal<DroppedFile[]>([]);

	const handleSingleFileDrop = (files: string[]) => {
		if (files.length > 0) {
			setSingleFile({
				path: files[0],
				timestamp: Date.now(),
			});
		}
	};

	const handleMultipleFilesDrop = (files: string[]) => {
		const newFiles = files.map((path) => ({
			path,
			timestamp: Date.now(),
		}));
		setMultipleFiles((prev) => [...prev, ...newFiles]);
	};

	const handleFolderDrop = (files: string[]) => {
		const newFiles = files.map((path) => ({
			path,
			timestamp: Date.now(),
		}));
		setFolderContents(newFiles);
	};

	const clearSingleFile = () => setSingleFile(null);
	const clearMultipleFiles = () => setMultipleFiles([]);
	const clearFolderContents = () => setFolderContents([]);

	return (
		<div class={styles["file-drop-page"]}>
			<h1>File Drop Test</h1>
			<p class={styles["file-drop-page__description"]}>
				Test the file drop functionality by dragging files or folders onto the
				drop zones below.
			</p>

			<div class={styles["file-drop-page__zones"]}>
				{/* Single File Drop Zone */}
				<section class={styles["file-drop-page__section"]}>
					<div class={styles["file-drop-page__section-header"]}>
						<h2>Single File Drop</h2>
						<button
							class={styles["file-drop-page__clear-btn"]}
							onClick={clearSingleFile}
							disabled={!singleFile()}
						>
							Clear
						</button>
					</div>
					<DropZone onFileDrop={handleSingleFileDrop} accept="files">
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
							disabled={multipleFiles().length === 0}
						>
							Clear
						</button>
					</div>
					<DropZone onFileDrop={handleMultipleFilesDrop} accept="files">
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
							disabled={folderContents().length === 0}
						>
							Clear
						</button>
					</div>
					<DropZone onFileDrop={handleFolderDrop} accept="folders">
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
