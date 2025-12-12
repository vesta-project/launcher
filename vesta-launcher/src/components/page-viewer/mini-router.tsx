/*
The Mini Router Component is a router solution to display different pages and navigate between them.

This is temporary and will most likely have to be rewritten in the future.
 */

import {
	type Accessor,
	type JSXElement,
	type ValidComponent,
	createMemo,
	createSignal,
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

class MiniRouter {
	paths: Record<string, RouterComponent>;
	currentPath: { set: (value: string) => void; get: Accessor<string> };
	currentElement: Accessor<RouterComponent>;
	currentPathProps: Accessor<Record<string, unknown> | undefined>;
	private setCurrentPathProps: (props: Record<string, unknown> | undefined) => void;
	history: {
		past: { [p: string]: RouterComponent }[];
		future: { [p: string]: RouterComponent }[];
		push: (path: string) => void;
		clear: () => void;
	};
	navigate: (path: string, props?: Record<string, unknown>) => void;
	forwards: () => void;
	backwards: () => void;

	constructor(props: MiniRouterProps) {
		this.paths = props.paths;

		this.paths["404"] = { element: props.invalid ?? (() => <div />) };

		const [getCurrentPath, setCurrentPath] = createSignal<string>(
			props.currentPath ?? "",
		);

		const [getCurrentPathProps, setCurrentPathProps] = createSignal<Record<string, unknown> | undefined>(
			props.initialProps,
		);
		this.currentPathProps = getCurrentPathProps;
		this.setCurrentPathProps = setCurrentPathProps;

		this.currentPath = { set: setCurrentPath, get: getCurrentPath };

		this.currentElement = createMemo(() => {
			const pathConfig = this.paths[this.currentPath.get()] ?? this.paths["404"];
			return {
				...pathConfig,
				props: this.currentPathProps(),
			};
		});

		this.history = {
			past: [],
			future: [],
			push: (path: string) => {
				if (this.currentPath.get() !== "") {
					this.history.past.push({
						[this.currentPath.get()]: this.currentElement(),
					});
				}
				this.currentPath.set(path);
			},
			clear: () => {
				this.history.past = [];
				this.history.future = [];
			},
		};

		this.navigate = (path: string, props?: Record<string, unknown>) => {
			this.setCurrentPathProps(props);
			this.history.push(path);
			this.history.future = [];
			console.log("Navigating Page: " + path);
			console.log(this);
		};

		this.backwards = () => {
			const x: { [p: string]: RouterComponent } | undefined =
				this.history.past.pop();
			if (x) {
				this.history.future.push({
					[this.currentPath.get()]: this.currentElement(),
				});

				const key = Object.keys(x)[0];
				this.setCurrentPathProps(x[key]?.props);
				this.currentPath.set(key);
				console.log("Navigating Back: " + this.currentPath.get());
				console.log(this);
			}
		};

		this.forwards = () => {
			const x: { [p: string]: RouterComponent } | undefined =
				this.history.future.pop();
			if (x) {
				this.history.past.push({
					[this.currentPath.get()]: this.currentElement(),
				});

				const key = Object.keys(x)[0];
				this.setCurrentPathProps(x[key]?.props);
				this.currentPath.set(key);
				console.log("Navigating Forwards: " + this.currentPath.get());
				console.log(this);
			}
		};
	}

	// Getter that returns a reactive JSX element
	getRouterView(): JSXElement {
		return (
			<Dynamic 
				component={this.currentElement().element} 
				{...(this.currentElement().props || {})} 
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
