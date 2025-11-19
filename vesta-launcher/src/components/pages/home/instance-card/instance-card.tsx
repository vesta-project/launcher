import FabricLogo from "@assets/fabric-logo.svg";
import ForgeLogo from "@assets/forge-logo.svg";
import NeoForgeLogo from "@assets/neoforge-logo.svg";
import PlayIcon from "@assets/play.svg";
import QuiltLogo from "@assets/quilt-logo.svg";
import * as webview from "@tauri-apps/api/webview";
import LauncherButton from "@ui/button/button";
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuGroupLabel,
	ContextMenuItem,
	ContextMenuItemLabel,
	ContextMenuLabel,
	ContextMenuPortal,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import {
	ComponentProps,
	Match,
	Show,
	Switch,
	createSignal,
	mergeProps,
	onCleanup,
} from "solid-js";
import "./instance-card.css";

interface InstanceCardProps {
	modloader?: "vanilla" | "forge" | "neoforge" | "fabric" | "quilt";
}

function InstanceCard(p: InstanceCardProps) {
	const [hover, setHover] = createSignal(false);
	const props = mergeProps({ modloader: "vanilla" }, p);

	// async function wait() {
	// 	const unlisten = await webview.getCurrent().onDragDropEvent((event) => {
	// 		if (event.payload.type === "dragged") {
	// 			console.log("User hovering", event.payload.paths);
	// 		} else if (event.payload.type === "dropped") {
	// 			console.log("User dropped", event.payload.paths);
	// 		} else {
	// 			console.log("File drop cancelled");
	// 		}
	// 	});

	// 	onCleanup(() => unlisten());
	// }

	// wait();

	return (
		<ContextMenu>
			<ContextMenuTrigger
				as={"div"}
				class={"instance-card"}
				onMouseOver={() => setHover(true)}
				onMouseLeave={() => setHover(false)}
			>
				<div class={"instance-card-top"}>
					<Show when={hover()} fallback={""}>
						<button class={"play-button"}>
							<PlayIcon />
						</button>
					</Show>
				</div>
				<div class={"instance-card-bottom"}>
					<h1>Instance Name</h1>
					<div class={"instance-card-bottom-version"}>
						{/*Game Version*/}
						<p>1.20</p>
						{/*Modloader*/}
						<div class={"instance-card-bottom-version-modloader"}>
							<Switch fallback={""}>
								<Match when={props.modloader === "forge"}>
									<ForgeLogo />
								</Match>
								<Match when={props.modloader === "neoforge"}>
									<NeoForgeLogo />
								</Match>
								<Match when={props.modloader === "fabric"}>
									<FabricLogo />
								</Match>
								<Match when={props.modloader === "quilt"}>
									<QuiltLogo />
								</Match>
							</Switch>
							<p style={{ "text-transform": "capitalize" }}>
								{props.modloader}
							</p>
						</div>
					</div>
				</div>
			</ContextMenuTrigger>

			<ContextMenuPortal>
				<ContextMenuContent>
					<ContextMenuLabel>Hmm</ContextMenuLabel>
					<ContextMenuSeparator />
					<ContextMenuItem>
						Profile <ContextMenuShortcut>Ctrl-C</ContextMenuShortcut>
					</ContextMenuItem>
					<ContextMenuItem>Billing</ContextMenuItem>
					<ContextMenuItem>Team</ContextMenuItem>
					<ContextMenuItem>Subscription</ContextMenuItem>
					<ContextMenuRadioGroup>
						<ContextMenuRadioItem value={"1"}>Something</ContextMenuRadioItem>
						<ContextMenuRadioItem value={"2"}>Something</ContextMenuRadioItem>
						<ContextMenuRadioItem value={"3"}>Something</ContextMenuRadioItem>
						<ContextMenuRadioItem value={"4"}>Something</ContextMenuRadioItem>
					</ContextMenuRadioGroup>
					<ContextMenuCheckboxItem>Checkbox</ContextMenuCheckboxItem>
					<ContextMenuSub>
						<ContextMenuSubTrigger>More</ContextMenuSubTrigger>
						<ContextMenuSubContent>
							<ContextMenuItem>More</ContextMenuItem>
							<ContextMenuItem>More</ContextMenuItem>
							<ContextMenuItem>More</ContextMenuItem>
						</ContextMenuSubContent>
					</ContextMenuSub>
					<ContextMenuSeparator />
					<ContextMenuGroup>
						<ContextMenuGroupLabel>Group</ContextMenuGroupLabel>
						<ContextMenuItem>Group Item</ContextMenuItem>
						<ContextMenuItem>Group Item</ContextMenuItem>
						<ContextMenuItem>Group Item</ContextMenuItem>
					</ContextMenuGroup>
				</ContextMenuContent>
			</ContextMenuPortal>
		</ContextMenu>
	);
}

export default InstanceCard;
