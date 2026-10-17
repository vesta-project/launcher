import { invoke } from '@tauri-apps/api/core';
import { nativeInstances } from './native-service';

/** Browser preview equivalent of the native screenshot-copy action. */
export async function copyScreenshot(src: string, path?: string): Promise<void> {
  if (nativeInstances && path) { await invoke('copy_screenshot_to_clipboard', { path }); return; }
  const png = (async () => {
    const response = await fetch(src);
    if (!response.ok) throw new Error("Could not read screenshot");
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image conversion unavailable");
      context.drawImage(bitmap, 0, 0);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("Image conversion failed")),
          "image/png",
        ),
      );
    } finally {
      bitmap.close();
    }
  })();
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
