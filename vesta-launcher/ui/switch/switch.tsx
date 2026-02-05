import * as SwitchPrimitive from "@kobalte/core/switch";
import { type PolymorphicProps } from "@kobalte/core/polymorphic";
import clsx from "clsx";
import { type ValidComponent, splitProps, type JSX } from "solid-js";
import styles from "./switch.module.css";

// Root switch component
export type SwitchRootProps<T extends ValidComponent = "div"> =
	SwitchPrimitive.SwitchRootProps<T> & {
		class?: string;
		children?: any;
		onCheckedChange?: (checked: boolean) => void;
	};

export function Switch<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, SwitchRootProps<T>>,
) {
	const [local, others] = splitProps(props as any, ["class", "children"]);
	return (
		<SwitchPrimitive.Root
			class={clsx(styles.switch, local.class)}
			{...others}
		>
			<SwitchPrimitive.Input class={styles.switch__input} />
			{local.children}
		</SwitchPrimitive.Root>
	);
}

// Switch Control
export type SwitchControlProps<T extends ValidComponent = "div"> = 
	SwitchPrimitive.SwitchControlProps<T> & { class?: string };

export function SwitchControl<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, SwitchControlProps<T>>
) {
	const [local, others] = splitProps(props as any, ["class"]);
	return (
		<SwitchPrimitive.Control
			class={clsx(styles.switch__control, local.class)}
			{...others}
		/>
	);
}

// Switch Thumb
export type SwitchThumbProps<T extends ValidComponent = "div"> = 
	SwitchPrimitive.SwitchThumbProps<T> & { class?: string };

export function SwitchThumb<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, SwitchThumbProps<T>>
) {
	const [local, others] = splitProps(props as any, ["class"]);
	return (
		<SwitchPrimitive.Thumb
			class={clsx(styles.switch__thumb, local.class)}
			{...others}
		/>
	);
}

// Switch Label
export type SwitchLabelProps<T extends ValidComponent = "label"> = 
	SwitchPrimitive.SwitchLabelProps<T> & { class?: string };

export function SwitchLabel<T extends ValidComponent = "label">(
	props: PolymorphicProps<T, SwitchLabelProps<T>>
) {
	const [local, others] = splitProps(props as any, ["class"]);
	return (
		<SwitchPrimitive.Label
			class={clsx(styles.switch__label, local.class)}
			{...others}
		/>
	);
}

export const SwitchDescription = SwitchPrimitive.Description;
export const SwitchErrorMessage = SwitchPrimitive.ErrorMessage;

