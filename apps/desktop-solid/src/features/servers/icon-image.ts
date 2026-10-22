// Normalizes a picked image into the agent's accepted icon encoding: a square,
// 8-bit RGBA, non-interlaced PNG between 64 and 512 pixels (canvas output satisfies all of it).
import { MAX_SERVER_ICON_BYTES } from './native-branding';

export const SERVER_ICON_SIZE = 128;

/** Center-crops to a square and re-encodes; resolves to base64 without the data URI prefix. */
export async function normalizeServerIcon(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SERVER_ICON_SIZE;
    const context = canvas.getContext('2d');
    if (!context || side === 0) throw new Error('unreadable image');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SERVER_ICON_SIZE, SERVER_ICON_SIZE);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png || png.size > MAX_SERVER_ICON_BYTES) throw new Error('icon too large');
    const bytes = new Uint8Array(await png.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  } finally {
    bitmap.close();
  }
}
