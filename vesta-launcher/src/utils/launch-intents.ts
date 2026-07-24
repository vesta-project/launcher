import { openMiniPage } from "@components/page-viewer/page-viewer";
import {
	initializeInstances,
	instancesState,
	setLaunching,
} from "@stores/instances";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "@ui/toast/toast";
import { ACCOUNT_TYPE_GUEST, getActiveAccount } from "@utils/auth";
import { isAllowedNavigatePath } from "@utils/deep-links";
import { launchInstance } from "@utils/instances";
import { hasTauriRuntime } from "@utils/tauri-runtime";

export { generateVestaDeepLink } from "@utils/deep-links";

export type QueuedIntent =
	| { type: "argv"; args: string[] }
	| { type: "path"; path: string };

const processedIntentKeys = new Set<string>();

export function isModpackFilePath(arg: string): boolean {
	return /\.mrpack$/i.test(arg) && !arg.startsWith("vesta://");
}

function intentDedupeKey(intent: QueuedIntent): string {
	if (intent.type === "argv") {
		return `argv:${JSON.stringify(intent.args)}`;
	}
	return `path:${intent.path}`;
}

function shouldProcessIntent(key: string): boolean {
	if (processedIntentKeys.has(key)) {
		return false;
	}
	processedIntentKeys.add(key);
	return true;
}

async function ensureExternalIntentReady(): Promise<boolean> {
	if (hasTauriRuntime()) {
		try {
			await invoke("show_window_from_tray");
		} catch (e) {
			console.warn("Failed to show window for external intent:", e);
		}
	}

	const config = await invoke<any>("get_config");
	if (!config || !config.setup_completed) {
		showToast({
			title: "Setup Required",
			description:
				"Please complete the onboarding process before using 'Open in Vesta'.",
			severity: "error",
			duration: 5000,
		});
		return false;
	}

	const account = await getActiveAccount();
	if (
		!account ||
		account.account_type === ACCOUNT_TYPE_GUEST ||
		account.is_expired
	) {
		showToast({
			title: "Authentication Required",
			description: "Please sign in to a valid account to use 'Open in Vesta'.",
			severity: "error",
			duration: 5000,
		});
		return false;
	}

	return true;
}

export async function launchInstanceBySlug(slug: string): Promise<void> {
	await initializeInstances();
	const inst = instancesState.instances.find(
		(instance) =>
			(instance as any).slug === slug ||
			instance.name.toLowerCase().replace(/ /g, "-") === slug,
	);
	if (!inst) {
		showToast({
			title: "Instance Not Found",
			description: `No instance found for "${slug}".`,
			severity: "error",
			duration: 5000,
		});
		return;
	}

	setLaunching(slug, true);
	try {
		await launchInstance(inst);
	} catch (err) {
		setLaunching(slug, false);
		throw err;
	}
}

export async function openInstanceBySlug(slug: string): Promise<void> {
	await Promise.resolve();
	openMiniPage("/instance", { slug });
}

export function openInstanceTab(slug: string, activeTab: string): void {
	openMiniPage("/instance", { slug, activeTab });
}

export async function handleModpackFileOpen(path: string): Promise<void> {
	if (!(await ensureExternalIntentReady())) {
		return;
	}

	openMiniPage("/install", { modpackPath: path, isModpack: true });
}

export async function handleDeepLinkMetadata(metadata: {
	target: string;
	params: Record<string, string>;
}): Promise<void> {
	switch (metadata.target) {
		case "install":
			openMiniPage("/install", metadata.params);
			return;
		case "resource-details":
			openMiniPage("/resource-details", metadata.params);
			return;
		case "launch-instance": {
			const slug = metadata.params.slug;
			if (!slug) {
				throw new Error("Missing slug for launch-instance link");
			}
			await launchInstanceBySlug(slug);
			return;
		}
		case "open-instance": {
			const slug = metadata.params.slug;
			if (!slug) {
				throw new Error("Missing slug for open-instance link");
			}
			await openInstanceBySlug(slug);
			return;
		}
		case "navigate": {
			const path = metadata.params.path;
			if (!path) {
				throw new Error("Missing path for navigate link");
			}
			if (!isAllowedNavigatePath(path)) {
				throw new Error(`Unsupported navigation path: ${path}`);
			}
			const { path: _path, ...routeParams } = metadata.params;
			openMiniPage(path, routeParams);
			return;
		}
		case "home":
			return;
		default:
			console.warn("Unknown deep link target:", metadata.target);
			openMiniPage("/config", metadata.params);
	}
}

export async function handleLaunchArgs(args: string[]): Promise<void> {
	const ready = await ensureExternalIntentReady();

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg.startsWith("vesta://")) {
			if (!ready) {
				continue;
			}
			const metadata = await invoke<{
				target: string;
				params: Record<string, string>;
			}>("parse_vesta_url", { url: arg });
			await handleDeepLinkMetadata(metadata);
			continue;
		}

		if (isModpackFilePath(arg)) {
			if (!ready) {
				continue;
			}
			openMiniPage("/install", { modpackPath: arg, isModpack: true });
			continue;
		}

		if (arg === "--launch-instance" && args[i + 1]) {
			if (!ready) {
				continue;
			}
			await launchInstanceBySlug(args[i + 1]);
			i++;
			continue;
		}

		if (arg === "--open-instance" && args[i + 1]) {
			if (!ready) {
				continue;
			}
			await openInstanceBySlug(args[i + 1]);
			i++;
			continue;
		}

		if (arg === "--open-resource" && args[i + 2]) {
			if (!ready) {
				continue;
			}
			openMiniPage("/resource-details", {
				platform: args[i + 1],
				projectId: args[i + 2],
			});
			i += 2;
		}
	}
}

export async function handleQueuedIntents(
	intents: QueuedIntent[],
): Promise<void> {
	for (const intent of intents) {
		const key = intentDedupeKey(intent);
		if (!shouldProcessIntent(key)) {
			continue;
		}

		if (intent.type === "argv") {
			await handleLaunchArgs(intent.args);
			continue;
		}

		await handleLaunchArgs([intent.path]);
	}
}

export async function handleDeepLink(url: string): Promise<void> {
	const key = `url:${url}`;
	if (!shouldProcessIntent(key)) {
		return;
	}

	try {
		await handleLaunchArgs([url]);
	} catch (error) {
		console.error("Failed to parse deep link:", url, error);
		showToast({
			title: "Invalid Link",
			description: "The Vesta link you clicked is invalid or unsupported.",
			severity: "error",
			duration: 5000,
		});
	}
}

/** Test helper */
export function resetProcessedIntentKeysForTests(): void {
	processedIntentKeys.clear();
}
