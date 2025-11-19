import { PolymorphicProps } from "@kobalte/core";
import * as ComboboxPrimitive from "@kobalte/core/combobox";
import { ChildrenProp, ClassProp } from "@ui/props";
import clsx from "clsx";
import { Component, ValidComponent, splitProps } from "solid-js";
import "./combobox.css";

const Combobox = ComboboxPrimitive.Combobox;

type ComboboxItemProps = ComboboxPrimitive.ComboboxItemProps & ClassProp;

function ComboboxItem<T extends ValidComponent = "li">(
	props: PolymorphicProps<T, ComboboxItemProps>,
) {
	const [_, rest] = splitProps(props as ComboboxItemProps, ["class"]);

	return (
		<ComboboxPrimitive.Item
			class={clsx("combobox__item", props.class)}
			{...rest}
		/>
	);
}

const ComboboxItemLabel = ComboboxPrimitive.ItemLabel;

type ComboboxItemIndicatorProps = ComboboxPrimitive.ComboboxItemIndicatorProps &
	ChildrenProp;

function ComboboxItemIndicator<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ComboboxItemIndicatorProps>,
) {
	const [_, rest] = splitProps(props as ComboboxItemIndicatorProps, [
		"children",
	]);
	return (
		<ComboboxPrimitive.ItemIndicator {...rest}>
			{props.children ?? (
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="size-4"
				>
					<path d="M5 12l5 5l10 -10" />
				</svg>
			)}
		</ComboboxPrimitive.ItemIndicator>
	);
}

type ComboboxSectionProps = ComboboxPrimitive.ComboboxSectionProps & ClassProp;

function ComboboxSection<T extends ValidComponent = "li">(
	props: PolymorphicProps<T, ComboboxSectionProps>,
) {
	const [_, rest] = splitProps(props as ComboboxSectionProps, ["class"]);
	return (
		<ComboboxPrimitive.Section
			class={clsx("combobox__section", props.class)}
			{...rest}
		/>
	);
}

type ComboboxControlProps<U> = ComboboxPrimitive.ComboboxControlProps<U> &
	ClassProp;

function ComboboxControl<T, U extends ValidComponent = "div">(
	props: PolymorphicProps<U, ComboboxControlProps<T>>,
) {
	const [_, rest] = splitProps(props as ComboboxControlProps<T>, ["class"]);
	return (
		<ComboboxPrimitive.Control
			class={clsx("combobox__control", props.class)}
			{...rest}
		/>
	);
}

type ComboboxInputProps = ComboboxPrimitive.ComboboxInputProps & ClassProp;

function ComboboxInput<T extends ValidComponent = "input">(
	props: PolymorphicProps<T, ComboboxInputProps>,
) {
	const [_, rest] = splitProps(props as ComboboxInputProps, ["class"]);
	return (
		<ComboboxPrimitive.Input
			class={clsx("combobox__input", props.class)}
			{...rest}
		/>
	);
}

const ComboboxHiddenSelect = ComboboxPrimitive.HiddenSelect;

type ComboboxTriggerProps = ComboboxPrimitive.ComboboxTriggerProps &
	ClassProp &
	ChildrenProp;

function ComboboxTrigger<T extends ValidComponent = "button">(
	props: PolymorphicProps<T, ComboboxTriggerProps>,
) {
	const [, rest] = splitProps(props as ComboboxTriggerProps, [
		"class",
		"children",
	]);
	return (
		<ComboboxPrimitive.Trigger
			class={clsx("combobox__trigger", props.class)}
			{...rest}
		>
			<ComboboxPrimitive.Icon>
				{props.children ?? (
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-4"
					>
						<path d="M8 9l4 -4l4 4" />
						<path d="M16 15l-4 4l-4 -4" />
					</svg>
				)}
			</ComboboxPrimitive.Icon>
		</ComboboxPrimitive.Trigger>
	);
}

type ComboboxContentProps = ComboboxPrimitive.ComboboxContentProps & ClassProp;

function ComboboxContent<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ComboboxContentProps>,
) {
	const [, rest] = splitProps(props as ComboboxContentProps, ["class"]);
	return (
		<ComboboxPrimitive.Portal>
			<ComboboxPrimitive.Content
				class={clsx("combobox__content", props.class)}
				{...rest}
			>
				<ComboboxPrimitive.Listbox class="m-0 p-1" />
			</ComboboxPrimitive.Content>
		</ComboboxPrimitive.Portal>
	);
}

export {
	Combobox,
	ComboboxItem,
	ComboboxItemLabel,
	ComboboxItemIndicator,
	ComboboxSection,
	ComboboxControl,
	ComboboxTrigger,
	ComboboxInput,
	ComboboxHiddenSelect,
	ComboboxContent,
};
