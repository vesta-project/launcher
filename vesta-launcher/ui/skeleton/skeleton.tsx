import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SkeletonPrimitive from "@kobalte/core/skeleton";
import clsx from "clsx";
import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";
import styles from "./skeleton.module.css";

type SkeletonRootProps<T extends ValidComponent = "div"> =
	SkeletonPrimitive.SkeletonRootProps<T> & { class?: string | undefined };

function Skeleton<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, SkeletonRootProps<T>>,
) {
	const [local, others] = splitProps(props as SkeletonRootProps, ["class"]);

	return (
		<SkeletonPrimitive.Root class={clsx(styles["skeleton"], local.class)} {...others} />
	);
}

export { Skeleton };
