type IdleWindow = Window & {
	requestIdleCallback?: (
		callback: () => void,
		options?: { timeout: number },
	) => number;
};

export function scheduleIdleTask(callback: () => void, timeout = 1500): void {
	const idleWindow = window as IdleWindow;
	if (idleWindow.requestIdleCallback) {
		idleWindow.requestIdleCallback(callback, { timeout });
		return;
	}
	window.setTimeout(callback, Math.min(timeout, 250));
}

export function waitForIdleTask(timeout = 1500): Promise<void> {
	return new Promise((resolve) => scheduleIdleTask(resolve, timeout));
}
