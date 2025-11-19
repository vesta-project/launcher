import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SkeletonPrimitive from "@kobalte/core/skeleton";

import clsx from "clsx";
import "./skeleton.css";

type SkeletonRootProps<T extends ValidComponent = "div"> =
	SkeletonPrimitive.SkeletonRootProps<T> & { class?: string | undefined };

function Skeleton<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, SkeletonRootProps<T>>,
) {
	const [local, others] = splitProps(props as SkeletonRootProps, ["class"]);

	return (
		<SkeletonPrimitive.Root class={clsx("skeleton", local.class)} {...others} />
	);
}

export { Skeleton };
