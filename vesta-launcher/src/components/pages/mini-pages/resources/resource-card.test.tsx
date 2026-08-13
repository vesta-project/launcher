/* @refresh skip */

import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { ResourceProject, ResourceVersion } from "@stores/resources";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResourceCard from "./resource-card";

const mocks = vi.hoisted(() => ({
	state: {
		resourceType: "resourcepack",
		selectedInstanceId: 7,
		installedResources: [],
		versions: [],
		installingProjectIds: [],
		loader: null,
		gameVersion: null,
		availableCategories: [],
	},
	getVersions: vi.fn(),
	setInstallRequest: vi.fn(),
	install: vi.fn().mockResolvedValue("task"),
	uninstall: vi.fn(),
	navigate: vi.fn(),
	showToast: vi.fn(),
}));

vi.mock("@stores/resources", () => ({
	resources: {
		state: mocks.state,
		getVersions: mocks.getVersions,
		setInstallRequest: mocks.setInstallRequest,
		install: mocks.install,
		uninstall: mocks.uninstall,
	},
}));
vi.mock("@stores/instances", () => ({
	instancesState: {
		instances: [
			{
				id: 7,
				name: "Test Instance",
				minecraftVersion: "1.21.5",
				modloader: "vanilla",
			},
		],
	},
}));
vi.mock("@components/page-viewer/page-viewer", () => ({
	router: () => ({ navigate: mocks.navigate }),
}));
vi.mock("@utils/resources", () => ({
	getProjectCompatibilityForInstance: () => ({ type: "compatible" }),
}));
vi.mock("@ui/toast/toast", () => ({ showToast: mocks.showToast }));
vi.mock("@assets/icons/actions/download.svg", () => ({
	default: () => <svg aria-hidden="true" />,
}));
vi.mock("@assets/icons/content/heart.svg", () => ({
	default: () => <svg aria-hidden="true" />,
}));
vi.mock("@ui/badge", () => ({
	Badge: (props: any) => <span>{props.children}</span>,
}));
vi.mock("@ui/button/button", () => ({
	default: (props: any) => (
		<button type="button" disabled={props.disabled} onClick={props.onClick}>
			{props.children}
		</button>
	),
}));
vi.mock("@ui/tooltip/tooltip", () => ({
	Tooltip: (props: any) => <>{props.children}</>,
	TooltipContent: (props: any) => <div>{props.children}</div>,
	TooltipTrigger: (props: any) => <span>{props.children}</span>,
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

const project = {
	id: "pack",
	source: "modrinth",
	resource_type: "resourcepack",
	name: "Test Pack",
	summary: "A resource pack",
	description: null,
	icon_url: null,
	author: "Vesta",
	authors: ["Vesta"],
	download_count: 10,
	follower_count: 0,
	categories: [],
	web_url: "https://example.test/pack",
	gallery: [],
	published_at: null,
	updated_at: null,
} satisfies ResourceProject;

const version = {
	id: "pack-version",
	project_id: "pack",
	version_number: "1.0.0",
	game_versions: ["1.21.5"],
	loaders: ["minecraft"],
	download_url: "https://example.test/pack.zip",
	file_name: "pack.zip",
	release_type: "release",
	hash: "hash",
	dependencies: [],
} satisfies ResourceVersion;

describe("ResourceCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.state.resourceType = "resourcepack";
		mocks.state.selectedInstanceId = 7;
	});

	it("keeps the clicked resource type while versions are loading", async () => {
		const versions = deferred<ResourceVersion[]>();
		mocks.getVersions.mockReturnValue(versions.promise);

		render(() => <ResourceCard project={project} viewMode="list" />);
		await fireEvent.click(screen.getByRole("button", { name: "Install" }));
		mocks.state.resourceType = "datapack";
		versions.resolve([version]);

		await waitFor(() =>
			expect(mocks.install).toHaveBeenCalledWith(
				project,
				version,
				{ kind: "instance", instanceId: 7 },
				{ installType: "resourcepack" },
			),
		);
		expect(mocks.setInstallRequest).not.toHaveBeenCalled();
	});
});
