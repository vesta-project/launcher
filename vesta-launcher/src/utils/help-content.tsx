import { JSX } from "solid-js";

export interface HelpTopic {
	title: string;
	description: string | JSX.Element;
}

export const HELP_CONTENT: Record<string, HelpTopic> = {
	MODLOADER_EXPLAINED: {
		title: "Introduction to Modloaders",
		description:
			"A Modloader is a piece of software that allows Minecraft to recognize and run player-made additions (Mods). It acts as a link between the game and the extra files, making sure everything runs correctly together.",
	},
	MODLOADER_FABRIC: {
		title: "Fabric",
		description:
			"A modern system for adding mods that focuses on being fast and efficient. It uses less of your computer's power compared to older systems and is usually very quick to support the latest game updates.",
	},
	MODLOADER_FORGE: {
		title: "Forge",
		description:
			"A well-established system for adding mods that supports a huge variety of complex changes. It provides creators with many tools to add large-scale features like new worlds, magic systems, and machinery.",
	},
	MODLOADER_NEOFORGE: {
		title: "NeoForge",
		description:
			"A modernized version of the Forge system. Many creators use it to build stable mods that are better optimized for modern computer hardware while still allowing for very complex additions.",
	},
	MODLOADER_QUILT: {
		title: "Quilt",
		description:
			"A community-focused system that is designed to be very easy to use and improve. It works similarly to Fabric and is compatible with many of the same mods while offering extra useful tools.",
	},
	MODLOADER_VANILLA: {
		title: "Vanilla (Normal)",
		description:
			"The official, standard version of Minecraft without any modifications. This is the simplest way to play, exactly as built by the game's developers.",
	},
	JAVA_MANAGED: {
		title: "Java Runtime",
		description:
			"Java is the software that Minecraft runs on. Because different versions of the game need specific versions of Java to work correctly, Vesta automatically downloads and handles these for you. This prevents technical issues that usually occur when the wrong software version is used.",
	},
	MEMORY_ALLOCATION: {
		title: "Memory (RAM)",
		description:
			"This is the amount of temporary storage your computer sets aside for Minecraft to use while it's running. Using many mods requires more memory to prevent the game from freezing. Most modded games run well with 4GB to 6GB of memory.",
	},
	JVM_ARGS: {
		title: "Advanced Tuning",
		description:
			"Special settings that change how Java handles the game's data. These are usually set automatically, but experts can tune them to improve performance on specialized computer hardware.",
	},
	GRADIENT_HARMONY: {
		title: "Color Matching",
		description:
			"A system that automatically picks colors that look good together. It ensures your theme stays consistent and readable by following professional design principles.",
	},
	MINECRAFT_VERSION: {
		title: "Game Versions",
		description:
			"'Releases' are finished and stable versions of the game. 'Snapshots' are early versions for testing new features. For the most stable modding experience, you should usually use a Release version.",
	},
	MODPACKS_CONCEPT: {
		title: "Modpacks",
		description:
			"A Modpack is a collection of many different mods grouped into one easy package. Creators build and test these collections to ensure they work smoothly together as a single experience, allowing you to install complex mod sets with just one click.",
	},
	GUIDE_PAGE: {
		title: "Knowledge Base",
		description:
			"A clear guide to help you understand modding concepts and your computer's requirements.",
	},
};
