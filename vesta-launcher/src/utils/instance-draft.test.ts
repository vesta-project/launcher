import {
	applyInstanceEditDraft,
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
