/* @refresh skip */

/**
 * DropZone tests. The bridge module is replaced with the REAL drop controller
 * wired to a mocked classifier and a mocked hit-test list. They check how the
 * component registers, applies state classes and reads props. They are NOT proof
 * of native OS drag-and-drop behaviour.
 *
 * Known limitation under test: there is no browser-dev fallback. DOM drag
 * listeners are deliberately absent.
 */
import { render, screen } from "@solidjs/testing-library";
import type { ClassifiedDropPath } from "@utils/file-drop/classify";
import type { DropZoneRegistration } from "@utils/file-drop/drop-controller";
import { getDropController } from "@utils/file-drop/native-bridge";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropZone } from "./drop-zone";
import styles from "./drop-zone.module.css";
import dropZoneSource from "./drop-zone.tsx?raw";

const mocks = vi.hoisted(() => ({
	classify: vi.fn(),
	elementsFromPoint: vi.fn((_x: number, _y: number): Element[] => []),
	registrations: [] as DropZoneRegistration[],
	unregisters: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock("@utils/file-drop/native-bridge", async () => {
	const { createDropController } = await import(
		"@utils/file-drop/drop-controller"
	);
	const controller = createDropController({
		classify: (paths) => mocks.classify(paths),
		elementsFromPoint: (x, y) => mocks.elementsFromPoint(x, y),
	});
	return {
		getDropController: () => ({
			...controller,
			register: (registration: DropZoneRegistration) => {
				mocks.registrations.push(registration);
				const spy = vi.fn(controller.register(registration));
				mocks.unregisters.push(spy);
				return spy;
			},
		}),
	};
});

// DropZone must not load the old sniffer manager. Any import of it fails the suite.
vi.mock("@utils/file-drop", () => {
	throw new Error("DropZone must not load the sniffer manager");
});

/** Paths ending in "/" are directories. Everything else is a regular file. */
function classifyByPath(paths: string[]): ClassifiedDropPath[] {
	return paths.map((path) => ({
		path,
		kind: path.endsWith("/") ? "directory" : "file",
		isSymlink: false,
	}));
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function enter(paths: string[]) {
	getDropController().handle({
		type: "enter",
		paths,
		position: { x: 1, y: 1 },
	});
}

function over() {
	getDropController().handle({ type: "over", position: { x: 1, y: 1 } });
}

function drop(paths: string[]) {
	getDropController().handle({ type: "drop", paths, position: { x: 1, y: 1 } });
}

function leave() {
	getDropController().handle({ type: "leave" });
}

function isActive(element: HTMLElement) {
	return element.classList.contains(styles["drop-zone--active"]);
}

function isRejected(element: HTMLElement) {
	return element.classList.contains(styles["drop-zone--rejected"]);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.registrations.length = 0;
	mocks.unregisters.length = 0;
	mocks.classify.mockImplementation(async (paths: string[]) =>
		classifyByPath(paths),
	);
	mocks.elementsFromPoint.mockReturnValue([]);
});

afterEach(() => {
	getDropController().cancel();
});

describe("DropZone registration", () => {
	it("registers once on mount with a stable id and unregisters on unmount", () => {
		const { unmount } = render(() => (
			<DropZone onFileDrop={() => undefined}>
				<div data-testid="zone" />
			</DropZone>
		));

		expect(mocks.registrations).toHaveLength(1);
		expect(mocks.registrations[0]?.id).toMatch(/^drop-zone-\d+$/);
		expect(mocks.unregisters[0]).not.toHaveBeenCalled();

		unmount();
		expect(mocks.unregisters[0]).toHaveBeenCalledTimes(1);
	});

	it("gives each instance its own id", () => {
		render(() => (
			<>
				<DropZone onFileDrop={() => undefined}>
					<div />
				</DropZone>
				<DropZone onFileDrop={() => undefined}>
					<div />
				</DropZone>
			</>
		));

		const ids = mocks.registrations.map((reg) => reg.id);
		expect(new Set(ids).size).toBe(2);
	});
});

describe("state classes", () => {
	it("resolves the state class names from the CSS module", () => {
		expect(styles["drop-zone--active"]).toEqual(expect.any(String));
		expect(styles["drop-zone--rejected"]).toEqual(expect.any(String));
		expect(styles["drop-zone--active"]).not.toBe(styles["drop-zone--rejected"]);
	});

	it("applies the active class and attribute while a hovered drag is accepted, and clears on leave", async () => {
		render(() => (
			<DropZone onFileDrop={() => undefined}>
				<div data-testid="zone" />
			</DropZone>
		));
		const zone = screen.getByTestId("zone");
		mocks.elementsFromPoint.mockReturnValue([zone]);

		enter(["/a.zip"]);
		await flush();
		expect(isActive(zone)).toBe(true);
		expect(zone.getAttribute("data-drop-state")).toBe("active");

		over();
		expect(isActive(zone)).toBe(true);

		leave();
		expect(isActive(zone)).toBe(false);
		expect(isRejected(zone)).toBe(false);
		expect(zone.hasAttribute("data-drop-state")).toBe(false);
	});

	it("applies the rejected class when nothing in the drag is accepted", async () => {
		render(() => (
			<DropZone onFileDrop={() => undefined} accept="files">
				<div data-testid="zone" />
			</DropZone>
		));
		const zone = screen.getByTestId("zone");
		mocks.elementsFromPoint.mockReturnValue([zone]);

		enter(["/folder/"]);
		await flush();
		expect(isRejected(zone)).toBe(true);
		expect(isActive(zone)).toBe(false);
		expect(zone.getAttribute("data-drop-state")).toBe("rejected");

		leave();
		expect(isRejected(zone)).toBe(false);
		expect(zone.hasAttribute("data-drop-state")).toBe(false);
	});

	it("clears its highlight on unmount mid-hover", async () => {
		const { unmount } = render(() => (
			<DropZone onFileDrop={() => undefined}>
				<div data-testid="zone" />
			</DropZone>
		));
		const zone = screen.getByTestId("zone");
		mocks.elementsFromPoint.mockReturnValue([zone]);
		enter(["/a.zip"]);
		await flush();
		expect(isActive(zone)).toBe(true);

		unmount();

		expect(isActive(zone)).toBe(false);
		expect(zone.hasAttribute("data-drop-state")).toBe(false);
	});
});

describe("props", () => {
	it("reads accept live, so a changed accept applies to the next hover", async () => {
		const [accept, setAccept] = createSignal<"files" | "all">("files");
		render(() => (
			<DropZone onFileDrop={() => undefined} accept={accept()}>
				<div data-testid="zone" />
			</DropZone>
		));
		const zone = screen.getByTestId("zone");
		mocks.elementsFromPoint.mockReturnValue([zone]);

		enter(["/folder/"]);
		await flush();
		expect(isRejected(zone)).toBe(true);

		setAccept("all");
		over();
		expect(isActive(zone)).toBe(true);
		expect(isRejected(zone)).toBe(false);
	});

	it("disabled zones are never highlighted and never receive a drop", async () => {
		const [disabled, setDisabled] = createSignal(true);
		const onFileDrop = vi.fn();
		render(() => (
			<DropZone onFileDrop={onFileDrop} disabled={disabled()}>
				<div data-testid="zone" />
			</DropZone>
		));
		const zone = screen.getByTestId("zone");
		mocks.elementsFromPoint.mockReturnValue([zone]);

		enter(["/a.zip"]);
		await flush();
		expect(zone.hasAttribute("data-drop-state")).toBe(false);
		drop(["/a.zip"]);
		await flush();
		expect(onFileDrop).not.toHaveBeenCalled();

		setDisabled(false);
		enter(["/a.zip"]);
		await flush();
		expect(isActive(zone)).toBe(true);
	});

	it("delivers accepted paths to onFileDrop and reports the rest through onFilesRejected", async () => {
		const onFileDrop = vi.fn();
		const onFilesRejected = vi.fn();
		render(() => (
			<DropZone
				onFileDrop={onFileDrop}
				onFilesRejected={onFilesRejected}
				accept="files"
				allowedExtensions={[".zip"]}
			>
				<div data-testid="zone" />
			</DropZone>
		));
		const zone = screen.getByTestId("zone");
		mocks.elementsFromPoint.mockReturnValue([zone]);
		const paths = ["/a.zip", "/b.txt", "/folder/"];

		enter(paths);
		await flush();
		drop(paths);
		await flush();

		expect(onFileDrop).toHaveBeenCalledTimes(1);
		expect(onFileDrop).toHaveBeenCalledWith(["/a.zip"]);
		expect(onFilesRejected).toHaveBeenCalledTimes(1);
		expect(onFilesRejected).toHaveBeenCalledWith([
			{ path: "/b.txt", reason: "extension" },
			{ path: "/folder/", reason: "not-accepted-type" },
		]);
	});
});

describe("removed DOM path", () => {
	it("does not add DOM drag listeners", () => {
		const addSpy = vi.spyOn(HTMLElement.prototype, "addEventListener");
		try {
			render(() => (
				<DropZone onFileDrop={() => undefined}>
					<div data-testid="zone" />
				</DropZone>
			));
			const registered = addSpy.mock.calls.map((call) => call[0]);
			for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
				expect(registered).not.toContain(type);
			}
		} finally {
			addSpy.mockRestore();
		}
	});

	it("keeps no reference to the sniffer manager or DOM drag handling in its source", () => {
		const source = dropZoneSource;
		expect(source).not.toContain("getDropZoneManager");
		expect(source).not.toMatch(/["']@utils\/file-drop["']/);
		expect(source).not.toMatch(/addEventListener/);
		expect(source).not.toMatch(/["'](dragenter|dragover|dragleave|drop)["']/);
	});
});
