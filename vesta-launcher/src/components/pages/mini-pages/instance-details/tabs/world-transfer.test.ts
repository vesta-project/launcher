import type { Instance } from "@stores/instances";
import { describe, expect, it } from "vitest";
import {
	getWorldTransferWarnings,
	isPureVanillaInstance,
} from "./world-transfer";

const instance = (overrides: Partial<Instance> = {}): Instance => ({
	id: 1,
	name: "Vanilla",
	minecraftVersion: "1.21.1",
	modloader: null,
	modloaderVersion: null,
	javaPath: null,
	javaArgs: null,
	gameDirectory: null,
	minMemory: 1024,
	maxMemory: 4096,
	iconPath: null,
	lastPlayed: null,
	totalPlaytimeMinutes: 0,
	createdAt: null,
	updatedAt: null,
	modpackId: null,
	modpackVersionId: null,
	modpackPlatform: null,
	modpackIconUrl: null,
	iconData: null,
	useGlobalResolution: true,
	useGlobalJavaArgs: true,
	useGlobalJavaPath: true,
	useGlobalHooks: true,
	useGlobalEnvironmentVariables: true,
	useGlobalGameDir: true,
	useGlobalLauncherAction: true,
	launcherActionOnLaunch: null,
	gameWidth: 854,
	gameHeight: 480,
	environmentVariables: null,
	preLaunchHook: null,
	postExitHook: null,
	wrapperCommand: null,
	useGlobalSandbox: true,
	sandboxPreset: null,
	sandboxWrapperNesting: null,
	sandboxExtraPaths: "[]",
	...overrides,
});

describe("world transfer compatibility", () => {
	it("recognizes unlinked vanilla instances", () => {
		expect(isPureVanillaInstance(instance())).toBe(true);
		expect(isPureVanillaInstance(instance({ modloader: "fabric" }))).toBe(
			false,
		);
	});

	it("enumerates version, modpack, modded, and saved-version differences", () => {
		const warnings = getWorldTransferWarnings(
			{ gameVersion: "1.20.1" },
			instance({ modloader: "fabric", modpackId: "a", modpackVersionId: "1" }),
			instance({
				id: 2,
				minecraftVersion: "1.21.4",
				modpackId: "b",
				modpackVersionId: "2",
			}),
		);
		expect(warnings).toHaveLength(4);
		expect(warnings.join(" ")).toContain("1.20.1");
	});
});
