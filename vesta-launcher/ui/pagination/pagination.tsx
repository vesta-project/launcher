import * as PaginationPrimitive from "@kobalte/core/pagination";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import ChevronLeftIcon from "@assets/icons/controls/chevron-left.svg";
import ChevronRightIcon from "@assets/icons/controls/chevron-right.svg";
import EllipsisHorizontalIcon from "@assets/icons/controls/ellipsis-horizontal.svg";
import { cn } from "@utils/ui";
import type { JSX, ValidComponent } from "solid-js";
import { Show, splitProps } from "solid-js";
import buttonStyles from "../button/button.module.css";
import styles from "./pagination.module.css";

export const PaginationItems = PaginationPrimitive.Items;

type PaginationRootProps<T extends ValidComponent = "nav"> =
	PaginationPrimitive.PaginationRootProps<T> & { class?: string | undefined };

export const Pagination = <T extends ValidComponent = "nav">(
	props: PolymorphicProps<T, PaginationRootProps<T>>,
) => {
	const [local, others] = splitProps(props as PaginationRootProps, ["class"]);
	return (
		<PaginationPrimitive.Root
			class={cn(styles["pagination-root"], local.class)}
			{...others}
		/>
	);
};

type PaginationItemProps<T extends ValidComponent = "button"> =
	PaginationPrimitive.PaginationItemProps<T> & { class?: string | undefined };

export const PaginationItem = <T extends ValidComponent = "button">(
	props: PolymorphicProps<T, PaginationItemProps<T>>,
) => {
	const [local, others] = splitProps(props as PaginationItemProps, ["class"]);
	return (
		<PaginationPrimitive.Item
			class={cn(
				buttonStyles["launcher-button"],
				buttonStyles["launcher-button--ghost"],
				styles["pagination-item"],
				local.class,
			)}
			{...others}
		/>
	);
};

type PaginationEllipsisProps<T extends ValidComponent = "div"> =
	PaginationPrimitive.PaginationEllipsisProps<T> & {
		class?: string | undefined;
	};

export const PaginationEllipsis = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, PaginationEllipsisProps<T>>,
) => {
	const [local, others] = splitProps(props as PaginationEllipsisProps, [
		"class",
	]);
	return (
		<PaginationPrimitive.Ellipsis
			class={cn(styles["pagination-ellipsis"], local.class)}
			{...others}
		>
			<EllipsisHorizontalIcon class={styles["size-4"]} />
			<span class={styles["sr-only"]}>More pages</span>
		</PaginationPrimitive.Ellipsis>
	);
};

type PaginationPreviousProps<T extends ValidComponent = "button"> =
	PaginationPrimitive.PaginationPreviousProps<T> & {
		class?: string | undefined;
		children?: JSX.Element;
	};

export const PaginationPrevious = <T extends ValidComponent = "button">(
	props: PolymorphicProps<T, PaginationPreviousProps<T>>,
) => {
	const [local, others] = splitProps(props as PaginationPreviousProps, [
		"class",
		"children",
	]);
	return (
		<PaginationPrimitive.Previous
			class={cn(
				buttonStyles["launcher-button"],
				buttonStyles["launcher-button--ghost"],
				styles["pagination-nav-btn"],
				local.class,
			)}
			{...others}
		>
			<Show
				when={local.children}
				fallback={
					<>
						<ChevronLeftIcon class={styles["size-4"]} />
						<span>Previous</span>
					</>
				}
			>
				{(children) => children()}
			</Show>
		</PaginationPrimitive.Previous>
	);
};

type PaginationNextProps<T extends ValidComponent = "button"> =
	PaginationPrimitive.PaginationNextProps<T> & {
		class?: string | undefined;
		children?: JSX.Element;
	};

export const PaginationNext = <T extends ValidComponent = "button">(
	props: PolymorphicProps<T, PaginationNextProps<T>>,
) => {
	const [local, others] = splitProps(props as PaginationNextProps, [
		"class",
		"children",
	]);
	return (
		<PaginationPrimitive.Next
			class={cn(
				buttonStyles["launcher-button"],
				buttonStyles["launcher-button--ghost"],
				styles["pagination-nav-btn"],
				local.class,
			)}
			{...others}
		>
			<Show
				when={local.children}
				fallback={
					<>
						<span>Next</span>
						<ChevronRightIcon class={styles["size-4"]} />
					</>
				}
			>
				{(children) => children()}
			</Show>
		</PaginationPrimitive.Next>
	);
};
