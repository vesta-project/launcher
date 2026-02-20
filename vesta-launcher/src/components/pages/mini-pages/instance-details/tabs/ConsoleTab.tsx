import BackArrowIcon from "@assets/back-arrow.svg";
import FolderIcon from "@assets/folder.svg";
import HistoryIcon from "@assets/history.svg";
import RefreshIcon from "@assets/refresh.svg";
import SearchIcon from "@assets/search.svg";
import TrashIcon from "@assets/trash.svg";
import { consoleStore, type LogLevel } from "@stores/console";
import { instancesState } from "@stores/instances";
import Button from "@ui/button/button";
import { Popover, PopoverContent, PopoverTrigger } from "@ui/popover/popover";
import { TextField } from "@ui/text-field/text-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import clsx from "clsx";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import styles from "../instance-details.module.css";

const ArrowUpIcon = (props: { class?: string }) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		class={props.class}
	>
		<polyline points="18 15 12 9 6 15" />
	</svg>
);

const ArrowDownIcon = (props: { class?: string }) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		class={props.class}
	>
		<polyline points="6 9 12 15 18 9" />
	</svg>
);

interface ConsoleTabProps {
	instanceSlug: string;
	openLogsFolder: () => void;
}

export const ConsoleTab = (props: ConsoleTabProps) => {
	let outputRef: HTMLDivElement | undefined;
	const [unlisten, setUnlisten] = createSignal<(() => void) | null>(null);
	const [historyOpen, setHistoryOpen] = createSignal(false);
	const [isScrollable, setIsScrollable] = createSignal(false);
	const [atBottom, setAtBottom] = createSignal(true);
	const [isSearchExpanded, setIsSearchExpanded] = createSignal(false);

	onMount(async () => {
		const cleanup = await consoleStore.init(props.instanceSlug);
		setUnlisten(() => cleanup);
	});

	onCleanup(() => {
		const u = unlisten();
		if (u) u();
	});

	const checkScroll = () => {
		if (!outputRef) return;
		const { scrollTop, scrollHeight, clientHeight } = outputRef;
		const atBottomNow = scrollHeight - scrollTop - clientHeight < 50;

		setIsScrollable(scrollHeight > clientHeight + 10);

		// Smart auto-scroll logic: sync store with user behavior
		if (atBottomNow && !consoleStore.state.autoScroll) {
			consoleStore.setAutoScroll(true);
		} else if (!atBottomNow && consoleStore.state.autoScroll) {
			consoleStore.setAutoScroll(false);
		}

		setAtBottom(atBottomNow);
	};

	const filteredLines = createMemo(() => {
		const query = consoleStore.state.searchQuery.toLowerCase();
		const levels = consoleStore.state.filterLevels;

		const filtered = consoleStore.state.lines.filter((line) => {
			const matchesQuery = !query || line.raw.toLowerCase().includes(query);
			const matchesLevel = levels.includes(line.level);
			return matchesQuery && matchesLevel;
		});

		// Defer scroll check to after render
		setTimeout(checkScroll, 0);
		return filtered;
	});

	// Handle autoscroll
	createEffect(() => {
		if (consoleStore.state.autoScroll && outputRef) {
			filteredLines(); // Dependency
			outputRef.scrollTop = outputRef.scrollHeight;
		}
	});

	const getLevelColor = (level: LogLevel) => {
		switch (level) {
			case "ERROR":
			case "FATAL":
				return "var(--semantic-error)";
			case "WARN":
				return "var(--semantic-warning)";
			case "DEBUG":
				return "var(--text-secondary)";
			default:
				return "inherit";
		}
	};

	const toggleScroll = () => {
		if (!outputRef) return;
		if (atBottom()) {
			outputRef.scrollTop = 0;
		} else {
			outputRef.scrollTop = outputRef.scrollHeight;
		}
		checkScroll();
	};

	return (
		<section class={styles["tab-console"]}>
			<div class={styles["console-toolbar"]}>
				<div class={styles["console-toolbar-left"]}>
					<span class={styles["console-title"]}>
						{consoleStore.state.isLive
							? "Viewing Session Logs"
							: consoleStore.state.currentLogPath
								? `Viewing Historical Log: ${consoleStore.state.currentLogPath.split(/[/\\]/).pop()}`
								: "Viewing Historical Logs"}
					</span>
					<Show
						when={
							!consoleStore.state.isLive &&
							instancesState.runningIds[props.instanceSlug]
						}
					>
						<Tooltip placement="top">
							<TooltipTrigger>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => consoleStore.goLive(props.instanceSlug)}
									class={styles["console-back-live"]}
								>
									<RefreshIcon /> Switch to Live
								</Button>
							</TooltipTrigger>
							<TooltipContent>Switch back to live logs</TooltipContent>
						</Tooltip>
					</Show>
				</div>

				<div class={styles["console-toolbar-buttons"]}>
					<div class={styles["console-search-container"]}>
						<div
							class={styles["console-search-wrapper"]}
							classList={{ [styles.expanded]: isSearchExpanded() }}
						>
							<Button
								size="sm"
								variant="ghost"
								icon_only
								class={styles["mobile-search-trigger"]}
								onClick={() => {
									setIsSearchExpanded(true);
									// Focus the input after expanding
									const input = document.querySelector(
										`.${styles["console-search-field"]} input`,
									) as HTMLInputElement;
									input?.focus();
								}}
							>
								<SearchIcon />
							</Button>
							<div class={styles["search-input-wrapper"]}>
								<SearchIcon class={styles["search-icon-fixed"]} />
								<TextField
									placeholder="Search logs..."
									value={consoleStore.state.searchQuery}
									onInput={(e) => consoleStore.setSearch(e.currentTarget.value)}
									class={styles["console-search-field"]}
									onFocus={() => setIsSearchExpanded(true)}
									onBlur={() => {
										setTimeout(() => setIsSearchExpanded(false), 200);
									}}
								/>
							</div>
						</div>
					</div>

					<Tooltip placement="top">
						<TooltipTrigger
							as={Button}
							variant="ghost"
							size="md"
							onClick={props.openLogsFolder}
							class={styles["console-tool-btn"]}
						>
							<FolderIcon />
						</TooltipTrigger>
						<TooltipContent>Open logs folder</TooltipContent>
					</Tooltip>

					<Popover open={historyOpen()} onOpenChange={setHistoryOpen}>
						<Tooltip placement="top">
							<TooltipTrigger>
								<PopoverTrigger
									as={Button}
									variant="ghost"
									size="md"
									class={clsx(
										styles["console-tool-btn"],
										historyOpen() && styles["active"],
									)}
								>
									<HistoryIcon />
								</PopoverTrigger>
							</TooltipTrigger>
							<TooltipContent>Log History</TooltipContent>
						</Tooltip>
						<PopoverContent class={styles["console-history-popover"]}>
							<div class={styles["history-popover-header"]}>
								Select Log File
							</div>
							<div class={styles["history-popover-list"]}>
								<For each={consoleStore.state.history}>
									{(file) => (
										<button
											onClick={() => {
												consoleStore.viewHistoricalLog(file.path);
												setHistoryOpen(false);
											}}
											class={clsx(
												styles["history-item"],
												consoleStore.state.currentLogPath === file.path &&
													styles["active"],
											)}
										>
											<span class={styles["history-name"]}>{file.name}</span>
											<span class={styles["history-meta"]}>
												{(file.size / 1024).toFixed(1)} KB
											</span>
										</button>
									)}
								</For>
							</div>
						</PopoverContent>
					</Popover>

					<Tooltip placement="top">
						<TooltipTrigger
							as={Button}
							variant="ghost"
							size="md"
							onClick={() => consoleStore.clear()}
							class={styles["console-tool-btn-trash"]}
						>
							<TrashIcon />
						</TooltipTrigger>
						<TooltipContent>Clear console view</TooltipContent>
					</Tooltip>
				</div>
			</div>

			<div class={styles["console-filters"]}>
				<For each={["INFO", "WARN", "ERROR", "DEBUG"] as LogLevel[]}>
					{(level) => (
						<button
							onClick={() => consoleStore.toggleFilterLevel(level)}
							class={clsx(
								styles["filter-tag"],
								consoleStore.state.filterLevels.includes(level) &&
									styles["active"],
							)}
							style={{ "--level-color": getLevelColor(level) }}
						>
							{level}
						</button>
					)}
				</For>
			</div>

			<div class={styles["console-viewport-container"]}>
				<div
					class={clsx(styles["console-output"], styles["v2"])}
					ref={outputRef}
					style={{ "font-family": "var(--font-mono)" }}
					onScroll={checkScroll}
				>
					<Show
						when={filteredLines().length > 0 || consoleStore.state.isCatchingUp}
						fallback={
							<div class={styles["console-empty"]}>
								<h3>
									{instancesState.runningIds[props.instanceSlug]
										? "Waiting for game output..."
										: "No logs to display"}
								</h3>
								<p>
									{consoleStore.state.searchQuery
										? "Try adjusting your search or filters."
										: "The log is currently empty or still being initialized."}
								</p>
							</div>
						}
					>
						<div class={styles["console-virtual-container"]}>
							<For each={filteredLines()}>
								{(line) => (
									<div class={styles["console-line-wrapper"]}>
										<div class={styles["console-gutter"]}>{line.id}</div>
										<div class={styles["console-line-content"]}>
											<Show when={line.timestamp}>
												<span class={styles["log-time"]}>
													[{line.timestamp}]
												</span>
											</Show>
											<Show when={line.level !== "UNKNOWN"}>
												<span
													class={styles["log-level"]}
													style={{ color: getLevelColor(line.level) }}
												>
													[{line.thread}/{line.level}]:
												</span>
											</Show>
											<span class={styles["log-message"]}>{line.message}</span>
										</div>
									</div>
								)}
							</For>
						</div>
					</Show>
				</div>

				<Show when={isScrollable()}>
					<div class={styles["console-scroll-controls"]}>
						<Tooltip placement="left">
							<TooltipTrigger>
								<Button
									variant="shadow"
									size="icon"
									onClick={toggleScroll}
									class={styles["scroll-btn-round"]}
								>
									<Show when={atBottom()} fallback={<ArrowDownIcon />}>
										<ArrowUpIcon />
									</Show>
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								{atBottom() ? "Jump to Top" : "Jump to Bottom"}
							</TooltipContent>
						</Tooltip>
					</div>
				</Show>
			</div>
		</section>
	);
};
