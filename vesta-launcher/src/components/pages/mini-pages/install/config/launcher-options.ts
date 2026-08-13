import ATLauncherIcon from "@assets/branding/launchers/at-launcher.svg";
import CurseForgeIcon from "@assets/branding/sources/curseforge.svg";
import FTBIcon from "@assets/branding/launchers/feed-the-beast.svg";
import GDLauncherIcon from "@assets/branding/launchers/gd-launcher.svg";
import ModrinthIcon from "@assets/branding/sources/modrinth.svg";
import MultiMCIcon from "@assets/branding/launchers/multimc.svg";
import PrismLauncherIcon from "@assets/branding/launchers/prism-launcher.svg";
import TechnicLauncherIcon from "@assets/branding/launchers/technic-launcher.svg";
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
