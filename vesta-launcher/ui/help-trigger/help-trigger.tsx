import HelpIcon from "@assets/help.svg";
import { Popover, PopoverContent, PopoverTrigger } from "@ui/popover/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { HELP_CONTENT } from "@utils/help-content";
import { Component, Show } from "solid-js";
import styles from "./help-trigger.module.css";

interface HelpTriggerProps {
	topic: string;
	mode?: "tooltip" | "popover";
}

export const HelpTrigger: Component<HelpTriggerProps> = (props) => {
	const content = () => HELP_CONTENT[props.topic];

	const TriggerAction = () => (
		<div
			class={styles["help-trigger"]}
			title={props.mode === "popover" ? "Click for more info" : undefined}
		>
			<HelpIcon class={styles["help-trigger-icon"]} />
		</div>
	);

	return (
		<Show when={content()}>
			<Show
				when={props.mode === "popover"}
				fallback={
					<Tooltip>
						<TooltipTrigger class={styles["help-trigger-anchor"]}>
							<TriggerAction />
						</TooltipTrigger>
						<TooltipContent>
							<div class={styles["help-trigger-tooltip-content"]}>
								<h4 class={styles["help-trigger-title"]}>{content()?.title}</h4>
								<p class={styles["help-trigger-description"]}>
									{content()?.description}
								</p>
							</div>
						</TooltipContent>
					</Tooltip>
				}
			>
				<Popover>
					<PopoverTrigger class={styles["help-trigger-anchor"]}>
						<TriggerAction />
					</PopoverTrigger>
					<PopoverContent>
						<div class={styles["help-trigger-popover-content"]}>
							<h4 class={styles["help-trigger-title"]}>{content()?.title}</h4>
							<p class={styles["help-trigger-description"]}>
								{content()?.description}
							</p>
						</div>
					</PopoverContent>
				</Popover>
			</Show>
		</Show>
	);
};
