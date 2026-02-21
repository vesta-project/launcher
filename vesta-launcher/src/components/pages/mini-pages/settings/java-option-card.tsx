import PlusIcon from "@assets/plus.svg";
import { Badge } from "@ui/badge";
import LauncherButton from "@ui/button/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import { showToast } from "@ui/toast/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { JSX, Show } from "solid-js";
import styles from "./settings-page.module.css";

export interface JavaOption {
	type: "managed" | "system" | "custom" | "browse";
	version: number;
	title: string;
	path?: string;
	isActive: boolean;
	onClick: () => void;
	onDownload?: () => void;
}

interface JavaOptionCardProps {
	option: JavaOption;
}

export function JavaOptionCard(props: JavaOptionCardProps) {
	const handleCopyPath = () => {
		if (props.option.path) {
			navigator.clipboard.writeText(props.option.path);
			showToast({
				title: "Copied",
				description: "Path copied to clipboard",
				severity: "success",
			});
		}
	};

	const cardContent = (): JSX.Element => {
		switch (props.option.type) {
			case "managed":
				return (
					<div
						class={styles["java-option-card"]}
						classList={{ [styles.active]: props.option.isActive }}
						onClick={props.option.onClick}
					>
						<div class={styles["option-title"]}>
							{props.option.title}
							<Show when={props.option.isActive}>
								<Badge>Active</Badge>
							</Show>
						</div>
						<Show
							when={props.option.path}
							fallback={
								<LauncherButton
									size="sm"
									variant="ghost"
									onClick={(e) => {
										e.stopPropagation();
										props.option.onDownload?.();
									}}
									style={{
										"margin-top": "auto",
										width: "100%",
										"font-size": "0.75rem",
										height: "28px",
									}}
								>
									Download & Use
								</LauncherButton>
							}
						>
							<div
								class={styles["option-path"]}
								style={{ "margin-top": "auto" }}
							>
								{props.option.path}
							</div>
						</Show>
					</div>
				);

			case "system":
			case "custom":
				return (
					<div
						class={styles["java-option-card"]}
						classList={{ [styles.active]: props.option.isActive }}
						onClick={props.option.onClick}
					>
						<div class={styles["option-title"]}>
							{props.option.title}
							<Show when={props.option.isActive}>
								<Badge>Active</Badge>
							</Show>
						</div>
						<div class={styles["option-path"]} style={{ "margin-top": "auto" }}>
							{props.option.path}
						</div>
					</div>
				);

			case "browse":
				return (
					<div
						class={`${styles["java-option-card"]} ${styles.browse}`}
						onClick={props.option.onClick}
					>
						<div class={styles["option-title"]}>
							<div
								style={{ display: "flex", "align-items": "center", gap: "8px" }}
							>
								<PlusIcon
									style={{
										width: "16px",
										height: "16px",
										color: "var(--accent-primary)",
									}}
								/>
								<span>Browse...</span>
							</div>
						</div>
						<div
							class={styles["option-subtitle"]}
							style={{ "margin-top": "auto" }}
						>
							Select manually
						</div>
					</div>
				);

			default:
				return <></>;
		}
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger>
				<Show when={props.option.path} fallback={cardContent()}>
					<Tooltip placement="top" gutter={8}>
						<TooltipTrigger as="div">{cardContent()}</TooltipTrigger>
						<TooltipContent>
							<div style="font-family: var(--font-mono); font-size: 11px; max-width: 400px; word-break: break-all;">
								{props.option.path}
							</div>
						</TooltipContent>
					</Tooltip>
				</Show>
			</ContextMenuTrigger>
			<Show when={props.option.path}>
				<ContextMenuContent>
					<ContextMenuItem onClick={handleCopyPath}>
						Copy Full Path
					</ContextMenuItem>
				</ContextMenuContent>
			</Show>
		</ContextMenu>
	);
}
