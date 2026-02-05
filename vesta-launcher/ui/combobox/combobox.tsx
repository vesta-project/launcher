import { PolymorphicProps } from "@kobalte/core";
import * as ComboboxPrimitive from "@kobalte/core/combobox";
import { ChildrenProp, ClassProp } from "@ui/props";
import clsx from "clsx";
import { Component, splitProps, ValidComponent } from "solid-js";
import styles from "./combobox.module.css";

const Combobox = ComboboxPrimitive.Combobox;

type ComboboxItemProps<T extends ValidComponent = "li"> = ComboboxPrimitive.ComboboxItemProps<T> & ClassProp & ChildrenProp;

function ComboboxItem<T extends ValidComponent = "li">(
	props: PolymorphicProps<T, ComboboxItemProps<T>>,
) {
	const [local, rest] = splitProps(props as ComboboxItemProps, ["class", "children"]);

	return (
		<ComboboxPrimitive.Item
			class={clsx(styles["combobox__item"], local.class)}
			{...rest}
		>
			<ComboboxPrimitive.ItemLabel>{local.children}</ComboboxPrimitive.ItemLabel>
			<ComboboxItemIndicator />
		</ComboboxPrimitive.Item>
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
					class={styles["size-4"]}
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
			class={clsx(styles["combobox__section"], props.class)}
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
			class={clsx(styles["combobox__control"], props.class)}
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
			class={clsx(styles["combobox__input"], props.class)}
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
			class={clsx(styles["combobox__trigger"], props.class)}
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
						class={styles["size-4"]}
					>
						<path d="M8 9l4 -4l4 4" />
						<path d="M16 15l-4 4l-4 -4" />
					</svg>
				)}
			</ComboboxPrimitive.Icon>
		</ComboboxPrimitive.Trigger>
	);
}

type ComboboxContentProps<T extends ValidComponent = "div"> = ComboboxPrimitive.ComboboxContentProps<T> & ClassProp & ChildrenProp;

function ComboboxContent<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ComboboxContentProps<T>>,
) {
	const [local, rest] = splitProps(props as ComboboxContentProps, ["class", "children"]);
	return (
		<ComboboxPrimitive.Portal>
			<ComboboxPrimitive.Content
				class={clsx(styles["combobox__content"], styles["relative"], styles["z-50"], local.class)}
				{...rest}
			>
				<ComboboxPrimitive.Listbox class={styles["combobox__listbox"]}>
					{local.children as any}
				</ComboboxPrimitive.Listbox>
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
