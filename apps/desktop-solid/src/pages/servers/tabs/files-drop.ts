// OS file drops onto the Files tab. In the app, the webview's native drag-drop events own
// file drops (see features/file-drop): they carry real paths, which native turns into upload
// candidates. Browser previews only get DOM `drop` events, so this reads the dropped entries'
// relative paths (folders walked) for the fixture server instead.

/** True when a DOM drag carries files from the OS (not text or an in-page drag). */
export const draggingFiles = (event: DragEvent) => !!event.dataTransfer && [...event.dataTransfer.types].includes('Files');

/** The folder row under a point or element, by its `data-drop-folder` name. */
export function folderAt(target: EventTarget | Element | null | undefined, within?: HTMLElement): string | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-drop-folder]') : null;
  if (!element || (within && !within.contains(element))) return null;
  return element.dataset.dropFolder ?? null;
}

const MAX_ENTRIES = 64;

/** Relative paths of a DOM drop (`plugins/LuckPerms/config.yml`), folders walked, capped like the picker. */
export async function droppedPaths(transfer: DataTransfer): Promise<string[]> {
  const entries = [...transfer.items]
    .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (!entries.length) return [...transfer.files].map((file) => file.name);
  const paths: string[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (paths.length > MAX_ENTRIES) return;
    if (entry.isFile) { paths.push(entry.fullPath.replace(/^\/+/, '')); return; }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (!batch.length) break;
      for (const child of batch) await walk(child);
    }
  };
  for (const entry of entries) await walk(entry);
  return paths;
}
