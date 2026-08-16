import FolderLockIcon from "@assets/icons/security/folder-lock.svg";
import LockIcon from "@assets/icons/security/lock.svg";
import MicOffIcon from "@assets/icons/security/mic-off.svg";
import MicIcon from "@assets/icons/security/mic.svg";
import NetworkIcon from "@assets/icons/security/network.svg";
import ShieldCheckIcon from "@assets/icons/security/shield-check.svg";
import ShieldOffIcon from "@assets/icons/security/shield-off.svg";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import { createMemo, type JSX } from "solid-js";
import styles from "./sandbox-policy.module.css";

export type SandboxPresetValue = "trusted" | "modded" | "paranoid";
export type SandboxWrapperNestingValue = "sandbox-outside" | "wrapper-outside";

export const SANDBOX_PRESET_OPTIONS: {
	value: SandboxPresetValue;
	label: string;
}[] = [
	{ value: "trusted", label: "Trusted" },
	{ value: "modded", label: "Modded" },
	{ value: "paranoid", label: "Paranoid" },
];

export function parseSandboxExtraPaths(
	raw: string | string[] | null | undefined,
): string[] {
	if (Array.isArray(raw)) return raw;
	if (!raw || !raw.trim()) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is string => typeof entry === "string");
	} catch {
		return [];
	}
}

function CapabilityChip(props: {
	icon: JSX.Element;
	off?: boolean;
	denied?: boolean;
	label: string;
}) {
	return (
		<Tooltip placement="top">
			<TooltipTrigger
				as="span"
				class={styles.capabilityChip}
				classList={{
					[styles.capabilityChipOff]: props.off,
					[styles.capabilityChipDenied]: props.denied,
				}}
				aria-label={props.label}
			>
				{props.icon}
			</TooltipTrigger>
			<TooltipContent>{props.label}</TooltipContent>
		</Tooltip>
	);
}

export function SandboxPresetOptionLabel(props: { preset: SandboxPresetValue }) {
	return (
		<div class={styles.presetOption}>
			<span class={styles.presetLabel}>
				{SANDBOX_PRESET_OPTIONS.find((option) => option.value === props.preset)
					?.label ?? props.preset}
			</span>
			<span class={styles.capabilityRow}>
				{props.preset === "trusted" && (
					<CapabilityChip
						icon={<ShieldOffIcon />}
						label="No sandbox enforcement"
					/>
				)}
				{props.preset === "modded" && (
					<>
						<CapabilityChip
							icon={<ShieldCheckIcon />}
							label="Sandbox enforced"
						/>
						<CapabilityChip
							icon={<FolderLockIcon />}
							label="Path exclusions"
						/>
						<CapabilityChip icon={<NetworkIcon />} label="Network allowed" />
						<CapabilityChip icon={<MicIcon />} label="Microphone allowed" />
					</>
				)}
				{props.preset === "paranoid" && (
					<>
						<CapabilityChip icon={<LockIcon />} label="Strict sandbox" />
						<CapabilityChip
							icon={<FolderLockIcon />}
							label="Path exclusions"
						/>
						<CapabilityChip
							icon={<NetworkIcon />}
							off
							denied
							label="Network blocked"
						/>
						<CapabilityChip
							icon={<MicOffIcon />}
							off
							denied
							label="Microphone blocked"
						/>
					</>
				)}
			</span>
		</div>
	);
}

export function SandboxPresetSelect(props: {
	value: SandboxPresetValue;
	onChange: (value: SandboxPresetValue) => void;
}) {
	const selected = createMemo(
		() =>
			SANDBOX_PRESET_OPTIONS.find((option) => option.value === props.value) ??
			SANDBOX_PRESET_OPTIONS[0],
	);

	return (
		<Select
			options={SANDBOX_PRESET_OPTIONS}
			optionValue="value"
			optionTextValue="label"
			value={selected()}
			onChange={(option) => {
				if (option) props.onChange(option.value);
			}}
			itemComponent={(itemProps) => (
				<SelectItem item={itemProps.item}>
					<SandboxPresetOptionLabel preset={itemProps.item.rawValue.value} />
				</SelectItem>
			)}
		>
			<SelectTrigger>
				<SelectValue<(typeof SANDBOX_PRESET_OPTIONS)[number]>>
					{(state) => (
						<SandboxPresetOptionLabel
							preset={state.selectedOption().value}
						/>
					)}
				</SelectValue>
			</SelectTrigger>
			<SelectContent />
		</Select>
	);
}

export function normalizeSandboxPreset(
	value: string | null | undefined,
): SandboxPresetValue {
	if (value === "modded" || value === "paranoid") return value;
	return "trusted";
}

export function normalizeSandboxWrapperNesting(
	value: string | null | undefined,
): SandboxWrapperNestingValue {
	if (value === "wrapper-outside" || value === "wrapper_outside") {
		return "wrapper-outside";
	}
	return "sandbox-outside";
}
