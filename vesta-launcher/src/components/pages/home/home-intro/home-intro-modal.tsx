import { Show } from "solid-js";
import type { IntroStep } from "./home-intro-steps";
import styles from "./home-intro.module.css";

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
				<div class={`${styles["home-intro-modal-card"]} ${styles["home-intro-modal-card--enter"]}`}>
					<div class={styles["home-intro-modal-icon"]}>
						<Show
							when={isWelcome()}
							fallback={
								<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
									<polyline points="22 4 12 14.01 9 11.01" />
								</svg>
							}
						>
							<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
								<polyline points="9 22 9 12 15 12 15 22" />
							</svg>
						</Show>
					</div>
					<h2 class={styles["home-intro-modal-title"]}>{props.step.title}</h2>
					<p class={styles["home-intro-modal-desc"]}>{props.step.description}</p>
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
