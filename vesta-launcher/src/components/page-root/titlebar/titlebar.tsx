import HelpIcon from "@assets/help.svg";
import { openMiniPage } from "@components/page-viewer/page-viewer";
import { getVersion } from "@tauri-apps/api/app";
import { WindowControls } from "@tauri-controls-v2/solid";
import {
	ACCOUNT_TYPE_GUEST,
	type Account,
	getActiveAccount,
} from "@utils/auth";
import { createResource, Show } from "solid-js";
import NetworkPill from "./network-pill";
import styles from "./titlebar.module.css";

interface TitleBarProps {
	pageViewerOpen?: boolean;
	hideHelp?: boolean;
	class?: string;
	os: string;
	sectionTitle?: string;
	macosFullscreen?: boolean;
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
		openMiniPage("/config", { activeTab: "help" });
	};

	return (
		<div
			classList={{
				[styles.titlebar]: true,
				[styles["titlebar--right"]]:
					props.os !== "macos" || props.macosFullscreen === true,
				[styles["titlebar--white"]]: props.os === "windows",
				[props.class ?? ""]: !!props.class,
			}}
		>
			<Show when={props.os !== "macos"}>
				<WindowControls
					class={styles["titlebar__window-controls"]}
					hide={props.pageViewerOpen}
					platform={
						props.os === "linux"
							? "gnome"
							: props.os === "macos"
								? "macos"
								: "windows"
					}
				/>
			</Show>
			<div class={styles["titlebar__grab"]} data-tauri-drag-region={true}>
				<div data-tauri-drag-region={true} class={styles["titlebar__content"]}>
					<span data-tauri-drag-region={true} class={styles["titlebar__brand"]}>
						Vesta Launcher {version() ? `v${version()}` : "..."}
					</span>
					<Show when={props.sectionTitle}>
						<span
							data-tauri-drag-region={true}
							class={styles["titlebar__section"]}
						>
							{props.sectionTitle}
						</span>
					</Show>
					<Show when={activeAccount()?.account_type === ACCOUNT_TYPE_GUEST}>
						<div
							class={styles["guest-pill"]}
							style={{
								"margin-left": "8px",
								background: "var(--primary)",
								color: "white",
								"font-size": "10px",
								"font-weight": "800",
								padding: "1px 6px",
								"border-radius": "100px",
								"letter-spacing": "0.5px",
								"box-shadow": "0 2px 4px rgba(0,0,0,0.1)",
								display: "inline-flex",
								"align-items": "center",
								height: "16px",
								"text-transform": "uppercase",
							}}
						>
							Guest Mode
						</div>
					</Show>
					<NetworkPill />
					<Show when={!props.hideHelp}>
						<button
							class={styles["titlebar__help-btn"]}
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
