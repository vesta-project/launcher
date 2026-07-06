import { onMount } from "solid-js";
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
			<div class={`${styles["complete-icon"]} ${styles["scale-in--enter"]}`}>
				<svg
					width="64"
					height="64"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--accent-primary)"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
					<polyline points="22 4 12 14.01 9 11.01" />
				</svg>
			</div>

			<h2
				class={`${styles["complete-title"]} ${styles["fade-up--enter-delay-1"]}`}
			>
				You are all set.
			</h2>

			<p
				class={`${styles["complete-subtitle"]} ${styles["fade-up--enter-delay-2"]}`}
			>
				Welcome to Vesta. Your journey starts now.
			</p>

			<button
				class={`${styles["complete-skip"]} ${styles["fade-in--enter-delay-3"]}`}
				onClick={() => props.navigate("/home", { replace: true })}
			>
				Enter Vesta
			</button>
		</div>
	);
}

export default CompleteStep;
