import { PolymorphicProps } from "@kobalte/core";
import * as ToastPrimitive from "@kobalte/core/toast";
import { NotificationItem } from "@ui/notification/notification-item";
import { ClassProp } from "@ui/props";
import {
	NotificationAction,
	NotificationSeverity,
	NotificationType,
} from "@utils/notifications";
import clsx from "clsx";
import { splitProps, ValidComponent } from "solid-js";
import { Portal } from "solid-js/web";
import styles from "./toast.module.css";

type ToastListProps = ToastPrimitive.ToastListProps & ClassProp;

function Toaster<T extends ValidComponent = "ol">(
	props: PolymorphicProps<T, ToastListProps>,
) {
	const [local, others] = splitProps(props as ToastListProps, ["class"]);

	return (
		<Portal>
			<ToastPrimitive.Region limit={5} swipeDirection={"left"}>
				<ToastPrimitive.List
					class={clsx(styles["toast__list"], local.class)}
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

	return (
		<ToastPrimitive.Root
			class={clsx(styles["toast"], local.class)}
			{...others}
		/>
	);
}

interface ShowToastProps {
	title?: string;
	description?: string;
	duration?: number;
	onToastForceClose?: (id: number) => void;
	onToastDismiss?: (id: number) => void;
	priority?: "high" | "low";
	severity?: NotificationSeverity;
	notification_type?: NotificationType;
	progress?: number | null;
	current_step?: number | null;
	total_steps?: number | null;
	dismissible?: boolean;
	actions?: NotificationAction[];
	onAction?: (actionId: string, payload?: any) => void;
}

function showToast(props: ShowToastProps) {
	return ToastPrimitive.toaster.show((data) => {
		return (
			<Toast
				toastId={data.toastId}
				duration={props.duration}
				onSwipeEnd={() => props.onToastForceClose?.(data.toastId)}
				onEscapeKeyDown={() => props.onToastForceClose?.(data.toastId)}
				priority={props.priority}
			>
				<NotificationItem
					id={data.toastId}
					title={props.title}
					description={props.description}
					progress={props.progress}
					current_step={props.current_step}
					total_steps={props.total_steps}
					severity={props.severity}
					notification_type={props.notification_type}
					dismissible={props.dismissible}
					actions={props.actions}
					isToast={true}
					onAction={(actionId, payload) => props.onAction?.(actionId, payload)}
					onDismiss={() => {
						props.onToastDismiss?.(data.toastId);
						ToastPrimitive.toaster.dismiss(data.toastId);
					}}
				/>
			</Toast>
		);
	});
}

function updateToast(id: number, props: ShowToastProps) {
	ToastPrimitive.toaster.update(id, (data) => {
		return (
			<Toast
				toastId={data.toastId}
				duration={props.duration}
				onSwipeEnd={() => props.onToastForceClose?.(data.toastId)}
				onEscapeKeyDown={() => props.onToastForceClose?.(data.toastId)}
				priority={props.priority}
			>
				<NotificationItem
					id={data.toastId}
					title={props.title}
					description={props.description}
					progress={props.progress}
					current_step={props.current_step}
					total_steps={props.total_steps}
					severity={props.severity}
					notification_type={props.notification_type}
					dismissible={props.dismissible}
					actions={props.actions}
					isToast={true}
					onAction={(actionId, payload) => props.onAction?.(actionId, payload)}
					onDismiss={() => {
						props.onToastDismiss?.(data.toastId);
						ToastPrimitive.toaster.dismiss(data.toastId);
					}}
				/>
			</Toast>
		);
	});
}

function tryRemoveToast(id: number) {
	try {
		ToastPrimitive.toaster.dismiss(id);
	} catch {
		// Ignore
	}
}

const clearToasts = ToastPrimitive.toaster.clear;

export { Toaster, Toast, showToast, updateToast, tryRemoveToast, clearToasts };
