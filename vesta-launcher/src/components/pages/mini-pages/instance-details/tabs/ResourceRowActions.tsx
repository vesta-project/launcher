import DownloadIcon from "@assets/download-compact.svg";
import TrashIcon from "@assets/trash.svg";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ui/dropdown-menu/dropdown-menu";
import type { ResourceVersion } from "@stores/resources";
import { Show } from "solid-js";
import styles from "../instance-details.module.css";

interface ResourceRowActionsProps {
	resource: any;
	update: ResourceVersion | undefined;
	isCheckingForUpdates: boolean;
	hasCheckedForUpdates: boolean;
	busy: boolean;
	showVersionInfo?: boolean;
	currentVersion?: string;
	onUpdate: (resource: any, version: ResourceVersion) => Promise<void>;
	onDelete: (resource: any) => Promise<void>;
	onCheckUpdates: (resource: any) => Promise<void>;
	onMenuItemSelect?: () => void;
}

export function ResourceRowActions(props: ResourceRowActionsProps) {
	const notifyMenuSelect = () => props.onMenuItemSelect?.();

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
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="currentColor"
					>
						<circle cx="12" cy="5" r="1.5" />
						<circle cx="12" cy="12" r="1.5" />
						<circle cx="12" cy="19" r="1.5" />
					</svg>
				</DropdownMenuTrigger>
				<DropdownMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
					<Show when={props.showVersionInfo && props.currentVersion}>
						<DropdownMenuItem disabled class={styles["row-actions-version-info"]}>
							Current: {props.currentVersion}
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
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									style={{ "margin-right": "8px", flex: "0 0 auto" }}
								>
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
									<polyline points="7 10 12 15 17 10" />
									<line x1="12" y1="15" x2="12" y2="3" />
								</svg>
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
							disabled={props.isCheckingForUpdates || props.hasCheckedForUpdates}
						>
							<Show
								when={!(props.isCheckingForUpdates || props.hasCheckedForUpdates)}
								fallback={
									<>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											style={{ "margin-right": "8px", flex: "0 0 auto" }}
											class={styles["checking-updates-spinner"]}
										/>
										Checking...
									</>
								}
							>
								<>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										style={{ "margin-right": "8px", flex: "0 0 auto" }}
									>
										<polyline points="23 4 23 10 17 10" />
										<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
									</svg>
									Check for Updates
								</>
							</Show>
						</DropdownMenuItem>
					</Show>

					<Show when={props.hasCheckedForUpdates && !props.update}>
						<DropdownMenuItem disabled class={styles["row-actions-version-info"]}>
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
							style={{ width: "14px", height: "14px", "margin-right": "8px", flex: "0 0 auto" }}
						/>
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			</div>
		</div>
	);
}
