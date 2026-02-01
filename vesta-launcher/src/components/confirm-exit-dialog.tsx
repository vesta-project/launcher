import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ui/dialog/dialog";
import Button from "@ui/button/button";
import { For, Show } from "solid-js";

interface ConfirmExitDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	blockingTasks: string[];
	runningInstances: string[];
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmExitDialog(props: ConfirmExitDialogProps) {
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle style={{ color: "var(--text-primary)" }}>Active Processes Detected</DialogTitle>
					<DialogDescription style={{ color: "var(--text-secondary)" }}>
						The launcher is still performing some actions or games are running.
						Closing now may cause issues.
					</DialogDescription>
				</DialogHeader>

				<div class="space-y-4 my-4" style={{ "margin-top": "1rem", "margin-bottom": "1.5rem" }}>
					<Show when={props.runningInstances.length > 0}>
						<div style={{ "background-color": "var(--semantic-warning-bg)", "padding": "0.75rem", "border-radius": "0.5rem", "border": "1px solid var(--semantic-warning)" }}>
							<h4 class="text-sm font-semibold mb-1" style={{ "font-weight": "600", "font-size": "0.875rem", color: "var(--semantic-warning)" }}>Running Instances:</h4>
							<ul class="text-xs list-disc pl-4" style={{ "font-size": "0.75rem", "list-style-type": "disc", "padding-left": "1.25rem", color: "var(--text-primary)" }}>
								<For each={props.runningInstances}>
									{(instance) => <li>{instance}</li>}
								</For>
							</ul>
						</div>
					</Show>

					<Show when={props.blockingTasks.length > 0}>
						<div style={{ "margin-top": "0.75rem", "background-color": "var(--primary-low)", "padding": "0.75rem", "border-radius": "0.5rem", "border": "1px solid var(--primary-accent)" }}>
							<h4 class="text-sm font-semibold mb-1" style={{ "font-weight": "600", "font-size": "0.875rem", color: "var(--primary-accent)" }}>Active Tasks:</h4>
							<ul class="text-xs list-disc pl-4" style={{ "font-size": "0.75rem", "list-style-type": "disc", "padding-left": "1.25rem", color: "var(--text-primary)" }}>
								<For each={props.blockingTasks}>
									{(task) => <li>{task}</li>}
								</For>
							</ul>
						</div>
					</Show>
				</div>

				<DialogFooter>
					<div style={{ display: "flex", gap: "0.75rem", "justify-content": "flex-end", width: "100%" }}>
						<Button variant="ghost" onClick={props.onCancel}>
							Stay Open
						</Button>
						<Button color="destructive" onClick={props.onConfirm}>
							Close Anyway
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
