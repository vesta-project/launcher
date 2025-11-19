import { JSX } from "solid-js";

interface ClassProp {
	class?: string;
}

interface ChildrenProp {
	children?: JSX.Element;
}

export { type ChildrenProp, type ClassProp };
