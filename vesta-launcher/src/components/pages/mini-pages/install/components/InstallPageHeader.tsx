import { InstallStageHeader } from "./InstallStageHeader";

interface InstallPageHeaderProps {
	isModpackMode: boolean;
	onToggleMode: () => void;
}

export function InstallPageHeader(props: InstallPageHeaderProps) {
	return (
		<InstallStageHeader
			title={props.isModpackMode ? "Install Modpack" : "New Instance"}
			description={
				props.isModpackMode
					? "Install a pre-configured modpack."
					: "Create a clean slate and customize it."
			}
			actionLabel={props.isModpackMode ? "Back" : "More Installation Options"}
			onAction={props.onToggleMode}
		/>
	);
}
