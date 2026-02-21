/* @refresh reload */

import { initTheme, isThemeReady } from "@components/theming";
import { Show } from "solid-js";
import { type MountableElement, render } from "solid-js/web";
import App from "./app";
import "./styles.css";

const root = document.getElementById("app");

if (!root) {
	throw new Error("Root element not found");
}

// Add Ctrl+R / Cmd+R reload handler
document.addEventListener("keydown", (e) => {
	if ((e.ctrlKey || e.metaKey) && e.key === "r") {
		e.preventDefault();
		window.location.reload();
	}
});

// Disable webview context menu in production
function disableMenu() {
	if (window.location.hostname !== "tauri.localhost") {
		return;
	}

	document.addEventListener(
		"contextmenu",
		(e) => {
			e.preventDefault();
			return false;
		},
		{ capture: true },
	);

	document.addEventListener(
		"selectstart",
		(e) => {
			const target = e.target as HTMLElement;
			// Allow selection for inputs, textareas, and anything explicitly marked as selectable
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				window.getComputedStyle(target).userSelect === "text"
			) {
				return true;
			}
			e.preventDefault();
			return false;
		},
		{ capture: true },
	);
}

disableMenu();

// Start theme initialization
initTheme().catch((err) => {
	console.error("Theme init failed; using defaults:", err);
});

// Render app with a guard for the initial theme loading
render(
	() => (
		<Show
			when={isThemeReady()}
			fallback={
				<div
					style={{
						display: "flex",
						height: "100vh",
						width: "100vw",
						"align-items": "center",
						"justify-content": "center",
						background: "#0a0a0a",
						color: "white",
						"font-family": "system-ui, sans-serif",
					}}
				>
					<div style={{ "text-align": "center" }}>
						<div class="spinner" style={{ "margin-bottom": "12px" }}></div>
						<p style={{ opacity: 0.5, "font-size": "14px" }}>
							Initializing Vesta...
						</p>
					</div>
				</div>
			}
		>
			<App />
		</Show>
	),
	root as MountableElement,
);
