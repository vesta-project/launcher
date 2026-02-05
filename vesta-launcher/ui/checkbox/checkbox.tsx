import * as CheckboxPrimitive from "@kobalte/core/checkbox";
import { PolymorphicProps } from "@kobalte/core/polymorphic";
import clsx from "clsx";
import { Match, Switch, splitProps, ValidComponent } from "solid-js";
import styles from "./checkbox.module.css";

// Props for Checkbox root
export type CheckboxRootProps<T extends ValidComponent = "div"> =
	CheckboxPrimitive.CheckboxRootProps<T> & { 
		class?: string; 
		children?: any;
		onCheckedChange?: (checked: boolean) => void;
	};

export function Checkbox<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, CheckboxRootProps<T>>,
) {
	const [local, others] = splitProps(props as any, [
		"class",
		"children",
	]);
	return (
		<CheckboxPrimitive.Root
			class={clsx(styles["checkbox"], local.class)}
			{...others}
		>
			<CheckboxPrimitive.Input class={styles["checkbox__input"]} />
			<CheckboxPrimitive.Control class={styles["checkbox__control"]}>
				<CheckboxPrimitive.Indicator>
					<Switch>
						<Match when={others.indeterminate}>
							<svg
								viewBox="0 0 24 24"
								class={styles["checkbox__icon"]}
								aria-hidden="true"
							>
								<rect x="5" y="11" width="14" height="2" rx="1" fill="currentColor" />
							</svg>
						</Match>
						<Match when={others.checked}>
							<svg
								viewBox="0 0 24 24"
								class={styles["checkbox__icon"]}
								aria-hidden="true"
							>
								<polyline
									points="5 12 10 17 19 7"
									stroke="currentColor"
									stroke-width="2"
									fill="none"
								/>
							</svg>
						</Match>
						<Match when={!others.checked && !others.indeterminate}>
							<svg
								viewBox="0 0 24 24"
								class={styles["checkbox__icon"]}
								aria-hidden="true"
							>
								<rect
									x="4"
									y="4"
									width="16"
									height="16"
									rx="4"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
								/>
							</svg>
						</Match>
					</Switch>
				</CheckboxPrimitive.Indicator>
			</CheckboxPrimitive.Control>
			{local.children}
		</CheckboxPrimitive.Root>
	);
}

// Checkbox group/fieldset support
export type CheckboxGroupProps = {
	class?: string;
	children?: any;
	label?: string;
};

export function CheckboxGroup(props: CheckboxGroupProps) {
	return (
		<fieldset class={clsx(styles["checkbox-group"], props.class)}>
			{props.label && (
				<legend class={styles["checkbox-group__label"]}>{props.label}</legend>
			)}
			<div class={styles["checkbox-group__items"]}>{props.children}</div>
		</fieldset>
	);
}
