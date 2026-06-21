import { PolymorphicProps } from "@kobalte/core";
import * as ToggleGroupPrimitive from "@kobalte/core/toggle-group";
import { getButtonStyleVars, type ButtonColor } from "@ui/button/button-style";
import { ChildrenProp, ClassProp } from "@ui/props";
import clsx from "clsx";
import { splitProps, ValidComponent } from "solid-js";
import styles from "./toggle-group.module.css";

type ToggleGroupRootProps<T extends ValidComponent = "div"> =
	ToggleGroupPrimitive.ToggleGroupRootProps<T> &
	ClassProp &
	ChildrenProp & {
		color?: ButtonColor;
		variant?: "solid" | "outline" | "ghost" | "shadow" | "slate";
	};

function ToggleGroup<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ToggleGroupRootProps<T>>,
) {
	const [local, rest] = splitProps(props as any, ["class", "children", "color", "variant", "style"]);
	const color = local.color || "secondary";
	const buttonVars = getButtonStyleVars(color);
	const isMutedShell = color === "none" || color === "secondary";

	return (
		<ToggleGroupPrimitive.Root
			class={clsx(
				"v-toggle-group",
				styles["toggle-group"],
				styles[`toggle-group--${local.variant || "solid"}`],
				local.class,
			)}
			data-variant={local.variant || "solid"}
			style={(() => {
				const groupVars = {
					"--toggle-group-shell-bg": buttonVars["--button-color"],
					"--toggle-group-shell-border": buttonVars["--button-border"],
					"--toggle-group-shell-fg": buttonVars["--button-text"],
					"--toggle-group-accent": isMutedShell
						? "var(--primary-accent)"
						: buttonVars["--button-color"],
					...(isMutedShell
						? {
								"--toggle-group-selected-fg": "var(--text-primary)",
							}
						: {
								"--toggle-group-selected-bg": `color-mix(in srgb, ${buttonVars["--button-fg"]} 22%, ${buttonVars["--button-color"]})`,
								"--toggle-group-selected-fg": buttonVars["--button-fg"],
							}),
				};

				return typeof local.style === "string"
					? `${Object.entries(groupVars)
							.map(([key, value]) => `${key}: ${value};`)
							.join(" ")} ${local.style}`
					: {
							...groupVars,
							...(local.style as any),
						};
			})()}
			{...rest}
		>
			{local.children}
		</ToggleGroupPrimitive.Root>
	);
}

type ToggleGroupItemProps = ToggleGroupPrimitive.ToggleGroupItemProps &
	ClassProp &
	ChildrenProp & {
		value: string;
		size?: "sm" | "md" | "lg" | "xl" | "icon";
		icon_only?: boolean;
	};

function ToggleGroupItem<T extends ValidComponent = "button">(
	props: PolymorphicProps<T, ToggleGroupItemProps>,
) {
	const [local, rest] = splitProps(props as any, [
		"class",
		"children",
		"value",
		"size",
		"icon_only",
		"aria-label",
		"style",
	]);
	return (
		<ToggleGroupPrimitive.Item
			value={local.value}
			aria-label={local["aria-label"] ?? local.value}
			class={clsx(
				"v-toggle-group__item",
				styles["toggle-group__item"],
				styles[`toggle-group__item--${local.size || "md"}`],
				local.icon_only ? styles["toggle-group__item--icon-only"] : "",
				local.class,
			)}
			style={local.style}
			{...rest}
		>
			{local.children}
		</ToggleGroupPrimitive.Item>
	);
}

export { ToggleGroup, ToggleGroupItem };
