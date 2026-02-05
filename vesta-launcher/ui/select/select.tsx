import type { JSX, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SelectPrimitive from "@kobalte/core/select";
import { ChildrenProp, ClassProp } from "@ui/props";
import clsx from "clsx";
import styles from "./select.module.css";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;
const SelectHiddenSelect = SelectPrimitive.HiddenSelect;

type SelectTriggerProps<T extends ValidComponent = "button"> =
    SelectPrimitive.SelectTriggerProps<T> & ClassProp & ChildrenProp;

const SelectTrigger = <T extends ValidComponent = "button">(
    props: PolymorphicProps<T, SelectTriggerProps<T>>
) => {
    const [local, others] = splitProps(props as SelectTriggerProps, ["class", "children"]);
    return (
        <SelectPrimitive.Trigger
            class={clsx(styles["select__trigger"], local.class)}
            {...others}
        >
            {local.children}
            <SelectPrimitive.Icon
                as="svg"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class={styles["select__icon"]}
            >
                <path d="M8 9l4 -4l4 4" />
                <path d="M16 15l-4 4l-4 -4" />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
    );
};

type SelectContentProps<T extends ValidComponent = "div"> =
    SelectPrimitive.SelectContentProps<T> & ClassProp & ChildrenProp;

const SelectContent = <T extends ValidComponent = "div">(
    props: PolymorphicProps<T, SelectContentProps<T>>
) => {
    const [local, others] = splitProps(props as SelectContentProps, ["class", "children"]);
    return (
        <SelectPrimitive.Portal>
            <SelectPrimitive.Content
                class={clsx(styles["select__content"], local.class)}
                {...others}
            >
                <SelectPrimitive.Listbox class={styles["select__listbox"]}>
                    {local.children as any}
                </SelectPrimitive.Listbox>
            </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
    );
};

type SelectItemProps<T extends ValidComponent = "li"> = SelectPrimitive.SelectItemProps<T> & ClassProp & ChildrenProp;

const SelectItem = <T extends ValidComponent = "li">(
    props: PolymorphicProps<T, SelectItemProps<T>>
) => {
    const [local, others] = splitProps(props as SelectItemProps, ["class", "children"]);
    return (
        <SelectPrimitive.Item
            class={clsx(styles["select__item"], local.class)}
            {...others}
        >
            <SelectPrimitive.ItemLabel>{local.children}</SelectPrimitive.ItemLabel>
            <SelectPrimitive.ItemIndicator class={styles["select__item-indicator"]}>
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
            </SelectPrimitive.ItemIndicator>
        </SelectPrimitive.Item>
    );
};

type SelectLabelProps<T extends ValidComponent = "label"> = SelectPrimitive.SelectLabelProps<T> & ClassProp;

const SelectLabel = <T extends ValidComponent = "label">(
    props: PolymorphicProps<T, SelectLabelProps<T>>
) => {
    const [local, others] = splitProps(props as SelectLabelProps, ["class"]);
    return <SelectPrimitive.Label class={clsx(styles["select__label"], local.class)} {...others} />;
};

type SelectDescriptionProps<T extends ValidComponent = "div"> =
    SelectPrimitive.SelectDescriptionProps<T> & ClassProp;

const SelectDescription = <T extends ValidComponent = "div">(
    props: PolymorphicProps<T, SelectDescriptionProps<T>>
) => {
    const [local, others] = splitProps(props as SelectDescriptionProps, ["class"]);
    return (
        <SelectPrimitive.Description
            class={clsx(styles["select__description"], local.class)}
            {...others}
        />
    );
};

type SelectErrorMessageProps<T extends ValidComponent = "div"> =
    SelectPrimitive.SelectErrorMessageProps<T> & ClassProp;

const SelectErrorMessage = <T extends ValidComponent = "div">(
    props: PolymorphicProps<T, SelectErrorMessageProps<T>>
) => {
    const [local, others] = splitProps(props as SelectErrorMessageProps, ["class"]);
    return (
        <SelectPrimitive.ErrorMessage
            class={clsx(styles["select__error-message"], local.class)}
            {...others}
        />
    );
};

export {
    Select,
    SelectValue,
    SelectHiddenSelect,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectLabel,
    SelectDescription,
    SelectErrorMessage
};
