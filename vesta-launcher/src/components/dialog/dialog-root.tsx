import { type DialogInstance, dialogStore } from "@stores/dialog-store";
import Button from "@ui/button/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ui/dialog/dialog";
import { TextFieldInput, TextFieldRoot } from "@ui/text-field/text-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/select/select";
import { Component, createSignal, For, Show } from "solid-js";

export const DialogRoot: Component = () => {
	return (
		<For each={dialogStore.dialogs}>{(dialog) => <DialogInstanceComponent dialog={dialog} />}</For>
	);
};

const DialogInstanceComponent: Component<{ dialog: DialogInstance }> = (props) => {
	const [inputValue, setInputValue] = createSignal(props.dialog.input?.defaultValue ?? "");
	const [selectValue, setSelectValue] = createSignal(
		props.dialog.defaultSelectOption ?? props.dialog.selectOptions?.[0] ?? "",
	);

	const handleAction = (actionId: string) => {
		const submitValue = props.dialog.selectOptions ? selectValue() : inputValue();
		dialogStore.submit(props.dialog.id, actionId, submitValue);
	};

	const isNonDismissible = () => props.dialog.isBackendGenerated;
	const cancelAction = () => props.dialog.actions.find((a) => a.id === "cancel");
	const primaryAction = () =>
		props.dialog.actions.length > 0 ? props.dialog.actions[props.dialog.actions.length - 1] : null;

	return (
		<Dialog
			open={true}
			onOpenChange={(open) => {
				// Only allow dismissal for non-backend dialogs that have a cancel action
				if (!open && !isNonDismissible() && cancelAction()) {
					handleAction("cancel");
				}
			}}
		>
			<DialogContent hideCloseButton={isNonDismissible()}>
				<DialogHeader>
					<DialogTitle>{props.dialog.title}</DialogTitle>
					<Show when={props.dialog.description}>
						<DialogDescription>{props.dialog.description}</DialogDescription>
					</Show>
				</DialogHeader>

				<Show when={props.dialog.input && !props.dialog.selectOptions}>
					<div style={{ margin: "1rem 0" }}>
						<TextFieldRoot value={inputValue()} onChange={setInputValue}>
							<TextFieldInput
								placeholder={props.dialog.input?.placeholder}
								type={props.dialog.input?.isPassword ? "password" : "text"}
								autofocus
								onKeyDown={(e: KeyboardEvent) => {
									if (e.key === "Enter") {
										const action = primaryAction();
										if (action) handleAction(action.id);
									}
								}}
							/>
						</TextFieldRoot>
					</div>
				</Show>

				<Show when={props.dialog.selectOptions && props.dialog.selectOptions.length > 0}>
					<div style={{ margin: "1rem 0" }}>
						<Select
							value={selectValue()}
							onChange={(value) => setSelectValue(String(value))}
							options={props.dialog.selectOptions!}
							itemComponent={(selectProps) => (
								<SelectItem item={selectProps.item}>{selectProps.item.rawValue}</SelectItem>
							)}
						>
							<SelectTrigger autofocus>
								<SelectValue<string>>{(state) => state.selectedOption() || ""}</SelectValue>
							</SelectTrigger>
							<SelectContent />
						</Select>
					</div>
				</Show>

				<DialogFooter>
					<div
						style={{
							display: "flex",
							"justify-content": "flex-end",
							gap: "0.5rem",
							width: "100%",
						}}
					>
						<For each={props.dialog.actions}>
							{(action) => (
								<Button
									color={action.color}
									variant={action.variant}
									onClick={() => handleAction(action.id)}
								>
									{action.label}
								</Button>
							)}
						</For>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
