import TitleBar from "@components/page-root/titlebar/titlebar";
import {
	InitFinishedPage,
	InitFirstPage,
	InitLoginPage,
} from "@components/pages/init/init-pages";
import { useNavigate } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import { Match, Switch, createSignal, onCleanup, onMount } from "solid-js";
import { getOsType } from "@utils/os";
import "./init.css";

const os = getOsType() ?? "windows";

function InitPage() {
	const navigate = useNavigate();
	const [_time, _setTime] = createSignal(0);
	const [initStep, setInitStep] = createSignal(0);
	const [isLoading, setIsLoading] = createSignal(true);

	onMount(() => {
		// Non-blocking account check - UI shows immediately
		// Check happens in background without blocking render
		setTimeout(async () => {
			try {
				const account = await invoke("get_active_account");
				if (account) {
					// User is logged in, redirect to home
					navigate("/home", { replace: true });
					return;
				}
			} catch (e) {
				console.error("Failed to check active account:", e);
				// Continue to init flow on error
			} finally {
				// Stop loading state if we haven't redirected
				setIsLoading(false);
			}
		}, 0);
	});

	//navigate("/home", { replace: true });

	/*setInterval(() => {
		setTime(time() + 1);

		if (time() == 10) {
			navigate("/home", { replace: true });
		}
	}, 1000);*/
	const root = document.querySelector(":root");

	if (root) {
		root.classList.add("animate--hue");
	}

	onCleanup(() => {
		const elements = document.querySelectorAll(".animate--hue");

		elements.forEach((element) => {
			element.classList.remove("animate--hue");
		});
	});

	return (
		<div id={"init-page__root"}>
			<TitleBar os={os} class={"animate--hue"} />
			<div id={"init-page__wrapper"}>
				<Switch>
					<Match when={isLoading()}>
						<div style={{
							display: "flex",
							"justify-content": "center",
							"align-items": "center",
							height: "100%",
							"flex-direction": "column",
							gap: "1rem"
						}}>
							<h1 style={{ "font-size": "24px" }}>Loading Vesta...</h1>
							{/* Add a spinner here if available */}
						</div>
					</Match>
					<Match when={initStep() == 0}>
						<InitFirstPage initStep={initStep()} changeInitStep={setInitStep} />
					</Match>
					<Match when={initStep() == 1}>
						<InitLoginPage initStep={initStep()} changeInitStep={setInitStep} />
					</Match>
					<Match when={initStep() == 2}>
						<InitFinishedPage
							initStep={initStep()}
							changeInitStep={setInitStep}
							navigate={navigate}
						/>
					</Match>
				</Switch>
				{/*{initStep()}*/}
			</div>
		</div>
	);
}

export default InitPage;
