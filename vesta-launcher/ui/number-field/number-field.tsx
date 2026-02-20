import * as NumberFieldPrimitive from "@kobalte/core/number-field";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import type { Component, ComponentProps, JSX, ValidComponent } from "solid-js";
import { Show, splitProps } from "solid-js";
import styles from "./number-field.module.css";

const NumberField = NumberFieldPrimitive.Root;

const NumberFieldGroup: Component<ComponentProps<"div">> = (props) => {
	const [local, others] = splitProps(props, ["class", "classList"]);
	return (
		<div
			class={`${styles["number-field__group"]} ${local.class || ""}`}
			{...others}
		/>
	);
};

type NumberFieldLabelProps<T extends ValidComponent = "label"> =
	NumberFieldPrimitive.NumberFieldLabelProps<T> & {
		class?: string | undefined;
	};

const NumberFieldLabel = <T extends ValidComponent = "label">(
	props: PolymorphicProps<T, NumberFieldLabelProps<T>>,
) => {
	const [local, others] = splitProps(props as NumberFieldLabelProps, ["class"]);
	return (
		<NumberFieldPrimitive.Label
			class={`${styles["number-field__label"]} ${local.class || ""}`}
			{...others}
		/>
	);
};

type NumberFieldInputProps<T extends ValidComponent = "input"> =
	NumberFieldPrimitive.NumberFieldInputProps<T> & {
		class?: string | undefined;
	};

const NumberFieldInput = <T extends ValidComponent = "input">(
	props: PolymorphicProps<T, NumberFieldInputProps<T>>,
) => {
	const [local, others] = splitProps(props as NumberFieldInputProps, ["class"]);
	return (
		<NumberFieldPrimitive.Input
			class={`${styles["number-field__input"]} ${local.class || ""}`}
			{...others}
		/>
	);
};

type NumberFieldIncrementTriggerProps<T extends ValidComponent = "button"> =
	NumberFieldPrimitive.NumberFieldIncrementTriggerProps<T> & {
		class?: string | undefined;
		children?: JSX.Element;
	};

const NumberFieldIncrementTrigger = <T extends ValidComponent = "button">(
	props: PolymorphicProps<T, NumberFieldIncrementTriggerProps<T>>,
) => {
	const [local, others] = splitProps(
		props as NumberFieldIncrementTriggerProps,
		["class", "children"],
	);
	return (
		<NumberFieldPrimitive.IncrementTrigger
			class={`${styles["number-field__increment-trigger"]} ${local.class || ""}`}
			{...others}
		>
			<Show
				when={local.children}
				fallback={
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M18 15l-6-6-6 6" />
					</svg>
				}
			>
				{(children) => children()}
			</Show>
		</NumberFieldPrimitive.IncrementTrigger>
	);
};

type NumberFieldDecrementTriggerProps<T extends ValidComponent = "button"> =
	NumberFieldPrimitive.NumberFieldDecrementTriggerProps<T> & {
		class?: string | undefined;
		children?: JSX.Element;
	};

const NumberFieldDecrementTrigger = <T extends ValidComponent = "button">(
	props: PolymorphicProps<T, NumberFieldDecrementTriggerProps<T>>,
) => {
	const [local, others] = splitProps(
		props as NumberFieldDecrementTriggerProps,
		["class", "children"],
	);
	return (
		<NumberFieldPrimitive.DecrementTrigger
			class={`${styles["number-field__decrement-trigger"]} ${local.class || ""}`}
			{...others}
		>
			<Show
				when={local.children}
				fallback={
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M6 9l6 6 6-6" />
					</svg>
				}
			>
				{(children) => children()}
			</Show>
		</NumberFieldPrimitive.DecrementTrigger>
	);
};

type NumberFieldDescriptionProps<T extends ValidComponent = "div"> =
	NumberFieldPrimitive.NumberFieldDescriptionProps<T> & {
		class?: string | undefined;
	};

const NumberFieldDescription = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, NumberFieldDescriptionProps<T>>,
) => {
	const [local, others] = splitProps(props as NumberFieldDescriptionProps, [
		"class",
	]);
	return (
		<NumberFieldPrimitive.Description
			class={`${styles["number-field__description"]} ${local.class || ""}`}
			{...others}
		/>
	);
};

type NumberFieldErrorMessageProps<T extends ValidComponent = "div"> =
	NumberFieldPrimitive.NumberFieldErrorMessageProps<T> & {
		class?: string | undefined;
	};

const NumberFieldErrorMessage = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, NumberFieldErrorMessageProps<T>>,
) => {
	const [local, others] = splitProps(props as NumberFieldErrorMessageProps, [
		"class",
	]);
	return (
		<NumberFieldPrimitive.ErrorMessage
			class={`${styles["number-field__error-message"]} ${local.class || ""}`}
			{...others}
		/>
	);
};

export {
	NumberField,
	NumberFieldGroup,
	NumberFieldLabel,
	NumberFieldInput,
	NumberFieldIncrementTrigger,
	NumberFieldDecrementTrigger,
	NumberFieldDescription,
	NumberFieldErrorMessage,
};
