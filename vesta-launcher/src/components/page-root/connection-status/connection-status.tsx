import { Match, Switch, createSignal } from "solid-js";

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
			<Switch fallback={<>Offline</>}>
				<Match when={status()}>Online</Match>
			</Switch>
		</div>
	);
}

export default ConnectionStatus;
