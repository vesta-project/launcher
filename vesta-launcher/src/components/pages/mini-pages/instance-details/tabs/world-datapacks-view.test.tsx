/* @refresh skip */

import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { WorldSummary } from "@stores/worlds";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorldDatapacksView } from "./WorldDatapacksView";
import { WorldCard } from "./WorldsTab";
import {
	openWorldDatapackBrowser,
	openWorldDatapackDetails,
} from "./world-datapack-navigation";

const mocks = vi.hoisted(() => ({
	listWorldDatapacks: vi.fn().mockResolvedValue(undefined),
	checkWorldDatapackUpdates: vi.fn().mockResolvedValue(undefined),
	openWorldDatapacksFolder: vi.fn().mockResolvedValue(undefined),
	toggleWorldDatapack: vi.fn().mockResolvedValue(undefined),
	deleteWorldDatapack: vi.fn().mockResolvedValue({
		removedCompanionCount: 0,
		retainedCompanionCount: 0,
		cleanupWarning: null,
	}),
	confirm: vi.fn().mockResolvedValue(true),
	showToast: vi.fn(),
	setType: vi.fn(),
	setInstance: vi.fn(),
	setGameVersion: vi.fn(),
	getProject: vi.fn().mockResolvedValue({
		id: "pack",
		source: "modrinth",
		resource_type: "mod",
		name: "Managed Pack",
	}),
	install: vi.fn().mockResolvedValue("task"),
	invoke: vi.fn().mockImplementation((command: string, args?: any) => {
		if (command === "get_cached_resource_projects_by_provider") {
			return Promise.resolve(
				(args?.refs ?? []).map((ref: { platform: string; id: string }) => ({
					id: ref.id,
					source: ref.platform,
					name: ref.id === "recipes_plus" ? "Recipes Plus" : "Managed Pack",
					icon_url: args?.hydrateIcons
						? "data:image/png;base64,cHJvdmlkZXI="
						: `https://example.test/${ref.id}.png`,
					has_cached_icon: Boolean(args?.hydrateIcons),
				})),
			);
		}
		if (command === "get_or_hydrate_resource_projects") {
			return Promise.resolve([
				{
					id: "pack",
					source: "modrinth",
					name: "Managed Pack",
					icon_url: "https://example.test/pack.png",
					has_cached_icon: false,
				},
			]);
		}
		if (command === "hydrate_resource_project_icons") {
			return Promise.resolve([
				{
					id: "pack",
					source: "modrinth",
					name: "Managed Pack",
					icon_url: "data:image/png;base64,cGFjaw==",
					has_cached_icon: true,
				},
			]);
		}
		return Promise.resolve(undefined);
	}),
	navigate: vi.fn(),
	worldsState: {
		byInstance: {},
		loading: {},
		errors: {},
	},
	worldDatapacksState: {
		byWorld: {} as Record<string, unknown>,
		updatesByWorld: {} as Record<string, unknown>,
		loading: {} as Record<string, boolean>,
		updatesLoading: {} as Record<string, boolean>,
		errors: {} as Record<string, string | null>,
		updateErrors: {} as Record<string, string | null>,
	},
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: mocks.invoke,
	Channel: class {
		onmessage?: (message: unknown) => void;
	},
}));

vi.mock("@assets/back-arrow.svg", () => ({
	default: () => <svg aria-hidden="true" />,
}));
vi.mock("@assets/folder.svg", () => ({
	default: () => <svg aria-hidden="true" />,
}));
vi.mock("@assets/download-compact.svg", () => ({
	default: () => <svg aria-hidden="true" />,
}));
vi.mock("@assets/plus.svg", () => ({
	default: () => <svg aria-hidden="true" />,
}));
vi.mock("@assets/reload.svg", () => ({
	default: () => <svg aria-hidden="true" />,
}));
vi.mock("@assets/timer.svg", () => ({
	default: () => <svg aria-hidden="true" />,
}));
vi.mock("@assets/trash.svg", () => ({
	default: () => <svg aria-hidden="true" />,
}));

vi.mock("@stores/worlds", () => ({
	worldsState: mocks.worldsState,
	worldDatapacksState: mocks.worldDatapacksState,
	worldRefKey: (world: { instanceId: number; directoryName: string }) =>
		`${world.instanceId}:${world.directoryName}`,
	listInstanceWorlds: vi.fn().mockResolvedValue([]),
	listWorldDatapacks: mocks.listWorldDatapacks,
	checkWorldDatapackUpdates: mocks.checkWorldDatapackUpdates,
	openWorldFolder: vi.fn().mockResolvedValue(undefined),
	openWorldDatapacksFolder: mocks.openWorldDatapacksFolder,
	toggleWorldDatapack: mocks.toggleWorldDatapack,
	deleteWorldDatapack: mocks.deleteWorldDatapack,
	transferWorld: vi.fn().mockResolvedValue("task"),
}));

vi.mock("@stores/resources", () => ({
	resources: {
		setType: mocks.setType,
		setInstance: mocks.setInstance,
		setGameVersion: mocks.setGameVersion,
		getProject: mocks.getProject,
		install: mocks.install,
	},
}));

vi.mock("@stores/instances", () => ({ instancesState: { instances: [] } }));
vi.mock("@stores/dialog-store", () => ({
	dialogStore: { confirm: mocks.confirm },
}));
vi.mock("@ui/toast/toast", () => ({ showToast: mocks.showToast }));
vi.mock("@components/instances/InstanceSelectionDialog", () => ({
	default: () => null,
}));
vi.mock("@components/worlds/WorldIcon", () => ({
	WorldIcon: (props: any) => <div data-testid="world-icon">{props.name}</div>,
}));
vi.mock("@ui/avatar", () => ({
	ResourceAvatar: (props: any) => (
		<div
			data-testid="pack-avatar"
			data-name={props.name}
			data-icon={props.icon ?? ""}
		/>
	),
}));
vi.mock("@ui/badge/badge", () => ({
	Badge: (props: any) => <span>{props.children}</span>,
}));
vi.mock("@ui/button/button", () => ({
	default: (props: any) => (
		<button
			type="button"
			disabled={props.disabled}
			aria-label={props["aria-label"]}
			onClick={props.onClick}
		>
			{props.children}
		</button>
	),
}));
vi.mock("@ui/context-menu/context-menu", () => ({
	ContextMenu: (props: any) => <div>{props.children}</div>,
	ContextMenuContent: (props: any) => <div>{props.children}</div>,
	ContextMenuItem: (props: any) => (
		<button type="button" disabled={props.disabled} onClick={props.onSelect}>
			{props.children}
		</button>
	),
	ContextMenuSeparator: () => <hr />,
	ContextMenuTrigger: (props: any) => (
		<article
			role={props.role}
			tabIndex={props.tabIndex}
			aria-label={props["aria-label"]}
			aria-disabled={props["aria-disabled"]}
			onClick={props.onClick}
			onKeyDown={props.onKeyDown}
		>
			{props.children}
		</article>
	),
}));
vi.mock("@ui/dropdown-menu/dropdown-menu", () => ({
	DropdownMenu: (props: any) => <div>{props.children}</div>,
	DropdownMenuContent: (props: any) => <div>{props.children}</div>,
	DropdownMenuItem: (props: any) => (
		<button type="button" disabled={props.disabled} onClick={props.onSelect}>
			{props.children}
		</button>
	),
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuTrigger: (props: any) => (
		<button
			type="button"
			aria-label={props["aria-label"]}
			onClick={props.onClick}
		>
			{props.children}
		</button>
	),
}));
vi.mock("@ui/switch/switch", () => ({
	Switch: (props: any) => (
		<button
			type="button"
			role="switch"
			aria-label={props["aria-label"]}
			aria-checked={props.checked}
			disabled={props.disabled}
			onClick={() => props.onCheckedChange?.(!props.checked)}
		>
			{props.children}
		</button>
	),
	SwitchControl: (props: any) => <span>{props.children}</span>,
	SwitchThumb: () => <span />,
}));

const world = (overrides: Partial<WorldSummary> = {}): WorldSummary => ({
	ref: { instanceId: 7, directoryName: "World One" },
	worldId: null,
	instanceName: "Vanilla",
	folderName: "World One",
	displayName: "Test World",
	lastPlayedAt: "2026-08-01T00:00:00Z",
	sizeBytes: 1_024,
	iconDataUrl: null,
	dataVersion: 4440,
	gameVersion: "1.21.5",
	storageFamily: "anvil",
	levelStatus: "valid",
	metadataStatus: "absent",
	datapackCount: 2,
	managedDatapackCount: 1,
	running: false,
	...overrides,
});

describe("world datapack navigation", () => {
	beforeEach(() => vi.clearAllMocks());

	it("opens a readable world card with pointer and keyboard input", async () => {
		const onOpen = vi.fn();
		render(() => (
			<WorldCard
				world={world()}
				busy={false}
				onMove={vi.fn()}
				onCopy={vi.fn()}
				onDuplicate={vi.fn()}
				onManageDatapacks={vi.fn()}
				onOpen={onOpen}
			/>
		));

		const card = screen.getByRole("button", {
			name: "View datapacks in Test World",
		});
		await fireEvent.click(card);
		await fireEvent.keyDown(card, { key: "Enter" });
		expect(onOpen).toHaveBeenCalledTimes(2);
	});

	it("uses the whole card instead of a separate datapack-count button", async () => {
		const onOpen = vi.fn();
		const onManageDatapacks = vi.fn();
		render(() => (
			<WorldCard
				world={world()}
				busy={false}
				onMove={vi.fn()}
				onCopy={vi.fn()}
				onDuplicate={vi.fn()}
				onManageDatapacks={onManageDatapacks}
				onOpen={onOpen}
			/>
		));

		expect(
			screen.queryByRole("button", {
				name: "Manage 2 datapacks in Test World",
			}),
		).toBeNull();
		await fireEvent.click(screen.getByLabelText("2 datapacks"));
		expect(onOpen).toHaveBeenCalledOnce();
		expect(onManageDatapacks).not.toHaveBeenCalled();

		await fireEvent.click(
			screen.getByRole("button", { name: "Actions for Test World" }),
		);
		expect(onOpen).toHaveBeenCalledOnce();
	});

	it("opens datapack browsing with the owning instance, not a sticky world", () => {
		const targetWorld = world();
		openWorldDatapackBrowser(targetWorld, {
			navigate: mocks.navigate,
		} as any);

		expect(mocks.setType).toHaveBeenCalledWith("datapack");
		expect(mocks.setInstance).toHaveBeenCalledWith(7);
		expect(mocks.setGameVersion).toHaveBeenCalledWith("1.21.5");
		expect(mocks.navigate).toHaveBeenCalledWith("/resources", {
			resourceType: "datapack",
			selectedInstanceId: "7",
			gameVersion: "1.21.5",
		});
	});

	it("opens project details with source-row context but no selected target", () => {
		const targetWorld = world();
		openWorldDatapackDetails(
			targetWorld,
			{
				resourceId: 11,
				fileName: "managed-pack.zip",
				displayName: "Managed Pack",
				entryKind: "file",
				platform: "modrinth",
				projectId: "pack",
				versionId: "old",
				versionNumber: "1.0",
				enabled: true,
				managed: true,
				readOnly: false,
				sizeBytes: 512,
				modifiedAt: null,
			},
			{ navigate: mocks.navigate } as any,
		);

		expect(mocks.navigate).toHaveBeenCalledWith("/resource-details", {
			projectId: "pack",
			platform: "modrinth",
			resourceType: "datapack",
			replacementResourceId: "11",
			replacementWorldInstanceId: "7",
			replacementWorldDirectory: "World One",
		});
	});
});

describe("WorldDatapacksView", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.confirm.mockResolvedValue(true);
		mocks.deleteWorldDatapack.mockResolvedValue({
			removedCompanionCount: 0,
			retainedCompanionCount: 0,
			cleanupWarning: null,
		});
		mocks.worldDatapacksState.loading = {};
		mocks.worldDatapacksState.errors = {};
		mocks.worldDatapacksState.updatesLoading = {};
		mocks.worldDatapacksState.updateErrors = {};
		mocks.worldDatapacksState.byWorld = {
			"7:World One": {
				world: world().ref,
				entries: [
					{
						resourceId: 11,
						fileName: "managed-pack.zip",
						displayName: "Managed Pack",
						entryKind: "file",
						platform: "modrinth",
						projectId: "pack",
						versionId: "version",
						versionNumber: "2.0",
						enabled: true,
						managed: true,
						readOnly: false,
						sizeBytes: 512,
						modifiedAt: null,
					},
					{
						resourceId: null,
						fileName: "Folder Pack",
						displayName: "Folder Pack",
						entryKind: "directory",
						platform: null,
						projectId: null,
						versionId: null,
						versionNumber: null,
						enabled: true,
						managed: false,
						readOnly: true,
						sizeBytes: 256,
						modifiedAt: null,
					},
				],
			},
			"7:Other World": {
				world: { instanceId: 7, directoryName: "Other World" },
				entries: [{ displayName: "Wrong World Pack" }],
			},
		};
		mocks.worldDatapacksState.updatesByWorld = {
			"7:World One": {
				world: world().ref,
				gameVersion: "1.21.5",
				updates: [],
			},
		};
	});

	it("refreshes datapacks when the selected world changes", async () => {
		const [selectedWorld, setSelectedWorld] = createSignal(world());
		render(() => (
			<WorldDatapacksView
				world={selectedWorld()}
				onBack={vi.fn()}
				onAddDatapack={vi.fn()}
				onOpenDatapackDetails={vi.fn()}
			/>
		));

		await waitFor(() =>
			expect(mocks.listWorldDatapacks).toHaveBeenCalledWith(world().ref),
		);
		setSelectedWorld(
			world({ ref: { instanceId: 7, directoryName: "Other World" } }),
		);
		await waitFor(() =>
			expect(mocks.listWorldDatapacks).toHaveBeenCalledWith({
				instanceId: 7,
				directoryName: "Other World",
			}),
		);
		expect(mocks.checkWorldDatapackUpdates).toHaveBeenLastCalledWith({
			instanceId: 7,
			directoryName: "Other World",
		});
	});

	it("renders only the selected world's rows and keeps folder packs read-only", () => {
		render(() => (
			<WorldDatapacksView
				world={world()}
				onBack={vi.fn()}
				onAddDatapack={vi.fn()}
				onOpenDatapackDetails={vi.fn()}
			/>
		));

		expect(screen.getByText("Managed Pack")).toBeTruthy();
		expect(screen.getByText("Folder Pack")).toBeTruthy();
		expect(screen.queryByText("Wrong World Pack")).toBeNull();
		expect(screen.getByText("Read only")).toBeTruthy();
		expect(screen.queryByRole("switch", { name: /Folder Pack/ })).toBeNull();
		expect(
			screen.getByRole("switch", { name: "Disable Managed Pack" }),
		).toBeTruthy();
	});

	it("opens managed project details from the whole row", async () => {
		const onOpenDatapackDetails = vi.fn();
		render(() => (
			<WorldDatapacksView
				world={world()}
				onBack={vi.fn()}
				onAddDatapack={vi.fn()}
				onOpenDatapackDetails={onOpenDatapackDetails}
			/>
		));

		await fireEvent.click(
			screen.getByRole("button", { name: "View details for Managed Pack" }),
		);
		expect(onOpenDatapackDetails).toHaveBeenCalledWith(
			world(),
			expect.objectContaining({ resourceId: 11, projectId: "pack" }),
		);
		await fireEvent.click(
			screen.getByRole("switch", { name: "Disable Managed Pack" }),
		);
		expect(onOpenDatapackDetails).toHaveBeenCalledOnce();
	});

	it("hydrates provider icons once and keeps local packs on the fallback", async () => {
		render(() => (
			<WorldDatapacksView
				world={world()}
				onBack={vi.fn()}
				onAddDatapack={vi.fn()}
				onOpenDatapackDetails={vi.fn()}
			/>
		));

		await waitFor(() =>
			expect(
				screen.getAllByTestId("pack-avatar")[0]?.getAttribute("data-icon"),
			).toBe("data:image/png;base64,cGFjaw=="),
		);
		expect(mocks.invoke).toHaveBeenCalledWith(
			"get_or_hydrate_resource_projects",
			expect.objectContaining({
				refs: [{ platform: "modrinth", id: "pack" }],
			}),
		);
		expect(mocks.invoke).toHaveBeenCalledWith(
			"hydrate_resource_project_icons",
			{ refs: [{ platform: "modrinth", id: "pack" }] },
		);
	});

	it("loads cached icons for providers that are not network sources in this build", async () => {
		mocks.worldDatapacksState.byWorld["7:World One"] = {
			world: world().ref,
			entries: [
				{
					resourceId: 12,
					fileName: "recipes_plus.zip",
					displayName: "Recipes Plus",
					entryKind: "file",
					platform: "smithed",
					projectId: "recipes_plus",
					versionId: "1.3.5",
					versionNumber: "1.3.5",
					enabled: true,
					managed: true,
					readOnly: false,
					sizeBytes: 810_578,
					modifiedAt: null,
				},
			],
		};

		render(() => (
			<WorldDatapacksView
				world={world()}
				onBack={vi.fn()}
				onAddDatapack={vi.fn()}
				onOpenDatapackDetails={vi.fn()}
			/>
		));

		await waitFor(() =>
			expect(screen.getByTestId("pack-avatar").getAttribute("data-icon")).toBe(
				"data:image/png;base64,cHJvdmlkZXI=",
			),
		);
		expect(mocks.invoke).toHaveBeenCalledWith(
			"get_cached_resource_projects_by_provider",
			{
				refs: [{ platform: "smithed", id: "recipes_plus" }],
				hydrateIcons: true,
			},
		);
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"get_or_hydrate_resource_projects",
			expect.objectContaining({
				refs: [{ platform: "smithed", id: "recipes_plus" }],
			}),
		);
	});

	it("returns the exact world from Add datapack", async () => {
		const targetWorld = world();
		const onAddDatapack = vi.fn();
		render(() => (
			<WorldDatapacksView
				world={targetWorld}
				onBack={vi.fn()}
				onAddDatapack={onAddDatapack}
				onOpenDatapackDetails={vi.fn()}
			/>
		));

		await fireEvent.click(screen.getByRole("button", { name: "Add datapack" }));
		expect(onAddDatapack).toHaveBeenCalledWith(targetWorld);
	});

	it("updates the exact world row with its replacement resource ID", async () => {
		const exactVersion = {
			id: "new-version",
			project_id: "pack",
			version_number: "2.1",
			game_versions: ["1.21.5"],
			loaders: ["datapack"],
			download_url: "https://example.test/pack.zip",
			file_name: "pack.zip",
			release_type: "release" as const,
			hash: "abc",
			dependencies: [],
		};
		mocks.worldDatapacksState.updatesByWorld["7:World One"] = {
			world: world().ref,
			gameVersion: "1.21.5",
			updates: [
				{
					resourceId: 11,
					exactVersion,
					manualReviewAvailable: false,
					error: null,
				},
			],
		};
		const targetWorld = world();
		render(() => (
			<WorldDatapacksView
				world={targetWorld}
				onBack={vi.fn()}
				onAddDatapack={vi.fn()}
				onOpenDatapackDetails={vi.fn()}
			/>
		));

		await fireEvent.click(screen.getByRole("button", { name: "Update" }));
		expect(mocks.install).toHaveBeenCalledWith(
			expect.objectContaining({ id: "pack" }),
			exactVersion,
			{ kind: "world", world: targetWorld.ref },
			{
				installType: "datapack",
				compatibilityAcknowledged: false,
				replacementResourceId: 11,
			},
		);
	});

	it("explains when a linked resource pack is retained for another world", async () => {
		mocks.deleteWorldDatapack.mockResolvedValue({
			removedCompanionCount: 0,
			retainedCompanionCount: 1,
			cleanupWarning: "Temporary-file cleanup needs attention.",
		});
		render(() => (
			<WorldDatapacksView
				world={world()}
				onBack={vi.fn()}
				onAddDatapack={vi.fn()}
				onOpenDatapackDetails={vi.fn()}
			/>
		));

		await fireEvent.click(
			screen.getByRole("button", { name: "Remove from world" }),
		);

		await waitFor(() =>
			expect(mocks.deleteWorldDatapack).toHaveBeenCalledWith(world().ref, 11),
		);
		expect(mocks.showToast).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Datapack removed",
				description: expect.stringContaining(
					"retained because Vesta could not prove it was unused",
				),
				severity: "warning",
			}),
		);
		expect(mocks.showToast.mock.calls.at(-1)?.[0].description).toContain(
			"Temporary-file cleanup needs attention.",
		);
	});
});
