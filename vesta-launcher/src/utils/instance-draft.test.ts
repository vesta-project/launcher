import {
	applyInstanceEditDraft,
	buildInstanceInstallPayload,
	createInstanceInstallDraft,
	type InstanceEditDirty,
	type InstanceEditDraft,
	isInstanceEditDirty,
	toInstanceEditHandoff,
} from "@utils/instance-draft";
import type { Instance } from "@utils/instances";
import { describe, expect, it } from "vitest";

const draft: InstanceEditDraft = {
	name: "Edited",
	iconPath: "icon.png",
	minMemory: 2048,
	maxMemory: 8192,
	javaArgs: "",
	javaPath: "",
	gameWidth: 1920,
	gameHeight: 1080,
	useGlobalResolution: false,
	useGlobalJavaArgs: true,
	useGlobalJavaPath: true,
	useGlobalHooks: false,
	useGlobalEnvironmentVariables: false,
	useGlobalLauncherAction: true,
	launcherActionOnLaunch: "quit",
	preLaunchHook: "",
	postExitHook: "echo done",
	wrapperCommand: "",
	environmentVariables: "FOO=bar",
};

const clean: InstanceEditDirty = {
	name: false,
	icon: false,
	minMem: false,
	maxMem: false,
	jvm: false,
	javaPath: false,
	resolution: false,
	hooks: false,
	env: false,
	launchAction: false,
};

describe("instance edit draft", () => {
	it("detects any dirty field", () => {
		expect(isInstanceEditDirty(clean)).toBe(false);
		expect(isInstanceEditDirty({ ...clean, hooks: true })).toBe(true);
	});

	it("applies draft values without mutating the source instance", () => {
		const source = {
			name: "Original",
			launcherActionOnLaunch: "minimize",
		} as Instance;
		const applied = applyInstanceEditDraft(source, draft);

		expect(applied).not.toBe(source);
		expect(source.name).toBe("Original");
		expect(applied.name).toBe("Edited");
		expect(applied.javaArgs).toBeNull();
		expect(applied.postExitHook).toBe("echo done");
		expect(applied.launcherActionOnLaunch).toBeNull();
	});

	it("preserves the local launcher action when global policy is disabled", () => {
		const applied = applyInstanceEditDraft({} as Instance, {
			...draft,
			useGlobalLauncherAction: false,
		});
		expect(applied.launcherActionOnLaunch).toBe("quit");
	});

	it("serializes handoff values and dirty state together", () => {
		const handoff = toInstanceEditHandoff(draft, { ...clean, name: true });
		expect(handoff.initialName).toBe("Edited");
		expect(handoff.initialMaxMemory).toBe(8192);
		expect(handoff._dirty).toEqual({ ...clean, name: true });
	});
});

describe("instance install draft", () => {
	it("applies initial-data precedence and preserves dirty handoff state", () => {
		const initialized = createInstanceInstallDraft({
			initialData: {
				name: "Restored",
				maxMemory: 6144,
				_dirty: { name: true },
			},
			initialName: "Route name",
			initialMaxMemory: 4096,
			defaultIcon: "default-icon",
			defaultMinMemory: 2048,
			defaultMaxMemory: 3072,
		});

		expect(initialized.name).toBe("Restored");
		expect(initialized.maxMemory).toBe(6144);
		expect(initialized.minMemory).toBe(2048);
		expect(initialized.dirty).toEqual({ name: true });
	});

	it("builds vanilla creation defaults without modpack links", () => {
		const payload = buildInstanceInstallPayload(
			{
				name: "Fresh",
				iconPath: "builtin:placeholder-1",
				minecraftVersion: "1.21.1",
				modloader: "vanilla",
				modloaderVersion: "",
				minMemory: 2048,
				maxMemory: 4096,
			},
			{ isModpack: false, projectId: "ignored" },
		);

		expect(payload.modloaderVersion).toBeNull();
		expect(payload.modpackId).toBeNull();
		expect(payload.useGlobalHooks).toBe(true);
	});

	it("links modpacks and preserves remote icons", () => {
		const payload = buildInstanceInstallPayload(
			{
				name: "Pack",
				iconPath: "https://example.com/icon.png",
				minecraftVersion: "1.21.1",
				modloader: "fabric",
				modloaderVersion: "0.16.0",
				minMemory: 4096,
				maxMemory: 8192,
			},
			{
				isModpack: true,
				projectId: "pack-id",
				platform: "modrinth",
				versionId: "version-id",
			},
		);

		expect(payload.modpackIconUrl).toBe("https://example.com/icon.png");
		expect(payload.modpackId).toBe("pack-id");
		expect(payload.modpackVersionId).toBe("version-id");
	});
});
