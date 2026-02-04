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
	initialParams?: Record<string, unknown>;
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
	customName: {
		set: (value: string | null) => void;
		get: Accessor<string | null>;
	};
	isReloading: Accessor<boolean>;
	private setCurrentPathProps: (
		props: Record<string, unknown> | undefined,
	) => void;
	private setIsReloading: (value: boolean) => void;
	private stateProviders: Map<string, () => Record<string, unknown>> =
		new Map();
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
	updateQuery: (key: string, value: unknown, push?: boolean) => void;
	removeQuery: (key: string, push?: boolean) => void;
	reload: () => Promise<void>;
	setState: (state: Record<string, unknown>) => void;
	registerStateProvider: (
		path: string,
		provider: () => Record<string, unknown>,
	) => void;
	getSnapshot: () => Record<string, unknown>;
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
		>(props.initialParams || {});

		const [getCurrentPathProps, setCurrentPathProps] = createSignal<
			Record<string, unknown> | undefined
		>(props.initialProps);

		const [getIsReloading, setIsReloading] = createSignal<boolean>(false);
		const [getCustomName, setCustomName] = createSignal<string | null>(null);

		this.currentPathProps = getCurrentPathProps;
		this.setCurrentPathProps = setCurrentPathProps;
		this.isReloading = getIsReloading;
		this.setIsReloading = setIsReloading;
		this.customName = { get: getCustomName, set: setCustomName };
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
						props: this.getSnapshot(), // Use snapshot to capture live state
					});
					setHistoryPast(newPast);
				}
				setCurrentPath(entry.path);
				setCurrentParams(entry.params);
				setCurrentPathProps(entry.props);
				setCustomName(null);
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

			const searchParams = new URLSearchParams();
			searchParams.set("path", path);

			if (Object.keys(params).length > 0) {
				for (const [key, value] of Object.entries(params)) {
					searchParams.set(key, String(value));
				}
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

		// Update query params. Can optionally create history entry (for tabs)
		this.updateQuery = (key: string, value: unknown, push = false) => {
			const currentParams = this.currentParams.get();
			const newParams = { ...currentParams };

			if (value === null || value === undefined) {
				delete newParams[key];
			} else {
				newParams[key] = value;
			}

			if (push) {
				this.history.push({
					path: this.currentPath.get(),
					params: newParams,
					props: this.getSnapshot(),
				});
				this.history.future = [];
			} else {
				this.currentParams.set(newParams);
			}

			console.log(
				`Updated query param ${key}:`,
				value,
				push ? "(push)" : "(replace)",
			);
		};

		// Remove a query param
		this.removeQuery = (key: string, push = false) => {
			this.updateQuery(key, null, push);
		};

		// Reload current page without creating history entry
		this.reload = async () => {
			if (this.refetchFn) {
				this.setIsReloading(true);
				try {
					await this.refetchFn();
					console.log("Page reloaded");
				} catch (error) {
					console.error("Reload failed:", error);
				} finally {
					this.setIsReloading(false);
				}
			} else {
				console.log("No refetch callback available");
			}
		};

		// NEW METHOD: Update component-specific state without affecting URL
		this.setState = (state: Record<string, unknown>) => {
			const newProps = { ...this.currentPathProps(), ...state };
			this.setCurrentPathProps(newProps);
			console.log("Updated component state:", state);
		};

		this.registerStateProvider = (
			path: string,
			provider: () => Record<string, unknown>,
		) => {
			this.stateProviders.set(path, provider);
		};

		this.getSnapshot = () => {
			const currentPath = this.currentPath.get();
			const provider = this.stateProviders.get(currentPath);
			const liveState = provider ? provider() : {};
			return { ...this.currentPathProps(), ...liveState };
		};

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

			// Preserve refetchFn across history navigation for cached data
			// Do NOT clear or call refetchFn when navigating backwards
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

			console.log("Navigating Forward to:", next.path);

			const newPast = [...getHistoryPast(), current];
			setHistoryPast(newPast);
			setHistoryFuture(futureArray);

			setCurrentPath(next.path);
			setCurrentParams(next.params);
			setCurrentPathProps(next.props);

			// Preserve refetchFn across history navigation for cached data
			// Do NOT clear or call refetchFn when navigating forwards
		};
	}

	// Getter that returns a reactive JSX element with optional additional props
	getRouterView(additionalProps?: Record<string, unknown>) {
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
