import TitleBar from "@components/page-root/titlebar/titlebar";
import {
	PageViewer,
	pageViewerOpen,
	setPageViewerOpen,
} from "@components/page-viewer/page-viewer";
import {
	InitAppearancePage,
	InitFinishedPage,
	InitFirstPage,
	InitGuidePage,
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
import styles from "./init.module.css";

const os = getOsType() ?? "windows";

function InitPage() {
	const navigate = useNavigate();
	const [initStep, setInitStep] = createSignal(0);
	const [hasInstalledInstance, setHasInstalledInstance] = createSignal(false);
	const [isLoading, setIsLoading] = createSignal(true);
	const [isLoginOnly, setIsLoginOnly] = createSignal(false);

	onMount(() => {
		const searchParams = new URLSearchParams(window.location.search);
		const forceLoginRequested = searchParams.get("login") === "true";

		// Initial setup check
		setTimeout(async () => {
			try {
				const config = await invoke<any>("get_config");
				const account = await invoke<any>("get_active_account");

				if (config.setup_completed) {
					if (account && !forceLoginRequested) {
						// Setup done and logged in (including Guest) -> Home
						navigate("/home", { replace: true });
						return;
					} else {
						// Setup done but logged out OR force login -> Jump to Login
						setIsLoginOnly(true);
						setInitStep(2); // Step 2 is Login
					}
				} else {
					// Setup not done -> Resume or start onboarding
					let resumeStep = config.setup_step || 0;

					// If we are resuming at login but already have an account, skip to Java
					if (resumeStep === 2 && account) {
						resumeStep = 3;
						await invoke("set_setup_step", { step: 3 });
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
		if (step === 2 && !isLoginOnly()) {
			const account = await invoke("get_active_account");
			if (account) {
				if (nextStep < initStep()) {
					// User is going back from Java or later, skip login backwards
					step = 0;
				} else {
					// User is going forward, skip login forwards to Java
					step = 3;
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
		<div
			class={`${styles["animate--hue"]} ${styles["init-page__root"]}`}
			data-tauri-drag-region
		>
			<TitleBar os={os} animate={true} />
			<div class={styles["init-page__wrapper"]}>
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
						<InitGuidePage
							initStep={initStep()}
							changeInitStep={handleStepChange}
						/>
					</Match>
					<Match when={initStep() == 2}>
						<InitLoginPage
							initStep={initStep()}
							changeInitStep={handleStepChange}
							isLoginOnly={isLoginOnly()}
							navigate={navigate}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() == 3}>
						<InitJavaPage
							initStep={initStep()}
							changeInitStep={handleStepChange}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() == 4}>
						<InitAppearancePage
							initStep={initStep()}
							changeInitStep={handleStepChange}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() == 5}>
						<InitDataStoragePage
							initStep={initStep()}
							changeInitStep={handleStepChange}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() == 6}>
						<InitInstallationPage
							initStep={initStep()}
							changeInitStep={handleStepChange}
							onInstanceInstalled={() => {
								setHasInstalledInstance(true);
								handleStepChange(7);
							}}
						/>
					</Match>
					<Match when={initStep() == 7}>
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
			<PageViewer
				open={pageViewerOpen()}
				viewChanged={() => setPageViewerOpen(false)}
			/>
		</div>
	);
}

export default InitPage;
