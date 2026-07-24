import {
	type Accessor,
	createEffect,
	createSignal,
	onCleanup,
	untrack,
} from "solid-js";

export interface NonSuspendingLoader<T> {
	value: Accessor<T>;
	loading: Accessor<boolean>;
	error: Accessor<unknown>;
	refetch: () => Promise<void>;
}

/**
 * Loads async enhancement data without participating in Solid Suspense.
 * Use this for data that should update part of an already-painted page rather
 * than replace the page with a route-level fallback.
 */
export function createNonSuspendingLoader<S, T>(
	source: Accessor<S | null | undefined>,
	fetcher: (source: S) => Promise<T>,
	initialValue: T,
): NonSuspendingLoader<T> {
	const [value, setValue] = createSignal<T>(initialValue);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<unknown>();
	let generation = 0;

	const load = async (sourceValue: S) => {
		const activeGeneration = ++generation;
		setLoading(true);
		setError(undefined);

		try {
			const result = await fetcher(sourceValue);
			if (activeGeneration !== generation) return;
			setValue(() => result);
		} catch (loadError) {
			if (activeGeneration !== generation) return;
			setError(loadError);
		} finally {
			if (activeGeneration === generation) setLoading(false);
		}
	};

	createEffect(() => {
		const sourceValue = source();
		if (sourceValue == null) {
			generation += 1;
			setLoading(false);
			return;
		}
		void load(sourceValue);
	});

	onCleanup(() => {
		generation += 1;
	});

	return {
		value,
		loading,
		error,
		refetch: async () => {
			const sourceValue = untrack(source);
			if (sourceValue == null) return;
			await load(sourceValue);
		},
	};
}
