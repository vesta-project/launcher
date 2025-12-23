/* @refresh reload */

import { initTheme } from "@components/theming";
import { type MountableElement, render } from "solid-js/web";
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

// Render app immediately, then initialize theme in background
render(() => <App />, root as MountableElement);
initTheme().catch((err) => {
	console.error("Theme init failed; using defaults:", err);
});
