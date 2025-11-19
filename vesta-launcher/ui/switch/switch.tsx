import { splitProps, type JSX, type ValidComponent } from "solid-js";
import * as SwitchPrimitive from "@kobalte/core/switch";
import { type PolymorphicProps } from "@kobalte/core/polymorphic";
import clsx from "clsx";
import "./switch.css";

// Root switch component (alias to primitive)
const Switch = SwitchPrimitive.Root;

// Switch Control (contains Input + Control wrapper)
type SwitchControlProps = SwitchPrimitive.SwitchControlProps & {
	class?: string;
	children?: JSX.Element;
};

const SwitchControl = <T extends ValidComponent = "input">(
	props: PolymorphicProps<T, SwitchControlProps>
) => {
	const [local, others] = splitProps(props as SwitchControlProps, [
		"class",
		"children",
	]);

	return (
		<>
			<SwitchPrimitive.Input class="switch__input" />
			<SwitchPrimitive.Control
				class={clsx("switch__control", local.class)}
				{...others}
			>
				{local.children}
			</SwitchPrimitive.Control>
		</>
	);
};

// Switch Thumb
type SwitchThumbProps = SwitchPrimitive.SwitchThumbProps & {
	class?: string;
};

const SwitchThumb = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, SwitchThumbProps>
) => {
	const [local, others] = splitProps(props as SwitchThumbProps, ["class"]);

	return (
		<SwitchPrimitive.Thumb
			class={clsx("switch__thumb", local.class)}
			{...others}
		/>
	);
};

// Switch Label
type SwitchLabelProps = SwitchPrimitive.SwitchLabelProps & {
	class?: string;
};

const SwitchLabel = <T extends ValidComponent = "label">(
	props: PolymorphicProps<T, SwitchLabelProps>
) => {
	const [local, others] = splitProps(props as SwitchLabelProps, ["class"]);

	return (
		<SwitchPrimitive.Label
			class={clsx("switch__label", local.class)}
			{...others}
		/>
	);
};

// Re-export Description and ErrorMessage from Kobalte
const SwitchDescription = SwitchPrimitive.Description;
const SwitchErrorMessage = SwitchPrimitive.ErrorMessage;

export {
	Switch,
	SwitchControl,
	SwitchThumb,
	SwitchLabel,
	SwitchDescription,
	SwitchErrorMessage,
};
