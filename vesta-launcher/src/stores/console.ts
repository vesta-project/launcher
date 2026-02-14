import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { instancesState } from "./instances";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG" | "FATAL" | "UNKNOWN";

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
		const isRunning = !!instancesState.runningIds[instanceSlug];

		// Reset state
		setState({
			lines: [],
			isLive: isRunning,
			currentLogPath: null,
			isCatchingUp: true,
		});

		// 1. Fetch history
		try {
			const history = await invoke<LogFileInfo[]>("get_instance_log_history", {
				instanceIdSlug: instanceSlug,
			});
			setState("history", history);
		} catch (e) {
			console.error("Failed to fetch log history", e);
		}

		// 2. Catch up with current session log
		await this.catchUp(instanceSlug);

		// 3. Listen for live events
		const logUnlisten = await listen<{
			lines: Array<{
				instance_id: string;
				line: string;
				stream: "stdout" | "stderr";
			}>
		}>("core://instance-log", (event) => {
			if (state.isLive) {
				const relevantLines = event.payload.lines
					.filter((l) => l.instance_id === instanceSlug)
					.map((l) => l.line);
				if (relevantLines.length > 0) {
					this.appendRawLines(relevantLines);
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

		return () => {
			logUnlisten();
			launchUnlisten();
			exitUnlisten();
		};
	},

	async catchUp(instanceSlug: string) {
		setState("isCatchingUp", true);
		try {
			const runningMeta = instancesState.runningIds[instanceSlug];
			const since = state.lastCatchupTime || (runningMeta ? runningMeta.startTime : undefined);

			const caughtUpLines = await invoke<string[]>("read_instance_log", {
				instanceIdSlug: instanceSlug,
				lastLines: state.lines.length === 0 ? 1000 : undefined,
				since: since,
			});

			if (state.lines.length === 0) {
				lineIdCounter = 0;
			}
			
			this.appendRawLines(caughtUpLines);
			setState("lastCatchupTime", Math.floor(Date.now() / 1000));
		} catch (e) {
			console.error("Failed to catch up logs", e);
		} finally {
			setState("isCatchingUp", false);
		}
	},

	appendRawLines(rawLines: string[]) {
		const parsed = rawLines.map(parseLine);
		setState("lines", (prev) => {
			const newLines = [...prev, ...parsed];
			// Keep a reasonable buffer for performance, e.g., 5000 lines
			return newLines.slice(-5000);
		});
	},

	async viewHistoricalLog(path: string) {
		setState({ isLive: false, currentLogPath: path, isCatchingUp: true, lines: [] });
		lineIdCounter = 0;

		try {
			const rawLines = await invoke<string[]>("read_specific_log_file", { path });
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
	},

	toggleAutoScroll() {
		setState("autoScroll", !state.autoScroll);
	},

	setAutoScroll(val: boolean) {
		setState("autoScroll", val);
	},
};
