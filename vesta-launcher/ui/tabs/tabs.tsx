import { PolymorphicProps } from "@kobalte/core";
import * as TabsPrimitive from "@kobalte/core/tabs";
import { splitProps, type ValidComponent } from "solid-js";
import "./tabs.css";

type TabsRootProps<T extends ValidComponent = "div"> = TabsPrimitive.TabsRootProps<T> & {
	class?: string;
};

export function Tabs<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, TabsRootProps<T>>
) {
	const [local, others] = splitProps(props as TabsRootProps, ["class"]);
	
	return (
		<TabsPrimitive.Root
			class={`tabs ${local.class || ""}`}
			{...others}
		/>
	);
}

type TabsListProps<T extends ValidComponent = "div"> = TabsPrimitive.TabsListProps<T> & {
	class?: string;
};

export function TabsList<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, TabsListProps<T>>
) {
	const [local, others] = splitProps(props as TabsListProps, ["class"]);
	
	return (
		<TabsPrimitive.List
			class={`tabs__list ${local.class || ""}`}
			{...others}
		/>
	);
}

type TabsTriggerProps<T extends ValidComponent = "button"> = TabsPrimitive.TabsTriggerProps<T> & {
	class?: string;
};

export function TabsTrigger<T extends ValidComponent = "button">(
	props: PolymorphicProps<T, TabsTriggerProps<T>>
) {
	const [local, others] = splitProps(props as TabsTriggerProps, ["class"]);
	
	return (
		<TabsPrimitive.Trigger
			class={`tabs__trigger ${local.class || ""}`}
			{...others}
		/>
	);
}

type TabsContentProps<T extends ValidComponent = "div"> = TabsPrimitive.TabsContentProps<T> & {
	class?: string;
};

export function TabsContent<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, TabsContentProps<T>>
) {
	const [local, others] = splitProps(props as TabsContentProps, ["class"]);
	
	return (
		<TabsPrimitive.Content
			class={`tabs__content ${local.class || ""}`}
			{...others}
		/>
	);
}

type TabsIndicatorProps<T extends ValidComponent = "div"> = TabsPrimitive.TabsIndicatorProps<T> & {
	class?: string;
};

export function TabsIndicator<T extends ValidComponent = "div">(
	props: PolymorphicProps<T, TabsIndicatorProps<T>>
) {
	const [local, others] = splitProps(props as TabsIndicatorProps, ["class"]);
	
	return (
		<TabsPrimitive.Indicator
			class={`tabs__indicator ${local.class || ""}`}
			{...others}
		/>
	);
}