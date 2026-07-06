import { createSignal, onCleanup, onMount } from "solid-js";
import styles from "../init.module.css";

interface AtmosphereLayerProps {
	state: "active" | "fading" | "off";
}

function AtmosphereLayer(props: AtmosphereLayerProps) {
	const [mousePos, setMousePos] = createSignal({ x: 50, y: 50 });
	let rafId: number | null = null;
	let pendingX = 50;
	let pendingY = 50;

	onMount(() => {
		const handleMouseMove = (e: MouseEvent) => {
			pendingX = (e.clientX / window.innerWidth) * 100;
			pendingY = (e.clientY / window.innerHeight) * 100;
			if (rafId === null) {
				rafId = requestAnimationFrame(() => {
					setMousePos({ x: pendingX, y: pendingY });
					rafId = null;
				});
			}
		};

		window.addEventListener("mousemove", handleMouseMove);

		onCleanup(() => {
			window.removeEventListener("mousemove", handleMouseMove);
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
			}
		});
	});

	const flashlightStyle = () => ({
		background: `radial-gradient(circle at ${mousePos().x}% ${mousePos().y}%, hsla(var(--color__primary-hue) 80% 60% / 0.08) 0%, transparent 50%)`,
	});

	return (
		<div
			classList={{
				[styles["atmosphere-layer"]]: true,
				[styles["atmosphere-layer--fading"]]: props.state === "fading",
				[styles["atmosphere-layer--off"]]: props.state === "off",
			}}
		>
			<div class={styles["atmosphere-orb"]} />
			<div class={styles["atmosphere-orb"]} />
			<div class={styles["atmosphere-orb"]} />
			<div class={styles["atmosphere-specks"]}>
				{Array.from({ length: 40 }).map((_, i) => {
					// Deterministic pseudo-random spread so particles are already
					// scattered at different points in their drift when the page loads.
					const startY = i * 47 - 80;
					const size = 1 + ((i * 13) % 3);
					return (
						<div
							class={styles["atmosphere-speck"]}
							style={{
								left: `${(i * 37 + 13) % 100}%`,
								top: `${(i * 53 + 7) % 100}%`,
								"--start-y": `${startY}px`,
								width: `${size}px`,
								height: `${size}px`,
								"animation-duration": `${(3.5 + (i % 4) * 0.8).toFixed(1)}s`,
							}}
						/>
					);
				})}
			</div>
			<div class={styles["atmosphere-flashlight"]} style={flashlightStyle()} />
		</div>
	);
}

export default AtmosphereLayer;
