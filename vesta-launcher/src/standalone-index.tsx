/* @refresh reload */

import StandalonePageViewer from "@components/page-viewer/standalone-page-viewer";
import { initTheme } from "@components/theming";
import {
	applyCommonConfigUpdates,
	onConfigUpdate,
	subscribeToConfigUpdates,
	unsubscribeFromConfigUpdates,
} from "@utils/config-sync";
import { type MountableElement, render } from "solid-js/web";
import "./reset.css";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("Standalone root element not found");

void initTheme()
	.catch((error) => {
		console.error("Failed to initialize standalone theme:", error);
	})
	.finally(() => {
		render(() => <StandalonePageViewer />, root as MountableElement);
	});

void subscribeToConfigUpdates()
	.then(() => {
		onConfigUpdate(applyCommonConfigUpdates);
	})
	.catch((error) => {
		console.error("Failed to subscribe standalone config updates:", error);
	});

window.addEventListener(
	"unload",
	() => {
		unsubscribeFromConfigUpdates();
	},
	{ once: true },
);
