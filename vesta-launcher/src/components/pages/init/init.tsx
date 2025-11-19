import TitleBar from "@components/page-root/titlebar/titlebar";
import {
	InitFinishedPage,
	InitFirstPage,
	InitLoginPage,
} from "@components/pages/init/init-pages/init-pages";
import { useNavigate } from "@solidjs/router";
import Button from "@ui/button/button";
import { Match, Switch, createSignal, onCleanup, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getOsType } from "../../../utils/os";
import "./init.css";

const os = getOsType() ?? "windows";

function InitPage() {
	const navigate = useNavigate();
	const [time, setTime] = createSignal(0);
	const [initStep, setInitStep] = createSignal(0);
	const [isCheckingAccount, setIsCheckingAccount] = createSignal(true);

	onMount(async () => {
		try {
			const account = await invoke("get_active_account");
			if (account) {
				navigate("/home", { replace: true });
				return;
			}
		} catch (e) {
			console.error("Failed to check active account:", e);
		} finally {
			setIsCheckingAccount(false);
		}
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
				{isCheckingAccount() ? (
					<div style={{ display: "flex", "justify-content": "center", "align-items": "center", height: "100%" }}>
						<p>Loading...</p>
					</div>
				) : (
					<Switch>
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
				)}
				{/*{initStep()}*/}
			</div>
		</div>
	);
}

export default InitPage;
