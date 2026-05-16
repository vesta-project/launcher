import LogoIcon from "@assets/logo.svg";
import Button from "@ui/button/button";
import networkStore from "@stores/network";
import { Show } from "solid-js";
import styles from "../init.module.css";

interface SplashStepProps {
	goNext: () => Promise<void>;
	goToStep: (step: number) => Promise<void>;
}

function SplashStep(props: SplashStepProps) {
	return (
		<div class={styles["splash-step"]}>
			<div class={styles["splash-logo"]}>
				<LogoIcon />
			</div>

			<h1 class={styles["splash-title"]}>Vesta</h1>

			<p class={styles["splash-subtitle"]}>Effortless modding.</p>

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
		</div>
	);
}

export default SplashStep;
