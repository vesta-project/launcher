import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import type { ProgressRootProps } from "@kobalte/core/progress";
import * as ProgressPrimitive from "@kobalte/core/progress";
import clsx from "clsx";
import type { ParentProps, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";
import "./progress.css";

export const ProgressLabel = ProgressPrimitive.Label;
export const ProgressValueLabel = ProgressPrimitive.ValueLabel;

type ProgressProps<T extends ValidComponent = "div"> = ParentProps<
	ProgressRootProps<T> & {
		class?: string;
		progress?: number | null; // -1 = indeterminate (pulse), 0-100 determinate
		current_step?: number | null;
		total_steps?: number | null;
		severity?: "info" | "success" | "warning" | "error";
		size?: "sm" | "md" | "lg";
	}
>;

export const Progress = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ProgressProps<T>>,
) => {
	const [local, rest] = splitProps(props as ProgressProps, [
		"class",
		"children",
		"progress",
		"current_step",
		"total_steps",
		"severity",
		"size",
	]);

	const isIndeterminate = local.progress === -1;
	const value =
		local.progress === null ||
		local.progress === undefined ||
		local.progress === -1
			? undefined
			: Math.min(100, Math.max(0, local.progress));

	const cssVars: Record<string, string> = {};
	if (value !== undefined) {
		cssVars["--progress-fill-width"] = `${value}%`;
		cssVars["--kb-progress-fill-width"] = `${value}%`;
	} else if (isIndeterminate) {
		cssVars["--progress-fill-width"] = `100%`;
		cssVars["--kb-progress-fill-width"] = `100%`;
	}

	const className = clsx(
		"progress",
		local.severity ? `progress--${local.severity}` : "",
		local.size ? `progress--${local.size}` : "",
		local.class,
		isIndeterminate && "progress--indeterminate",
	);

	const mergedStyle = Object.assign({}, (rest as any).style || {}, cssVars);

	return (
		<ProgressPrimitive.Root
			class={className}
			style={mergedStyle as any}
			value={value}
			maxValue={100}
			indeterminate={isIndeterminate}
			{...rest}
		>
			{local.children}
			<div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
				<ProgressPrimitive.Track class="progress__track" style={{ flex: 1 }}>
					<ProgressPrimitive.Fill
						class={clsx(
							"progress__fill",
							isIndeterminate && "progress__fill--indeterminate",
						)}
					/>
				</ProgressPrimitive.Track>
				{local.current_step !== undefined &&
					local.total_steps !== undefined && (
						<div class="progress__steps">
							{local.current_step}/{local.total_steps}
						</div>
					)}
			</div>
		</ProgressPrimitive.Root>
	);
};
