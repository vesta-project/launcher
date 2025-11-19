import SearchIcon from "@assets/search.svg";
import { Button } from "@kobalte/core/button";
import {
	Tooltip,
	TooltipContent,
	TooltipPlacement,
	TooltipTrigger,
} from "@ui/tooltip/tooltip";
import clsx from "clsx";
import {
	type ComponentProps,
	children,
	mergeProps,
	splitProps,
} from "solid-js";
import "./sidebar-buttons.css";

interface SidebarButtonProps extends ComponentProps<"button"> {
	tooltip_text?: string;
	tooltip_placement?: TooltipPlacement;
	onClick?: () => void;
}

function SidebarButton(props: SidebarButtonProps) {
	const c = children(() => props.children);
	const [local, others] = splitProps(
		mergeProps({ tooltip_placement: "right", tooltip_text: "" }, props),
		["tooltip_placement", "tooltip_text", "class", "onClick"],
	);
	return (
		/* The placement property gives an error because it doesn't allow a string but, this is a valid property
		 *  @ts-ignore */
		<Tooltip placement={local.tooltip_placement} gutter={8}>
			{/* @ts-ignore error with the props. But the props are valid.*/}
			<TooltipTrigger
				as={Button}
				class={clsx("sidebar-button", local.class)}
				onClick={props.onClick}
				{...others}
			>
				{c()}
			</TooltipTrigger>
			<TooltipContent>{local.tooltip_text}</TooltipContent>
		</Tooltip>
	);
}

interface SidebarProfileButtonProps extends SidebarButtonProps {}

function SidebarProfileButton(props: SidebarProfileButtonProps) {
	const c = children(() => props.children);
	const [_, others] = splitProps(props, ["children"]);

	return (
		<SidebarButton style={{ "background-color": "red" }} {...others}>
			{c()}
		</SidebarButton>
	);
}

interface SidebarActionButtonProps extends SidebarButtonProps {}

function SidebarActionButton(props: SidebarActionButtonProps) {
	const c = children(() => props.children);
	const [_, others] = splitProps(props, ["children"]);

	return (
		<SidebarButton class={"sidebar-action-button"} {...others}>
			{c()}
		</SidebarButton>
	);
}

interface SidebarPageButtonProps extends SidebarButtonProps {}

function SidebarPageButton(props: SidebarPageButtonProps) {
	const c = children(() => props.children);
	const [_, others] = splitProps(props, ["children"]);

	return (
		<SidebarButton style={{ background: "green" }} {...others}>
			{c()}
		</SidebarButton>
	);
}

export { SidebarProfileButton, SidebarActionButton, SidebarPageButton };
