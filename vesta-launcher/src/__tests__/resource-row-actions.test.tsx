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
