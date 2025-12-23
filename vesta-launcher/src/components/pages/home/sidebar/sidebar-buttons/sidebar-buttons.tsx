// SearchIcon not used in this file; removed import.
import { Button } from "@kobalte/core/button";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
	Tooltip,
	TooltipContent,
	TooltipPlacement,
	TooltipTrigger,
} from "@ui/tooltip/tooltip";
import { type Account, getActiveAccount } from "@utils/auth";
import clsx from "clsx";
import {
	type ComponentProps,
	children,
	createResource,
	mergeProps,
	Show,
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

interface SidebarProfileButtonProps extends SidebarButtonProps {
	onAccountMenuToggle?: (open: boolean) => void;
	open?: boolean;
}

function SidebarProfileButton(props: SidebarProfileButtonProps) {
	const c = children(() => props.children);
	const [_, others] = splitProps(props, [
		"children",
		"onAccountMenuToggle",
		"open",
	]);

	// Fetch active account
	// NOTE: when createResource is called with only a fetcher function the
	// helper may not return the second control tuple reliably across build
	// configurations. Avoid relying on destructuring the `loading` accessor
	// and instead check the resource value directly (undefined while loading).
	const [activeAccount] = createResource<Account | null>(async () => {
		try {
			return await getActiveAccount();
		} catch (e) {
			console.error("Failed to get active account:", e);
			return null;
		}
	});

	// Fetch player head image
	const [avatarUrl] = createResource(
		() => activeAccount()?.uuid,
		async (uuid) => {
			if (!uuid) return null;
			try {
				const path = await invoke<string>("get_player_head_path", {
					uuid,
					forceDownload: false,
				});
				return convertFileSrc(path);
			} catch (e) {
				console.error("Failed to get player head:", e);
				return null;
			}
		},
	);

	const toggleMenu = () => {
		const newState = !props.open;
		props.onAccountMenuToggle?.(newState);
	};

	return (
		<SidebarButton
			class="sidebar-profile-button"
			onClick={toggleMenu}
			style={{
				"background-image": avatarUrl()
					? `url(${avatarUrl()})`
					: "linear-gradient(to bottom, hsl(0deg 0% 50%), hsl(0deg 0% 30%))",
				"background-size": "cover",
				"background-position": "center",
			}}
			{...others}
		>
			<Show when={activeAccount() === undefined}>
				<div class="profile-loading-spinner" />
			</Show>
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
