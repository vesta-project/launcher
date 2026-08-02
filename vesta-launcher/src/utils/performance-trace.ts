export interface PerformanceTraceEntry {
	name: string;
	startTime: number;
	duration?: number;
	detail?: Record<string, unknown>;
}

const MAX_TRACE_ENTRIES = 200;
const traceEntries: PerformanceTraceEntry[] = [];

function retain(entry: PerformanceTraceEntry) {
	if (!import.meta.env.DEV) return;
	traceEntries.push(entry);
	if (traceEntries.length > MAX_TRACE_ENTRIES) {
		traceEntries.splice(0, traceEntries.length - MAX_TRACE_ENTRIES);
	}
}

export function markPerformance(
	name: string,
	detail?: Record<string, unknown>,
) {
	const startTime = performance.now();
	performance.mark(name);
	retain({ name, startTime, detail });
}

export function measurePerformance(
	name: string,
	startMark: string,
	endMark?: string,
	detail?: Record<string, unknown>,
) {
	try {
		const measure = performance.measure(name, startMark, endMark);
		retain({
			name,
			startTime: measure.startTime,
			duration: measure.duration,
			detail,
		});
	} catch {
		// A missing start mark must never affect application behavior.
	}
}

export function afterStablePaint(callback: () => void): () => void {
	let firstFrame = 0;
	let secondFrame = 0;
	let cancelled = false;

	firstFrame = requestAnimationFrame(() => {
		secondFrame = requestAnimationFrame(() => {
			if (!cancelled) callback();
		});
	});

	return () => {
		cancelled = true;
		cancelAnimationFrame(firstFrame);
		cancelAnimationFrame(secondFrame);
	};
}

export function getPerformanceTrace(): readonly PerformanceTraceEntry[] {
	return traceEntries;
}

