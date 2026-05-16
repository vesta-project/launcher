import CurseForgeIcon from "@assets/curseforge.svg";
import FabricLogo from "@assets/fabricmc-logo-colored.svg";
import ForgeLogo from "@assets/forge-logo-colored.svg";
import ModrinthIcon from "@assets/modrinth.svg";
import NeoForgeLogo from "@assets/neoforged-logo-colored.svg";
import QuiltLogo from "@assets/quiltmc-logo-colored.svg";
import { createSignal, onCleanup, onMount } from "solid-js";
import styles from "../init.module.css";

interface CreditsStepProps {
	goNext: () => Promise<void>;
}

const PLATFORMS = [
	{ name: "Modrinth", icon: ModrinthIcon, color: "#1bd96a" },
	{ name: "CurseForge", icon: CurseForgeIcon, color: "#f16436" },
	{ name: "Fabric", icon: FabricLogo, color: "#dbb69b" },
	{ name: "Forge", icon: ForgeLogo, color: "#dfa86b" },
	{ name: "NeoForge", icon: NeoForgeLogo, color: "#e07e47" },
	{ name: "Quilt", icon: QuiltLogo, color: "#8b76b8" },
];

function CreditsStep(props: CreditsStepProps) {
	const [canSkip, setCanSkip] = createSignal(false);

	onMount(() => {
		const autoAdvanceTimer = setTimeout(() => {
			void props.goNext();
		}, 6000);

		const handleKey = () => {
			clearTimeout(autoAdvanceTimer);
			void props.goNext();
		};

		window.addEventListener("keydown", handleKey);

		// Delay enabling click skip so the splash button click doesn't bubble here
		const skipEnableTimer = setTimeout(() => setCanSkip(true), 50);

		onCleanup(() => {
			clearTimeout(autoAdvanceTimer);
			clearTimeout(skipEnableTimer);
			window.removeEventListener("keydown", handleKey);
		});
	});

	const handleClick = () => {
		if (!canSkip()) return;
		void props.goNext();
	};

	return (
		<div class={styles["credits-step"]} onClick={handleClick}>
			<p class={`${styles["credits-text"]} ${styles["fade-up--enter"]}`}>
				Minecraft modding exists because of an incredible community.
			</p>

			<p class={`${styles["credits-subtext"]} ${styles["fade-up--enter-delay-1"]}`}>
				Vesta stands on the work of these teams and the thousands of mod developers
				who make it all possible.
			</p>

			<div class={`${styles["credits-logos"]} ${styles["fade-up--enter-delay-2"]}`}>
				{PLATFORMS.map((platform) => (
					<div
						class={styles["credits-logo-item"]}
						style={{ color: platform.color }}
						title={platform.name}
					>
						<platform.icon />
						<span>{platform.name}</span>
					</div>
				))}
			</div>

			<p class={`${styles["credits-hint"]} ${styles["credits-hint--enter"]}`}>
				Click or press any key to continue
			</p>
		</div>
	);
}

export default CreditsStep;
