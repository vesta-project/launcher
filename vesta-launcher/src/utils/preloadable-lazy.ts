import { type Accessor, type Component, createSignal, lazy } from "solid-js";

type ComponentModule = { default: Component<any> };

/**
 * Solid's lazy components cache after rendering, but product surfaces often
 * know about user intent earlier (hover/focus). This helper shares one module
 * promise between intent preloading and the eventual Suspense render.
 */
export function createPreloadableLazyComponent(
	loader: () => Promise<ComponentModule>,
): {
	Component: Component<any>;
	preload: () => Promise<ComponentModule>;
} {
	let pending: Promise<ComponentModule> | undefined;
	const preload = () => (pending ??= loader());
	return {
		Component: lazy(preload),
		preload,
	};
}

/**
 * Coordinates intent preloading with retained tab content. Tabs only mount
 * after their first visit, then stay mounted so local form and resource state
 * survives navigation.
 */
export function createRetainedTabLoader<T extends string>(
	initialTab: T,
	resolveLoader: (tab: T) => (() => Promise<unknown>) | undefined,
	onPreloadError?: (tab: T, error: unknown) => void,
): {
	visitedTabs: Accessor<ReadonlySet<T>>;
	retain: (tab: T) => void;
	preload: (tab: T) => void;
	prepare: (tab: T) => void;
} {
	const [visitedTabs, setVisitedTabs] = createSignal<ReadonlySet<T>>(
		new Set<T>([initialTab]),
	);

	const retain = (tab: T) => {
		setVisitedTabs((visited) => {
			if (visited.has(tab)) return visited;
			return new Set([...visited, tab]);
		});
	};

	const preload = (tab: T) => {
		const loader = resolveLoader(tab);
		if (!loader) return;
		void loader().catch((error) => onPreloadError?.(tab, error));
	};

	const prepare = (tab: T) => {
		retain(tab);
		preload(tab);
	};

	return { visitedTabs, retain, preload, prepare };
}
