/* @refresh reload */

import { isThemeReady, initTheme } from "@components/theming";
import { Show } from "solid-js";
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

// Start theme initialization
initTheme().catch((err) => {
	console.error("Theme init failed; using defaults:", err);
});

// Render app with a guard for the initial theme loading
render(() => (
	<Show 
		when={isThemeReady()} 
		fallback={
			<div style={{ 
				display: "flex", 
				height: "100vh", 
				width: "100vw", 
				"align-items": "center", 
				"justify-content": "center",
				background: "#0a0a0a",
				color: "white",
				"font-family": "system-ui, sans-serif"
			}}>
				<div style={{ "text-align": "center" }}>
					<div class="spinner" style={{ "margin-bottom": "12px" }}></div>
					<p style={{ opacity: 0.5, "font-size": "14px" }}>Initializing Vesta...</p>
				</div>
			</div>
		}
	>
		<App />
	</Show>
), root as MountableElement);
