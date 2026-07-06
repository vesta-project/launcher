import { createEffect, createSignal, Show } from "solid-js";
import styles from "./home-intro.module.css";

interface HomeIntroRingProps {
	targetSelector: string;
	visible: boolean;
}

function HomeIntroRing(props: HomeIntroRingProps) {
	const [rect, setRect] = createSignal<DOMRect | null>(null);

	createEffect(() => {
		// Track both dependencies so effect re-runs when either changes
		const visible = props.visible;
		const selector = props.targetSelector;

		if (!visible || !selector) {
			setRect(null);
			return;
		}

		const update = () => {
			const el = document.querySelector(selector);
			if (el) {
				setRect(el.getBoundingClientRect());
			} else {
				setRect(null);
			}
		};

		update();

		const ro = new ResizeObserver(update);
		const el = document.querySelector(selector);
		if (el) ro.observe(el);

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
			ro.disconnect();
			window.removeEventListener("resize", update);
			cancelAnimationFrame(rafId);
		};
	});

	return (
		<Show when={rect()}>
			{(r) => {
				const padding = 8;
				return (
					<div
						class={styles["home-intro-ring"]}
						style={{
							left: `${r().left - padding}px`,
							top: `${r().top - padding}px`,
							width: `${r().width + padding * 2}px`,
							height: `${r().height + padding * 2}px`,
						}}
					/>
				);
			}}
		</Show>
	);
}

export default HomeIntroRing;
