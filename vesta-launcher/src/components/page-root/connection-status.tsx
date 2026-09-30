import { t } from "~/localization";
import { createSignal, Match, Switch } from "solid-js";

function ConnectionStatus() {
	const [status, setStatus] = createSignal<boolean>(window.navigator.onLine);

	window.addEventListener("offline", () => {
		setStatus(false);
	});
	window.addEventListener("online", () => {
		setStatus(true);
	});

	return (
		<div
			style={{
				position: "absolute",
				color: "white",
				top: "0",
				left: "100px",
			}}
		>
			<Switch fallback={<>{t("app-shell-offline")}</>}>
				<Match when={status()}>{t("app-shell-online")}</Match>
			</Switch>
		</div>
	);
}

export default ConnectionStatus;
