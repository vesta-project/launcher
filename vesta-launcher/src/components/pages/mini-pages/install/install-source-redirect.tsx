import { onMount } from "solid-js";
import { router } from "@components/page-viewer/page-viewer";

/**
 * Compatibility shim for bookmarks and deep links that still target
 * `/install/source`. New entry points open `/install` directly.
 */
function InstallSourceRedirectPage(props: { router?: any }) {
	const activeRouter = () => props.router || router();

	onMount(() => {
		activeRouter()?.navigate("/install");
	});

	return null;
}

export default InstallSourceRedirectPage;
