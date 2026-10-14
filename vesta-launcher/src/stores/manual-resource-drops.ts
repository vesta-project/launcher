import type { WorldRef } from "@stores/worlds";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasTauriRuntime } from "@utils/tauri-runtime";
import { createSignal } from "solid-js";

export type DropResourceKind =
	| "mod"
	| "dataPack"
	| "resourcePack"
	| "shader"
	| "world"
	| "modpack";

export interface ResourceDropCandidate {
	id: string;
	name: string;
	kinds: DropResourceKind[];
}

export interface ManualDropRequest {
	operationId: string;
	decisionId: string;
	instanceId: number;
	instanceName: string;
	phase: "resources" | "dependencies";
	candidates: ResourceDropCandidate[];
	dependencies: { id: string; name: string; version: string }[];
	notes: string[];
	expiresAt: string;
}

export interface ResourceDropSelection {
	candidateId: string;
	kind: DropResourceKind;
	world?: WorldRef;
}

export interface ManualDropResponse {
	selections?: ResourceDropSelection[];
	downloadDependencies?: boolean;
	remember?: boolean;
	cancel?: boolean;
}

const [requests, setRequests] = createSignal<ManualDropRequest[]>([]);
export const manualDropRequest = () => requests()[0] ?? null;
const [submitting, setSubmitting] = createSignal<string | null>(null);
export const manualDropSubmitting = () => submitting() !== null;

interface ListenerSession {
	closed: boolean;
	ready: Promise<void>;
	unlisteners: (() => void)[];
	timers: Map<string, ReturnType<typeof setTimeout>>;
}

let session: ListenerSession | undefined;
const MAX_PENDING_CHOICES = 50;

function retire(current: ListenerSession, decisionId: string) {
	clearTimeout(current.timers.get(decisionId));
	current.timers.delete(decisionId);
	setRequests((queue) =>
		queue.filter((item) => item.decisionId !== decisionId),
	);
}

function cancelRequest(request: ManualDropRequest) {
	void invoke("cancel_resource_drop", {
		operationId: request.operationId,
	}).catch(() => undefined);
}

/** Root-owned subscription; late registration and stale cleanup are safe. */
export function startManualDropChoiceListener(): () => void {
	if (!hasTauriRuntime() || session) return () => undefined;
	const current: ListenerSession = {
		closed: false,
		ready: Promise.resolve(),
		timers: new Map(),
		unlisteners: [],
	};
	session = current;
	const register = <T>(
		event: string,
		callback: (event: { payload: T }) => void,
	) =>
		listen<T>(event, callback).then((unlisten) => {
			if (current.closed) unlisten();
			else current.unlisteners.push(unlisten);
		});
	current.ready = Promise.all([
		register<ManualDropRequest>(
			"core://manual-resource-drop-choice",
			(event) => {
				if (current.closed) return;
				const request = event.payload;
				if (requests().some((item) => item.decisionId === request.decisionId))
					return;
				const remaining = Date.parse(request.expiresAt) - Date.now();
				if (
					!Number.isFinite(remaining) ||
					remaining <= 0 ||
					requests().length >= MAX_PENDING_CHOICES
				) {
					cancelRequest(request);
					return;
				}
				setRequests((queue) => [...queue, request]);
				current.timers.set(
					request.decisionId,
					setTimeout(
						() => {
							retire(current, request.decisionId);
							cancelRequest(request);
						},
						Math.min(remaining, 2_147_483_647),
					),
				);
			},
		),
		register<{ decisionId: string }>(
			"core://manual-resource-drop-choice-closed",
			(event) => {
				if (!current.closed) retire(current, event.payload.decisionId);
			},
		),
	])
		.then(() => undefined)
		.catch((error) => {
			current.closed = true;
			for (const unlisten of current.unlisteners.splice(0)) unlisten();
			throw error;
		});
	// A failed subscription is surfaced by waitForManualDropChoices on drop.
	void current.ready.catch(() => undefined);

	return () => {
		current.closed = true;
		for (const unlisten of current.unlisteners.splice(0)) unlisten();
		for (const timer of current.timers.values()) clearTimeout(timer);
		current.timers.clear();
		if (session === current) {
			for (const request of requests()) cancelRequest(request);
			setRequests([]);
			setSubmitting(null);
			session = undefined;
		}
	};
}

/** Register the decision listener before the backend can emit a choice. */
export async function waitForManualDropChoices(): Promise<void> {
	const current = session;
	if (!current || current.closed)
		throw new Error("Resource import is unavailable.");
	await current.ready;
	if (current.closed || session !== current)
		throw new Error("Resource import is unavailable.");
}

export async function submitManualDropChoice(
	request: ManualDropRequest,
	response: ManualDropResponse,
): Promise<void> {
	const current = session;
	if (
		!current ||
		current.closed ||
		manualDropRequest()?.decisionId !== request.decisionId
	)
		throw new Error("This import choice is no longer pending.");
	if (submitting() !== null) return;
	setSubmitting(request.decisionId);
	try {
		await invoke("submit_resource_drop_choice", {
			decisionId: request.decisionId,
			response,
		});
		if (!current.closed && session === current)
			retire(current, request.decisionId);
	} finally {
		if (submitting() === request.decisionId) setSubmitting(null);
	}
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		const current = session;
		if (!current) return;
		current.closed = true;
		for (const unlisten of current.unlisteners.splice(0)) unlisten();
		for (const timer of current.timers.values()) clearTimeout(timer);
		for (const request of requests()) cancelRequest(request);
		setRequests([]);
		session = undefined;
		setSubmitting(null);
	});
}
