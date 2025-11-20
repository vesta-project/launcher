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

// Add Ctrl+R / Cmd+R reload handler
document.addEventListener("keydown", (e) => {
	if ((e.ctrlKey || e.metaKey) && e.key === "r") {
		e.preventDefault();
		window.location.reload();
	}
});

// Initialize theme and render app
initTheme().then(() => {
	render(() => <App />, root);
});
