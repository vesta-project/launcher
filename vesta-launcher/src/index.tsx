/* @refresh reload */

import { router } from "@components/page-viewer/page-viewer";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

if (
	(window as any).__TAURI_INTERNALS__ &&
	getCurrentWindow().label === "main"
) {
	void presentCurrentWindowAfterPaint().catch((error) => {
		console.warn("Failed to present startup window:", error);
	});
}

function isTauriDevWebview() {
	return Boolean((window as any).__TAURI_INTERNALS__) && import.meta.env.DEV;
}

// Add Ctrl+R / Cmd+R reload handler
document.addEventListener("keydown", (e) => {
	if ((e.ctrlKey || e.metaKey) && e.key === "r") {
		const miniRouter = router();
		e.preventDefault();
		if (miniRouter?.getRefetch()) {
			void miniRouter.reload();
			return;
		}
		if (isTauriDevWebview()) {
			return;
		}
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
