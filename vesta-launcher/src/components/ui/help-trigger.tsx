import { Component, Show } from "solid-js";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../../ui/tooltip/tooltip";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "../../../ui/popover/popover";
import { HELP_CONTENT } from "../../utils/help-content";
import HelpIcon from "@assets/help.svg";
import styles from "./help-trigger.module.css";

interface HelpTriggerProps {
	topic: string;
	mode?: "tooltip" | "popover";
}

export const HelpTrigger: Component<HelpTriggerProps> = (props) => {
	const content = () => HELP_CONTENT[props.topic];

	const TriggerAction = () => (
		<div
			class={styles.trigger}
			title={props.mode === "popover" ? "Click for more info" : undefined}
		>
			<HelpIcon class={styles.icon} />
		</div>
	);

	return (
		<Show when={content()}>
			<Show
				when={props.mode === "popover"}
				fallback={
					<Tooltip>
						<TooltipTrigger class={styles.anchor}>
							<TriggerAction />
						</TooltipTrigger>
						<TooltipContent>
							<div class={styles.tooltip_content}>
								<h4 class={styles.title}>{content()?.title}</h4>
								<p class={styles.description}>{content()?.description}</p>
							</div>
						</TooltipContent>
					</Tooltip>
				}
			>
				<Popover>
					<PopoverTrigger class={styles.anchor}>
						<TriggerAction />
					</PopoverTrigger>
					<PopoverContent>
						<div class={styles.popover_content}>
							<h4 class={styles.title}>{content()?.title}</h4>
							<p class={styles.description}>{content()?.description}</p>
						</div>
					</PopoverContent>
				</Popover>
			</Show>
		</Show>
	);
};
