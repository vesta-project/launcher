import { createEffect, createSignal, Show } from "solid-js";
import styles from "./home-intro.module.css";
import type { IntroStep } from "./home-intro-steps";

interface HomeIntroTooltipProps {
	step: IntroStep;
	visible: boolean;
	onContinue: () => void;
}

function HomeIntroTooltip(props: HomeIntroTooltipProps) {
	const [pos, setPos] = createSignal({ x: 0, y: 0 });

	createEffect(() => {
		// Track both so effect re-runs when step changes even if visible stays true
		const visible = props.visible;
		const step = props.step;

		if (!visible) {
			return;
		}

		const tooltipWidth = 280;
		// Estimate tooltip height generously to prevent falling off-screen
		const tooltipHeight = 220;
		const gap = 16;

		const update = () => {
			// Cards step: fixed position below titlebar, centered horizontally
			if (step.kind === "cards") {
				setPos({
					x: Math.max(16, window.innerWidth / 2 - tooltipWidth / 2),
					y: Math.max(
						80,
						Math.min(160, window.innerHeight / 2 - tooltipHeight / 2),
					),
				});
				return;
			}

			const selector = step.targetSelector;
			if (!selector) return;

			const el = document.querySelector(selector);
			if (!el) {
				// Fallback: position near top-left of content area if target not found
				setPos({
					x: 80,
					y: 80,
				});
				return;
			}

			const r = el.getBoundingClientRect();
			const placement = step.tooltipPlacement ?? "right";

			let x = 0;
			let y = 0;

			switch (placement) {
				case "right":
					x = r.right + gap;
					y = r.top + r.height / 2 - tooltipHeight / 2;
					break;
				case "left":
					x = r.left - tooltipWidth - gap;
					y = r.top + r.height / 2 - tooltipHeight / 2;
					break;
				case "top":
					x = r.left + r.width / 2 - tooltipWidth / 2;
					y = r.top - tooltipHeight - gap;
					break;
				case "bottom":
					x = r.left + r.width / 2 - tooltipWidth / 2;
					y = r.bottom + gap;
					break;
			}

			// Clamp to viewport with generous padding
			x = Math.max(16, Math.min(x, window.innerWidth - tooltipWidth - 16));
			y = Math.max(48, Math.min(y, window.innerHeight - tooltipHeight - 16));

			setPos({ x, y });
		};

		update();
		window.addEventListener("resize", update);

		// Poll position during first 800ms to catch sidebar/CSS transitions
		let rafId: number;
		const startTime = Date.now();
		const poll = () => {
			update();
			if (Date.now() - startTime < 800) {
				rafId = requestAnimationFrame(poll);
			}
		};
		rafId = requestAnimationFrame(poll);

		return () => {
			window.removeEventListener("resize", update);
			cancelAnimationFrame(rafId);
		};
	});

	const shouldShow = () => {
		if (!props.visible) return false;
		if (props.step.kind === "cards") return true;
		return !!props.step.targetSelector;
	};

	const animClass = () =>
		props.step.kind === "cards"
			? styles["home-intro-tooltip--enter"]
			: styles["home-intro-tooltip--enter-right"];

	return (
		<Show when={shouldShow()}>
			<div
				class={`${styles["home-intro-tooltip"]} ${animClass()}`}
				style={{
					left: `${pos().x}px`,
					top: `${pos().y}px`,
				}}
			>
				<h4 class={styles["home-intro-tooltip-title"]}>{props.step.title}</h4>
				<p class={styles["home-intro-tooltip-desc"]}>
					{props.step.description}
				</p>
				<button
					class={styles["home-intro-tooltip-btn"]}
					onClick={props.onContinue}
				>
					{props.step.buttonText}
				</button>
			</div>
		</Show>
	);
}

export default HomeIntroTooltip;
