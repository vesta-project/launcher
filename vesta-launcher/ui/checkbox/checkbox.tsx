import * as CheckboxPrimitive from "@kobalte/core/checkbox";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import CheckIcon from "@assets/icons/controls/check.svg";
import MinusIcon from "@assets/icons/controls/minus.svg";
import clsx from "clsx";
import { Match, Switch, splitProps, type ValidComponent } from "solid-js";
import styles from "./checkbox.module.css";

// Props for Checkbox root
export type CheckboxRootProps<T extends ValidComponent = "div"> =
	CheckboxPrimitive.CheckboxRootProps<T> & {
		class?: string;
	};

export function Checkbox<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, CheckboxRootProps<T>>,
) {
	const [local, others] = splitProps(props as any, ["class"]);

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
							<MinusIcon class={styles["checkbox__icon"]} aria-hidden="true" />
						</Match>
						<Match when={others.checked}>
							<CheckIcon class={styles["checkbox__icon"]} aria-hidden="true" />
						</Match>
					</Switch>
				</CheckboxPrimitive.Indicator>
			</CheckboxPrimitive.Control>
		</CheckboxPrimitive.Root>
	);
}
