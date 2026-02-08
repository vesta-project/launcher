import { Show, For } from "solid-js";
import styles from "../instance-details.module.css";
import Button from "@ui/button/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import FolderIcon from "@assets/folder.svg";
import TrashIcon from "@assets/trash.svg";

interface ConsoleTabProps {
	lines: string[];
	consoleRef: (el: HTMLDivElement) => void;
	openLogsFolder: () => void;
	clearConsole: () => void;
}

export const ConsoleTab = (props: ConsoleTabProps) => {
	return (
		<section class={styles["tab-console"]}>
			<div class={styles["console-toolbar"]}>
				<span class={styles["console-title"]}>Game Console</span>
				<div class={styles["console-toolbar-buttons"]}>
					<Tooltip placement="top">
						<TooltipTrigger onClick={props.openLogsFolder} as={Button}>
							<FolderIcon /> Logs
						</TooltipTrigger>
						<TooltipContent>Open logs folder in file explorer</TooltipContent>
					</Tooltip>
					<button class={styles["console-clear"]} onClick={props.clearConsole}>
						<TrashIcon /> Clear
					</button>
				</div>
			</div>
			<div class={styles["console-output"]} ref={props.consoleRef}>
				<Show when={props.lines.length === 0}>
					<div class={styles["console-placeholder"]}>
						No output yet. Launch the game to see console output.
					</div>
				</Show>
				<For each={props.lines}>
					{(line) => <div class={styles["console-line"]}>{line}</div>}
				</For>
			</div>
		</section>
	);
};
