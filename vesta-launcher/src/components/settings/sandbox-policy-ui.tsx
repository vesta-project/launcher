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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ui/tooltip/tooltip";
import { showToast } from "@ui/toast/toast";
import {
	fetchSandboxHostSupport,
	guardSandboxPresetChange,
	invalidateSandboxHostSupportCache,
	sandboxPresetBlockedCopy,
	type SandboxHostSupport,
} from "@utils/sandbox-host";
import {
	createMemo,
	createResource,
	onCleanup,
	onMount,
	type JSX,
	Show,
} from "solid-js";
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
							label="Files restricted"
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
							label="Files restricted"
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

export function SandboxHostNotice(props: {
	support: SandboxHostSupport | undefined;
}) {
	const message = createMemo(() => {
		const support = props.support;
		if (!support) {
			return null;
		}
		if (support.enforcementAvailable) {
			return support.hostOs === "linux"
				? "On Linux, Paranoid blocks microphone access by also disabling game audio playback."
				: null;
		}
		return (
			support.missingRequirementMessage ??
			"Modded and Paranoid sandbox presets cannot be enforced on this system."
		);
	});

	return (
		<Show when={message()}>
			{(text) => (
				<div class={styles.hostNotice} role="alert">
					{text()}
				</div>
			)}
		</Show>
	);
}

export function useSandboxHostSupport() {
	const [support, actions] = createResource(fetchSandboxHostSupport);

	onMount(() => {
		const refreshSupport = () => {
			invalidateSandboxHostSupportCache();
			void actions.refetch();
		};

		const handleVisibility = () => {
			if (!document.hidden) {
				refreshSupport();
			}
		};

		window.addEventListener("focus", refreshSupport);
		document.addEventListener("visibilitychange", handleVisibility);

		onCleanup(() => {
			window.removeEventListener("focus", refreshSupport);
			document.removeEventListener("visibilitychange", handleVisibility);
		});
	});

	return [support, actions] as const;
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

	const handleChange = async (next: SandboxPresetValue) => {
		const { allowed, support } = await guardSandboxPresetChange(next);
		if (!allowed) {
			const copy = sandboxPresetBlockedCopy(support);
			showToast({
				title: copy.title,
				description: copy.description,
				severity: "error",
				dismissible: true,
			});
			return;
		}
		props.onChange(next);
	};

	return (
		<Select
			options={SANDBOX_PRESET_OPTIONS}
			optionValue="value"
			optionTextValue="label"
			value={selected()}
			onChange={(option) => {
				if (option) {
					void handleChange(option.value);
				}
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
