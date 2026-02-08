import { cn } from "@utils/ui";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import type {
	SwitchControlProps,
	SwitchThumbProps,
} from "@kobalte/core/switch";
import * as SwitchPrimitive from "@kobalte/core/switch";
import type { ParentProps, ValidComponent, VoidProps } from "solid-js";
import { splitProps } from "solid-js";
import styles from "./switch.module.css";

export const SwitchLabel = SwitchPrimitive.Label;

// Backwards-compatible wrapper: keep supporting <Switch checked=...> while encouraging <Switch.Root>
export function Switch(props: any) {
	return <SwitchPrimitive.Root {...props} onChange={props.onCheckedChange}>{props.children}</SwitchPrimitive.Root>;
}

Object.assign(Switch, SwitchPrimitive);

export const SwitchErrorMessage = SwitchPrimitive.ErrorMessage;
export const SwitchDescription = SwitchPrimitive.Description;

type switchControlProps<T extends ValidComponent = "input"> = ParentProps<
	SwitchControlProps<T> & { class?: string }
>;

export const SwitchControl = <T extends ValidComponent = "input">(
	props: PolymorphicProps<T, switchControlProps<T>>,
) => {
	const [local, rest] = splitProps(props as switchControlProps, [
		"class",
		"children",
	]);

	return (
		<>
			<SwitchPrimitive.Input class={styles.switch__input} />
			<SwitchPrimitive.Control
				class={cn(styles["switch__control"], local.class)}
				{...rest}
			>
				{local.children}
			</SwitchPrimitive.Control>
		</>
	);
};

type switchThumbProps<T extends ValidComponent = "div"> = VoidProps<
	SwitchThumbProps<T> & { class?: string }
>;

export const SwitchThumb = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, switchThumbProps<T>>,
) => {
	const [local, rest] = splitProps(props as switchThumbProps, ["class"]);

	return (
		<SwitchPrimitive.Thumb
			class={cn(styles["switch__thumb"], local.class)}
			{...rest}
		/>
	);
};

