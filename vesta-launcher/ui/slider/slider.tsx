import { type PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SliderPrimitive from "@kobalte/core/slider";
import clsx from "clsx";
import { splitProps, type ValidComponent } from "solid-js";
import "./slider.css";

// Root slider component
const Slider = SliderPrimitive.Root;

// Slider Track
type SliderTrackProps = SliderPrimitive.SliderTrackProps & {
	class?: string;
};

const SliderTrack = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, SliderTrackProps>,
) => {
	const [local, others] = splitProps(props as SliderTrackProps, ["class"]);

	return (
		<SliderPrimitive.Track
			class={clsx("slider__track", local.class)}
			{...others}
		/>
	);
};

// Slider Fill
type SliderFillProps = SliderPrimitive.SliderFillProps & {
	class?: string;
};

const SliderFill = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, SliderFillProps>,
) => {
	const [local, others] = splitProps(props as SliderFillProps, ["class"]);

	return (
		<SliderPrimitive.Fill
			class={clsx("slider__fill", local.class)}
			{...others}
		/>
	);
};

// Slider Thumb
type SliderThumbProps = SliderPrimitive.SliderThumbProps & {
	class?: string;
};

const SliderThumb = <T extends ValidComponent = "span">(
	props: PolymorphicProps<T, SliderThumbProps>,
) => {
	const [local, others] = splitProps(props as SliderThumbProps, ["class"]);

	return (
		<SliderPrimitive.Thumb
			class={clsx("slider__thumb", local.class)}
			{...others}
		>
			<SliderPrimitive.Input />
		</SliderPrimitive.Thumb>
	);
};

// Slider Label
type SliderLabelProps = SliderPrimitive.SliderLabelProps & {
	class?: string;
};

const SliderLabel = <T extends ValidComponent = "label">(
	props: PolymorphicProps<T, SliderLabelProps>,
) => {
	const [local, others] = splitProps(props as SliderLabelProps, ["class"]);

	return (
		<SliderPrimitive.Label
			class={clsx("slider__label", local.class)}
			{...others}
		/>
	);
};

// Slider ValueLabel
type SliderValueLabelProps = SliderPrimitive.SliderValueLabelProps & {
	class?: string;
};

const SliderValueLabel = <T extends ValidComponent = "output">(
	props: PolymorphicProps<T, SliderValueLabelProps>,
) => {
	const [local, others] = splitProps(props as SliderValueLabelProps, ["class"]);

	return (
		<SliderPrimitive.ValueLabel
			class={clsx("slider__value-label", local.class)}
			{...others}
		/>
	);
};

export {
	Slider,
	SliderTrack,
	SliderFill,
	SliderThumb,
	SliderLabel,
	SliderValueLabel,
};
