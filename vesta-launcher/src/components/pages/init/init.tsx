import TitleBar from "@components/page-root/titlebar/titlebar";
import { useNavigate } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import { openExternal as openUrl } from "@utils/external-link";
import { useOs } from "@utils/os";
import { consumeInitBootstrapState } from "@utils/startup-bootstrap";
import {
	createSignal,
	Match,
	Switch as MatchSwitch,
	onMount,
	Show,
} from "solid-js";
import AtmosphereLayer from "./components/atmosphere-layer";
import StageCard from "./components/stage-card";
import StepTransition from "./components/step-transition";
import {
	type OnboardingFlowState,
	useOnboardingFlow,
} from "./hooks/use-onboarding-flow";
import styles from "./init.module.css";
import {
	isGuestOrDemoAccountType,
	isSkippableAuthenticatedAccount,
	normalizeOnboardingStep,
	ONBOARDING_STEP,
	type OnboardingStep,
	shouldRecoverLegacyGuestCompletion,
} from "./init-flow";

const PRIVACY_POLICY_URL =
	"https://github.com/vesta-project/launcher/blob/main/docs/legal/PRIVACY_POLICY.md";

function isValidAtmosphereState(
	value: unknown,
): value is "active" | "fading" | "off" {
	return value === "active" || value === "fading" || value === "off";
}

function isValidStartupState(
	state: ReturnType<typeof consumeInitBootstrapState>,
): state is {
	initStep: OnboardingStep;
	loginOnly: boolean;
	guideVisited: boolean;
	atmosphereState: "active" | "fading" | "off";
} {
	if (!state) return false;
	return (
		normalizeOnboardingStep(state.initStep) === state.initStep &&
		typeof state.loginOnly === "boolean" &&
		typeof state.guideVisited === "boolean" &&
		isValidAtmosphereState(state.atmosphereState)
	);
}

import AuthStep from "./steps/auth-step";
import CompleteStep from "./steps/complete-step";
import CreditsStep from "./steps/credits-step";
import FirstInstanceStep from "./steps/first-instance-step";
import LearnStep from "./steps/learn-step";
import SplashStep from "./steps/splash-step";
import ThemeStep from "./steps/theme-step";

// Placeholder step components until we build them in later chunks

function InitPage() {
	const navigate = useNavigate();
	const consumedStartupState = consumeInitBootstrapState();
	const startupState = isValidStartupState(consumedStartupState)
		? consumedStartupState
		: null;

	if (consumedStartupState && !startupState) {
		console.warn(
			"Invalid startup bootstrap state detected; falling back to InitPage runtime initialization.",
			consumedStartupState,
		);
	}

	const initialStep = startupState?.initStep ?? ONBOARDING_STEP.SPLASH;
	const initialState: Partial<OnboardingFlowState> = {
		step: initialStep,
		learnCompleted: startupState?.guideVisited ?? false,
		isLoginOnly: startupState?.loginOnly ?? false,
		atmosphereState: startupState?.atmosphereState ?? "active",
	};

	const flow = useOnboardingFlow(initialState);
	const os = useOs();

	onMount(() => {
		if (startupState) {
			return;
		}

		const searchParams = new URLSearchParams(window.location.search);
		const forceLoginRequested = searchParams.get("login") === "true";

		void (async () => {
			try {
				const config = await invoke<any>("get_config");
				const account = await invoke<any>("get_active_account");
				const hasValidAccount = isSkippableAuthenticatedAccount(account);
				const forceGuestLoginOnly =
					forceLoginRequested &&
					isGuestOrDemoAccountType(account?.account_type);
				let setupCompleted = Boolean(config.setup_completed);
				let setupStep = normalizeOnboardingStep(config.setup_step);

				if (shouldRecoverLegacyGuestCompletion(setupCompleted, setupStep)) {
					try {
						await invoke("reset_onboarding");
						setupCompleted = false;
						setupStep = ONBOARDING_STEP.SPLASH;
					} catch (error) {
						console.error(
							"Failed to recover legacy guest completion state:",
							error,
						);
					}
				}

				if (forceGuestLoginOnly) {
					flow.setLoginOnly(true);
					await flow.goToStep(ONBOARDING_STEP.AUTH, {
						replaceHistory: true,
						recordHistory: false,
					});
					return;
				}

				if (setupCompleted) {
					if (hasValidAccount && !forceLoginRequested) {
						navigate("/home", { replace: true });
						return;
					} else {
						await flow.goToStep(ONBOARDING_STEP.AUTH, {
							replaceHistory: true,
							recordHistory: false,
						});
					}
				} else {
					let resumeStep = setupStep;
					if (resumeStep === ONBOARDING_STEP.AUTH && hasValidAccount) {
						resumeStep = ONBOARDING_STEP.THEME;
						await invoke("set_setup_step", { step: ONBOARDING_STEP.THEME });
					}

					await flow.goToStep(resumeStep, {
						replaceHistory: true,
						recordHistory: false,
					});
				}
			} catch (e) {
				console.error("Failed to initialize app state:", e);
			}
		})();
	});

	return (
		<div class={styles["init-root"]} data-tauri-drag-region>
			<div class={styles["init-titlebar"]}>
				<TitleBar os={os()} hideHelp={true} />
			</div>
			<AtmosphereLayer state={flow.atmosphereState()} />
			<div class={styles["init-center"]}>
				<StageCard>
					<StepTransition>
						<MatchSwitch>
							<Match when={flow.step() === ONBOARDING_STEP.SPLASH}>
								<SplashStep goNext={flow.goNext} goToStep={flow.goToStep} />
							</Match>
							<Match when={flow.step() === ONBOARDING_STEP.CREDITS}>
								<CreditsStep goNext={flow.goNext} />
							</Match>
							<Match when={flow.step() === ONBOARDING_STEP.AUTH}>
								<AuthStep
									goNext={flow.goNext}
									goBack={flow.goBack}
									isLoginOnly={flow.isLoginOnly()}
									exitLoginOnlyMode={flow.exitLoginOnlyMode}
									navigate={navigate}
								/>
							</Match>
							<Match when={flow.step() === ONBOARDING_STEP.LEARN}>
								<LearnStep goNext={flow.goNext} goBack={flow.goBack} />
							</Match>
							<Match when={flow.step() === ONBOARDING_STEP.THEME}>
								<ThemeStep
									goNext={flow.goNext}
									goBack={flow.goBack}
									onThemeActivated={flow.fadeAtmosphere}
								/>
							</Match>
							<Match when={flow.step() === ONBOARDING_STEP.FIRST_INSTANCE}>
								<FirstInstanceStep
									goNext={flow.goNext}
									goBack={flow.goBack}
									navigate={navigate}
								/>
							</Match>
							<Match when={flow.step() === ONBOARDING_STEP.COMPLETE}>
								<CompleteStep navigate={navigate} />
							</Match>
						</MatchSwitch>
					</StepTransition>
				</StageCard>
			</div>
			<TelemetryToggle show={flow.step() === ONBOARDING_STEP.SPLASH} />
		</div>
	);
}

function TelemetryToggle(props: { show: boolean }) {
	const [telemetryEnabled, setTelemetryEnabled] = createSignal(true);

	onMount(() => {
		void (async () => {
			try {
				const config = await invoke<any>("get_config");
				setTelemetryEnabled(config.telemetry_enabled ?? true);
			} catch (error) {
				console.error("Failed to load telemetry preference:", error);
			}
		})();
	});

	const persistTelemetry = async (enabled: boolean) => {
		setTelemetryEnabled(enabled);
		try {
			await invoke("update_config_field", {
				field: "telemetry_enabled",
				value: enabled,
			});
		} catch (error) {
			console.error("Failed to persist telemetry preference:", error);
		}
	};

	return (
		<Show when={props.show}>
			<div class={styles["init-telemetry"]}>
				<Switch
					checked={telemetryEnabled()}
					onCheckedChange={(checked: boolean) => void persistTelemetry(checked)}
				>
					<SwitchControl class={styles["init-telemetry-switch"]}>
						<SwitchThumb />
					</SwitchControl>
				</Switch>
				<p class={styles["init-telemetry-text"]}>
					Share crash and error reports.{" "}
					<a
						href={PRIVACY_POLICY_URL}
						onClick={(e) => {
							e.preventDefault();
							void openUrl(PRIVACY_POLICY_URL);
						}}
					>
						Privacy Policy
					</a>
				</p>
			</div>
		</Show>
	);
}

export default InitPage;
