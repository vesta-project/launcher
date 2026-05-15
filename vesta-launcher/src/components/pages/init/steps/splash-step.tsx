import LogoIcon from "@assets/logo.svg";
import Button from "@ui/button/button";
import { Switch, SwitchControl, SwitchThumb } from "@ui/switch/switch";
import networkStore from "@stores/network";
import { openExternal as openUrl } from "@utils/external-link";
import { invoke } from "@tauri-apps/api/core";
import { Motion } from "@motionone/solid";
import { createSignal, onMount, Show } from "solid-js";
import { DURATION, EASE } from "../utils/motion";
import styles from "../init.module.css";

const PRIVACY_POLICY_URL =
	"https://github.com/vesta-project/launcher/blob/main/docs/legal/PRIVACY_POLICY.md";

interface SplashStepProps {
	goNext: () => Promise<void>;
	goToStep: (step: number) => Promise<void>;
}

function SplashStep(props: SplashStepProps) {
	const [telemetryEnabled, setTelemetryEnabled] = createSignal(true);
	const [showTelemetry, setShowTelemetry] = createSignal(false);

	onMount(() => {
		void (async () => {
			try {
				const config = await invoke<any>("get_config");
				setTelemetryEnabled(config.telemetry_enabled ?? true);
			} catch (error) {
				console.error("Failed to load telemetry preference:", error);
			}
		})();

		const timer = setTimeout(() => setShowTelemetry(true), 1000);
		return () => clearTimeout(timer);
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
		<div class={styles["splash-step"]}>
			<Motion
				initial={{ opacity: 0, y: 20 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.slow, easing: EASE.smooth }}
			>
				<div class={styles["splash-logo"]}>
					<LogoIcon />
				</div>
			</Motion>

			<Motion
				initial={{ opacity: 0, y: 20 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.slow, delay: 0.1, easing: EASE.smooth }}
			>
				<h1 class={styles["splash-title"]}>Vesta</h1>
			</Motion>

			<Motion
				initial={{ opacity: 0, y: 20 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.slow, delay: 0.2, easing: EASE.smooth }}
			>
				<p class={styles["splash-subtitle"]}>Effortless modding.</p>
			</Motion>

			<Motion
				initial={{ opacity: 0, y: 20 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.slow, delay: 0.3, easing: EASE.smooth }}
			>
				<div class={styles["splash-actions"]}>
					<Button
						color="primary"
						size="lg"
						onClick={() => void props.goNext()}
						disabled={networkStore.isOffline()}
						class={styles["splash-primary-btn"]}
					>
						{networkStore.isOffline() ? "Internet connection required" : "Start Setup"}
					</Button>

					<Show when={networkStore.isOffline()}>
						<p class={styles["splash-offline-hint"]}>
							No internet connection detected.
							<span>You will need a connection to sign in and download game components.</span>
						</p>
					</Show>

					<button
						class={styles["splash-guest-link"]}
						onClick={() => void props.goToStep(2)}
					>
						Continue as Guest
					</button>
				</div>
			</Motion>

			<Show when={showTelemetry()}>
				<Motion
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: DURATION.normal, easing: EASE.smooth }}
				>
					<div class={styles["splash-telemetry"]}>
						<Switch
							checked={telemetryEnabled()}
							onCheckedChange={(checked: boolean) => void persistTelemetry(checked)}
						>
							<SwitchControl class={styles["splash-telemetry-switch"]}>
								<SwitchThumb />
							</SwitchControl>
						</Switch>
						<p class={styles["splash-telemetry-text"]}>
							Help us improve by sharing crash reports.{" "}
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
				</Motion>
			</Show>
		</div>
	);
}

export default SplashStep;
