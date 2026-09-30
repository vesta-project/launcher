import LogoIcon from "@assets/branding/vesta-mark.svg";
import networkStore from "@stores/network";
import Button from "@ui/button/button";
import { Show } from "solid-js";
import { t } from "~/localization";
import styles from "../init.module.css";

interface SplashStepProps {
	goNext: () => Promise<void>;
	goToStep: (step: number) => Promise<void>;
}

function SplashStep(props: SplashStepProps) {
	return (
		<div class={styles["splash-step"]}>
			<h1 class={styles["splash-title"]}>Vesta</h1>

			<p class={styles["splash-subtitle"]}>{t("onboarding-splash-subtitle")}</p>

			<div class={styles["splash-actions"]}>
				<Button
					color="primary"
					size="lg"
					onClick={() => void props.goNext()}
					disabled={networkStore.isOffline()}
					class={styles["splash-primary-btn"]}
				>
					{networkStore.isOffline()
						? t("onboarding-splash-internet-required")
						: t("onboarding-splash-start-setup")}
				</Button>

				<Show when={networkStore.isOffline()}>
					<p class={styles["splash-offline-hint"]}>
						{t("onboarding-splash-no-internet")}
						<span>
							{t("onboarding-splash-connection-required-description")}
						</span>
					</p>
				</Show>

				<button
					class={styles["splash-guest-link"]}
					onClick={() => void props.goToStep(2)}
				>
					{t("auth-continue-as-guest")}
				</button>
			</div>
		</div>
	);
}

export default SplashStep;
