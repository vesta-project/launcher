import PlusIcon from "@assets/icons/actions/add.svg";
import ReloadIcon from "@assets/icons/actions/reload.svg";
import { SettingsCard } from "@components/settings";
import panelStyles from "@components/settings/settings.module.css";
import {
	getRequirements,
	isScanning,
	javaOptions,
	refreshJavas,
} from "@stores/settings";
import { Badge } from "@ui/badge";
import LauncherButton from "@ui/button/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@ui/context-menu/context-menu";
import { showToast } from "@ui/toast/toast";
import { invoke } from "@tauri-apps/api/core";
import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import pageStyles from "../settings-page.module.css";
import styles from "./JavaTab.module.css";

export interface JavaOption {
	type: "managed" | "system" | "custom" | "browse";
	version: number;
	title: string;
	path?: string;
	isActive: boolean;
	onClick: () => void;
	onDownload?: () => void;
}

type DetectedJavaInfo = {
	path: string;
	major_version: number;
	is_64bit: boolean;
};

const SOURCE_LABEL: Record<JavaOption["type"], string> = {
	managed: "Managed",
	system: "System",
	custom: "Custom",
	browse: "Browse",
};

const JavaRuntimeRow: Component<{ option: JavaOption }> = (props) => {
	const [testing, setTesting] = createSignal(false);

	const handleCopyPath = () => {
		if (!props.option.path) return;
		void navigator.clipboard.writeText(props.option.path);
		showToast({
			title: "Copied",
			description: "Path copied to clipboard",
			severity: "success",
		});
	};

	const handleTestRuntime = async () => {
		const path = props.option.path;
		if (!path || testing()) return;
		setTesting(true);
		try {
			const info = await invoke<DetectedJavaInfo>("verify_java_path", {
				pathStr: path,
			});
			showToast({
				title: "Java runtime OK",
				description: `Java ${info.major_version}${info.is_64bit ? " (64-bit)" : " (32-bit)"} verified at ${path}`,
				severity: "success",
			});
		} catch (error) {
			showToast({
				title: "Java runtime failed",
				description: String(error),
				severity: "error",
			});
		} finally {
			setTesting(false);
		}
	};

	if (props.option.type === "browse") {
		return (
			<button
				type="button"
				class={styles.browseRow}
				onClick={props.option.onClick}
			>
				<span class={styles.browseIcon} aria-hidden="true">
					<PlusIcon />
				</span>
				<span class={styles.browseCopy}>
					<span class={styles.rowTitle}>Browse for Java…</span>
					<span class={styles.rowMeta}>
						Pick a custom runtime for this version
					</span>
				</span>
			</button>
		);
	}

	const row = (
		<button
			type="button"
			class={styles.runtimeRow}
			classList={{ [styles.runtimeRowActive]: props.option.isActive }}
			aria-pressed={props.option.isActive}
			onClick={props.option.onClick}
		>
			<span
				class={styles.radio}
				classList={{ [styles.radioActive]: props.option.isActive }}
				aria-hidden="true"
			/>
			<span class={styles.rowBody}>
				<span class={styles.rowHeadline}>
					<span class={styles.rowTitle}>{props.option.title}</span>
					<span class={styles.sourceBadge} data-source={props.option.type}>
						{SOURCE_LABEL[props.option.type]}
					</span>
					<Show when={props.option.isActive}>
						<Badge class={styles.activeBadge}>Active</Badge>
					</Show>
				</span>
				<Show
					when={props.option.path}
					fallback={<span class={styles.rowMeta}>Not installed yet</span>}
				>
					{(path) => <span class={styles.rowPath}>{path()}</span>}
				</Show>
			</span>
			<Show when={!props.option.path && props.option.onDownload}>
				<LauncherButton
					size="sm"
					variant="ghost"
					class={styles.downloadButton}
					onClick={(event) => {
						event.stopPropagation();
						props.option.onDownload?.();
					}}
				>
					Download & Use
				</LauncherButton>
			</Show>
		</button>
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger as="div" class={styles.rowShell}>
				{row}
			</ContextMenuTrigger>
			<Show when={props.option.path}>
				<ContextMenuContent>
					<ContextMenuItem
						disabled={testing()}
						onClick={() => void handleTestRuntime()}
					>
						{testing() ? "Testing…" : "Test runtime"}
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem onClick={handleCopyPath}>
						Copy full path
					</ContextMenuItem>
				</ContextMenuContent>
			</Show>
		</ContextMenu>
	);
};

const JavaVersionGroup: Component<{
	requirement: { major_version: number; recommended_name: string };
}> = (props) => {
	const options = createMemo((): JavaOption[] =>
		(javaOptions() as JavaOption[]).filter(
			(option) => option.version === props.requirement.major_version,
		),
	);
	const active = createMemo(
		(): JavaOption | undefined =>
			options().find(
				(option) => option.isActive && option.type !== "browse",
			),
	);
	const statusText = createMemo(() => {
		const selected = active();
		if (!selected) return "No runtime selected";
		return `Using ${SOURCE_LABEL[selected.type].toLowerCase()} runtime`;
	});
	const runtimes = createMemo((): JavaOption[] =>
		options().filter((option) => option.type !== "browse"),
	);
	const browse = createMemo(
		(): JavaOption | undefined =>
			options().find((option) => option.type === "browse"),
	);

	return (
		<section
			class={styles.versionGroup}
			aria-label={props.requirement.recommended_name}
		>
			<header class={styles.versionHeader}>
				<div class={styles.versionIdentity}>
					<span class={styles.versionMark} aria-hidden="true">
						{props.requirement.major_version}
					</span>
					<div class={styles.versionCopy}>
						<h3 class={styles.versionTitle}>
							{props.requirement.recommended_name}
						</h3>
						<p class={styles.versionStatus}>{statusText()}</p>
					</div>
				</div>
			</header>

			<div class={styles.runtimeList} role="list">
				<For each={runtimes()}>
					{(option) => (
						<div
							role="listitem"
							data-runtime={`${option.type}:${option.path ?? "missing"}`}
						>
							<JavaRuntimeRow option={option} />
						</div>
					)}
				</For>
				<Show when={browse()}>
					{(option) => (
						<div role="listitem">
							<JavaRuntimeRow option={option()} />
						</div>
					)}
				</Show>
			</div>
		</section>
	);
};

export function JavaSettingsTab() {
	return (
		<div
			class={`${pageStyles["settings-tab-content"]} ${pageStyles["settings-tab-content--wide"]}`}
		>
			<div class={panelStyles["settings-panel"]}>
				<SettingsCard
					header="Java Environments"
					subHeader="Choose the default runtime for each Minecraft Java generation. Instances inherit these unless overridden."
					helpTopic="JAVA_MANAGED"
					headerRight={
						<LauncherButton
							onClick={refreshJavas}
							disabled={isScanning()}
							variant="ghost"
							size="sm"
							class={styles.rescanButton}
						>
							<ReloadIcon class={styles.rescanIcon} />
							{isScanning() ? "Scanning…" : "Rescan"}
						</LauncherButton>
					}
				>
					<Show
						when={getRequirements().length > 0}
						fallback={
							<div class={styles.emptyState}>
								<div class={styles.spinner} aria-hidden="true" />
								<p>Loading Minecraft version metadata…</p>
								<span>
									Java requirements appear once the launcher manifest is ready.
								</span>
							</div>
						}
					>
						<div class={styles.versionStack}>
							<For each={getRequirements()}>
								{(requirement: {
									major_version: number;
									recommended_name: string;
								}) => <JavaVersionGroup requirement={requirement} />}
							</For>
						</div>
					</Show>
				</SettingsCard>
			</div>
		</div>
	);
}
