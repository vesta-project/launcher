import {
	setHomeIntroShowDemoCards,
	setHomeIntroSidebarVisible,
} from "@stores/home-intro";
import { invoke } from "@tauri-apps/api/core";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import styles from "./home-intro.module.css";
import HomeIntroModal from "./home-intro-modal";
import HomeIntroRing from "./home-intro-ring";
import { INTRO_STEPS } from "./home-intro-steps";
import HomeIntroTooltip from "./home-intro-tooltip";

interface HomeIntroProps {
	onComplete?: () => void;
}

function HomeIntro(props: HomeIntroProps) {
	const [stepIndex, setStepIndex] = createSignal(0);
	const [ringReady, setRingReady] = createSignal(false);
	const [tooltipReady, setTooltipReady] = createSignal(false);
	let ringTimeout: ReturnType<typeof setTimeout> | null = null;
	let tooltipTimeout: ReturnType<typeof setTimeout> | null = null;

	const currentStep = () => INTRO_STEPS[stepIndex()];
	const isLastStep = () => stepIndex() >= INTRO_STEPS.length - 1;
	const stepKind = () => currentStep().kind;
	const isDarkBackdrop = () => stepKind() === "modal";

	// Show sidebar when we reach the first sidebar highlight step (profiles) or later
	createEffect(() => {
		const idx = stepIndex();
		const firstRingStepIndex = INTRO_STEPS.findIndex((s) => s.kind === "ring");
		setHomeIntroSidebarVisible(idx >= firstRingStepIndex);
	});

	// Show demo cards when we're on the instances step or any step after it (before the last modal)
	createEffect(() => {
		const idx = stepIndex();
		const instancesStepIndex = INTRO_STEPS.findIndex((s) => s.kind === "cards");
		const shouldShow =
			idx >= instancesStepIndex && idx < INTRO_STEPS.length - 1;
		setHomeIntroShowDemoCards(shouldShow);
	});

	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				void finish();
			}
		};
		window.addEventListener("keydown", onKey);

		// Block all clicks outside the intro overlay during ring/cards steps.
		// Hover still works (pointer-events: none on light backdrop), but
		// clicks are swallowed so users can't accidentally interact with the app.
		const onClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement | null;
			if (!target) return;

			// Only block during non-modal steps
			if (stepKind() === "modal") return;

			// Allow clicks on the intro overlay itself (tooltip buttons, skip)
			const overlay = document.querySelector(
				`.${styles["home-intro-overlay"]}`,
			);
			if (overlay && overlay.contains(target)) return;

			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
		};
		document.addEventListener("click", onClick, true);

		onCleanup(() => {
			window.removeEventListener("keydown", onKey);
			document.removeEventListener("click", onClick, true);
		});
	});

	onCleanup(() => {
		setHomeIntroShowDemoCards(false);
		setHomeIntroSidebarVisible(false);
		if (ringTimeout) clearTimeout(ringTimeout);
		if (tooltipTimeout) clearTimeout(tooltipTimeout);
	});

	const scheduleStepEntrance = () => {
		setRingReady(false);
		setTooltipReady(false);
		if (ringTimeout) clearTimeout(ringTimeout);
		if (tooltipTimeout) clearTimeout(tooltipTimeout);

		// Ring appears first once sidebar is mostly settled
		ringTimeout = setTimeout(() => setRingReady(true), 400);
		// Tooltip slides in 250ms after ring for a staggered reveal
		tooltipTimeout = setTimeout(() => setTooltipReady(true), 650);
	};

	const nextStep = () => {
		if (isLastStep()) {
			void finish();
			return;
		}
		setStepIndex((i) => i + 1);
		scheduleStepEntrance();
	};

	const finish = async () => {
		try {
			await invoke("update_config_field", {
				field: "tutorial_completed",
				value: true,
			});
		} catch (e) {
			console.error("Failed to mark tutorial complete:", e);
		}
		setHomeIntroShowDemoCards(false);
		setHomeIntroSidebarVisible(false);
		props.onComplete?.();
	};

	const showRing = () => stepKind() === "ring" && ringReady();
	const showTooltip = () =>
		(stepKind() === "ring" || stepKind() === "cards") && tooltipReady();
	const showModal = () => stepKind() === "modal";

	const ringTarget = () => currentStep().targetSelector ?? "";

	return (
		<div class={styles["home-intro-overlay"]}>
			{/* Backdrop: dark for modals, nearly transparent for tooltips/rings */}
			<div
				class={`${styles["home-intro-backdrop"]} ${!isDarkBackdrop() ? styles["home-intro-backdrop--light"] : ""}`}
			/>

			<button class={styles["home-intro-skip"]} onClick={() => void finish()}>
				Skip intro
			</button>

			{/* Ring highlight */}
			<Show when={showRing()}>
				<HomeIntroRing targetSelector={ringTarget()} visible={showRing()} />
			</Show>

			{/* Tooltip */}
			<HomeIntroTooltip
				step={currentStep()}
				visible={showTooltip()}
				onContinue={nextStep}
			/>

			{/* Modal */}
			<HomeIntroModal
				step={currentStep()}
				visible={showModal()}
				onContinue={nextStep}
			/>
		</div>
	);
}

export default HomeIntro;
