import CloseIcon from "@assets/close.svg";
import { PolymorphicProps } from "@kobalte/core";
import * as ToastPrimitive from "@kobalte/core/toast";
import { Progress } from "@ui/progress/progress";
import { ClassProp } from "@ui/props";
import clsx from "clsx";
import {
	JSX,
	Match,
	Switch,
	ValidComponent,
	onCleanup,
	splitProps,
} from "solid-js";
import { Portal } from "solid-js/web";
import "./toast.css";

type ToastListProps = ToastPrimitive.ToastListProps & ClassProp;

function Toaster<T extends ValidComponent = "ol">(
	props: PolymorphicProps<T, ToastListProps>,
) {
	const [local, others] = splitProps(props as ToastListProps, ["class"]);

	return (
		<Portal>
			<ToastPrimitive.Region limit={5} swipeDirection={"left"}>
				<ToastPrimitive.List
					class={clsx("toast__list", local.class)}
					{...others}
				/>
			</ToastPrimitive.Region>
		</Portal>
	);
}

type ToastRootProps = ToastPrimitive.ToastRootProps & ClassProp;

function Toast<T extends ValidComponent = "li">(
	props: PolymorphicProps<T, ToastRootProps>,
) {
	const [local, others] = splitProps(props as ToastRootProps, ["class"]);

	return <ToastPrimitive.Root class={clsx("toast", local.class)} {...others} />;
}

type ToastCloseButtonProps = ToastPrimitive.ToastCloseButtonProps & ClassProp;

function ToastClose<T extends ValidComponent = "button">(
	props: PolymorphicProps<T, ToastCloseButtonProps>,
) {
	const [local, others] = splitProps(props as ToastCloseButtonProps, ["class"]);
	return (
		<ToastPrimitive.CloseButton
			class={clsx("toast__close-btn", local.class)}
			{...others}
		>
			<CloseIcon />
		</ToastPrimitive.CloseButton>
	);
}

type ToastTitleProps = ToastPrimitive.ToastTitleProps & ClassProp;

function ToastTitle<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ToastTitleProps>,
) {
	const [local, others] = splitProps(props as ToastTitleProps, ["class"]);
	return (
		<ToastPrimitive.Title
			class={clsx("toast__title", local.class)}
			{...others}
		/>
	);
}

type ToastDescriptionProps = ToastPrimitive.ToastDescriptionProps & ClassProp;

function ToastDescription<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ToastDescriptionProps>,
) {
	const [local, others] = splitProps(props as ToastDescriptionProps, ["class"]);
	return (
		<ToastPrimitive.Description
			class={clsx("toast__description", local.class)}
			{...others}
		/>
	);
}

function showToast(props: {
	title?: JSX.Element;
	description?: JSX.Element;
	duration?: number;
	onToastForceClose?: (id: number) => void;
	priority?: "high" | "low";
	severity?: "Info" | "Success" | "Warning" | "Error";
	progress?: number | null;
	current_step?: number | null;
	total_steps?: number | null;
	cancellable?: boolean;
	onCancel?: () => void;
}) {
	return ToastPrimitive.toaster.show((data) => {
		const severityColor = () => {
			if (!props.severity) return "hsl(210 70% 50%)";
			switch (props.severity.toLowerCase()) {
				case "error":
					return "hsl(0 70% 50%)";
				case "warning":
					return "hsl(45 90% 50%)";
				case "success":
					return "hsl(140 70% 50%)";
				default:
					return "hsl(210 70% 50%)";
			}
		};

		return (
			<Toast
				toastId={data.toastId}
				duration={props.duration}
				onSwipeEnd={() => props.onToastForceClose?.(data.toastId)}
				onEscapeKeyDown={() => props.onToastForceClose?.(data.toastId)}
				priority={props.priority}
				class={props.severity ? `toast-${props.severity.toLowerCase()}` : ""}
				style={{
					"border-left": `4px solid ${severityColor()}`,
				}}
			>
				<div style="display: grid; grid-gap: 4px; width: 100%">
					{props.title && <ToastTitle>{props.title}</ToastTitle>}
					{props.description && (
						<ToastDescription>{props.description}</ToastDescription>
					)}
					{props.progress !== null && props.progress !== undefined && (
						<Progress
							progress={props.progress}
							current_step={props.current_step}
							total_steps={props.total_steps}
							severity={
								props.severity
									? (props.severity.toLowerCase() as any)
									: undefined
							}
							class={"toast__progress"}
						/>
					)}
					{props.cancellable && (
						<button 
							class="toast__cancel-btn"
							onClick={() => props.onCancel?.()}
							style={{
								"margin-top": "8px",
								"padding": "4px 8px",
								"background": "rgba(0,0,0,0.1)",
								"border": "1px solid rgba(0,0,0,0.2)",
								"border-radius": "4px",
								"cursor": "pointer",
								"font-size": "0.8rem",
								"width": "fit-content"
							}}
						>
							Cancel
						</button>
					)}
				</div>
				<ToastClose onClick={() => props.onToastForceClose?.(data.toastId)} />
			</Toast>
		);
	});
}

function updateToast(id: number, props: {
	title?: JSX.Element;
	description?: JSX.Element;
	duration?: number;
	onToastForceClose?: (id: number) => void;
	priority?: "high" | "low";
	severity?: "Info" | "Success" | "Warning" | "Error";
	progress?: number | null;
	current_step?: number | null;
	total_steps?: number | null;
	cancellable?: boolean;
	onCancel?: () => void;
}) {
	ToastPrimitive.toaster.update(id, (data) => {
		const severityColor = () => {
			if (!props.severity) return "hsl(210 70% 50%)";
			switch (props.severity.toLowerCase()) {
				case "error":
					return "hsl(0 70% 50%)";
				case "warning":
					return "hsl(45 90% 50%)";
				case "success":
					return "hsl(140 70% 50%)";
				default:
					return "hsl(210 70% 50%)";
			}
		};

		return (
			<Toast
				toastId={data.toastId}
				duration={props.duration}
				onSwipeEnd={() => props.onToastForceClose?.(data.toastId)}
				onEscapeKeyDown={() => props.onToastForceClose?.(data.toastId)}
				priority={props.priority}
				class={props.severity ? `toast-${props.severity.toLowerCase()}` : ""}
				style={{
					"border-left": `4px solid ${severityColor()}`,
				}}
			>
				<div style="display: grid; grid-gap: 4px; width: 100%">
					{props.title && <ToastTitle>{props.title}</ToastTitle>}
					{props.description && (
						<ToastDescription>{props.description}</ToastDescription>
					)}
					{props.progress !== null && props.progress !== undefined && (
						<Progress
							progress={props.progress}
							current_step={props.current_step}
							total_steps={props.total_steps}
							severity={
								props.severity
									? (props.severity.toLowerCase() as any)
									: undefined
							}
							class={"toast__progress"}
						/>
					)}
					{props.cancellable && (
						<button 
							class="toast__cancel-btn"
							onClick={() => props.onCancel?.()}
							style={{
								"margin-top": "8px",
								"padding": "4px 8px",
								"background": "rgba(0,0,0,0.1)",
								"border": "1px solid rgba(0,0,0,0.2)",
								"border-radius": "4px",
								"cursor": "pointer",
								"font-size": "0.8rem",
								"width": "fit-content"
							}}
						>
							Cancel
						</button>
					)}
				</div>
				<ToastClose onClick={() => props.onToastForceClose?.(data.toastId)} />
			</Toast>
		);
	});
}

const clearToasts = ToastPrimitive.toaster.clear;

function tryRemoveToast(id: number) {
	ToastPrimitive.toaster.dismiss(id);
}

/*function showToastPromise<T, U>(
	promise: Promise<T> | (() => Promise<T>),
	options: {
		loading?: JSX.Element;
		success?: (data: T) => JSX.Element;
		error?: (error: U) => JSX.Element;
		duration?: number;
	},
) {
	return ToastPrimitive.toaster.promise<T, U>(promise, (props) => (
		<Toast toastId={props.toastId} duration={options.duration}>
			<Switch>
				<Match when={props.state === "pending"}>{options.loading}</Match>
				<Match when={props.state === "fulfilled"}>
					{options.success?.(props.data!)}
				</Match>
				<Match when={props.state === "rejected"}>
					{options.error?.(props.error)}
				</Match>
			</Switch>
		</Toast>
	));
}*/

export {
	Toaster,
	Toast,
	ToastClose,
	ToastTitle,
	ToastDescription,
	showToast,
	updateToast,
	clearToasts,
	tryRemoveToast,
};
