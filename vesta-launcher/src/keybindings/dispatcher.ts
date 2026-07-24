import { commandHandlers } from "./catalog";
import {
	dispatchKeybinding as dispatchKeybindingCore,
	isEditableTarget,
} from "./dispatcher-core";
import { keybindingCommands } from "./store";

export function installKeybindingDispatcher(): () => void {
	const listener = (event: KeyboardEvent) => {
		dispatchKeybindingCore(event, keybindingCommands(), commandHandlers);
	};
	window.addEventListener("keydown", listener);
	return () => window.removeEventListener("keydown", listener);
}

export { isEditableTarget };
