/**
 * Pure routing for native file drops. No Tauri imports: every side effect goes
 * through injected dependencies. Ported from the original launcher controller.
 *
 * Positions handed to handle() must already be CSS pixels (see coordinates.ts).
 * Paths are never logged. Diagnostics carry codes, zone ids and points only.
 */
import type { ClassifiedDropPath } from "./classify";

export interface Point {
	x: number;
	y: number;
}

export type DropAccept = "files" | "folders" | "all";
export type DropZoneState = "idle" | "active" | "rejected";
export type RejectionReason = "not-accepted-type" | "extension" | "unreadable";

export interface RejectedDropItem {
	path: string;
	reason: RejectionReason;
}

export interface DropZoneRegistration {
	id: string;
	getElement(): HTMLElement | null | undefined;
	getAccept(): DropAccept;
	getAllowedExtensions(): string[];
	isDisabled(): boolean;
	onFileDrop(paths: string[]): void;
	onRejected?(items: RejectedDropItem[]): void;
	onStateChange(state: DropZoneState): void;
}

/** `position` is already CSS pixels. */
export type NativeDropEvent =
	| { type: "enter"; paths: string[]; position: Point }
	| { type: "over"; position: Point }
	| { type: "drop"; paths: string[]; position: Point }
	| { type: "leave" };

export interface DropControllerDiagnostic {
	sessionId: number;
	event: NativeDropEvent["type"];
	cssPoint: Point | null;
	targetZoneId: string | null;
	rejection: RejectionReason | null;
	pendingClassification: boolean;
}

export interface DropControllerDeps {
	classify(paths: string[]): Promise<ClassifiedDropPath[]>;
	elementsFromPoint(x: number, y: number): Element[];
	onDiagnostic?(diagnostic: DropControllerDiagnostic): void;
}

/**
 * A raw view of the drag for features that are not drop targets themselves, such
 * as opening a folder while a file is held over it. `hits` is the same
 * top-first element list the controller hit-tests, computed once per event.
 * "end" means the drag left the window or was cancelled. "drop" means the
 * files were released and delivery is under way.
 */
export interface DragObservation {
	type: "move" | "drop" | "end";
	point: Point | null;
	hits: Element[];
}

export type DragObserver = (observation: DragObservation) => void;

export interface DropController {
	register(registration: DropZoneRegistration): () => void;
	/** Observers are called synchronously and never see file paths. */
	observe(observer: DragObserver): () => void;
	handle(event: NativeDropEvent): void;
	cancel(): void;
	dispose(): void;
}

/** Lowercased text after the last dot of the last path segment, or "". Matches the old sniffer manager. */
export function extensionOf(path: string): string {
	const segments = path.split(/[/\\]/);
	const lastSegment = segments[segments.length - 1] ?? "";
	const lastDot = lastSegment.lastIndexOf(".");
	if (lastDot === -1) {
		return "";
	}
	return lastSegment.substring(lastDot).toLowerCase();
}

/** Returns the reason an item is rejected by a zone's policy, or null when accepted. */
export function rejectionReasonFor(
	item: ClassifiedDropPath,
	accept: DropAccept,
	allowedExtensions: readonly string[],
): RejectionReason | null {
	if (item.kind === "missing" || item.kind === "inaccessible") {
		return "unreadable";
	}
	if (item.kind === "other") {
		return "not-accepted-type";
	}
	if (accept === "files" && item.kind !== "file") {
		return "not-accepted-type";
	}
	if (accept === "folders" && item.kind !== "directory") {
		return "not-accepted-type";
	}
	if (item.kind === "file" && allowedExtensions.length > 0) {
		const extension = extensionOf(item.path);
		const allowed = allowedExtensions.some(
			(candidate) => candidate.toLowerCase() === extension,
		);
		if (!allowed) {
			return "extension";
		}
	}
	return null;
}

export function evaluateDropItems(
	items: ClassifiedDropPath[],
	accept: DropAccept,
	allowedExtensions: readonly string[],
): { accepted: string[]; rejected: RejectedDropItem[] } {
	const accepted: string[] = [];
	const rejected: RejectedDropItem[] = [];
	for (const item of items) {
		const reason = rejectionReasonFor(item, accept, allowedExtensions);
		if (reason === null) {
			accepted.push(item.path);
		} else {
			rejected.push({ path: item.path, reason });
		}
	}
	return { accepted, rejected };
}

interface Entry {
	reg: DropZoneRegistration;
	state: DropZoneState;
	/** Set once unregistered or replaced. Never reverts. */
	removed: boolean;
}

/**
 * dragging: entered and hovering. dropping: drop received, awaiting re-classification.
 * finished: drop handled. A finished session still blocks duplicate drops until
 * the next enter, leave or cancel.
 */
type SessionPhase = "dragging" | "dropping" | "finished";

interface Session {
	id: number;
	phase: SessionPhase;
	classified: ClassifiedDropPath[] | null;
	hovered: Entry | null;
}

interface Outcome {
	sessionId: number;
	cssPoint: Point | null;
	target: Entry | null;
	rejection: RejectionReason | null;
	pending: boolean;
}

interface ZoneSnapshot {
	entry: Entry;
	element: HTMLElement;
	disabled: boolean;
}

const noop = (): void => undefined;

function safeCall(label: string, fn: () => void): void {
	try {
		fn();
	} catch {
		// Deliberately generic: error objects can contain paths.
		console.error(`[FileDrop] ${label} callback threw`);
	}
}

function depthOf(element: Element): number {
	let depth = 0;
	for (let node = element.parentElement; node; node = node.parentElement) {
		depth += 1;
	}
	return depth;
}

function innermost(candidates: ZoneSnapshot[]): ZoneSnapshot {
	// Every candidate contains the same element, so they form an ancestor chain:
	// the deepest one is the innermost.
	let best = candidates[0];
	for (const candidate of candidates.slice(1)) {
		if (depthOf(candidate.element) > depthOf(best.element)) {
			best = candidate;
		}
	}
	return best;
}

export function createDropController(deps: DropControllerDeps): DropController {
	const zones = new Map<string, Entry>();
	const observers = new Set<DragObserver>();
	let activeSession: Session | null = null;
	let nextSessionId = 1;
	let disposed = false;

	function isLive(session: Session): boolean {
		return !disposed && activeSession === session;
	}

	function openSession(phase: SessionPhase): Session {
		const session: Session = {
			id: nextSessionId,
			phase,
			classified: null,
			hovered: null,
		};
		nextSessionId += 1;
		activeSession = session;
		return session;
	}

	/** Never rejects. A failing classifier means every path is unreadable. */
	function classifyPaths(paths: string[]): Promise<ClassifiedDropPath[]> {
		return new Promise<ClassifiedDropPath[]>((resolve) => {
			resolve(deps.classify(paths));
		}).catch(() => {
			console.error(
				"[FileDrop] Classification failed; treating items as unreadable",
			);
			return paths.map(
				(path): ClassifiedDropPath => ({
					path,
					kind: "inaccessible",
					isSymlink: false,
				}),
			);
		});
	}

	function hitsAt(point: Point): Element[] {
		return deps.elementsFromPoint(point.x, point.y);
	}

	function notifyObservers(observation: DragObservation): void {
		// Snapshot: an observer can unregister another observer during notification.
		// oxlint-disable-next-line unicorn/no-useless-spread
		for (const observer of [...observers]) {
			safeCall("observer", () => observer(observation));
		}
	}

	function attachedElement(entry: Entry): HTMLElement | null {
		const element = entry.reg.getElement();
		return element && element.isConnected ? element : null;
	}

	function isEligible(entry: Entry): boolean {
		return (
			!entry.removed &&
			!entry.reg.isDisabled() &&
			attachedElement(entry) !== null
		);
	}

	function snapshotZones(): ZoneSnapshot[] {
		const snapshots: ZoneSnapshot[] = [];
		for (const entry of zones.values()) {
			const element = attachedElement(entry);
			if (element) {
				snapshots.push({ entry, element, disabled: entry.reg.isDisabled() });
			}
		}
		return snapshots;
	}

	/**
	 * Walks the hit list top-first. The first element inside an enabled zone decides
	 * the target. An element inside only disabled zones is transparent. An element
	 * inside no zone is an overlay above the zones, so the point is blocked.
	 */
	function findTarget(hits: Element[]): Entry | null {
		const snapshots = snapshotZones();
		for (const element of hits) {
			const containing = snapshots.filter((zone) =>
				zone.element.contains(element),
			);
			const enabled = containing.filter((zone) => !zone.disabled);
			if (enabled.length > 0) {
				return innermost(enabled).entry;
			}
			if (containing.length > 0) {
				continue;
			}
			return null;
		}
		return null;
	}

	function desiredState(entry: Entry): DropZoneState {
		const session = activeSession;
		if (
			!session ||
			session.phase !== "dragging" ||
			session.hovered !== entry ||
			entry.reg.isDisabled() ||
			!session.classified ||
			session.classified.length === 0
		) {
			return "idle";
		}
		const { accepted } = evaluateDropItems(
			session.classified,
			entry.reg.getAccept(),
			entry.reg.getAllowedExtensions(),
		);
		return accepted.length > 0 ? "active" : "rejected";
	}

	function setState(entry: Entry, next: DropZoneState): void {
		if (entry.state === next) {
			return;
		}
		entry.state = next;
		safeCall("onStateChange", () => entry.reg.onStateChange(next));
	}

	function refreshStates(): void {
		// Snapshot: callbacks may unregister zones while states are delivered.
		// oxlint-disable-next-line unicorn/no-useless-spread
		for (const entry of [...zones.values()]) {
			if (!entry.removed) {
				setState(entry, desiredState(entry));
			}
		}
	}

	function retire(entry: Entry): void {
		entry.removed = true;
		const session = activeSession;
		if (session && session.hovered === entry) {
			session.hovered = null;
		}
		setState(entry, "idle");
	}

	function rejectionFor(
		session: Session,
		entry: Entry | null,
	): RejectionReason | null {
		if (!entry || !session.classified) {
			return null;
		}
		const { rejected } = evaluateDropItems(
			session.classified,
			entry.reg.getAccept(),
			entry.reg.getAllowedExtensions(),
		);
		return rejected[0]?.reason ?? null;
	}

	function onEnter(paths: string[], position: Point): Outcome {
		const session = openSession("dragging");
		const hits = hitsAt(position);
		session.hovered = findTarget(hits);
		// Idle until classification resolves.
		refreshStates();
		notifyObservers({ type: "move", point: position, hits });
		void classifyPaths(paths).then((classified) => {
			if (!isLive(session) || session.phase !== "dragging") {
				return;
			}
			session.classified = classified;
			refreshStates();
		});
		return {
			sessionId: session.id,
			cssPoint: position,
			target: session.hovered,
			rejection: null,
			pending: true,
		};
	}

	// Synchronous. No awaits.
	function onOver(position: Point): Outcome {
		const session = activeSession;
		if (!session || session.phase !== "dragging") {
			return {
				sessionId: session?.id ?? 0,
				cssPoint: position,
				target: null,
				rejection: null,
				pending: false,
			};
		}
		const hits = hitsAt(position);
		session.hovered = findTarget(hits);
		refreshStates();
		notifyObservers({ type: "move", point: position, hits });
		return {
			sessionId: session.id,
			cssPoint: position,
			target: session.hovered,
			rejection: rejectionFor(session, session.hovered),
			pending: session.classified === null,
		};
	}

	function onDrop(paths: string[], position: Point): Outcome {
		const current = activeSession;
		if (current && current.phase !== "dragging") {
			// Duplicate drop for a session that is already dropping or finished.
			return {
				sessionId: current.id,
				cssPoint: position,
				target: null,
				rejection: null,
				pending: current.phase === "dropping",
			};
		}
		// A drop with no live session starts a fresh one.
		const session = current ?? openSession("dropping");
		session.phase = "dropping";
		session.hovered = null;
		const hits = hitsAt(position);
		const target = findTarget(hits);
		refreshStates();
		notifyObservers({ type: "drop", point: position, hits });
		// Re-classify the drop's own paths. The enter cache is not trusted.
		void classifyPaths(paths).then((classified) =>
			finishDrop(session, target, position, classified),
		);
		return {
			sessionId: session.id,
			cssPoint: position,
			target,
			rejection: null,
			pending: true,
		};
	}

	function finishDrop(
		session: Session,
		target: Entry | null,
		position: Point,
		classified: ClassifiedDropPath[],
	): void {
		if (!isLive(session) || session.phase !== "dropping") {
			return;
		}
		session.phase = "finished";
		const deliverable = target !== null && isEligible(target) ? target : null;
		let rejection: RejectionReason | null = null;
		if (deliverable) {
			const { accepted, rejected } = evaluateDropItems(
				classified,
				deliverable.reg.getAccept(),
				deliverable.reg.getAllowedExtensions(),
			);
			rejection = rejected[0]?.reason ?? null;
			if (accepted.length > 0) {
				safeCall("onFileDrop", () => deliverable.reg.onFileDrop(accepted));
			}
			if (rejected.length > 0) {
				safeCall("onRejected", () => deliverable.reg.onRejected?.(rejected));
			}
		}
		emitDiagnostic("drop", {
			sessionId: session.id,
			cssPoint: position,
			target: deliverable,
			rejection,
			pending: false,
		});
	}

	function onLeave(): Outcome {
		const session = activeSession;
		if (session && session.phase === "dropping") {
			// A drop is already being resolved. A stray leave after it must not lose
			// the drop (cancel() and dispose() still do).
			return {
				sessionId: session.id,
				cssPoint: null,
				target: null,
				rejection: null,
				pending: true,
			};
		}
		activeSession = null;
		if (session) {
			session.phase = "finished";
		}
		refreshStates();
		notifyObservers({ type: "end", point: null, hits: [] });
		return {
			sessionId: session?.id ?? 0,
			cssPoint: null,
			target: null,
			rejection: null,
			pending: false,
		};
	}

	function emitDiagnostic(
		event: NativeDropEvent["type"],
		outcome: Outcome,
	): void {
		if (!deps.onDiagnostic) {
			return;
		}
		const diagnostic: DropControllerDiagnostic = {
			sessionId: outcome.sessionId,
			event,
			cssPoint: outcome.cssPoint,
			targetZoneId: outcome.target?.reg.id ?? null,
			rejection: outcome.rejection,
			pendingClassification: outcome.pending,
		};
		safeCall("onDiagnostic", () => deps.onDiagnostic?.(diagnostic));
	}

	return {
		register(registration) {
			if (disposed) {
				return noop;
			}
			const entry: Entry = { reg: registration, state: "idle", removed: false };
			const previous = zones.get(registration.id);
			zones.set(registration.id, entry);
			if (previous) {
				// Carry the hover over to the replacement so it is not left stale.
				const session = activeSession;
				if (session && session.hovered === previous) {
					session.hovered = entry;
				}
				retire(previous);
				refreshStates();
			}
			return () => {
				if (zones.get(registration.id) !== entry) {
					return;
				}
				zones.delete(registration.id);
				retire(entry);
			};
		},

		observe(observer) {
			if (disposed) {
				return noop;
			}
			observers.add(observer);
			return () => {
				observers.delete(observer);
			};
		},

		handle(event) {
			if (disposed) {
				return;
			}
			let outcome: Outcome;
			switch (event.type) {
				case "enter":
					outcome = onEnter(event.paths, event.position);
					break;
				case "over":
					outcome = onOver(event.position);
					break;
				case "drop":
					outcome = onDrop(event.paths, event.position);
					break;
				case "leave":
					outcome = onLeave();
					break;
			}
			emitDiagnostic(event.type, outcome);
		},

		cancel() {
			if (disposed) {
				return;
			}
			const hadSession = activeSession !== null;
			activeSession = null;
			refreshStates();
			if (hadSession) {
				notifyObservers({ type: "end", point: null, hits: [] });
			}
		},

		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			activeSession = null;
			observers.clear();
			const entries = [...zones.values()];
			zones.clear();
			for (const entry of entries) {
				retire(entry);
			}
		},
	};
}
