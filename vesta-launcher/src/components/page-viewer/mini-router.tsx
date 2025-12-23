/*
The Mini Router Component is a router solution to display different pages and navigate between them.

Refactored to support:
- Route parameters (e.g., /instance/:slug)
- Proper history with params + state separation
- URL generation for deep linking
- Disabled button states
 */

import {
	type Accessor,
	createMemo,
	createSignal,
	type JSXElement,
	type ValidComponent,
} from "solid-js";

import { Dynamic } from "solid-js/web";

interface RouterComponent<T extends ValidComponent = ValidComponent> {
	name?: string;
	element: T;
	props?: Record<string, unknown>;
}

interface MiniRouterProps {
	paths: Record<string, RouterComponent>;
	invalid?: ValidComponent;
	currentPath?: string;
	initialProps?: Record<string, unknown>;
}

interface HistoryEntry {
	path: string;
	params: Record<string, unknown>;
	props: Record<string, unknown> | undefined;
}

class MiniRouter {
	paths: Record<string, RouterComponent>;
	currentPath: { set: (value: string) => void; get: Accessor<string> };
	currentParams: {
		set: (value: Record<string, unknown>) => void;
		get: Accessor<Record<string, unknown>>;
	};
	currentElement: Accessor<RouterComponent>;
	currentPathProps: Accessor<Record<string, unknown> | undefined>;
	private setCurrentPathProps: (
		props: Record<string, unknown> | undefined,
	) => void;
	history: {
		past: HistoryEntry[];
		future: HistoryEntry[];
		push: (entry: HistoryEntry) => void;
		clear: () => void;
	};
	navigate: (
		path: string,
		params?: Record<string, unknown>,
		props?: Record<string, unknown>,
	) => void;
	updateQuery: (key: string, value: unknown) => void;
	reload: () => Promise<void>;
	setState: (state: Record<string, unknown>) => void;
	forwards: () => void;
	backwards: () => void;
	getRefetch: () => (() => Promise<void>) | undefined;
	setRefetch: (fn: () => Promise<void>) => void;
	canGoBack: () => boolean;
	canGoForward: () => boolean;
	generateUrl: () => string;
	private refetchFn: (() => Promise<void>) | undefined;

	constructor(props: MiniRouterProps) {
		this.paths = props.paths;

		this.paths["404"] = { element: props.invalid ?? (() => <div />) };

		const [getCurrentPath, setCurrentPath] = createSignal<string>(
			props.currentPath ?? "",
		);

		const [getCurrentParams, setCurrentParams] = createSignal<
			Record<string, unknown>
		>({});

		const [getCurrentPathProps, setCurrentPathProps] = createSignal<
			Record<string, unknown> | undefined
		>(props.initialProps);

		this.currentPathProps = getCurrentPathProps;
		this.setCurrentPathProps = setCurrentPathProps;
		this.currentPath = { set: setCurrentPath, get: getCurrentPath };
		this.currentParams = { set: setCurrentParams, get: getCurrentParams };

		this.currentElement = createMemo(() => {
			const pathConfig =
				this.paths[this.currentPath.get()] ?? this.paths["404"];
			const params = this.currentParams.get();
			const props = this.currentPathProps();

			return {
				...pathConfig,
				props: { ...params, ...props },
			};
		});

		const [getHistoryPast, setHistoryPast] = createSignal<HistoryEntry[]>([]);
		const [getHistoryFuture, setHistoryFuture] = createSignal<HistoryEntry[]>(
			[],
		);

		this.history = {
			get past() {
				return getHistoryPast();
			},
			set past(value: HistoryEntry[]) {
				setHistoryPast(value);
			},
			get future() {
				return getHistoryFuture();
			},
			set future(value: HistoryEntry[]) {
				setHistoryFuture(value);
			},
			push: (entry: HistoryEntry) => {
				if (this.currentPath.get() !== "") {
					const newPast = [...getHistoryPast()];
					newPast.push({
						path: this.currentPath.get(),
						params: this.currentParams.get(),
						props: this.currentPathProps(),
					});
					setHistoryPast(newPast);
				}
				setCurrentPath(entry.path);
				setCurrentParams(entry.params);
				setCurrentPathProps(entry.props);
			},
			clear: () => {
				setHistoryPast([]);
				setHistoryFuture([]);
			},
		};

		// Refetch management
		this.setRefetch = (fn: () => Promise<void>) => {
			this.refetchFn = fn;
		};

		this.getRefetch = () => this.refetchFn;

		// Helper methods
		this.canGoBack = () => this.history.past.length > 0;
		this.canGoForward = () => this.history.future.length > 0;

		this.generateUrl = () => {
			const path = this.currentPath.get();
			const params = this.currentParams.get();

			if (Object.keys(params).length === 0) {
				return `vesta://${path}`;
			}

			const searchParams = new URLSearchParams();
			for (const [key, value] of Object.entries(params)) {
				searchParams.set(key, String(value));
			}
			return `vesta://${path}?${searchParams.toString()}`;
		};

		this.navigate = (
			path: string,
			params?: Record<string, unknown>,
			props?: Record<string, unknown>,
		) => {
			this.history.push({
				path,
				params: params || {},
				props,
			});
			this.history.future = [];
			console.log(
				"Navigating to:",
				path,
				"with params:",
				params,
				"and props:",
				props,
			);
		};

		// NEW METHOD: Update query params without creating history entry (for component local state like tabs)
		const updateQuery = (key: string, value: unknown) => {
			const newParams = { ...this.currentParams.get(), [key]: value };
			this.currentParams.set(newParams);
			console.log(`Updated query param ${key}:`, value);
		};

		// NEW METHOD: Reload current page without creating history entry
		const reload = async () => {
			if (this.refetchFn) {
				try {
					await this.refetchFn();
					console.log("Page reloaded");
				} catch (error) {
					console.error("Reload failed:", error);
				}
			} else {
				console.log("No refetch callback available");
			}
		};

		// NEW METHOD: Update component-specific state without affecting URL
		const setState = (state: Record<string, unknown>) => {
			const newProps = { ...this.currentPathProps(), ...state };
			this.setCurrentPathProps(newProps);
			console.log("Updated component state:", state);
		};

		// Expose new methods on the router instance
		Object.defineProperty(this, "updateQuery", {
			value: updateQuery,
			writable: false,
		});
		Object.defineProperty(this, "reload", { value: reload, writable: false });
		Object.defineProperty(this, "setState", {
			value: setState,
			writable: false,
		});

		this.backwards = () => {
			if (!this.canGoBack()) return;

			const current: HistoryEntry = {
				path: this.currentPath.get(),
				params: this.currentParams.get(),
				props: this.currentPathProps(),
			};

			const pastArray = [...getHistoryPast()];
			const prev = pastArray.pop();
			if (!prev) return;

			const newFuture = [current, ...getHistoryFuture()];
			setHistoryFuture(newFuture);
			setHistoryPast(pastArray);

			setCurrentPath(prev.path);
			setCurrentParams(prev.params);
			setCurrentPathProps(prev.props);

			// Do NOT refetch on backwards - use cached data
			this.refetchFn = undefined;
			console.log("Navigating Back to:", prev.path);
		};

		this.forwards = () => {
			if (!this.canGoForward()) return;

			const current: HistoryEntry = {
				path: this.currentPath.get(),
				params: this.currentParams.get(),
				props: this.currentPathProps(),
			};

			const futureArray = [...getHistoryFuture()];
			const next = futureArray.shift();
			if (!next) return;

			const newPast = [...getHistoryPast(), current];
			setHistoryPast(newPast);
			setHistoryFuture(futureArray);

			setCurrentPath(next.path);
			setCurrentParams(next.params);
			setCurrentPathProps(next.props);

			// Do NOT refetch on forwards - use cached data
			this.refetchFn = undefined;
			console.log("Navigating Forward to:", next.path);
		};
	}

	// Getter that returns a reactive JSX element with optional additional props
	getRouterView(additionalProps?: Record<string, unknown>): JSXElement {
		return (
			<Dynamic
				component={this.currentElement().element}
				{...(this.currentElement().props || {})}
				{...(additionalProps || {})}
			/>
		);
	}
}

function CreateMiniRouterPath(
	path: string,
	element: ValidComponent,
	name?: string,
	props?: Record<string, unknown>,
) {
	return { [path]: { name, element, props } };
}

export { MiniRouter, CreateMiniRouterPath };
