import { resolveResourceUrl } from "@utils/assets";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
} from "solid-js";

const posterCache = new Map<string, Promise<string | null>>();

function pngHasAnimationChunk(dataUrl: string) {
	const commaIndex = dataUrl.indexOf(",");
	if (commaIndex === -1) return false;

	try {
		const binary = atob(dataUrl.slice(commaIndex + 1));
		return binary.includes("acTL");
	} catch {
		return false;
	}
}

export function isAnimatedIconSource(source?: string | null) {
	if (!source?.startsWith("data:image/")) return false;
	const lower = source.slice(0, 32).toLowerCase();
	return (
		lower.startsWith("data:image/gif") ||
		lower.startsWith("data:image/webp") ||
		(lower.startsWith("data:image/png") && pngHasAnimationChunk(source))
	);
}

function createPosterFrame(source: string) {
	const cached = posterCache.get(source);
	if (cached) return cached;

	const promise = new Promise<string | null>((resolve) => {
		const image = new Image();
		image.onload = () => {
			const width = image.naturalWidth || image.width;
			const height = image.naturalHeight || image.height;
			if (!width || !height) {
				resolve(null);
				return;
			}

			try {
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext("2d");
				if (!ctx) {
					resolve(null);
					return;
				}
				ctx.drawImage(image, 0, 0, width, height);
				resolve(canvas.toDataURL("image/png"));
			} catch {
				resolve(null);
			}
		};
		image.onerror = () => resolve(null);
		image.src = source;
	});

	posterCache.set(source, promise);
	return promise;
}

export function createAnimatedIconPreview(
	icon: Accessor<string | null | undefined>,
) {
	const [posterFrame, setPosterFrame] = createSignal<string | null>(null);
	const [active, setActive] = createSignal(false);

	const source = createMemo(() => {
		const raw = icon();
		if (!raw) return undefined;
		if (raw.startsWith("linear-gradient")) return raw;
		return resolveResourceUrl(raw);
	});

	const isAnimated = createMemo(() => isAnimatedIconSource(source()));

	createEffect(() => {
		const current = source();
		let cancelled = false;
		setPosterFrame(null);

		if (!current || !isAnimatedIconSource(current)) return;

		createPosterFrame(current).then((poster) => {
			if (!cancelled) setPosterFrame(poster);
		});

		onCleanup(() => {
			cancelled = true;
		});
	});

	const displaySource = createMemo(() => {
		const current = source();
		if (!current) return undefined;
		if (!isAnimated()) return current;
		return active() ? current : posterFrame() || current;
	});

	return {
		source,
		displaySource,
		isAnimated,
		setActive,
		activate: () => setActive(true),
		deactivate: () => setActive(false),
	};
}

export function iconBackgroundStyle(source?: string | null) {
	if (!source) return {};
	if (source.startsWith("linear-gradient")) return { background: source };

	return {
		"background-image": `url('${source}')`,
		"background-size": "cover",
		"background-position": "center",
	};
}
