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
	batch,
	createMemo,
	createSignal,
	type JSXElement,
	type ValidComponent,
} from "solid-js";

import {
	createLibraryEntry,
	type HistoryEntry,
	isLibraryEntry,
	isLibraryPath,
	type ShellNavigationDelegate,
} from "@utils/flat-shell-navigation";
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
	private setCurrentPathProps: (props: Record<string, unknown> | undefined) => void;
	private setIsReloading: (value: boolean) => void;
	private stateProviders: Map<string, () => Record<string, unknown>> = new Map();
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
	navigateFromLibrary: (
		path: string,
		params?: Record<string, unknown>,
		props?: Record<string, unknown>,
	) => void;
	navigateToLibrary: () => void;
	isOnLibrarySlot: () => boolean;
	setLibrarySlot: () => void;
	resetLibrarySlot: () => void;
	updateQuery: (key: string, value: unknown, push?: boolean) => void;
	removeQuery: (key: string, push?: boolean) => void;
	reload: () => Promise<void>;
	setState: (state: Record<string, unknown>) => void;
	registerStateProvider: (path: string, provider: () => Record<string, unknown>) => void;
	getSnapshot: () => Record<string, unknown>;
	forwards: () => void;
	backwards: () => void;
	getRefetch: () => (() => Promise<void>) | undefined;
	setRefetch: (fn: (() => Promise<void>) | undefined, path?: string) => void;
	clearRefetch: (fn?: () => Promise<void>) => void;
	canGoBack: () => boolean;
	canGoForward: () => boolean;
	/** Reactive history past stack for Solid memos (tracks signal reads). */
	historyPast: Accessor<HistoryEntry[]>;
	/** Reactive history future stack for Solid memos (tracks signal reads). */
	historyFuture: Accessor<HistoryEntry[]>;
	/** Reactive can-go-back for button disabled state. */
	canGoBackReactive: Accessor<boolean>;
	/** Reactive can-go-forward for button disabled state. */
	canGoForwardReactive: Accessor<boolean>;
	generateUrl: () => string;
	getCanExit: () => (() => Promise<boolean>) | null;
	setCanExit: (fn: (() => Promise<boolean>) | null) => void;
	setShellNavigation: (delegate: ShellNavigationDelegate | null) => void;
	skipNextExitCheck: boolean = false;
	private refetchFn: (() => Promise<void>) | undefined;
	private refetchPath: string | undefined;
	private canExitBlock: (() => Promise<boolean>) | null = null;
	private shellNavigation: ShellNavigationDelegate | null = null;

	constructor(props: MiniRouterProps) {
		this.paths = props.paths;

		this.paths["404"] = { element: props.invalid ?? (() => <div />) };

		const [getCanExit, setCanExitSignal] = createSignal<(() => Promise<boolean>) | null>(null);

		this.getCanExit = getCanExit;
		this.setCanExit = (fn) => setCanExitSignal(() => fn);

		const [getCurrentPath, setCurrentPath] = createSignal<string>(props.currentPath ?? "");

		const [getCurrentParams, setCurrentParams] = createSignal<Record<string, unknown>>(
			props.initialParams || {},
		);

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
			const pathConfig = this.paths[this.currentPath.get()] ?? this.paths["404"];
			const params = this.currentParams.get();
			const props = this.currentPathProps();

			return {
				...pathConfig,
				props: { ...params, ...props },
			};
		});

		const [getHistoryPast, setHistoryPast] = createSignal<HistoryEntry[]>([]);
		const [getHistoryFuture, setHistoryFuture] = createSignal<HistoryEntry[]>([]);

		const applyEntry = (entry: HistoryEntry) => {
			batch(() => {
				setCurrentPath(entry.path);
				setCurrentParams(entry.params);
				setCurrentPathProps(entry.props);
			});
		};

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
				const previousPath = this.currentPath.get();
				batch(() => {
					if (previousPath !== "" && !isLibraryPath(previousPath)) {
						const newPast = [...getHistoryPast()];
						newPast.push({
							path: previousPath,
							params: this.currentParams.get(),
							props: this.getSnapshot(),
						});
						setHistoryPast(newPast);
					}
					applyEntry(entry);
					if (entry.path !== previousPath) {
						setCustomName(null);
					}
				});
			},
			clear: () => {
				batch(() => {
					setHistoryPast([]);
					setHistoryFuture([]);
				});
			},
		};

		this.setRefetch = (fn: (() => Promise<void>) | undefined, path = this.currentPath.get()) => {
			this.refetchFn = fn;
			this.refetchPath = fn ? path : undefined;
		};

		this.clearRefetch = (fn?: () => Promise<void>) => {
			if (fn && this.refetchFn !== fn) return;
			this.refetchFn = undefined;
			this.refetchPath = undefined;
		};

		this.getRefetch = () => {
			if (!this.refetchFn) return undefined;
			if (this.refetchPath && this.refetchPath !== this.currentPath.get()) return undefined;
			return this.refetchFn;
		};

		this.setShellNavigation = (delegate) => {
			this.shellNavigation = delegate;
		};

		this.isOnLibrarySlot = () => isLibraryPath(this.currentPath.get());

		this.setLibrarySlot = () => {
			applyEntry(createLibraryEntry());
		};

		this.resetLibrarySlot = () => {
			batch(() => {
				setHistoryPast(getHistoryPast().filter((entry) => !isLibraryEntry(entry)));
				setHistoryFuture(getHistoryFuture().filter((entry) => !isLibraryEntry(entry)));
				if (this.isOnLibrarySlot()) {
					setCurrentPath("");
					setCurrentParams({});
					setCurrentPathProps(undefined);
				}
			});
		};

		this.historyPast = getHistoryPast;
		this.historyFuture = getHistoryFuture;
		this.canGoBackReactive = createMemo(() => getHistoryPast().length > 0);
		this.canGoForwardReactive = createMemo(() => getHistoryFuture().length > 0);
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

		this.navigateFromLibrary = (
			path: string,
			params?: Record<string, unknown>,
			props?: Record<string, unknown>,
		) => {
			batch(() => {
				setHistoryPast([createLibraryEntry()]);
				applyEntry({
					path,
					params: params || {},
					props,
				});
				setCustomName(null);
				setHistoryFuture([]);
			});
			this.shellNavigation?.onLeaveLibrary();
		};

		this.navigateToLibrary = () => {
			if (this.isOnLibrarySlot()) {
				this.shellNavigation?.onEnterLibrary();
				return;
			}

			const current: HistoryEntry = {
				path: this.currentPath.get(),
				params: this.currentParams.get(),
				props: this.currentPathProps(),
			};

			// Library sidebar/tab: jump to the library slot in one step. Push the current
			// page onto past (not future) so Back on the library screen returns here.
			// Contrast with backwards() hitting the library sentinel, which walks the
			// stack one entry at a time and builds future for redo.
			batch(() => {
				setHistoryPast([...getHistoryPast(), current]);
				setHistoryFuture([]);
				applyEntry(createLibraryEntry());
			});
			this.shellNavigation?.onEnterLibrary();
		};

		this.navigate = (
			path: string,
			params?: Record<string, unknown>,
			props?: Record<string, unknown>,
		) => {
			batch(() => {
				this.history.push({
					path,
					params: params || {},
					props,
				});
				this.history.future = [];
			});
		};

		this.updateQuery = (key: string, value: unknown, push = false) => {
			const currentParams = this.currentParams.get();
			const newParams = { ...currentParams };

			if (value === null || value === undefined) {
				delete newParams[key];
			} else {
				newParams[key] = value;
			}

			if (push) {
				batch(() => {
					this.history.push({
						path: this.currentPath.get(),
						params: newParams,
						props: this.getSnapshot(),
					});
					this.history.future = [];
				});
			} else {
				this.currentParams.set(newParams);
			}
		};

		this.removeQuery = (key: string, push = false) => {
			this.updateQuery(key, null, push);
		};

		this.reload = async () => {
			const refetch = this.getRefetch();
			if (!refetch || this.isReloading()) return;

			this.setIsReloading(true);
			try {
				await refetch();
			} catch (error) {
				console.error("Reload failed:", error);
			} finally {
				this.setIsReloading(false);
			}
		};

		this.setState = (state: Record<string, unknown>) => {
			const newProps = { ...this.currentPathProps(), ...state };
			this.setCurrentPathProps(newProps);
		};

		this.registerStateProvider = (path: string, provider: () => Record<string, unknown>) => {
			this.stateProviders.set(path, provider);
		};

		this.getSnapshot = () => {
			const currentPath = this.currentPath.get();
			const provider = this.stateProviders.get(currentPath);
			const liveState = provider ? provider() : {};
			return { ...this.currentPathProps(), ...liveState };
		};

		this.backwards = () => {
			if (this.history.past.length === 0) return;

			const current: HistoryEntry = {
				path: this.currentPath.get(),
				params: this.currentParams.get(),
				props: this.currentPathProps(),
			};

			const pastArray = [...getHistoryPast()];
			const prev = pastArray.pop();
			if (!prev) return;

			if (isLibraryEntry(prev)) {
				// Stepped back onto the library sentinel (in-app back, not library tab).
				batch(() => {
					setHistoryPast([]);
					setHistoryFuture([current, ...getHistoryFuture()]);
					applyEntry(createLibraryEntry());
				});
				this.shellNavigation?.onEnterLibrary();
				return;
			}

			const newFuture = [current, ...getHistoryFuture()];
			batch(() => {
				setHistoryFuture(newFuture);
				setHistoryPast(pastArray);
				applyEntry(prev);
			});
			this.shellNavigation?.onLeaveLibrary();
		};

		this.forwards = () => {
			if (this.history.future.length === 0) return;

			const futureArray = [...getHistoryFuture()];
			const next = futureArray.shift();
			if (!next || isLibraryEntry(next)) return;

			if (this.isOnLibrarySlot()) {
				batch(() => {
					setHistoryPast([createLibraryEntry()]);
					applyEntry(next);
					setHistoryFuture(futureArray);
				});
				this.shellNavigation?.onLeaveLibrary();
				return;
			}

			const current: HistoryEntry = {
				path: this.currentPath.get(),
				params: this.currentParams.get(),
				props: this.currentPathProps(),
			};

			const newPast = [...getHistoryPast(), current];
			batch(() => {
				setHistoryPast(newPast);
				setHistoryFuture(futureArray);
				applyEntry(next);
			});
			this.shellNavigation?.onLeaveLibrary();
		};
	}

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

export { CreateMiniRouterPath, MiniRouter };
// Canonical HistoryEntry lives in flat-shell-navigation to avoid mini-router ↔ utilities cycles.
export type { HistoryEntry } from "@utils/flat-shell-navigation";
