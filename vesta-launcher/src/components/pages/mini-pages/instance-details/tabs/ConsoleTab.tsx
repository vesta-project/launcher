import FolderIcon from "@assets/icons/content/folder.svg";
import HistoryIcon from "@assets/icons/content/history.svg";
import SearchIcon from "@assets/icons/content/search.svg";
import TrashIcon from "@assets/icons/actions/delete.svg";
import ChevronDownIcon from "@assets/icons/controls/chevron-down.svg";
import ChevronUpIcon from "@assets/icons/controls/chevron-up.svg";
import LiveIcon from "@assets/icons/status/live.svg";
import TerminalIcon from "@assets/icons/content/terminal.svg";
import {
	CONSOLE_FILTER_LEVELS,
	consoleStore,
	type LogFileInfo,
	type LogLevel,
} from "@stores/console";
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
import {
	formatLogFileMetadata,
	getConsoleLogDisplay,
} from "../console-log-display";
import { t } from "~/localization";

interface ConsoleTabProps {
	instanceSlug: string;
	openLogsFolder: () => void;
}

export const ConsoleTab = (props: ConsoleTabProps) => {
	const [outputElement, setOutputElement] = createSignal<
		HTMLDivElement | undefined
	>();
	const [unlisten, setUnlisten] = createSignal<(() => void) | null>(null);
	const [historyOpen, setHistoryOpen] = createSignal(false);
	const [isScrollable, setIsScrollable] = createSignal(false);
	const [atBottom, setAtBottom] = createSignal(true);
	const [isSearchExpanded, setIsSearchExpanded] = createSignal(false);
	const hasFilters = () =>
		CONSOLE_FILTER_LEVELS.some(
			(level) => !consoleStore.state.filterLevels.includes(level),
		) || consoleStore.state.searchQuery.length > 0;
	const logDisplay = createMemo(() =>
		getConsoleLogDisplay({
			isLive: consoleStore.state.isLive,
			currentLogPath: consoleStore.state.currentLogPath,
			history: consoleStore.state.history as LogFileInfo[],
			instanceSlug: props.instanceSlug,
		}),
	);

	onMount(async () => {
		const cleanup = await consoleStore.init(props.instanceSlug);
		setUnlisten(() => cleanup);
	});

	onCleanup(() => {
		const u = unlisten();
		if (u) u();
	});

	const checkScroll = () => {
		const output = outputElement();
		if (!output) return;
		const { scrollTop, scrollHeight, clientHeight } = output;
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
			// Unclassified lines are still real console output (stack traces,
			// crash reports, native-loader diagnostics). FATAL shares the
			// visible ERROR category because there is no separate FATAL control.
			const matchesLevel =
				line.level === "UNKNOWN" ||
				levels.includes(line.level === "FATAL" ? "ERROR" : line.level);
			return matchesQuery && matchesLevel;
		});

		// Defer scroll check to after render
		setTimeout(checkScroll, 0);
		return filtered;
	});

	// Handle autoscroll
	createEffect(() => {
		const count = filteredLines().length;
		const output = outputElement();
		if (consoleStore.state.autoScroll && output && count > 0) {
			requestAnimationFrame(() => {
				output.scrollTop = output.scrollHeight;
				checkScroll();
			});
		}
	});

	const getLevelColor = (level: LogLevel) => {
		switch (level) {
			case "ERROR":
			case "FATAL":
				return "var(--semantic-error)";
			case "WARN":
				return "var(--semantic-warning)";
			case "INFO":
				return "var(--semantic-info)";
			case "DEBUG":
				return "var(--text-secondary)";
			default:
				return "inherit";
		}
	};

	const toggleScroll = () => {
		const output = outputElement();
		if (!output) return;
		if (atBottom()) {
			output.scrollTop = 0;
		} else {
			output.scrollTop = output.scrollHeight;
		}
		checkScroll();
	};

	return (
		<section class={styles["tab-console"]}>
			<div class={styles["console-header"]}>
				<div class={styles["console-toolbar"]}>
					<div class={styles["console-toolbar-left"]}>
						<div class={styles["console-file-context"]}>
							<div>
								<span class={styles["console-title"]}>
									{logDisplay().title}
								</span>
								<Show when={logDisplay().live}>
									<span class={styles["console-live-indicator"]}>
										{t("instances-details-console-live")}
									</span>
								</Show>
							</div>
							<Show when={logDisplay().metadata}>
								{(metadata) => (
									<span class={styles["console-file-meta"]}>{metadata()}</span>
								)}
							</Show>
						</div>
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
										placeholder={t(
											"instances-details-console-search-placeholder",
										)}
										value={consoleStore.state.searchQuery}
										onInput={(e) =>
											consoleStore.setSearch(e.currentTarget.value)
										}
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
							<TooltipContent>
								{t("instances-details-console-open-logs-folder")}
							</TooltipContent>
						</Tooltip>

						<Show
							when={
								!consoleStore.state.isLive &&
								instancesState.runningIds[props.instanceSlug]
							}
						>
							<Button
								variant="outline"
								size="sm"
								onClick={() => consoleStore.goLive(props.instanceSlug)}
								class={styles["console-back-live"]}
								aria-label={t("instances-details-console-follow-live-aria")}
								tooltip_text={t("instances-details-console-follow-live-tooltip")}
							>
								<LiveIcon />
								<span>{t("instances-details-console-follow-live")}</span>
							</Button>
						</Show>

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
								<TooltipContent>
									{t("instances-details-console-log-history")}
								</TooltipContent>
							</Tooltip>
							<PopoverContent class={styles["console-history-popover"]}>
								<div class={styles["history-popover-header"]}>
									{t("instances-details-console-select-log-file")}
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
													{formatLogFileMetadata(file)}
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
								class={clsx(
									styles["console-tool-btn"],
									styles["console-tool-btn-trash"],
								)}
							>
								<TrashIcon />
							</TooltipTrigger>
							<TooltipContent>
								{t("instances-details-console-clear-view")}
							</TooltipContent>
						</Tooltip>
					</div>
				</div>

				<div class={styles["console-filters"]}>
					<For each={CONSOLE_FILTER_LEVELS}>
						{(level) => (
							<button
								onClick={() => consoleStore.toggleFilterLevel(level)}
								class={clsx(
									styles["filter-tag"],
									styles[`filter-tag--${level.toLowerCase()}`],
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
			</div>

			<div
				class={clsx(styles["console-output"], styles["v2"])}
				ref={(element) => setOutputElement(element)}
				style={{ "font-family": "var(--font-mono)" }}
				onScroll={checkScroll}
			>
				<Show
					when={filteredLines().length > 0 || consoleStore.state.isCatchingUp}
					fallback={
						<div class={styles["console-empty"]}>
							<TerminalIcon class={styles["empty-icon"]} />
							<Show
								when={
									hasFilters() &&
									filteredLines().length === 0 &&
									!consoleStore.state.isCatchingUp
								}
							>
								<h3>{t("instances-details-console-no-matching-logs")}</h3>
								<p>
									{t("instances-details-console-no-matching-logs-description")}
								</p>
								<div class={styles["console-empty-actions"]}>
									<Button
										variant="slate"
										size="sm"
										onClick={() => consoleStore.setSearch("")}
									>
										{t("instances-details-console-clear-search")}
									</Button>
									<Button
										variant="slate"
										size="sm"
										onClick={() => consoleStore.resetFilters()}
									>
										{t("instances-details-console-reset-filters")}
									</Button>
								</div>
							</Show>
							<Show
								when={
									!hasFilters() && instancesState.runningIds[props.instanceSlug]
								}
							>
								<h3>{t("instances-details-console-waiting")}</h3>
								<p>{t("instances-details-console-waiting-description")}</p>
							</Show>
							<Show
								when={
									!hasFilters() &&
									!instancesState.runningIds[props.instanceSlug]
								}
							>
								<h3>{t("instances-details-console-no-logs")}</h3>
								<p>{t("instances-details-console-no-logs-description")}</p>
								<div class={styles["console-empty-actions"]}>
									<Button
										variant="slate"
										size="sm"
										onClick={props.openLogsFolder}
									>
										{t("instances-details-console-open-logs-folder-action")}
									</Button>
								</div>
							</Show>
						</div>
					}
				>
					<div class={styles["console-lines"]}>
						<For each={filteredLines()}>
							{(line) => (
								<div class={styles["console-line-wrapper"]}>
									<div class={styles["console-gutter"]}>{line.id}</div>
									<div class={styles["console-line-content"]}>
										<Show when={line.timestamp}>
											<span class={styles["log-time"]}>[{line.timestamp}]</span>
										</Show>
										<Show when={line.level !== "UNKNOWN"}>
											<span
												class={clsx(
													styles["log-level"],
													styles[`log-level--${line.level.toLowerCase()}`],
												)}
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
									<Show when={atBottom()} fallback={<ChevronDownIcon />}>
										<ChevronUpIcon />
								</Show>
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{atBottom()
								? t("instances-details-console-jump-top")
								: t("instances-details-console-jump-bottom")}
						</TooltipContent>
					</Tooltip>
				</div>
			</Show>
		</section>
	);
};
