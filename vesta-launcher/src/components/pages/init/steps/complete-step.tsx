import { Motion } from "@motionone/solid";
import { onMount } from "solid-js";
import { DURATION, EASE } from "../utils/motion";
import styles from "../init.module.css";

interface CompleteStepProps {
	navigate: (to: string, options?: { replace?: boolean }) => void;
}

function CompleteStep(props: CompleteStepProps) {
	onMount(() => {
		const timer = setTimeout(() => {
			props.navigate("/home", { replace: true });
		}, 4000);

		return () => clearTimeout(timer);
	});

	return (
		<div class={styles["complete-step"]}>
			<Motion
				initial={{ opacity: 0, scale: 0.8 }}
				animate={{ opacity: 1, scale: 1 }}
				transition={{ duration: DURATION.slow, easing: EASE.smooth }}
			>
				<div class={styles["complete-icon"]}>
					<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
						<polyline points="22 4 12 14.01 9 11.01" />
					</svg>
				</div>
			</Motion>

			<Motion
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.slow, delay: 0.15, easing: EASE.smooth }}
			>
				<h2 class={styles["complete-title"]}>You are all set.</h2>
			</Motion>

			<Motion
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.slow, delay: 0.3, easing: EASE.smooth }}
			>
				<p class={styles["complete-subtitle"]}>
					Welcome to Vesta. Your journey starts now.
				</p>
			</Motion>

			<Motion
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: DURATION.slow, delay: 0.6, easing: EASE.smooth }}
			>
				<button
					class={styles["complete-skip"]}
					onClick={() => props.navigate("/home", { replace: true })}
				>
					Enter Vesta
				</button>
			</Motion>
		</div>
	);
}

export default CompleteStep;
