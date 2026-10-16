import { createSignal } from "solid-js";

const assets = import.meta.glob<string>(
  "../../assets/images/placeholders/placeholder-image*.png",
  { query: "?url", import: "default", eager: true },
);
export const defaultInstanceIcons = Object.entries(assets)
  .map(([path, src]) => ({
    value: `builtin:placeholder-${path.match(/image(\d+)/)![1]}`,
    src,
    label: `Default icon ${path.match(/image(\d+)/)![1]}`,
  }))
  .sort(
    (a, b) =>
      Number(a.value.split("-").at(-1)) - Number(b.value.split("-").at(-1)),
  );
export function stableIconId(value: string) {
  const number =
    value.match(/placeholder-(\d+)/)?.[1] ??
    value.match(/placeholder-image(\d+)/)?.[1];
  return number ? `builtin:placeholder-${number}` : value;
}
export const resolveInstanceIcon = (value: string) =>
  defaultInstanceIcons.find((icon) => icon.value === stableIconId(value))
    ?.src ?? value;
export const [uploadedInstanceIcons, setUploadedInstanceIcons] = createSignal<
  string[]
>([], { name: "uploadedInstanceIcons" });

/** Original picker upload behaviour: retain aspect ratio and limit either side to 512px. */
export async function importInstanceIcon(file: File): Promise<string> {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 512 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read this image.");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    image.close();
  }
}
