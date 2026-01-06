import TitleBar from "@components/page-root/titlebar/titlebar";
import {
	InitAppearancePage,
	InitFinishedPage,
	InitFirstPage,
	InitJavaPage,
	InitLoginPage,
	InitDataStoragePage,
	InitInstallationPage,
} from "@components/pages/init/init-pages";
import { useNavigate } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import { getOsType } from "@utils/os";
import { createSignal, Match, onCleanup, onMount, Switch } from "solid-js";
import { applyTheme, configToTheme } from "../../../themes/presets";
import "./init.css";

const os = getOsType() ?? "windows";

function InitPage() {
	const navigate = useNavigate();
	const [initStep, setInitStep] = createSignal(0);
	const [hasInstalledInstance, setHasInstalledInstance] = createSignal(false);
	const [isLoading, setIsLoading] = createSignal(true);
	const [isLoginOnly, setIsLoginOnly] = createSignal(false);

	onMount(() => {
		// Initial setup check
		setTimeout(async () => {
			try {
				const config = await invoke<any>("get_config");
				const account = await invoke("get_active_account");

				if (config.setup_completed) {
					if (account) {
						// Setup done and logged in -> Home
						navigate("/home", { replace: true });
						return;
					} else {
						// Setup done but logged out -> Force Login Only
						setIsLoginOnly(true);
						setInitStep(1); // Step 1 is Login
					}
				} else {
					// Setup not done -> Resume or start onboarding
					let resumeStep = config.setup_step || 0;

					// If we are resuming at login but already have an account, skip to Java
					if (resumeStep === 1 && account) {
						resumeStep = 2;
						await invoke("set_setup_step", { step: 2 });
					}

					setInitStep(resumeStep);
				}
			} catch (e) {
				console.error("Failed to initialize app state:", e);
			} finally {
				setIsLoading(false);
			}
		}, 0);
	});

	const handleStepChange = async (nextStep: number) => {
		let step = nextStep;

		// If going to login step, check if already authenticated
		if (step === 1 && !isLoginOnly()) {
			const account = await invoke("get_active_account");
			if (account) {
				if (nextStep < initStep()) {
					// User is going back from Java (2) or later, 
					// skip login backwards to the welcome page
					step = 0;
				} else {
					// User is going forward from welcome (0),
					// skip login forwards to Java
					step = 2;
				}
			}
		}

		setInitStep(step);
		if (!isLoginOnly()) {
			await invoke("set_setup_step", { step: step });
		}
	};

	//navigate("/home", { replace: true });

	/*setInterval(() => {
		setTime(time() + 1);

		if (time() == 10) {
			navigate("/home", { replace: true });
		}
	}, 1000);*/

	return (
		<div id={"init-page__root"}>
			<TitleBar os={os} />
			<div id={"init-page__wrapper"}>
				<Switch>
					<Match when={isLoading()}>
						<div
							style={{
								display: "flex",
								"justify-content": "center",
								"align-items": "center",
								height: "100%",
								"flex-direction": "column",
								gap: "1rem",
							}}
						>
							<h1 style={{ "font-size": "24px" }}>Loading Vesta...</h1>
							{/* Add a spinner here if available */}
						</div>
					</Match>
					<Match when={initStep() == 0}>
						<InitFirstPage
							initStep={initStep()}
							changeInitStep={handleStepChange}
						/>
					</Match>
					<Match when={initStep() == 1}>
						<InitLoginPage
							initStep={initStep()}
							changeInitStep={handleStepChange}
							isLoginOnly={isLoginOnly()}
							navigate={navigate}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() == 2}>
						<InitJavaPage
							initStep={initStep()}
							changeInitStep={handleStepChange}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() == 3}>
						<InitAppearancePage
							initStep={initStep()}
							changeInitStep={handleStepChange}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() == 4}>
						<InitDataStoragePage
							initStep={initStep()}
							changeInitStep={handleStepChange}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() == 5}>
						<InitInstallationPage
							initStep={initStep()}
							changeInitStep={handleStepChange}
							onInstanceInstalled={() => {
								setHasInstalledInstance(true);
								handleStepChange(6);
							}}
						/>
					</Match>
					<Match when={initStep() == 6}>
						<InitFinishedPage
							initStep={initStep()}
							changeInitStep={handleStepChange}
							navigate={navigate}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
				</Switch>
				{/*{initStep()}*/}
			</div>
		</div>
	);
}

export default InitPage;
