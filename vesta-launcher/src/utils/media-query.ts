import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

export const RESOURCES_TABLE_COMPACT_WIDTH = 640;
export const RESOURCES_FILTER_COMPACT_WIDTH = 680;

export function createMediaQuery(query: string): () => boolean {
	const [matches, setMatches] = createSignal(false);

	if (typeof window === "undefined") {
		return matches;
	}

	const mql = window.matchMedia(query);
	setMatches(mql.matches);

	const handler = (e: MediaQueryListEvent) => {
		setMatches(e.matches);
	};

	mql.addEventListener("change", handler);
	onCleanup(() => mql.removeEventListener("change", handler));

	return matches;
}

/** Observe an element's width; returns true when width <= maxWidth. */
export function createContainerQuery(
	getElement: Accessor<HTMLElement | undefined>,
	maxWidth: number,
): Accessor<boolean> {
	const [isCompact, setIsCompact] = createSignal(false);

	createEffect(() => {
		const el = getElement();
		if (!el) return;

		const update = (width: number) => {
			setIsCompact(width <= maxWidth);
		};

		update(el.getBoundingClientRect().width);

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				update(entry.contentRect.width);
			}
		});

		observer.observe(el);
		onCleanup(() => observer.disconnect());
	});

	return isCompact;
}

/** Observe an element's width in pixels. */
export function createContainerWidth(
	getElement: Accessor<HTMLElement | undefined>,
): Accessor<number> {
	const [width, setWidth] = createSignal(0);

	createEffect(() => {
		const el = getElement();
		if (!el) return;

		const update = (w: number) => setWidth(w);

		update(el.getBoundingClientRect().width);

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				update(entry.contentRect.width);
			}
		});

		observer.observe(el);
		onCleanup(() => observer.disconnect());
	});

	return width;
}
