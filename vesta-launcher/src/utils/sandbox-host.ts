import type { SandboxPresetValue } from "@components/settings/sandbox-policy-ui";
import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "@utils/tauri-runtime";

export type SandboxHostSupport = {
	hostOs: string;
	enforcementAvailable: boolean;
	enforcementBackend: string | null;
	bubblewrapAvailable: boolean;
	bubblewrapPath: string | null;
	missingRequirementMessage: string | null;
};

type SandboxHostSupportResponse = {
	hostOs: string;
	enforcementAvailable: boolean;
	enforcementBackend?: string | null;
	bubblewrapAvailable: boolean;
	bubblewrapPath?: string | null;
	missingRequirementMessage?: string | null;
};

let cachedSupport: SandboxHostSupport | null = null;
let supportPromise: Promise<SandboxHostSupport> | null = null;

function mapSupport(response: SandboxHostSupportResponse): SandboxHostSupport {
	return {
		hostOs: response.hostOs,
		enforcementAvailable: response.enforcementAvailable,
		enforcementBackend: response.enforcementBackend ?? null,
		bubblewrapAvailable: response.bubblewrapAvailable,
		bubblewrapPath: response.bubblewrapPath ?? null,
		missingRequirementMessage: response.missingRequirementMessage ?? null,
	};
}

export function isEnforcedSandboxPreset(preset: SandboxPresetValue): boolean {
	return preset === "modded" || preset === "paranoid";
}

function nonTauriSandboxHostSupport(): SandboxHostSupport {
	return {
		hostOs: "unknown",
		enforcementAvailable: false,
		enforcementBackend: null,
		bubblewrapAvailable: false,
		bubblewrapPath: null,
		missingRequirementMessage:
			"Sandbox enforcement requires the Vesta desktop runtime and is unavailable in browser previews.",
	};
}

function fetchSandboxHostSupportFromBackend(): Promise<SandboxHostSupport> {
	if (!supportPromise) {
		const request = invoke<SandboxHostSupportResponse>(
			"get_sandbox_host_support",
		)
			.then(mapSupport)
			.then((support) => {
				// An invalidation may have started a newer host capability check.
				if (supportPromise === request) cachedSupport = support;
				return support;
			})
			.finally(() => {
				if (supportPromise === request) supportPromise = null;
			});
		supportPromise = request;
	}

	return supportPromise;
}

export async function fetchSandboxHostSupport(): Promise<SandboxHostSupport> {
	if (!hasTauriRuntime()) {
		return nonTauriSandboxHostSupport();
	}

	if (cachedSupport) {
		return cachedSupport;
	}

	return fetchSandboxHostSupportFromBackend();
}

export async function fetchSandboxHostSupportForce(): Promise<SandboxHostSupport> {
	if (!hasTauriRuntime()) {
		return nonTauriSandboxHostSupport();
	}

	invalidateSandboxHostSupportCache();
	return fetchSandboxHostSupportFromBackend();
}

export async function refreshSandboxHostSupport(): Promise<SandboxHostSupport> {
	return fetchSandboxHostSupportForce();
}

export function invalidateSandboxHostSupportCache() {
	cachedSupport = null;
	supportPromise = null;
}

export function sandboxPresetBlockedCopy(support: SandboxHostSupport): {
	title: string;
	description: string;
} {
	const description =
		support.missingRequirementMessage ??
		"Sandbox enforcement is unavailable on this system.";

	return {
		title: "Sandbox unavailable",
		description,
	};
}

export async function canSelectSandboxPreset(
	preset: SandboxPresetValue,
): Promise<boolean> {
	if (!isEnforcedSandboxPreset(preset)) {
		return true;
	}

	const support = await fetchSandboxHostSupport();
	return support.enforcementAvailable;
}

export async function guardSandboxPresetChange(
	next: SandboxPresetValue,
): Promise<{ allowed: boolean; support: SandboxHostSupport }> {
	const support = isEnforcedSandboxPreset(next)
		? await fetchSandboxHostSupportForce()
		: await fetchSandboxHostSupport();
	if (!isEnforcedSandboxPreset(next) || support.enforcementAvailable) {
		return { allowed: true, support };
	}

	return { allowed: false, support };
}
