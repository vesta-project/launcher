import { PolymorphicProps } from "@kobalte/core";
import * as DialogPrimitive from "@kobalte/core/dialog";
import { ClassProp } from "@ui/props";
import clsx from "clsx";
import {
	Component,
	ComponentProps,
	JSX,
	Show,
	splitProps,
	ValidComponent,
} from "solid-js";
import styles from "./dialog.module.css";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal: Component<DialogPrimitive.DialogPortalProps> = (props) => {
	const [, rest] = splitProps(props, ["children"]);
	return (
		<DialogPrimitive.Portal {...rest}>
			<div class={styles["dialog__portal-container"]}>{props.children}</div>
		</DialogPrimitive.Portal>
	);
};

type DialogOverlayProps<T extends ValidComponent = "div"> =
	DialogPrimitive.DialogOverlayProps<T> & ClassProp;

const DialogOverlay = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DialogOverlayProps<T>>,
) => {
	const [local, rest] = splitProps(props as DialogOverlayProps, ["class"]);
	return (
		<DialogPrimitive.Overlay
			class={clsx(styles["dialog__overlay"], local.class)}
			{...rest}
		/>
	);
};

type DialogContentProps<T extends ValidComponent = "div"> =
	DialogPrimitive.DialogContentProps<T> &
		ClassProp & {
			children?: JSX.Element;
			hideCloseButton?: boolean;
		};

const DialogContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DialogContentProps<T>>,
) => {
	const [local, rest] = splitProps(props as DialogContentProps, [
		"class",
		"children",
		"hideCloseButton",
	]);
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Content
				class={clsx(styles["dialog__content"], local.class)}
				{...rest}
			>
				{local.children}
				<Show when={!local.hideCloseButton}>
					<DialogPrimitive.CloseButton class={styles["dialog__close-btn"]}>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M18 6l-12 12" />
							<path d="M6 6l12 12" />
						</svg>
						<span
							class="sr-only"
							style={{
								position: "absolute",
								width: "1px",
								height: "1px",
								padding: 0,
								margin: "-1px",
								overflow: "hidden",
								clip: "rect(0, 0, 0, 0)",
								"white-space": "nowrap",
								"border-width": 0,
							}}
						>
							Close
						</span>
					</DialogPrimitive.CloseButton>
				</Show>
			</DialogPrimitive.Content>
		</DialogPortal>
	);
};

const DialogHeader: Component<ComponentProps<"div"> & ClassProp> = (props) => {
	const [local, rest] = splitProps(props, ["class"]);
	return <div class={clsx(styles["dialog__header"], local.class)} {...rest} />;
};

const DialogFooter: Component<ComponentProps<"div"> & ClassProp> = (props) => {
	const [local, rest] = splitProps(props, ["class"]);
	return <div class={clsx(styles["dialog__footer"], local.class)} {...rest} />;
};

type DialogTitleProps<T extends ValidComponent = "h2"> =
	DialogPrimitive.DialogTitleProps<T> & ClassProp;

const DialogTitle = <T extends ValidComponent = "h2">(
	props: PolymorphicProps<T, DialogTitleProps<T>>,
) => {
	const [local, rest] = splitProps(props as DialogTitleProps, ["class"]);
	return (
		<DialogPrimitive.Title
			class={clsx(styles["dialog__title"], "selectable", local.class)}
			{...rest}
		/>
	);
};

type DialogDescriptionProps<T extends ValidComponent = "p"> =
	DialogPrimitive.DialogDescriptionProps<T> & ClassProp;

const DialogDescription = <T extends ValidComponent = "p">(
	props: PolymorphicProps<T, DialogDescriptionProps<T>>,
) => {
	const [local, rest] = splitProps(props as DialogDescriptionProps, ["class"]);
	return (
		<DialogPrimitive.Description
			class={clsx(styles["dialog__description"], "selectable", local.class)}
			{...rest}
		/>
	);
};

export {
	Dialog,
	DialogTrigger,
	DialogContent,
	DialogOverlay,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogDescription,
};
