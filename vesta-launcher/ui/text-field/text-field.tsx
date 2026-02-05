import * as TextFieldPrimitive from "@kobalte/core/text-field";
import { PolymorphicProps } from "@kobalte/core/polymorphic";
import { ClassProp } from "@ui/props";
import clsx from "clsx";
import { splitProps, ValidComponent } from "solid-js";
import styles from "./text-field.module.css";

const TextFieldRoot = TextFieldPrimitive.Root;

type TextFieldInputProps = TextFieldPrimitive.TextFieldInputProps & ClassProp;

function TextFieldInput<T extends ValidComponent = "input">(
	props: PolymorphicProps<T, TextFieldInputProps>,
) {
	const [_, rest] = splitProps(props as TextFieldInputProps, ["class"]);

	return (
		<TextFieldPrimitive.Input
			class={clsx(styles["text-field__input"], props.class)}
			{...rest}
		/>
	);
}

type TextFieldAreaProps = TextFieldPrimitive.TextFieldTextAreaProps & ClassProp;

function TextFieldTextArea<T extends ValidComponent = "input">(
	props: PolymorphicProps<T, TextFieldAreaProps>,
) {
	const [_, rest] = splitProps(props as TextFieldAreaProps, ["class"]);

	return (
		<TextFieldPrimitive.TextArea
			class={clsx(styles["text-field__text-area"], props.class)}
			{...rest}
		/>
	);
}

type TextFieldLabelProps = TextFieldPrimitive.TextFieldLabelProps & ClassProp;

function TextFieldLabel<T extends "label">(
	props: PolymorphicProps<T, TextFieldLabelProps>,
) {
	const [_, rest] = splitProps(props as TextFieldLabelProps, ["class"]);

	return (
		<TextFieldPrimitive.Label
			class={clsx(styles["text-field__label"], props.class)}
			{...rest}
		/>
	);
}

type TextFieldDescriptionProps = TextFieldPrimitive.TextFieldDescriptionProps &
	ClassProp;

function TextFieldDescription<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, TextFieldDescriptionProps>,
) {
	const [_, rest] = splitProps(props as TextFieldDescriptionProps, ["class"]);

	return (
		<TextFieldPrimitive.Description
			class={clsx(styles["text-field__description"], props.class)}
			{...rest}
		/>
	);
}

type TextFieldErrorMessageProps = TextFieldPrimitive.TextFieldErrorMessageProps;

function TextFieldErrorMessage<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, TextFieldErrorMessageProps>,
) {
	const [_, rest] = splitProps(props as TextFieldErrorMessageProps, []);

	return (
		<TextFieldPrimitive.ErrorMessage
			class={styles["text-field__error-message"]}
			{...rest}
		/>
	);
}

export type TextFieldProps = TextFieldPrimitive.TextFieldRootProps & {
	placeholder?: string;
	onInput?: (e: any) => void;
    onFocus?: (e: any) => void;
    onBlur?: (e: any) => void;
	class?: string;
};

export function TextField(props: TextFieldProps) {
	const [local, rest] = splitProps(props, ["placeholder", "onInput", "class", "onFocus", "onBlur"]);
	return (
		<TextFieldRoot class={clsx(styles["text-field"], local.class)} {...rest}>
			<TextFieldInput 
                placeholder={local.placeholder} 
                onInput={local.onInput} 
                onFocus={local.onFocus}
                onBlur={local.onBlur}
            />
		</TextFieldRoot>
	);
}

export {
	TextFieldRoot,
	TextFieldInput,
	TextFieldTextArea,
	TextFieldLabel,
	TextFieldDescription,
	TextFieldErrorMessage,
};
