import { WindowControls } from "@tauri-controls/solid";
import { getOsType } from "@utils/os";
import { createResource, createSignal, Show } from "solid-js";
import ConnectionStatus from "../connection-status";
import { router, setPageViewerOpen } from "@components/page-viewer/page-viewer";
import HelpIcon from "@assets/help.svg";
import { getVersion } from "@tauri-apps/api/app";
import { ACCOUNT_TYPE_GUEST, getActiveAccount, type Account } from "@utils/auth";
import "./titlebar.css";

interface TitleBarProps {
	pageViewerOpen?: boolean;
	hideHelp?: boolean;
	class?: string;
	os: string;
}

function TitleBar(props: TitleBarProps) {
	const [version] = createResource(getVersion);
	const [activeAccount] = createResource<Account | null>(async () => {
		try {
			return await getActiveAccount();
		} catch (_) {
			return null;
		}
	});

	const handleHelpClick = () => {
		const r = router();
		if (r) {
			r.navigate("/config", { activeTab: "help" });
			setPageViewerOpen(true);
		}
	};

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
					<span data-tauri-drag-region={true}>Vesta Launcher {version() ? `v${version()}` : "..."}</span>
					<Show when={activeAccount()?.account_type === ACCOUNT_TYPE_GUEST}>
						<div 
							class="guest-pill"
							style={{
								"margin-left": "8px",
								"background": "var(--primary)",
								"color": "white",
								"font-size": "10px",
								"font-weight": "800",
								"padding": "1px 6px",
								"border-radius": "100px",
								"letter-spacing": "0.5px",
								"box-shadow": "0 2px 4px rgba(0,0,0,0.1)",
								"display": "inline-flex",
								"align-items": "center",
								"height": "16px",
								"text-transform": "uppercase"
							}}
						>
							Guest Mode
						</div>
					</Show>
					<Show when={!props.hideHelp}>
						<button 
							class="titlebar__help-btn" 
							onClick={handleHelpClick}
							title="Help & Modding Guide"
						>
							<HelpIcon />
						</button>
					</Show>
				</div>
			</div>
		</div>
	);
}

export default TitleBar;
