export interface IntroStep {
	id: string;
	kind: "modal" | "cards" | "ring";
	title: string;
	description: string;
	buttonText: string;
	targetSelector?: string;
	tooltipPlacement?: "right" | "left" | "top" | "bottom";
}

export const INTRO_STEPS: IntroStep[] = [
  {
    id: "welcome",
    kind: "modal",
    title: "Welcome to Vesta.",
    description:
      "Your setup is complete. Let us take a quick look at what is waiting for you.",
    buttonText: "Continue",
  },
  {
    id: "instances",
    kind: "cards",
    title: "Your Instances",
    description:
      "These cards are your Minecraft instances. Each one is a self-contained installation with its own mods, resource packs, worlds and configurations.",
    buttonText: "Continue",
  },
  {
    id: "profiles",
    kind: "ring",
    title: "Profiles",
    description:
      "Switch between your Minecraft accounts or manage who you are playing as.",
    buttonText: "Continue",
    targetSelector: "#profile-selector",
    tooltipPlacement: "right",
  },
  {
    id: "new-instance",
    kind: "ring",
    title: "New Instance",
    description: "Create a fresh Minecraft instance or install a modpack.",
    buttonText: "Continue",
    targetSelector: "#sidebar-new",
    tooltipPlacement: "right",
  },
  {
    id: "explore",
    kind: "ring",
    title: "Explore",
    description:
      "Browse modpacks, resource packs, shaders, and worlds from Modrinth and CurseForge.",
    buttonText: "Continue",
    targetSelector: "#sidebar-explore",
    tooltipPlacement: "right",
  },
  {
    id: "notifications",
    kind: "ring",
    title: "Notifications",
    description:
      "Keep track of downloads, installations, and launcher activity in real time.",
    buttonText: "Continue",
    targetSelector: "#sidebar-notifications",
    tooltipPlacement: "right",
  },
  {
    id: "settings",
    kind: "ring",
    title: "Settings",
    description:
      "Themes, Java versions, memory limits, and everything else you can tweak.",
    buttonText: "Continue",
    targetSelector: "#sidebar-settings",
    tooltipPlacement: "right",
  },
  {
    id: "ready",
    kind: "modal",
    title: "You are ready.",
    description: "Enjoy Vesta. Your journey starts now.",
    buttonText: "Enter Vesta",
  },
];
