import ATLauncherIcon from "@assets/at-launcher.svg";
import CurseForgeIcon from "@assets/curseforge.svg";
import FTBIcon from "@assets/feed-the-beast.svg";
import GDLauncherIcon from "@assets/gd-launcher.svg";
import ModrinthIcon from "@assets/modrinth.svg";
import MultiMCIcon from "@assets/multimc.svg";
import PrismLauncherIcon from "@assets/prism-launcher.svg";
import TechnicLauncherIcon from "@assets/technic-launcher.svg";
import type { LauncherKind } from "@utils/launcher-imports";
import type { LauncherOption } from "../types";

export const launcherOptions: LauncherOption[] = [
	{
		kind: "curseforgeFlame",
		label: "CurseForge",
		icon: CurseForgeIcon,
		tone: "curseforge",
	},
	{
		kind: "gdlauncher",
		label: "GDLauncher",
		icon: GDLauncherIcon,
		tone: "gdlauncher",
	},
	{
		kind: "prism",
		label: "Prism Launcher",
		icon: PrismLauncherIcon,
		tone: "prism",
	},
	{
		kind: "multimc",
		label: "MultiMC",
		icon: MultiMCIcon,
		tone: "multimc",
	},
	{
		kind: "modrinthApp",
		label: "Modrinth App",
		icon: ModrinthIcon,
		tone: "modrinth",
	},
	{
		kind: "atlauncher",
		label: "ATLauncher",
		icon: ATLauncherIcon,
		tone: "atlauncher",
	},
	{
		kind: "ftb",
		label: "FTB",
		icon: FTBIcon,
		tone: "ftb",
	},
	{
		kind: "technic",
		label: "Technic Launcher",
		icon: TechnicLauncherIcon,
		tone: "technic",
	},
];

export const launcherLabelMap = new Map<LauncherKind, string>(
	launcherOptions.map((opt) => [opt.kind, opt.label]),
);

export const launcherVisualMap = new Map<LauncherKind, LauncherOption>(
	launcherOptions.map((opt) => [opt.kind, opt]),
);
