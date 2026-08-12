/* @refresh skip */

import { render, screen, waitFor } from "@solidjs/testing-library";
import type { Instance } from "@stores/instances";
import type {
	InstalledResource,
	ResourceProject,
	ResourceVersion,
} from "@stores/resources";
import { createSignal, For } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResourceInstanceSelectionDialog from "./resource-instance-selection-dialog";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	getVersions: vi.fn(),
	instances: [] as Instance[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@stores/instances", () => ({
	instancesState: { instances: mocks.instances },
}));
vi.mock("@stores/resources", () => ({
	resources: { getVersions: mocks.getVersions },
}));
vi.mock("@components/instances/InstanceSelectionDialog", () => ({
	default: (props: any) => (
		<div>
			<For each={props.options}>
				{(option: any) => (
					<button
						type="button"
						data-testid={`option-${option.instance.id}`}
						disabled={option.disabled}
					>
						{option.instance.name} {option.detail ?? ""}
					</button>
				)}
			</For>
		</div>
	),
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((accept, decline) => {
		resolve = accept;
		reject = decline;
	});
	return { promise, resolve, reject };
}

const instance = {
	id: 7,
	name: "Test Instance",
	minecraftVersion: "1.21.1",
	modloader: "fabric",
} as Instance;

const project = (id: string): ResourceProject =>
	({
		id,
		source: "modrinth",
		resource_type: "mod",
		name: `Project ${id}`,
		categories: ["fabric"],
		external_ids: {},
	}) as ResourceProject;

const version = (
	projectId: string,
	overrides: Partial<ResourceVersion> = {},
): ResourceVersion =>
	({
		id: `${projectId}-version`,
		project_id: projectId,
		version_number: "1.0.0",
		game_versions: ["1.21.1"],
		loaders: ["fabric"],
		download_url: "https://example.test/mod.jar",
		file_name: "mod.jar",
		release_type: "release",
		hash: `${projectId}-hash`,
		dependencies: [],
		...overrides,
	}) as ResourceVersion;

const installed = (
	overrides: Partial<InstalledResource> = {},
): InstalledResource =>
	({
		id: 1,
		instance_id: 7,
		platform: "curseforge",
		remote_id: "different-project",
		remote_version_id: "different-version",
		resource_type: "mod",
		local_path: "mods/different.jar",
		display_name: "Different Mod",
		current_version: "1.0.0",
		release_type: "release",
		is_manual: false,
		is_enabled: true,
		last_updated: "",
		...overrides,
	}) as InstalledResource;

describe("ResourceInstanceSelectionDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.instances.splice(0, mocks.instances.length, instance);
	});

	it("uses freshly fetched versions for cross-provider installed matching", async () => {
		mocks.invoke.mockResolvedValue([
			installed({ hash: "target-hash" }),
		]);
		mocks.getVersions.mockResolvedValue([
			version("target", { hash: "target-hash" }),
		]);

		render(() => (
			<ResourceInstanceSelectionDialog
				isOpen={true}
				project={project("target")}
				versions={[]}
				installType="mod"
				onClose={vi.fn()}
				onSelect={vi.fn()}
				onCreateNew={vi.fn()}
			/>
		));

		await waitFor(() =>
			expect(screen.getByTestId("option-7").textContent).toContain(
				"Already installed",
			),
		);
		expect(mocks.invoke).toHaveBeenCalledWith("get_installed_resources", {
			instanceId: 7,
		});
	});

	it("discards a stale version response after the project changes", async () => {
		const first = deferred<ResourceVersion[]>();
		const second = deferred<ResourceVersion[]>();
		mocks.invoke.mockResolvedValue([]);
		mocks.getVersions.mockImplementation((_source: string, id: string) =>
			id === "first" ? first.promise : second.promise,
		);
		const [selectedProject, setSelectedProject] = createSignal(project("first"));

		render(() => (
			<ResourceInstanceSelectionDialog
				isOpen={true}
				project={selectedProject()}
				versions={[]}
				installType="mod"
				onClose={vi.fn()}
				onSelect={vi.fn()}
				onCreateNew={vi.fn()}
			/>
		));

		await waitFor(() => expect(mocks.getVersions).toHaveBeenCalledTimes(1));
		setSelectedProject(project("second"));
		await waitFor(() => expect(mocks.getVersions).toHaveBeenCalledTimes(2));
		second.resolve([version("second")]);
		await waitFor(() =>
			expect(
				(screen.getByTestId("option-7") as HTMLButtonElement).disabled,
			).toBe(false),
		);
		first.resolve([
			version("first", { game_versions: ["1.20.1"], loaders: ["forge"] }),
		]);
		await Promise.resolve();
		expect(
			(screen.getByTestId("option-7") as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("discards installed rows loaded for a previous project", async () => {
		const first = deferred<InstalledResource[]>();
		const second = deferred<InstalledResource[]>();
		mocks.invoke
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise);
		const [selectedProject, setSelectedProject] = createSignal(project("first"));
		const suppliedVersions = [version("second")];

		render(() => (
			<ResourceInstanceSelectionDialog
				isOpen={true}
				project={selectedProject()}
				versions={suppliedVersions}
				installType="mod"
				onClose={vi.fn()}
				onSelect={vi.fn()}
				onCreateNew={vi.fn()}
			/>
		));

		await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
		setSelectedProject(project("second"));
		await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
		second.resolve([]);
		await waitFor(() =>
			expect(
				(screen.getByTestId("option-7") as HTMLButtonElement).disabled,
			).toBe(false),
		);
		first.resolve([
			installed({
				platform: "modrinth",
				remote_id: "second",
				remote_version_id: "second-version",
			}),
		]);
		await Promise.resolve();
		expect(
			(screen.getByTestId("option-7") as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("blocks selection when installed resources cannot be verified", async () => {
		mocks.invoke.mockRejectedValue(new Error("offline"));
		mocks.getVersions.mockResolvedValue([version("target")]);

		render(() => (
			<ResourceInstanceSelectionDialog
				isOpen={true}
				project={project("target")}
				versions={[version("target")]}
				installType="mod"
				onClose={vi.fn()}
				onSelect={vi.fn()}
				onCreateNew={vi.fn()}
			/>
		));

		await waitFor(() =>
			expect(screen.getByTestId("option-7").textContent).toContain(
				"Could not verify installed resources",
			),
		);
		expect(
			(screen.getByTestId("option-7") as HTMLButtonElement).disabled,
		).toBe(true);
	});
});
