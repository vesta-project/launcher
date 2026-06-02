import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import {
	computeHeaderCollapseProgress,
	deriveHeaderCompactState,
} from "./resource-details-header-progress";

const PROGRESS_EPSILON = 0.001;

export function supportsScrollDrivenHeaderCollapse(): boolean {
	return typeof CSS !== "undefined" && CSS.supports("animation-timeline", "scroll()");
}

export function getScrollParent(el: HTMLElement | null | undefined): HTMLElement | undefined {
	if (!el) return undefined;
	let node: HTMLElement | null = el.parentElement;
	while (node) {
		const overflowY = getComputedStyle(node).overflowY;
		if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
			return node;
		}
		node = node.parentElement;
	}
	return undefined;
}

export function findPageScrollContainer(root: HTMLElement | null | undefined): HTMLElement | undefined {
	if (!root) return undefined;

	const marked = root.closest<HTMLElement>("[data-page-scroll-container]");
	if (marked) return marked;

	return getScrollParent(root) ?? root.closest<HTMLElement>("main") ?? undefined;
}

export function computeHeaderCollapseState(
	scrollOffset: number,
	maxScroll: number,
	wasCompact: boolean,
) {
	const progress = computeHeaderCollapseProgress(scrollOffset, maxScroll);
	const compact = deriveHeaderCompactState(progress, wasCompact);
	return { progress, compact };
}

export type HeaderCollapseClassNames = {
	compact: string;
	floating: string;
};

export type HeaderCollapseController = {
	setPageRoot: (el: HTMLDivElement | undefined) => void;
	setHeaderEl: (el: HTMLElement | undefined) => void;
	scheduleUpdate: () => void;
	getPageRoot: () => HTMLDivElement | undefined;
	getScrollContainer: () => HTMLElement | undefined;
};

export function applyHeaderCollapseToElement(
	header: HTMLElement,
	progress: number,
	compact: boolean,
	classNames: HeaderCollapseClassNames,
	cssDrivenProgress = false,
) {
	if (!cssDrivenProgress) {
		header.style.setProperty("--header-collapse-progress", String(progress));
	} else {
		header.style.removeProperty("--header-collapse-progress");
	}

	header.classList.toggle(classNames.compact, compact);
	header.classList.toggle(classNames.floating, progress > 0.01);
}

export function resetHeaderCollapseElement(
	header: HTMLElement,
	classNames: HeaderCollapseClassNames,
	cssDrivenProgress = false,
) {
	header.style.removeProperty("--header-collapse-progress");
	header.classList.remove(classNames.compact, classNames.floating);

	if (!cssDrivenProgress) {
		header.style.setProperty("--header-collapse-progress", "0");
	}
}

export function createHeaderCollapseController(options: {
	isDesktop: Accessor<boolean>;
	classNames: HeaderCollapseClassNames;
}): HeaderCollapseController {
	const cssDrivenProgress = supportsScrollDrivenHeaderCollapse();
	const [pageRoot, setPageRoot] = createSignal<HTMLDivElement | undefined>();
	const [headerEl, setHeaderElement] = createSignal<HTMLElement | undefined>();
	const [scrollContainer, setScrollContainer] = createSignal<HTMLElement | undefined>();
	let wasCompact = false;
	let lastProgress = -1;
	let scrollRaf: number | null = null;

	const applyToHeader = (progress: number, compact: boolean) => {
		const header = headerEl();
		if (!header) return;
		applyHeaderCollapseToElement(header, progress, compact, options.classNames, cssDrivenProgress);
	};

	const resetHeader = () => {
		wasCompact = false;
		lastProgress = -1;
		const header = headerEl();
		if (header) resetHeaderCollapseElement(header, options.classNames, cssDrivenProgress);
	};

	const runUpdate = (container: HTMLElement) => {
		if (!options.isDesktop()) {
			resetHeader();
			return;
		}

		const maxScroll = container.scrollHeight - container.clientHeight;
		const scrollOffset = container.scrollTop;
		const state = computeHeaderCollapseState(scrollOffset, maxScroll, wasCompact);

		if (
			Math.abs(state.progress - lastProgress) < PROGRESS_EPSILON &&
			state.compact === wasCompact
		) {
			return;
		}

		lastProgress = state.progress;
		wasCompact = state.compact;
		applyToHeader(state.progress, state.compact);
	};

	const scheduleUpdate = () => {
		const container = scrollContainer();
		if (!container) return;

		if (scrollRaf !== null) return;
		scrollRaf = requestAnimationFrame(() => {
			scrollRaf = null;
			runUpdate(container);
		});
	};

	createEffect(() => {
		const root = pageRoot();
		const desktop = options.isDesktop();

		if (!root || !desktop) {
			resetHeader();
			setScrollContainer(undefined);
			return;
		}

		let container: HTMLElement | undefined;
		let retryRaf: number | undefined;
		let disposed = false;

		const resizeObserver =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(() => {
						scheduleUpdate();
					})
				: undefined;

		const bindScrollContainer = () => {
			if (disposed) return;

			container = findPageScrollContainer(root);
			if (!container) {
				retryRaf = requestAnimationFrame(bindScrollContainer);
				return;
			}

			setScrollContainer(container);
			container.addEventListener("scroll", scheduleUpdate, { passive: true });
			resizeObserver?.observe(container);
			scheduleUpdate();
		};

		bindScrollContainer();

		onCleanup(() => {
			disposed = true;
			if (retryRaf !== undefined) cancelAnimationFrame(retryRaf);
			container?.removeEventListener("scroll", scheduleUpdate);
			resizeObserver?.disconnect();
			setScrollContainer(undefined);
		});
	});

	createEffect(() => {
		if (!options.isDesktop()) return;
		headerEl();
		scheduleUpdate();
	});

	return {
		setPageRoot: (el) => setPageRoot(el),
		setHeaderEl: (el) => {
			setHeaderElement(el);
			scheduleUpdate();
		},
		scheduleUpdate,
		getPageRoot: () => pageRoot(),
		getScrollContainer: () => scrollContainer(),
	};
}
