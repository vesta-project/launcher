// SearchIcon not used in this file; removed import.
import { Button } from "@kobalte/core/button";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
	Tooltip,
	TooltipContent,
	TooltipPlacement,
	TooltipTrigger,
} from "@ui/tooltip/tooltip";
import { type Account, getActiveAccount } from "@utils/auth";
import { onConfigUpdate } from "@utils/config-sync";
import clsx from "clsx";
import {
	type ComponentProps,
	children,
	createEffect,
	createResource,
	createSignal,
	mergeProps,
	onCleanup,
	Show,
	splitProps,
} from "solid-js";
import styles from "./sidebar-buttons.module.css";

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
				class={clsx(styles["sidebar-button"], local.class)}
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

	const [avatarTimestamp, setAvatarTimestamp] = createSignal(Date.now());

	// Fetch active account
	// NOTE: when createResource is called with only a fetcher function the
	// helper may not return the second control tuple reliably across build
	// configurations. Avoid relying on destructuring the `loading` accessor
	// and instead check the resource value directly (undefined while loading).
	const [activeAccount, { refetch }] = createResource<Account | null>(
		async () => {
			try {
				return await getActiveAccount();
			} catch (e) {
				console.error("Failed to get active account:", e);
				return null;
			}
		},
	);

	// Listen for config updates to refetch active account
	createEffect(() => {
		const unsubscribe = onConfigUpdate((field) => {
			if (field === "active_account_uuid") {
				refetch();
			}
		});
		onCleanup(unsubscribe);
	});

	// Listen for head updates from backend
	createEffect(() => {
		let unlisten: (() => void) | undefined;
		listen("core://account-heads-updated", () => {
			setAvatarTimestamp(Date.now());
		}).then((fn) => {
			unlisten = fn;
		});

		onCleanup(() => unlisten?.());
	});

	// Fetch player head image
	const [avatarUrl] = createResource(
		() => ({ uuid: activeAccount()?.uuid, t: avatarTimestamp() }),
		async ({ uuid }) => {
			if (!uuid) return null;
			try {
				const path = await invoke<string>("get_player_head_path", {
					playerUuid: uuid,
					forceDownload: false,
				});
				return `${convertFileSrc(path)}?t=${avatarTimestamp()}`;
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
			class={styles["sidebar-profile-button"]}
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
				<div class={styles["profile-loading-spinner"]} />
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
		<SidebarButton class={styles["sidebar-action-button"]} {...others}>
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
