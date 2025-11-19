import { WindowControls } from "@tauri-controls/solid";
import { createSignal } from "solid-js";
import { getOsType } from "../../../utils/os";
import ConnectionStatus from "../connection-status/connection-status";
import "./titlebar.css";

interface TitleBarProps {
	pageViewerOpen?: boolean;
	class?: string;
	os: string;
}

function TitleBar(props: TitleBarProps) {
	return (
		<div
			classList={{
				titlebar: true,
				"titlebar--right": props.os !== "macos",
				"titlebar--white": props.os === "windows",
				[props.class ?? ""]: !!props.class,
			}}
		>
			<WindowControls
				class={"titlebar__window-controls"}
				hide={props.pageViewerOpen}
				platform={
					props.os === "linux"
						? "gnome"
						: props.os === "macos"
							? "macos"
							: "windows"
				}
			/>
			<div class={"titlebar__grab"} data-tauri-drag-region={true}>
				<div data-tauri-drag-region={true} class={"titlebar__content"}>
					<span data-tauri-drag-region={true}>Vesta Launcher Alpha V0.0.1</span>
				</div>
			</div>
		</div>
	);
}

export default TitleBar;
