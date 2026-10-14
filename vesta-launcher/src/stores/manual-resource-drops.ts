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

interface ListenerOwner {
	session?: ListenerSession;
}

let owner: ListenerOwner | undefined;
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

function closeSession(current: ListenerSession) {
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
}

function registerSession(root: ListenerOwner): ListenerSession {
	const current: ListenerSession = {
		closed: false,
		ready: Promise.resolve(),
		timers: new Map(),
		unlisteners: [],
	};
	root.session = current;
	session = current;
	const active = () => !current.closed && owner === root && session === current;
	const register = async <T>(
		event: string,
		callback: (event: { payload: T }) => void,
	) => {
		const unlisten = await listen<T>(event, callback);
		if (!active()) unlisten();
		else current.unlisteners.push(unlisten);
	};
	current.ready = Promise.all([
		register<ManualDropRequest>(
			"core://manual-resource-drop-choice",
			(event) => {
				if (!active()) return;
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
							if (!active()) return;
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
				if (active()) retire(current, event.payload.decisionId);
			},
		),
	])
		.then(() => undefined)
		.catch((error) => {
			closeSession(current);
			if (root.session === current) root.session = undefined;
			throw error;
		});
	// A failed subscription is surfaced by waitForManualDropChoices on drop.
	void current.ready.catch(() => undefined);
	return current;
}

function closeOwner(root: ListenerOwner) {
	if (owner !== root) return;
	owner = undefined;
	if (root.session) closeSession(root.session);
	root.session = undefined;
}

/** Root ownership outlives failed listener registration attempts. */
export function startManualDropChoiceListener(): () => void {
	if (!hasTauriRuntime() || owner) return () => undefined;
	const root: ListenerOwner = {};
	owner = root;
	registerSession(root);
	return () => closeOwner(root);
}

/** Register the decision listener before the backend can emit a choice. */
export async function waitForManualDropChoices(): Promise<void> {
	const root = owner;
	if (!root) throw new Error("Resource import is unavailable.");
	const current = root.session ?? registerSession(root);
	await current.ready;
	if (current.closed || owner !== root || session !== current)
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
		if (session === current && submitting() === request.decisionId)
			setSubmitting(null);
	}
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		if (owner) closeOwner(owner);
	});
}
