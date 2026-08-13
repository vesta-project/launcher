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
				<SuccessIcon width="64" height="64" />
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
import SuccessIcon from "@assets/icons/controls/success.svg";
