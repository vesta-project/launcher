/* @refresh skip */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { DropTargetHint, dropTargetForZoneState } from "./drop-target";

const dropTargetStyles = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "drop-target.css"),
	"utf8",
);

describe("dropTargetForZoneState", () => {
	it("maps a zone's highlight state onto the shared drop-target states", () => {
		expect(dropTargetForZoneState("active")).toBe("ready");
		expect(dropTargetForZoneState("rejected")).toBe("rejected");
		expect(dropTargetForZoneState("idle")).toBeUndefined();
	});
});

describe("shared drop-target styling", () => {
	it("uses semantic theme tokens without a private palette", () => {
		expect(dropTargetStyles).not.toContain("--drop-target-");
		expect(dropTargetStyles).not.toContain("--color__");
		for (const token of [
			"--primary-accent",
			"--primary-low",
			"--semantic-error",
			"--semantic-error-bg",
		]) {
			expect(dropTargetStyles).toContain(`var(${token})`);
		}
		expect(dropTargetStyles).toContain(
			"color-mix(in srgb, var(--primary-accent) 45%, transparent)",
		);
	});

	it("keeps shadows neutral and out of state animations", () => {
		const shadows = [...dropTargetStyles.matchAll(/box-shadow:\s*([^;]+);/g)];
		expect(shadows).toHaveLength(1);
		expect(shadows[0][1]).toBe("inset var(--elevation-soft)");
		expect(
			dropTargetStyles.slice(dropTargetStyles.indexOf("@keyframes")),
		).not.toContain("box-shadow");
	});

	it("contains the border and preserves both reduced-motion overrides", () => {
		const overlay = dropTargetStyles.match(
			/\[data-drop-target\]::after \{([^}]+)\}/,
		)?.[1];
		expect(overlay).toContain("inset: 0;");
		expect(overlay).toContain("box-sizing: border-box;");
		expect(overlay).toContain("border: 2px solid var(--primary-accent);");
		expect(overlay).toContain("pointer-events: none;");
		expect(dropTargetStyles).toContain("animation-name: drop-target-in-ready;");
		expect(dropTargetStyles).toContain(
			"@media (prefers-reduced-motion: reduce)",
		);
		expect(dropTargetStyles).toContain(
			':root[data-reduced-motion="true"] [data-drop-target]::after',
		);
		expect(dropTargetStyles).toContain(
			':root[data-reduced-motion="true"] .drop-target-hint',
		);
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
