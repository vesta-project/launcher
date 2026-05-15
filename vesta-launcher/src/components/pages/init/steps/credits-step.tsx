import CurseForgeIcon from "@assets/curseforge.svg";
import FabricLogo from "@assets/fabric-logo.svg";
import ForgeLogo from "@assets/forge-logo.svg";
import ModrinthIcon from "@assets/modrinth.svg";
import NeoForgeLogo from "@assets/neoforge-logo.svg";
import QuiltLogo from "@assets/quilt-logo.svg";
import { Motion } from "@motionone/solid";
import { onCleanup, onMount } from "solid-js";
import { DURATION, EASE } from "../utils/motion";
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
	onMount(() => {
		const autoAdvanceTimer = setTimeout(() => {
			void props.goNext();
		}, 3000);

		const handleKey = () => {
			clearTimeout(autoAdvanceTimer);
			void props.goNext();
		};

		window.addEventListener("keydown", handleKey);
		window.addEventListener("click", handleKey);

		onCleanup(() => {
			clearTimeout(autoAdvanceTimer);
			window.removeEventListener("keydown", handleKey);
			window.removeEventListener("click", handleKey);
		});
	});

	return (
		<div class={styles["credits-step"]} onClick={() => void props.goNext()}>
			<Motion
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.slow, easing: EASE.smooth }}
			>
				<p class={styles["credits-text"]}>
					Minecraft modding exists because of an incredible community.
				</p>
			</Motion>

			<Motion
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.slow, delay: 0.15, easing: EASE.smooth }}
			>
				<p class={styles["credits-subtext"]}>
					Vesta stands on the work of these teams and the thousands of mod developers
					who make it all possible.
				</p>
			</Motion>

			<Motion
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.slow, delay: 0.3, easing: EASE.smooth }}
			>
				<div class={styles["credits-logos"]}>
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
			</Motion>

			<Motion
				initial={{ opacity: 0 }}
				animate={{ opacity: 0.4 }}
				transition={{ duration: DURATION.slow, delay: 0.8, easing: EASE.smooth }}
			>
				<p class={styles["credits-hint"]}>Press any key to continue</p>
			</Motion>
		</div>
	);
}

export default CreditsStep;
