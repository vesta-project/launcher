import DownloadIcon from "@assets/icons/actions/download.svg";
import ReloadIcon from "@assets/icons/actions/reload.svg";
import TrashIcon from "@assets/icons/actions/delete.svg";
import MoreIcon from "@assets/icons/content/ellipsis-v.svg";
import type { ResourceVersion } from "@stores/resources";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ui/dropdown-menu/dropdown-menu";
import { Show } from "solid-js";
import styles from "../instance-details.module.css";

interface ResourceRowActionsProps {
	resource: any;
	update: ResourceVersion | undefined;
	isCheckingForUpdates: boolean;
	hasCheckedForUpdates: boolean;
	isIdentifying: boolean;
	busy: boolean;
	showVersionInfo?: boolean;
	currentVersion?: string;
	onUpdate: (resource: any, version: ResourceVersion) => Promise<void>;
	onDelete: (resource: any) => Promise<void>;
	onCheckUpdates: (resource: any) => Promise<void>;
	onIdentify: (resource: any) => Promise<void>;
	onMenuItemSelect?: () => void;
}

export function ResourceRowActions(props: ResourceRowActionsProps) {
	const notifyMenuSelect = () => props.onMenuItemSelect?.();
	const isUnresolved = () =>
		!props.resource.remote_id ||
		!["modrinth", "curseforge", "smithed"].includes(props.resource.platform);

	const handleMenuOpenChange = (open: boolean) => {
		if (!open) props.onMenuItemSelect?.();
	};

	return (
		<div class={styles["row-actions-cell"]}>
			<div class={styles["row-actions-update-slot"]}>
				<Show when={props.update}>
					{(update) => (
						<button
							type="button"
							class={styles["row-actions-update-button"]}
							title={`Update to ${update().version_number}`}
							disabled={props.busy}
							onClick={(e: MouseEvent) => {
								e.stopPropagation();
								void props.onUpdate(props.resource, update());
							}}
						>
							<DownloadIcon />
						</button>
					)}
				</Show>
			</div>
			<div class={styles["row-actions-menu-slot"]}>
				<DropdownMenu onOpenChange={handleMenuOpenChange}>
					<DropdownMenuTrigger
						as="button"
						class={styles["row-actions-trigger-button"]}
						onClick={(e: MouseEvent) => e.stopPropagation()}
					>
						<MoreIcon width="16" height="16" />
					</DropdownMenuTrigger>
					<DropdownMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
						<Show when={props.showVersionInfo && props.currentVersion}>
							<DropdownMenuItem
								disabled
								class={styles["row-actions-version-info"]}
							>
								Current: {props.currentVersion}
							</DropdownMenuItem>
							<DropdownMenuSeparator class={styles["row-actions-separator"]} />
						</Show>

						<Show when={isUnresolved()}>
							<DropdownMenuItem
								onSelect={() => {
									notifyMenuSelect();
									void props.onIdentify(props.resource);
								}}
								disabled={props.busy || props.isIdentifying}
							>
								<ReloadIcon
									style={{ "margin-right": "8px", flex: "0 0 auto" }}
									classList={{
										[styles["checking-updates-spinner"]]: props.isIdentifying,
									}}
								/>
								{props.isIdentifying ? "Identifying..." : "Identify Resource"}
							</DropdownMenuItem>
							<DropdownMenuSeparator class={styles["row-actions-separator"]} />
						</Show>

						<Show when={props.update}>
							{(update) => (
								<DropdownMenuItem
									onSelect={() => {
										notifyMenuSelect();
										void props.onUpdate(props.resource, update());
									}}
									disabled={props.busy}
									class={styles["row-actions-update"]}
								>
									<DownloadIcon style={{ "margin-right": "8px", flex: "0 0 auto" }} />
									Update to {update().version_number}
								</DropdownMenuItem>
							)}
						</Show>

						<Show when={!props.update}>
							<DropdownMenuItem
								onSelect={() => {
									notifyMenuSelect();
									void props.onCheckUpdates(props.resource);
								}}
								disabled={
									props.isCheckingForUpdates || props.hasCheckedForUpdates
								}
							>
								<Show
									when={
										!(props.isCheckingForUpdates || props.hasCheckedForUpdates)
									}
									fallback={
										<>
									<ReloadIcon
										style={{ "margin-right": "8px", flex: "0 0 auto" }}
										class={styles["checking-updates-spinner"]}
									/>
											Checking...
										</>
									}
								>
									<>
										<ReloadIcon style={{ "margin-right": "8px", flex: "0 0 auto" }} />
										Check for Updates
									</>
								</Show>
							</DropdownMenuItem>
						</Show>

						<Show when={props.hasCheckedForUpdates && !props.update}>
							<DropdownMenuItem
								disabled
								class={styles["row-actions-version-info"]}
							>
								Up to date
							</DropdownMenuItem>
						</Show>

						<DropdownMenuSeparator class={styles["row-actions-separator"]} />

						<DropdownMenuItem
							onSelect={() => {
								notifyMenuSelect();
								void props.onDelete(props.resource);
							}}
							disabled={props.busy}
							class={styles["row-actions-delete"]}
						>
							<TrashIcon
								style={{
									width: "14px",
									height: "14px",
									"margin-right": "8px",
									flex: "0 0 auto",
								}}
							/>
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
