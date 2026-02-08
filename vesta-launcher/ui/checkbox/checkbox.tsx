import * as CheckboxPrimitive from "@kobalte/core/checkbox";
import { PolymorphicProps } from "@kobalte/core/polymorphic";
import clsx from "clsx";
import { Match, Switch, splitProps, ValidComponent } from "solid-js";
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
							<svg
								viewBox="0 0 24 24"
								class={styles["checkbox__icon"]}
								aria-hidden="true"
							>
								<path d="M5 12h14" stroke="currentColor" stroke-width="2" />
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
					</Switch>
				</CheckboxPrimitive.Indicator>
			</CheckboxPrimitive.Control>
		</CheckboxPrimitive.Root>
	);
}



