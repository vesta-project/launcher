/* @refresh skip */

import { ResourceRowActions } from "@components/pages/mini-pages/instance-details/tabs/ResourceRowActions";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

vi.mock("@assets/icons/actions/download.svg", () => ({
	default: () => <svg data-testid="download-icon" />,
}));

vi.mock("@assets/icons/actions/delete.svg", () => ({
	default: () => <svg data-testid="trash-icon" />,
}));

vi.mock("@ui/dropdown-menu/dropdown-menu", () => ({
	DropdownMenu: (props: any) => <div>{props.children}</div>,
	DropdownMenuContent: (props: any) => <div>{props.children}</div>,
	DropdownMenuItem: (props: any) => (
		<button onClick={props.onSelect} disabled={props.disabled}>
			{props.children}
		</button>
	),
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuTrigger: (props: any) => <button>{props.children}</button>,
}));

vi.mock("@ui/context-menu/context-menu", () => ({
	ContextMenuContent: (props: any) => (
		<div data-testid="resource-context-menu">{props.children}</div>
	),
	ContextMenuItem: (props: any) => (
		<button onClick={props.onSelect} disabled={props.disabled}>
			{props.children}
		</button>
	),
	ContextMenuSeparator: () => <hr />,
}));

const baseProps = {
	update: undefined,
	isCheckingForUpdates: false,
	hasCheckedForUpdates: false,
	isIdentifying: false,
	busy: false,
	onUpdate: vi.fn(),
	onDelete: vi.fn(),
	onCheckUpdates: vi.fn(),
	onIdentify: vi.fn(),
};

describe("ResourceRowActions", () => {
	it("offers targeted identification only for unresolved resources", async () => {
		const onIdentify = vi.fn().mockResolvedValue(undefined);
		const resource = { id: 1, platform: "manual", remote_id: "" };
		render(() => (
			<ResourceRowActions
				{...baseProps}
				resource={resource}
				onIdentify={onIdentify}
			/>
		));

		await fireEvent.click(screen.getByText("Identify Resource"));
		expect(onIdentify).toHaveBeenCalledWith(resource);
	});

	it("does not offer identification for linked provider resources", () => {
		render(() => (
			<ResourceRowActions
				{...baseProps}
				resource={{ id: 1, platform: "modrinth", remote_id: "sodium" }}
			/>
		));

		expect(screen.queryByText("Identify Resource")).toBeNull();
	});
});

it("uses the resource callbacks from the right-click menu without rendering action buttons", async () => {
	const onDelete = vi.fn().mockResolvedValue(undefined);
	const resource = {
		id: 7,
		display_name: "Sodium",
		platform: "modrinth",
		remote_id: "sodium",
	};
	render(() => (
		<ResourceRowActions
			{...baseProps}
			contextMenu
			resource={resource}
			onDelete={onDelete}
		/>
	));
	expect(screen.getByTestId("resource-context-menu")).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: "Actions for Sodium" }),
	).toBeNull();
	await fireEvent.click(screen.getByText("Delete"));
	expect(onDelete).toHaveBeenCalledWith(resource);
});
