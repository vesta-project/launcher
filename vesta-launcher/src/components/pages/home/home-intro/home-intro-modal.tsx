import { Show } from "solid-js";
import styles from "./home-intro.module.css";
import type { IntroStep } from "./home-intro-steps";

interface HomeIntroModalProps {
	step: IntroStep;
	visible: boolean;
	onContinue: () => void;
}

function HomeIntroModal(props: HomeIntroModalProps) {
	const isWelcome = () => props.step.id === "welcome";

	return (
		<Show when={props.visible}>
			<div class={styles["home-intro-modal"]}>
				<div
					class={`${styles["home-intro-modal-card"]} ${styles["home-intro-modal-card--enter"]}`}
				>
					<div class={styles["home-intro-modal-icon"]}>
						<Show
							when={isWelcome()}
							fallback={
								<SuccessIcon width="56" height="56" />
							}
						>
							<HomeIcon width="56" height="56" />
						</Show>
					</div>
					<h2 class={styles["home-intro-modal-title"]}>{props.step.title}</h2>
					<p class={styles["home-intro-modal-desc"]}>
						{props.step.description}
					</p>
					<button
						class={styles["home-intro-modal-btn"]}
						onClick={props.onContinue}
					>
						{props.step.buttonText}
					</button>
				</div>
			</div>
		</Show>
	);
}

export default HomeIntroModal;
import SuccessIcon from "@assets/icons/controls/success.svg";
import HomeIcon from "@assets/icons/navigation/home.svg";
