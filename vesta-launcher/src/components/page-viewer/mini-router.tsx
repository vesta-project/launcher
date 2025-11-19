/*
The Mini Router Component is a router solution to display different pages and navigate between them.

This is temporary and will most likely have to be rewritten in the future.
 */

import {
	type Accessor,
	Component,
	type JSX,
	JSXElement,
	type ValidComponent,
	createMemo,
	createSignal,
} from "solid-js";

import { Dynamic } from "solid-js/web";

const RouterViewer = (props: {
	element: ValidComponent;
	props?: Record<string, unknown>;
}) => {
	return <Dynamic component={props.element} {...props} />;
};

interface RouterComponent<T extends ValidComponent = any> {
	name?: string;
	element: T;
	props?: Record<string, unknown>;
}

interface MiniRouterProps {
	paths: Record<string, RouterComponent>;
	invalid?: ValidComponent;
	currentPath?: string;
}

class MiniRouter {
	router:
		| undefined
		| null
		| number
		| false
		| true
		| (string & {})
		| Node
		| JSX.ArrayElement;

	paths: Record<string, RouterComponent>;
	currentPath: { set: (value: string) => void; get: Accessor<string> };
	currentElement: Accessor<RouterComponent>;
	currentPathProps?: Record<string, unknown>;
	history: {
		past: { [p: string]: RouterComponent }[];
		future: { [p: string]: RouterComponent }[];
		push: (path: string) => void;
		clear: () => void;
	};
	navigate: (path: string) => void;
	forwards: () => void;
	backwards: () => void;

	constructor(props: MiniRouterProps) {
		this.paths = props.paths;

		this.paths["404"] = { element: props.invalid ?? (() => <div />) };

		const [getCurrentPath, setCurrentPath] = createSignal<string>(
			props.currentPath ?? "",
		);

		this.currentPath = { set: setCurrentPath, get: getCurrentPath };

		this.currentElement = createMemo(() => {
			const x = this.paths[this.currentPath.get()] ?? this.paths["404"];
			x.props = this.currentPathProps;
			return x;
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

		this.router = (
			<RouterViewer
				element={this.currentElement().element}
				props={this.currentElement().props}
			/>
		);

		this.navigate = (path: string, props?: Record<string, unknown>) => {
			this.history.push(path);
			this.currentPathProps = props;
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

				this.currentPathProps = x[0]?.props;
				this.currentPath.set(Object.keys(x)[0]);
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

				this.currentPathProps = x[0]?.props;
				this.currentPath.set(Object.keys(x)[0]);
				console.log("Navigating Forwards: " + this.currentPath.get());
				console.log(this);
			}
		};
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
