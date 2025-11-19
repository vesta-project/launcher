import { DropZone } from "@ui/drop-zone/drop-zone";
import { createSignal, For } from "solid-js";
import "./file-drop-page.css";

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
		<div class="file-drop-page">
			<h1>File Drop Test</h1>
			<p class="file-drop-page__description">
				Test the file drop functionality by dragging files or folders onto the
				drop zones below.
			</p>

			<div class="file-drop-page__zones">
				{/* Single File Drop Zone */}
				<section class="file-drop-page__section">
					<div class="file-drop-page__section-header">
						<h2>Single File Drop</h2>
						<button
							class="file-drop-page__clear-btn"
							onClick={clearSingleFile}
							disabled={!singleFile()}
						>
							Clear
						</button>
					</div>
					<DropZone onFileDrop={handleSingleFileDrop} accept="files">
						<div class="file-drop-page__zone file-drop-page__zone--single">
							<svg
								class="file-drop-page__icon"
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
								<polyline points="17 8 12 3 7 8" />
								<line x1="12" y1="3" x2="12" y2="15" />
							</svg>
							<p>Drop a single file here</p>
							<p class="file-drop-page__hint">Files only (no folders)</p>
						</div>
					</DropZone>
					{singleFile() && (
						<div class="file-drop-page__result">
							<p class="file-drop-page__result-label">Dropped file:</p>
							<code class="file-drop-page__path">{singleFile()!.path}</code>
						</div>
					)}
				</section>

				{/* Multiple Files Drop Zone */}
				<section class="file-drop-page__section">
					<div class="file-drop-page__section-header">
						<h2>Multiple Files Drop</h2>
						<button
							class="file-drop-page__clear-btn"
							onClick={clearMultipleFiles}
							disabled={multipleFiles().length === 0}
						>
							Clear
						</button>
					</div>
					<DropZone onFileDrop={handleMultipleFilesDrop} accept="files">
						<div class="file-drop-page__zone file-drop-page__zone--multiple">
							<svg
								class="file-drop-page__icon"
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
								<polyline points="14 2 14 8 20 8" />
								<line x1="12" y1="18" x2="12" y2="12" />
								<line x1="9" y1="15" x2="15" y2="15" />
							</svg>
							<p>Drop multiple files here</p>
							<p class="file-drop-page__hint">Files only (no folders)</p>
						</div>
					</DropZone>
					{multipleFiles().length > 0 && (
						<div class="file-drop-page__result">
							<p class="file-drop-page__result-label">
								Dropped {multipleFiles().length} file(s):
							</p>
							<div class="file-drop-page__file-list">
								<For each={multipleFiles()}>
									{(file) => (
										<code class="file-drop-page__path">{file.path}</code>
									)}
								</For>
							</div>
						</div>
					)}
				</section>

				{/* Folder Drop Zone */}
				<section class="file-drop-page__section">
					<div class="file-drop-page__section-header">
						<h2>Folder Drop</h2>
						<button
							class="file-drop-page__clear-btn"
							onClick={clearFolderContents}
							disabled={folderContents().length === 0}
						>
							Clear
						</button>
					</div>
					<DropZone onFileDrop={handleFolderDrop} accept="folders">
						<div class="file-drop-page__zone file-drop-page__zone--folder">
							<svg
								class="file-drop-page__icon"
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
							</svg>
							<p>Drop a folder here</p>
							<p class="file-drop-page__hint">Folders only (no files)</p>
						</div>
					</DropZone>
					{folderContents().length > 0 && (
						<div class="file-drop-page__result">
							<p class="file-drop-page__result-label">
								Folder contents ({folderContents().length} item(s)):
							</p>
							<div class="file-drop-page__file-list">
								<For each={folderContents()}>
									{(file) => (
										<code class="file-drop-page__path">{file.path}</code>
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
