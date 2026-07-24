/* @refresh skip */

import { ResourcesTab } from "@components/pages/mini-pages/instance-details/tabs/ResourcesTab";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@assets/reload.svg", () => ({
	default: (props: any) => <svg data-testid="reload-icon" {...props} />,
}));

vi.mock("@assets/right-arrow.svg", () => ({
	default: (props: any) => <svg data-testid="right-arrow-icon" {...props} />,
}));

vi.mock("@assets/search.svg", () => ({
	default: (props: any) => <svg data-testid="search-icon" {...props} />,
}));

vi.mock("@assets/trash.svg", () => ({
	default: (props: any) => <svg data-testid="trash-icon" {...props} />,
}));

vi.mock("@utils/media-query", () => ({
	RESOURCES_FILTER_COMPACT_WIDTH: 680,
	RESOURCES_TABLE_COMPACT_WIDTH: 640,
	createContainerQuery: () => () => false,
}));

vi.mock("@ui/avatar", () => ({
	ResourceAvatar: (props: any) => (
		<span data-testid="resource-avatar">{props.name}</span>
	),
}));

vi.mock("@ui/button/button", () => ({
	default: (props: any) => (
		<button onClick={props.onClick} disabled={props.disabled}>
			{props.children}
		</button>
	),
}));

vi.mock("@ui/dropdown-menu/dropdown-menu", () => ({
	DropdownMenu: (props: any) => <div>{props.children}</div>,
	DropdownMenuContent: (props: any) => <div>{props.children}</div>,
	DropdownMenuItem: (props: any) => (
		<button onClick={props.onSelect}>{props.children}</button>
	),
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuTrigger: (props: any) => (
		<button onClick={props.onClick} class={props.class}>
			{props.children}
		</button>
	),
}));

vi.mock("@ui/select/select", () => ({
	Select: (props: any) => <div>{props.children}</div>,
	SelectContent: () => null,
	SelectItem: (props: any) => <div>{props.children}</div>,
	SelectTrigger: (props: any) => <button>{props.children}</button>,
	SelectValue: (props: any) => (
		<span>{props.children?.({ selectedOption: () => "All" })}</span>
	),
}));

vi.mock("@ui/skeleton/skeleton", () => ({
	Skeleton: () => <div data-testid="skeleton" />,
}));

const columns = [
	{ id: "select" },
	{ id: "display_name" },
	{ id: "current_version" },
	{ id: "is_enabled" },
	{ id: "actions" },
];

const createRow = (resource: any) => ({
	id: String(resource.id),
	original: resource,
	getIsSelected: () => false,
	getVisibleCells: () =>
		columns.map((column) => ({
			column: {
				...column,
				columnDef: {
					cell: () =>
						column.id === "display_name" ? resource.display_name : "",
				},
			},
			getContext: () => ({}),
		})),
});

const createTable = (rows: any[]) => ({
	getRowModel: () => ({ rows }),
	getVisibleLeafColumns: () => columns,
	getHeaderGroups: () => [
		{
			headers: columns.map((column) => ({
				column: {
					...column,
					columnDef: { header: column.id },
					getCanSort: () => false,
					getToggleSortingHandler: () => () => undefined,
				},
				isPlaceholder: false,
				getContext: () => ({}),
			})),
		},
	],
});

describe("ResourcesTab virtualized modpack rows", () => {
	it("mounts bundled rows only when their group is expanded", async () => {
		const rows = [
			createRow({
				id: 1,
				display_name: "Bundled One",
				current_version: "1.0.0",
				is_enabled: true,
				local_path: "mods/bundled-one.jar",
				resource_type: "mod",
				source_kind: "modpack",
			}),
			createRow({
				id: 2,
				display_name: "Custom One",
				current_version: "1.0.0",
				is_enabled: true,
				local_path: "mods/custom-one.jar",
				resource_type: "mod",
				source_kind: "custom",
			}),
		];

		const Harness = () => {
			const [expanded, setExpanded] = createSignal(false);

			return (
				<ResourcesTab
					instance={{ id: 10, name: "Test Pack", modpackId: "pack-1" }}
					resourceTypeFilter="All"
					setResourceTypeFilter={vi.fn()}
					table={createTable(rows)}
					resourcesStore={{
						state: { selection: {} },
						clearSelection: vi.fn(),
						setInstance: vi.fn(),
						setGameVersion: vi.fn(),
						setLoader: vi.fn(),
					}}
					installedResources={{
						latest: rows.map((row) => row.original),
						loading: false,
					}}
					modpackResources={[rows[0].original]}
					modpackIcon={() => null}
					modpackExpanded={expanded()}
					setModpackExpanded={setExpanded}
					currentModpackVersion={null}
					availableModpackUpdate={null}
					router={null}
					handleBatchUpdate={vi.fn()}
					handleBatchDelete={vi.fn()}
					onManageModpackVersions={vi.fn()}
					onUnlinkModpack={vi.fn()}
					onDeleteModpackAndUnlink={vi.fn()}
					onRowClick={vi.fn()}
					resourceSearch=""
					setResourceSearch={vi.fn()}
					selectedToUpdateCount={0}
					busy={false}
					checkingUpdates={false}
					checkUpdates={vi.fn()}
				/>
			);
		};

		render(() => <Harness />);

		expect(screen.getByText("Custom One")).toBeTruthy();
		expect(screen.queryByText("Bundled One")).toBeNull();

		const groupRow = screen.getByText("1 bundled resources").closest("tr");
		if (!groupRow) throw new Error("expected bundled resource group row");
		await fireEvent.click(groupRow);

		await waitFor(() => {
			const bundledRow = screen.getByText("Bundled One").closest("tr");
			expect(bundledRow?.hasAttribute("hidden")).toBe(false);
			expect(bundledRow?.getAttribute("aria-hidden")).toBeNull();
		});
	});

	it("expands bundled modpack rows by default when there are no custom resources", async () => {
		const rows = [
			createRow({
				id: 1,
				display_name: "Bundled One",
				current_version: "1.0.0",
				is_enabled: true,
				local_path: "mods/bundled-one.jar",
				resource_type: "mod",
				source_kind: "modpack",
			}),
			createRow({
				id: 2,
				display_name: "Bundled Two",
				current_version: "1.0.0",
				is_enabled: true,
				local_path: "mods/bundled-two.jar",
				resource_type: "mod",
				source_kind: "modpack",
			}),
		];

		const Harness = () => {
			const [expanded, setExpanded] = createSignal(false);

			return (
				<ResourcesTab
					instance={{ id: 10, name: "Test Pack", modpackId: "pack-1" }}
					resourceTypeFilter="All"
					setResourceTypeFilter={vi.fn()}
					table={createTable(rows)}
					resourcesStore={{
						state: { selection: {} },
						clearSelection: vi.fn(),
						setInstance: vi.fn(),
						setGameVersion: vi.fn(),
						setLoader: vi.fn(),
					}}
					installedResources={{
						latest: rows.map((row) => row.original),
						loading: false,
					}}
					modpackResources={rows.map((row) => row.original)}
					modpackIcon={() => null}
					modpackExpanded={expanded()}
					setModpackExpanded={setExpanded}
					currentModpackVersion={null}
					availableModpackUpdate={null}
					router={null}
					handleBatchUpdate={vi.fn()}
					handleBatchDelete={vi.fn()}
					onManageModpackVersions={vi.fn()}
					onUnlinkModpack={vi.fn()}
					onDeleteModpackAndUnlink={vi.fn()}
					onRowClick={vi.fn()}
					resourceSearch=""
					setResourceSearch={vi.fn()}
					selectedToUpdateCount={0}
					busy={false}
					checkingUpdates={false}
					checkUpdates={vi.fn()}
				/>
			);
		};

		render(() => <Harness />);

		await waitFor(() => {
			const bundledRow = screen.getByText("Bundled One").closest("tr");
			expect(bundledRow?.hasAttribute("hidden")).toBe(false);
			expect(bundledRow?.getAttribute("aria-hidden")).toBeNull();
		});

		expect(screen.getByText("Bundled Two")).toBeTruthy();
		expect(
			screen
				.getByText("2 bundled resources")
				.closest("tr")
				?.getAttribute("aria-expanded"),
		).toBe("true");
	});

	it("keeps the mounted table bounded for large resource collections", async () => {
		const rows = Array.from({ length: 5_000 }, (_, index) =>
			createRow({
				id: index + 1,
				display_name: `Resource ${index + 1}`,
				current_version: "1.0.0",
				is_enabled: true,
				local_path: `mods/resource-${index + 1}.jar`,
				resource_type: "mod",
				source_kind: "custom",
			}),
		);

		render(() => (
			<ResourcesTab
				instance={{ id: 10, name: "Large Instance" }}
				resourceTypeFilter="All"
				setResourceTypeFilter={vi.fn()}
				table={createTable(rows)}
				resourcesStore={{
					state: { selection: {} },
					clearSelection: vi.fn(),
					setInstance: vi.fn(),
					setGameVersion: vi.fn(),
					setLoader: vi.fn(),
				}}
				installedResources={{
					latest: rows.map((row) => row.original),
					loading: false,
				}}
				modpackResources={[]}
				modpackIcon={() => null}
				modpackExpanded={false}
				setModpackExpanded={vi.fn()}
				currentModpackVersion={null}
				availableModpackUpdate={null}
				router={null}
				handleBatchUpdate={vi.fn()}
				handleBatchDelete={vi.fn()}
				onManageModpackVersions={vi.fn()}
				onUnlinkModpack={vi.fn()}
				onDeleteModpackAndUnlink={vi.fn()}
				onRowClick={vi.fn()}
				resourceSearch=""
				setResourceSearch={vi.fn()}
				selectedToUpdateCount={0}
				busy={false}
				checkingUpdates={false}
				checkUpdates={vi.fn()}
			/>
		));

		await waitFor(() => expect(screen.getByText("Resource 1")).toBeTruthy());
		expect(document.querySelectorAll("tbody tr").length).toBeLessThan(80);
		expect(screen.queryByText("Resource 5000")).toBeNull();
	});
});
