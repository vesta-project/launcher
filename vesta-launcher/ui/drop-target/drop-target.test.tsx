/* @refresh skip */
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { DropTargetHint, dropTargetForZoneState } from "./drop-target";

describe("dropTargetForZoneState", () => {
	it("maps a zone's highlight state onto the shared drop-target states", () => {
		expect(dropTargetForZoneState("active")).toBe("ready");
		expect(dropTargetForZoneState("rejected")).toBe("rejected");
		expect(dropTargetForZoneState("idle")).toBeUndefined();
	});
});

describe("DropTargetHint", () => {
	it("renders the label with the target state", () => {
		render(() => (
			<DropTargetHint target={{ state: "ready", label: "Add mod" }} />
		));
		const hint = screen.getByText("Add mod");
		expect(hint.getAttribute("data-state")).toBe("ready");
	});

	it("renders nothing without a target or without a label", () => {
		const { container, unmount } = render(() => (
			<DropTargetHint target={undefined} />
		));
		expect(container.querySelector(".drop-target-hint")).toBeNull();
		unmount();

		const second = render(() => (
			<DropTargetHint target={{ state: "pending" }} />
		));
		expect(second.container.querySelector(".drop-target-hint")).toBeNull();
	});
});
