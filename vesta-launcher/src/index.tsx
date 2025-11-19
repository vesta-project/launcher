/* @refresh reload */
import { type MountableElement, render } from "solid-js/web";

import { initTheme } from "@components/theming";
import App from "./app";
import "./styles.css";

const root = document.getElementById("app");

if (!root) {
	throw new Error("Root element not found");
}

/// TODO Drag and drop

root.ondrop = (e) => {
	e.preventDefault();
};
root.ondragover = (e) => {
	e.preventDefault();
};

initTheme();
render(() => <App />, root);

// Hide loader after app renders
setTimeout(() => {
	const loader = document.getElementById("app-loader");
	if (loader) {
		loader.classList.add("hidden");
		setTimeout(() => loader.remove(), 300);
	}
}, 100);
