/* @refresh reload */

import { installKeybindingDispatcher } from "~/keybindings/dispatcher";
import { initializeKeybindings } from "~/keybindings/store";
import { initSentryMonitoring } from "@utils/sentry";
import { scheduleCommonPagePreloads } from "@utils/page-preload";
import {
	applyStartupRouteTarget,
	bootstrapStartup,
} from "@utils/startup-bootstrap";
import { presentCurrentWindowAfterPaint } from "@utils/window-readiness";
import { createSignal, Show } from "solid-js";
import { type MountableElement, render } from "solid-js/web";
import App from "./app";
import "./reset.css";
import "./styles.css";

const root = document.getElementById("app");

if (!root) {
	throw new Error("Root element not found");
}

void initSentryMonitoring();

void initializeKeybindings();
const removeKeybindingDispatcher = installKeybindingDispatcher();
window.addEventListener("unload", removeKeybindingDispatcher, { once: true });

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

const [isStartupReady, setIsStartupReady] = createSignal(false);

function retireStartupLoader() {
	const loader = document.getElementById("startup-loader");
	if (!loader) {
		return;
	}

	const appRoot = document.getElementById("app");
	if (!appRoot || appRoot.childElementCount > 0) {
		loader.remove();
		return;
	}

	const observer = new MutationObserver(() => {
		if (appRoot.childElementCount > 0) {
			observer.disconnect();
			loader.remove();
		}
	});

	observer.observe(appRoot, { childList: true });
}

void bootstrapStartup()
	.then((result) => {
		applyStartupRouteTarget(result.target);
	})
	.catch((error) => {
		console.error("Startup bootstrap failed:", error);
	})
	.finally(() => {
		setIsStartupReady(true);
		queueMicrotask(() => {
			retireStartupLoader();
			scheduleCommonPagePreloads();
			void presentCurrentWindowAfterPaint().catch((error) => {
				console.warn("Failed to present startup window:", error);
			});
		});
	});

render(
	() => (
		<Show when={isStartupReady()}>
			<App />
		</Show>
	),
	root as MountableElement,
);
