import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createStore } from "solid-js/store";
import { instancesState } from "./instances";

export type LogLevel =
	| "INFO"
	| "WARN"
	| "ERROR"
	| "DEBUG"
	| "FATAL"
	| "UNKNOWN";

export interface LogLine {
	id: number;
	timestamp: string;
	level: LogLevel;
	thread: string;
	message: string;
	raw: string;
}

export interface LogFileInfo {
	name: string;
	path: string;
	size: number;
	last_modified: number;
}

interface ConsoleState {
	lines: LogLine[];
	history: LogFileInfo[];
	currentLogPath: string | null;
	isLive: boolean;
	searchQuery: string;
	filterLevels: LogLevel[];
	autoScroll: boolean;
	isCatchingUp: boolean;
	lastCatchupTime: number | null;
}

const [state, setState] = createStore<ConsoleState>({
	lines: [],
	history: [],
	currentLogPath: null,
	isLive: true,
	searchQuery: "",
	filterLevels: ["INFO", "WARN", "ERROR", "FATAL", "DEBUG"],
	autoScroll: true,
	isCatchingUp: false,
	lastCatchupTime: null,
});

let lineIdCounter = 0;
let activeInstanceSlug: string | null = null;
let initGeneration = 0;

interface CachedConsoleSession {
	lines: LogLine[];
	history: LogFileInfo[];
	lastCatchupTime: number | null;
}

const MAX_CACHED_CONSOLE_SESSIONS = 6;
const sessionCache = new Map<string, CachedConsoleSession>();

function retainCurrentSession() {
	if (!activeInstanceSlug) return;
	sessionCache.delete(activeInstanceSlug);
	sessionCache.set(activeInstanceSlug, {
		lines: [...state.lines],
		history: [...state.history],
		lastCatchupTime: state.lastCatchupTime,
	});
	while (sessionCache.size > MAX_CACHED_CONSOLE_SESSIONS) {
		const oldest = sessionCache.keys().next().value;
		if (!oldest) break;
		sessionCache.delete(oldest);
	}
}

// Regex for standard Minecraft log4j format: [12:34:56] [Thread/LEVEL]: message
const LOG_REGEX = /^\[(\d{2}:\d{2}:\d{2})\]\s+\[([^/]+)\/([^\]]+)\]:\s+(.*)$/;

function parseLine(raw: string): LogLine {
	const match = raw.match(LOG_REGEX);
	if (match) {
		return {
			id: ++lineIdCounter,
			timestamp: match[1],
			thread: match[2],
			level: (match[3].toUpperCase() as LogLevel) || "UNKNOWN",
			message: match[4],
			raw,
		};
	}

	// Fallback for non-standard lines
	return {
		id: ++lineIdCounter,
		timestamp: "",
		thread: "",
		level: "UNKNOWN",
		message: raw,
		raw,
	};
}

export const consoleStore = {
	state,

	async init(instanceSlug: string) {
		const generation = ++initGeneration;
		const isRunning = !!instancesState.runningIds[instanceSlug];
		const cached = sessionCache.get(instanceSlug);
		activeInstanceSlug = instanceSlug;
		lineIdCounter = cached?.lines.at(-1)?.id ?? 0;

		setState({
			lines: cached?.lines ?? [],
			history: cached?.history ?? [],
			isLive: isRunning,
			currentLogPath: null,
			isCatchingUp: true,
			lastCatchupTime: cached?.lastCatchupTime ?? null,
		});

		const queuedLiveLines: string[] = [];
		const logUnlisten = await listen<{
			lines: Array<{
				instance_id: string;
				line: string;
				stream: "stdout" | "stderr";
			}>;
		}>("core://instance-log", (event) => {
			if (state.isLive) {
				const relevantLines = event.payload.lines
					.filter((l) => l.instance_id === instanceSlug)
					.map((l) => l.line);
				if (relevantLines.length > 0) {
					if (state.isCatchingUp) {
						queuedLiveLines.push(...relevantLines);
					} else {
						this.appendRawLines(relevantLines);
					}
				}
			}
		});

		const launchUnlisten = await listen<{ instance_id: string }>(
			"core://instance-launched",
			(event) => {
				if (event.payload.instance_id === instanceSlug) {
					this.goLive(instanceSlug);
				}
			},
		);

		const exitUnlisten = await listen<{ instance_id: string }>(
			"core://instance-exited",
			(event) => {
				if (event.payload.instance_id === instanceSlug) {
					setState("isLive", false);
				}
			},
		);

		await Promise.all([
			invoke<LogFileInfo[]>("get_instance_log_history", {
				instanceIdSlug: instanceSlug,
			})
				.then((history) => {
					if (generation !== initGeneration) return;
					setState("history", history);
					retainCurrentSession();
				})
				.catch((error) => {
					console.error("Failed to fetch log history", error);
				}),
			this.catchUp(instanceSlug),
		]);

		if (generation === initGeneration && queuedLiveLines.length > 0) {
			const tail = new Set(
				state.lines
					.slice(-Math.max(200, queuedLiveLines.length * 2))
					.map((line) => line.raw),
			);
			this.appendRawLines(queuedLiveLines.filter((line) => !tail.has(line)));
		}

		return () => {
			logUnlisten();
			launchUnlisten();
			exitUnlisten();
			retainCurrentSession();
		};
	},

	async catchUp(instanceSlug: string) {
		setState("isCatchingUp", true);
		try {
			const runningMeta = instancesState.runningIds[instanceSlug];
			const since =
				state.lastCatchupTime ||
				(runningMeta ? runningMeta.startTime : undefined);

			const caughtUpLines = await invoke<string[]>("read_instance_log", {
				instanceIdSlug: instanceSlug,
				lastLines: state.lines.length === 0 ? 1000 : undefined,
				since: since,
			});
			if (activeInstanceSlug !== instanceSlug) return;

			if (state.lines.length === 0) {
				lineIdCounter = 0;
			}

			this.appendRawLines(caughtUpLines);
			setState("lastCatchupTime", Math.floor(Date.now() / 1000));
			retainCurrentSession();
		} catch (e) {
			console.error("Failed to catch up logs", e);
		} finally {
			if (activeInstanceSlug === instanceSlug) {
				setState("isCatchingUp", false);
			}
		}
	},

	appendRawLines(rawLines: string[]) {
		const parsed = rawLines.map(parseLine);
		setState("lines", (prev) => {
			const newLines = [...prev, ...parsed];
			// Keep a reasonable buffer for performance, e.g., 5000 lines
			return newLines.slice(-5000);
		});
		retainCurrentSession();
	},

	async viewHistoricalLog(path: string) {
		setState({
			isLive: false,
			currentLogPath: path,
			isCatchingUp: true,
			lines: [],
		});
		lineIdCounter = 0;

		try {
			const rawLines = await invoke<string[]>("read_specific_log_file", {
				path,
			});
			this.appendRawLines(rawLines);
		} catch (e) {
			console.error("Failed to read historical log", e);
		} finally {
			setState("isCatchingUp", false);
		}
	},

	async goLive(instanceSlug: string) {
		setState({ isLive: true, currentLogPath: null, lastCatchupTime: null });
		await this.catchUp(instanceSlug);
	},

	setSearch(query: string) {
		setState("searchQuery", query);
	},

	toggleFilterLevel(level: LogLevel) {
		setState("filterLevels", (prev) => {
			if (prev.includes(level)) {
				return prev.filter((l) => l !== level);
			}
			return [...prev, level];
		});
	},

	clear() {
		setState("lines", []);
		lineIdCounter = 0;
		retainCurrentSession();
	},

	toggleAutoScroll() {
		setState("autoScroll", !state.autoScroll);
	},

	setAutoScroll(val: boolean) {
		setState("autoScroll", val);
	},
};
