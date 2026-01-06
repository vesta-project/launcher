import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { invoke } from "@tauri-apps/api/core";

export const startAppTutorial = (onComplete?: () => void) => {
	const driverObj = driver({
		showProgress: true,
		animate: true,
		allowClose: true,
		allowInteraction: false,
		overlayColor: "rgba(0, 0, 0, 0.75)",
		popoverClass: "driverjs-theme",
		steps: [
			{
				element: "#sidebar-new",
				popover: {
					title: "Instances",
					description:
						"This is where you create and manage your Minecraft instances. Click 'New' to start.",
					side: "right",
					align: "start",
				},
			},
			{
				element: "#sidebar-explore",
				popover: {
					title: "Explore",
					description:
						"Discover modpacks and maps directly from Vesta.",
					side: "right",
					align: "start",
				},
			},
			{
				element: "#profile-selector",
				popover: {
					title: "Profiles",
					description:
						"Manage your Minecraft accounts and switch between them.",
					side: "right",
					align: "center",
				},
			},
			{
				element: "#sidebar-settings",
				popover: {
					title: "Settings",
					description:
						"Customize Vesta, manage Java, and re-run this tutorial anytime.",
					side: "right",
					align: "end",
				},
			},
		],
		onDestroyed: async () => {
			await invoke("update_config_field", {
				field: "tutorial_completed",
				value: true,
			});
			if (onComplete) onComplete();
		},
	});

	driverObj.drive();
};
