import TitleBar from "@components/page-root/titlebar/titlebar";
import {
    PageViewer,
    pageViewerOpen,
    setPageViewerOpen,
} from "@components/page-viewer/page-viewer";
import {
    InitAppearancePage,
    InitDataStoragePage,
    InitFinishedPage,
    InitFirstPage,
    InitGuidePage,
    InitInstallationPage,
    InitJavaPage,
    InitLoginPage,
} from "@components/pages/init/init-pages";
import { useNavigate } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import { useOs } from "@utils/os";
import { createSignal, Match, onCleanup, onMount, Switch } from "solid-js";
import {
    getCanonicalBackStep,
    getNextInitStep,
    INIT_STEPS,
    type InitStep,
    isGuestOrDemoAccountType,
    isSkippableAuthenticatedAccount,
    normalizeInitStep,
    shouldRecoverLegacyGuestCompletion,
} from "./init-flow";
import styles from "./init.module.css";

type NavigationDirection = "forward" | "backward" | "direct";
type AtmosphereState = "active" | "fading" | "off";

function InitPage() {
	const navigate = useNavigate();
	const [initStep, setInitStep] = createSignal<InitStep>(INIT_STEPS.WELCOME);
	const [stepHistory, setStepHistory] = createSignal<InitStep[]>([
		INIT_STEPS.WELCOME,
	]);
	const [guideVisited, setGuideVisited] = createSignal(false);
	const [hasInstalledInstance, setHasInstalledInstance] = createSignal(false);
	const [isLoading, setIsLoading] = createSignal(true);
	const [isLoginOnly, setIsLoginOnly] = createSignal(false);
	const [onboardingAtmosphereState, setOnboardingAtmosphereState] =
		createSignal<AtmosphereState>("active");
	const os = useOs();
	let atmosphereFadeTimer: ReturnType<typeof setTimeout> | null = null;

	const clearAtmosphereFadeTimer = () => {
		if (atmosphereFadeTimer) {
			clearTimeout(atmosphereFadeTimer);
			atmosphereFadeTimer = null;
		}
	};

	const handleThemeActivated = () => {
		if (onboardingAtmosphereState() === "off") {
			return;
		}

		const reducedMotionEnabled =
			document.documentElement.getAttribute("data-reduced-motion") === "true";
		if (reducedMotionEnabled) {
			clearAtmosphereFadeTimer();
			setOnboardingAtmosphereState("off");
			return;
		}

		if (onboardingAtmosphereState() !== "fading") {
			setOnboardingAtmosphereState("fading");
		}

		clearAtmosphereFadeTimer();
		atmosphereFadeTimer = setTimeout(() => {
			setOnboardingAtmosphereState("off");
			atmosphereFadeTimer = null;
		}, 180);
	};

	onCleanup(() => {
		clearAtmosphereFadeTimer();
	});

	const persistSetupStep = async (step: InitStep) => {
		if (isLoginOnly()) {
			return;
		}

		await invoke("set_setup_step", { step });
	};

	const applyStep = async (
		step: InitStep,
		options?: {
			replaceHistory?: boolean;
			recordHistory?: boolean;
			persist?: boolean;
		},
	) => {
		setInitStep(step);

		if (step === INIT_STEPS.GUIDE) {
			setGuideVisited(true);
		}

		if (options?.replaceHistory) {
			setStepHistory([step]);
		} else if (options?.recordHistory !== false) {
			setStepHistory((previous) => {
				if (previous[previous.length - 1] === step) {
					return previous;
				}
				return [...previous, step];
			});
		}

		if (options?.persist !== false) {
			await persistSetupStep(step);
		}
	};

	const hasValidSession = async () => {
		try {
			const account = await invoke<any>("get_active_account");
			return isSkippableAuthenticatedAccount(account);
		} catch (error) {
			console.error("Failed to check active account:", error);
			return false;
		}
	};

	const getDirection = (
		from: InitStep,
		to: InitStep,
	): NavigationDirection => {
		if (to > from) {
			return "forward";
		}
		if (to < from) {
			return "backward";
		}
		return "direct";
	};

	const resolveStepWithGuards = async (
		requestedStep: InitStep,
		direction: NavigationDirection,
	): Promise<InitStep> => {
		if (requestedStep !== INIT_STEPS.LOGIN) {
			return requestedStep;
		}

		if (isLoginOnly()) {
			return INIT_STEPS.LOGIN;
		}

		const validSession = await hasValidSession();
		if (!validSession) {
			return INIT_STEPS.LOGIN;
		}

		if (direction === "backward") {
			return guideVisited() ? INIT_STEPS.GUIDE : INIT_STEPS.WELCOME;
		}

		return INIT_STEPS.JAVA;
	};

	const goToStep = async (
		rawStep: number,
		options?: { replaceHistory?: boolean; recordHistory?: boolean },
	) => {
		const requestedStep = normalizeInitStep(rawStep);
		const direction = getDirection(initStep(), requestedStep);
		const targetStep = await resolveStepWithGuards(requestedStep, direction);
		await applyStep(targetStep, {
			replaceHistory: options?.replaceHistory,
			recordHistory: options?.recordHistory,
		});
	};

	const goNext = async () => {
		const nextStep = getNextInitStep(initStep());
		await goToStep(nextStep);
	};

	const goBack = async () => {
		if (isLoginOnly()) {
			return;
		}

		const history = stepHistory();
		if (history.length > 1) {
			const historyWithoutCurrent = history.slice(0, -1);
			const previousStep = historyWithoutCurrent[historyWithoutCurrent.length - 1];
			const guardedPreviousStep = await resolveStepWithGuards(
				previousStep,
				"backward",
			);

			if (guardedPreviousStep !== previousStep) {
				const targetIndex = historyWithoutCurrent.lastIndexOf(guardedPreviousStep);
				if (targetIndex >= 0) {
					setStepHistory(historyWithoutCurrent.slice(0, targetIndex + 1));
				} else {
					setStepHistory([...historyWithoutCurrent, guardedPreviousStep]);
				}
			} else {
				setStepHistory(historyWithoutCurrent);
			}

			await applyStep(guardedPreviousStep, { recordHistory: false });
			return;
		}

		const fallbackStep = getCanonicalBackStep(initStep(), guideVisited());
		const targetStep = await resolveStepWithGuards(fallbackStep, "backward");
		await applyStep(targetStep, { recordHistory: false });
	};

	onMount(() => {
		const searchParams = new URLSearchParams(window.location.search);
		const forceLoginRequested = searchParams.get("login") === "true";

		// Initial setup check
		setTimeout(async () => {
			try {
				const config = await invoke<any>("get_config");
				const account = await invoke<any>("get_active_account");
				const hasValidAccount = isSkippableAuthenticatedAccount(account);
				const forceGuestLoginOnly =
					forceLoginRequested &&
					isGuestOrDemoAccountType(account?.account_type);
				let setupCompleted = Boolean(config.setup_completed);
				let setupStep = normalizeInitStep(config.setup_step);

				if (shouldRecoverLegacyGuestCompletion(setupCompleted, setupStep)) {
					try {
						await invoke("reset_onboarding");
						setupCompleted = false;
						setupStep = INIT_STEPS.WELCOME;
					} catch (error) {
						console.error(
							"Failed to recover legacy guest completion state:",
							error,
						);
					}
				}

				if (forceGuestLoginOnly) {
					setIsLoginOnly(true);
					setGuideVisited(false);
					setOnboardingAtmosphereState("off");
					await applyStep(INIT_STEPS.LOGIN, {
						replaceHistory: true,
						persist: false,
					});
					return;
				}

				if (setupCompleted) {
					if (hasValidAccount && !forceLoginRequested) {
						// Setup done and logged in with valid session -> Home
						navigate("/home", { replace: true });
						return;
					} else {
						// Setup done but logged out OR session expired OR force login -> Jump to Login
						setIsLoginOnly(true);
						setGuideVisited(false);
						setOnboardingAtmosphereState("off");
						await applyStep(INIT_STEPS.LOGIN, {
							replaceHistory: true,
							persist: false,
						});
					}
				} else {
					// Setup not done -> Resume or start onboarding
					let resumeStep = setupStep;
					setGuideVisited(resumeStep === INIT_STEPS.GUIDE);

					// If we are resuming at login but already have a valid account, skip to Java
					if (resumeStep === INIT_STEPS.LOGIN && hasValidAccount) {
						resumeStep = INIT_STEPS.JAVA;
						await invoke("set_setup_step", { step: INIT_STEPS.JAVA });
					}

					setOnboardingAtmosphereState(
						resumeStep <= INIT_STEPS.APPEARANCE ? "active" : "off",
					);

					await applyStep(resumeStep, {
						replaceHistory: true,
						persist: false,
					});
				}
			} catch (e) {
				console.error("Failed to initialize app state:", e);
			} finally {
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

	return (
		<div
			class={`${styles["init-page__root"]} ${
				onboardingAtmosphereState() !== "off"
					? styles["init-page__root--welcome"]
					: ""
			} ${
				onboardingAtmosphereState() === "fading"
					? styles["init-page__root--welcome-fading"]
					: ""
			}`}
			data-tauri-drag-region
		>
			<TitleBar os={os()} />
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
					<Match when={initStep() === INIT_STEPS.WELCOME}>
						<InitFirstPage
							initStep={initStep()}
							goToStep={goToStep}
							goNext={goNext}
							goBack={goBack}
						/>
					</Match>
					<Match when={initStep() === INIT_STEPS.GUIDE}>
						<InitGuidePage
							initStep={initStep()}
							goToStep={goToStep}
							goNext={goNext}
							goBack={goBack}
						/>
					</Match>
					<Match when={initStep() === INIT_STEPS.LOGIN}>
						<InitLoginPage
							initStep={initStep()}
							goToStep={goToStep}
							goNext={goNext}
							goBack={goBack}
							isLoginOnly={isLoginOnly()}
							onExitLoginOnlyMode={() => setIsLoginOnly(false)}
							navigate={navigate}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() === INIT_STEPS.JAVA}>
						<InitJavaPage
							initStep={initStep()}
							goToStep={goToStep}
							goNext={goNext}
							goBack={goBack}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() === INIT_STEPS.APPEARANCE}>
						<InitAppearancePage
							initStep={initStep()}
							goToStep={goToStep}
							goNext={goNext}
							goBack={goBack}
							onThemeActivated={handleThemeActivated}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() === INIT_STEPS.DATA_STORAGE}>
						<InitDataStoragePage
							initStep={initStep()}
							goToStep={goToStep}
							goNext={goNext}
							goBack={goBack}
							hasInstalledInstance={hasInstalledInstance()}
						/>
					</Match>
					<Match when={initStep() === INIT_STEPS.INSTALLATION}>
						<InitInstallationPage
							initStep={initStep()}
							goToStep={goToStep}
							goNext={goNext}
							goBack={goBack}
							onInstanceInstalled={() => {
								setHasInstalledInstance(true);
								void goToStep(INIT_STEPS.FINISHED);
							}}
						/>
					</Match>
					<Match when={initStep() === INIT_STEPS.FINISHED}>
						<InitFinishedPage
							initStep={initStep()}
							goToStep={goToStep}
							goNext={goNext}
							goBack={goBack}
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
