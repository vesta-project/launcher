/**
 * Drop controller tests. Fake elements in jsdom, an injected hit-test list and a
 * controllable classifier. They verify routing and session rules only. They are
 * NOT proof of native OS drag behaviour.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from "vitest";
import type { ClassifiedDropPath, DropPathKind } from "./classify";
import {
	createDropController,
	type DropAccept,
	type DropControllerDiagnostic,
	type DropZoneRegistration,
	type DropZoneState,
	evaluateDropItems,
	extensionOf,
	type Point,
	type RejectedDropItem,
	rejectionReasonFor,
} from "./drop-controller";

const at: Point = { x: 5, y: 5 };

interface Pending {
	paths: string[];
	resolve: (items: ClassifiedDropPath[]) => void;
	reject: (error: unknown) => void;
}

interface ZoneConfig {
	accept: DropAccept;
	extensions: string[];
	disabled: boolean;
}

interface TestZone {
	id: string;
	element: HTMLElement;
	cfg: ZoneConfig;
	reg: DropZoneRegistration;
	drops: string[][];
	rejected: RejectedDropItem[][];
	states: DropZoneState[];
}

function setup() {
	const pending: Pending[] = [];
	const diagnostics: DropControllerDiagnostic[] = [];
	let hits: Element[] = [];
	const classify = vi.fn(
		(paths: string[]) =>
			new Promise<ClassifiedDropPath[]>((resolve, reject) => {
				pending.push({ paths, resolve, reject });
			}),
	);
	const controller = createDropController({
		classify,
		elementsFromPoint: () => hits,
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
	});
	return {
		controller,
		classify,
		pending,
		diagnostics,
		setHits(next: Element[]) {
			hits = next;
		},
		async settle() {
			await new Promise((resolve) => setTimeout(resolve, 0));
		},
	};
}

type Ctx = ReturnType<typeof setup>;

function el(parent: Element = document.body, tag = "div"): HTMLElement {
	const element = document.createElement(tag);
	parent.append(element);
	return element;
}

function makeZone(
	id: string,
	element: HTMLElement,
	init: Partial<ZoneConfig> = {},
): TestZone {
	const cfg: ZoneConfig = {
		accept: "all",
		extensions: [],
		disabled: false,
		...init,
	};
	const drops: string[][] = [];
	const rejected: RejectedDropItem[][] = [];
	const states: DropZoneState[] = [];
	const reg: DropZoneRegistration = {
		id,
		getElement: () => element,
		getAccept: () => cfg.accept,
		getAllowedExtensions: () => cfg.extensions,
		isDisabled: () => cfg.disabled,
		onFileDrop: (paths) => {
			drops.push(paths);
		},
		onRejected: (items) => {
			rejected.push(items);
		},
		onStateChange: (state) => {
			states.push(state);
		},
	};
	return { id, element, cfg, reg, drops, rejected, states };
}

function item(path: string, kind: DropPathKind = "file"): ClassifiedDropPath {
	return { path, kind, isSymlink: false };
}

function resolvePending(ctx: Ctx, index: number, items: ClassifiedDropPath[]) {
	const request = ctx.pending[index];
	if (!request) {
		throw new Error(`no pending classification at ${index}`);
	}
	request.resolve(items);
}

/** Enter a drag over the current hit list and resolve its classification. */
async function startDrag(
	ctx: Ctx,
	paths: string[],
	items: ClassifiedDropPath[],
) {
	ctx.controller.handle({ type: "enter", paths, position: at });
	resolvePending(ctx, ctx.pending.length - 1, items);
	await ctx.settle();
}

let consoleError: MockInstance;

beforeEach(() => {
	document.body.innerHTML = "";
	consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
	consoleError.mockRestore();
});

describe("state machine", () => {
	it("enter, over, drop and leave move through the expected states", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);

		ctx.controller.handle({
			type: "enter",
			paths: ["/x/one.zip"],
			position: at,
		});
		expect(a.states).toEqual([]);
		resolvePending(ctx, 0, [item("/x/one.zip")]);
		await ctx.settle();
		expect(a.states).toEqual(["active"]);

		ctx.controller.handle({ type: "over", position: at });
		expect(a.states).toEqual(["active"]);

		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		expect(a.states).toEqual(["active", "idle"]);
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();
		expect(a.drops).toEqual([["/x/one.zip"]]);

		ctx.controller.handle({ type: "leave" });
		expect(a.states).toEqual(["active", "idle"]);
	});

	it("over is synchronous and never classifies", () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		ctx.controller.handle({ type: "enter", paths: ["/x"], position: at });

		ctx.controller.handle({ type: "over", position: at });
		ctx.controller.handle({ type: "over", position: at });

		expect(ctx.classify).toHaveBeenCalledTimes(1);
	});
});

describe("hit testing", () => {
	it("a child element of the zone resolves to the same zone with no extra state calls", async () => {
		const ctx = setup();
		const root = el();
		const a = makeZone("a", root);
		const child = el(root, "span");
		ctx.controller.register(a.reg);

		ctx.setHits([root]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);
		ctx.setHits([child, root]);
		ctx.controller.handle({ type: "over", position: at });
		ctx.setHits([child]);
		ctx.controller.handle({ type: "over", position: at });

		expect(a.states).toEqual(["active"]);
	});

	it("an overlay painted above a zone blocks it", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		const overlay = el();
		ctx.controller.register(a.reg);

		ctx.setHits([a.element]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);
		expect(a.states).toEqual(["active"]);

		ctx.setHits([overlay, a.element]);
		ctx.controller.handle({ type: "over", position: at });
		expect(a.states).toEqual(["active", "idle"]);

		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		await ctx.settle();
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();
		expect(a.drops).toEqual([]);
	});

	it("nested zones resolve to the innermost zone", async () => {
		const ctx = setup();
		const outer = el();
		const inner = el(outer);
		const outerZone = makeZone("outer", outer);
		const innerZone = makeZone("inner", inner);
		ctx.controller.register(outerZone.reg);
		ctx.controller.register(innerZone.reg);

		ctx.setHits([inner, outer]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);
		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();

		expect(innerZone.states).toEqual(["active", "idle"]);
		expect(outerZone.states).toEqual([]);
		expect(innerZone.drops).toEqual([["/x/one.zip"]]);
		expect(outerZone.drops).toEqual([]);
	});

	it("a disabled zone is not a target", async () => {
		const ctx = setup();
		const a = makeZone("a", el(), { disabled: true });
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);

		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);
		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();

		expect(a.states).toEqual([]);
		expect(a.drops).toEqual([]);
	});

	it("a disabled zone above an eligible zone does not block it", async () => {
		const ctx = setup();
		const disabledEl = el();
		const eligibleEl = el();
		const disabled = makeZone("disabled", disabledEl, { disabled: true });
		const eligible = makeZone("eligible", eligibleEl);
		ctx.controller.register(disabled.reg);
		ctx.controller.register(eligible.reg);

		ctx.setHits([disabledEl, eligibleEl]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);

		expect(eligible.states).toEqual(["active"]);
		expect(disabled.states).toEqual([]);
	});

	it("switching zones moves the highlight without stale state", async () => {
		const ctx = setup();
		const aEl = el();
		const bEl = el();
		const a = makeZone("a", aEl);
		const b = makeZone("b", bEl);
		ctx.controller.register(a.reg);
		ctx.controller.register(b.reg);

		ctx.setHits([aEl]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);
		ctx.setHits([bEl]);
		ctx.controller.handle({ type: "over", position: at });
		ctx.controller.handle({ type: "over", position: at });

		expect(a.states).toEqual(["active", "idle"]);
		expect(b.states).toEqual(["active"]);
	});
});

describe("classification timing", () => {
	it("is idle while pending on over, then becomes active when it resolves", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);

		ctx.controller.handle({
			type: "enter",
			paths: ["/x/one.zip"],
			position: at,
		});
		ctx.controller.handle({ type: "over", position: at });
		expect(a.states).toEqual([]);

		resolvePending(ctx, 0, [item("/x/one.zip")]);
		await ctx.settle();
		expect(a.states).toEqual(["active"]);
	});

	it("a stale classification after leave does not revive the highlight", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);

		ctx.controller.handle({
			type: "enter",
			paths: ["/x/one.zip"],
			position: at,
		});
		ctx.controller.handle({ type: "leave" });
		resolvePending(ctx, 0, [item("/x/one.zip")]);
		await ctx.settle();

		expect(a.states).toEqual([]);
	});

	it("a stale classification from an older enter does not revive the highlight", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);

		ctx.controller.handle({ type: "enter", paths: ["/old.zip"], position: at });
		ctx.controller.handle({ type: "enter", paths: ["/new.zip"], position: at });
		resolvePending(ctx, 0, [item("/old.zip")]);
		await ctx.settle();
		expect(a.states).toEqual([]);

		resolvePending(ctx, 1, [item("/new.zip")]);
		await ctx.settle();
		expect(a.states).toEqual(["active"]);
	});

	it("a drop after leave is a fresh drop, and the earlier enter's late result delivers nothing", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);

		ctx.controller.handle({ type: "enter", paths: ["/old.zip"], position: at });
		ctx.controller.handle({ type: "leave" });
		ctx.controller.handle({ type: "drop", paths: ["/y.zip"], position: at });

		resolvePending(ctx, 0, [item("/old.zip")]);
		await ctx.settle();
		expect(a.drops).toEqual([]);

		resolvePending(ctx, 1, [item("/y.zip")]);
		await ctx.settle();
		expect(a.drops).toEqual([["/y.zip"]]);
	});

	it("a stray leave after a drop does not lose the in-flight drop", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);

		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		ctx.controller.handle({ type: "leave" });
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();

		expect(a.drops).toEqual([["/x/one.zip"]]);
	});

	it("cancel() discards an in-flight drop", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);

		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		ctx.controller.cancel();
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();

		expect(a.drops).toEqual([]);
		expect(a.states).toEqual(["active", "idle"]);
	});
});

describe("drop delivery", () => {
	it("delivers exactly once for a rapid double drop", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);

		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();

		expect(ctx.classify).toHaveBeenCalledTimes(2);
		expect(a.drops).toEqual([["/x/one.zip"]]);
	});

	it("a repeat drop after a finished drop is ignored, and new sessions still deliver", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		await startDrag(ctx, ["/one.zip"], [item("/one.zip")]);
		ctx.controller.handle({ type: "drop", paths: ["/one.zip"], position: at });
		resolvePending(ctx, 1, [item("/one.zip")]);
		await ctx.settle();
		ctx.controller.handle({ type: "drop", paths: ["/one.zip"], position: at });
		await ctx.settle();
		expect(a.drops).toEqual([["/one.zip"]]);

		await startDrag(ctx, ["/two.zip"], [item("/two.zip")]);
		ctx.controller.handle({ type: "drop", paths: ["/two.zip"], position: at });
		resolvePending(ctx, ctx.pending.length - 1, [item("/two.zip")]);
		await ctx.settle();
		expect(a.drops).toEqual([["/one.zip"], ["/two.zip"]]);
	});

	it("delivers accepted items and reports rejected ones in a partial drop", async () => {
		const ctx = setup();
		const a = makeZone("a", el(), { accept: "files", extensions: [".zip"] });
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		const items = [
			item("/d/a.zip"),
			item("/d/B.ZIP"),
			item("/d/c.txt"),
			item("/d/folder", "directory"),
			item("/d/gone", "missing"),
		];
		await startDrag(ctx, ["/d/a.zip"], items);
		expect(a.states).toEqual(["active"]);

		ctx.controller.handle({ type: "drop", paths: ["/d/a.zip"], position: at });
		resolvePending(ctx, 1, items);
		await ctx.settle();

		expect(a.drops).toEqual([["/d/a.zip", "/d/B.ZIP"]]);
		expect(a.rejected).toEqual([
			[
				{ path: "/d/c.txt", reason: "extension" },
				{ path: "/d/folder", reason: "not-accepted-type" },
				{ path: "/d/gone", reason: "unreadable" },
			],
		]);
	});

	it("a zone with zero accepted items gets no onFileDrop, reports rejections, and goes idle", async () => {
		const ctx = setup();
		const a = makeZone("a", el(), { accept: "folders" });
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);
		expect(a.states).toEqual(["rejected"]);

		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();

		expect(a.drops).toEqual([]);
		expect(a.rejected).toEqual([
			[{ path: "/x/one.zip", reason: "not-accepted-type" }],
		]);
		expect(a.states).toEqual(["rejected", "idle"]);
	});

	it("a drop outside any zone delivers nothing and resets the highlight", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);

		ctx.setHits([]);
		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();

		expect(a.drops).toEqual([]);
		expect(a.rejected).toEqual([]);
		expect(a.states).toEqual(["active", "idle"]);
	});

	it("a zone disabled after hover does not receive the drop", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);

		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		a.cfg.disabled = true;
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();

		expect(a.drops).toEqual([]);
	});

	it("a failing classifier marks the dropped items as unreadable", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);

		ctx.controller.handle({
			type: "enter",
			paths: ["/x/one.zip"],
			position: at,
		});
		ctx.pending[0]?.reject(new Error("/x/one.zip"));
		await ctx.settle();

		expect(a.states).toEqual(["rejected"]);
		expect(JSON.stringify(consoleError.mock.calls)).not.toContain("one.zip");
	});
});

describe("registration", () => {
	it("unregistering mid-drag resets the zone and blocks later delivery", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		const unregister = ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);

		unregister();
		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();

		expect(a.states).toEqual(["active", "idle"]);
		expect(a.drops).toEqual([]);
	});

	it("a duplicate id replaces the old registration, and the old unregister cannot remove the new one", async () => {
		const ctx = setup();
		const elA = el();
		const elB = el();
		const first = makeZone("z", elA);
		const second = makeZone("z", elB);
		const unregisterFirst = ctx.controller.register(first.reg);
		ctx.setHits([elA]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);
		expect(first.states).toEqual(["active"]);

		ctx.controller.register(second.reg);
		expect(first.states).toEqual(["active", "idle"]);

		unregisterFirst();
		ctx.setHits([elB]);
		ctx.controller.handle({ type: "over", position: at });
		expect(second.states).toEqual(["active"]);
	});

	it("dispose resets active zones, ignores later events, and ignores stale classification", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);
		ctx.controller.handle({
			type: "drop",
			paths: ["/x/one.zip"],
			position: at,
		});

		ctx.controller.dispose();
		ctx.controller.dispose();
		resolvePending(ctx, 1, [item("/x/one.zip")]);
		await ctx.settle();
		ctx.controller.handle({
			type: "enter",
			paths: ["/later.zip"],
			position: at,
		});

		expect(a.states).toEqual(["active", "idle"]);
		expect(a.drops).toEqual([]);
		expect(ctx.classify).toHaveBeenCalledTimes(2);
	});

	it("register after dispose is a no-op", () => {
		const ctx = setup();
		ctx.controller.dispose();
		const a = makeZone("a", el());
		const unregister = ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		ctx.controller.handle({ type: "over", position: at });

		expect(() => unregister()).not.toThrow();
		expect(a.states).toEqual([]);
	});

	it("an unmount mid-drag does not leave the zone reachable by later over events", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		const unregister = ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		await startDrag(ctx, ["/x/one.zip"], [item("/x/one.zip")]);
		unregister();
		unregister();

		ctx.controller.handle({ type: "over", position: at });
		expect(a.states).toEqual(["active", "idle"]);
	});
});

describe("robustness", () => {
	it("a throwing onFileDrop does not break the controller", async () => {
		const ctx = setup();
		const elA = el();
		const elB = el();
		const a = makeZone("a", elA);
		const b = makeZone("b", elB);
		ctx.controller.register({
			...a.reg,
			onFileDrop: () => {
				throw new Error("/secret/file.zip");
			},
		});
		ctx.controller.register(b.reg);

		ctx.setHits([elA]);
		await startDrag(ctx, ["/secret/file.zip"], [item("/secret/file.zip")]);
		ctx.controller.handle({
			type: "drop",
			paths: ["/secret/file.zip"],
			position: at,
		});
		resolvePending(ctx, 1, [item("/secret/file.zip")]);
		await ctx.settle();
		expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");

		ctx.setHits([elB]);
		await startDrag(ctx, ["/b.zip"], [item("/b.zip")]);
		ctx.controller.handle({ type: "drop", paths: ["/b.zip"], position: at });
		resolvePending(ctx, ctx.pending.length - 1, [item("/b.zip")]);
		await ctx.settle();
		expect(b.drops).toEqual([["/b.zip"]]);
	});

	it("a throwing onStateChange does not break the controller", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register({
			...a.reg,
			onStateChange: () => {
				throw new Error("boom");
			},
		});
		ctx.setHits([a.element]);

		expect(() =>
			ctx.controller.handle({ type: "enter", paths: ["/x.zip"], position: at }),
		).not.toThrow();
		resolvePending(ctx, 0, [item("/x.zip")]);
		await ctx.settle();
		expect(() =>
			ctx.controller.handle({ type: "over", position: at }),
		).not.toThrow();
	});

	it("a throwing onDiagnostic does not break the controller", () => {
		const controller = createDropController({
			classify: () => Promise.resolve([]),
			elementsFromPoint: () => [],
			onDiagnostic: () => {
				throw new Error("diagnostic failure");
			},
		});
		expect(() =>
			controller.handle({ type: "enter", paths: ["/x"], position: at }),
		).not.toThrow();
	});

	it("an over with no live session is a harmless no-op", () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);

		expect(() =>
			ctx.controller.handle({ type: "over", position: at }),
		).not.toThrow();
		expect(a.states).toEqual([]);
	});
});

describe("diagnostics", () => {
	it("reports codes, zone ids and points, and never paths", async () => {
		const ctx = setup();
		const a = makeZone("zone-a", el(), { accept: "folders" });
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);

		ctx.controller.handle({
			type: "enter",
			paths: ["/private/secret.zip"],
			position: at,
		});
		expect(ctx.diagnostics.at(-1)).toMatchObject({
			event: "enter",
			cssPoint: at,
			targetZoneId: "zone-a",
			rejection: null,
			pendingClassification: true,
		});

		resolvePending(ctx, 0, [item("/private/secret.zip")]);
		await ctx.settle();
		ctx.controller.handle({ type: "over", position: at });
		expect(ctx.diagnostics.at(-1)).toMatchObject({
			event: "over",
			targetZoneId: "zone-a",
			rejection: "not-accepted-type",
			pendingClassification: false,
		});

		ctx.controller.handle({
			type: "drop",
			paths: ["/private/secret.zip"],
			position: at,
		});
		resolvePending(ctx, 1, [item("/private/secret.zip")]);
		await ctx.settle();
		ctx.controller.handle({ type: "leave" });

		expect(ctx.diagnostics.at(-1)).toMatchObject({
			event: "leave",
			cssPoint: null,
		});
		expect(JSON.stringify(ctx.diagnostics)).not.toContain("secret");
	});
});

describe("policy", () => {
	it("extensionOf is case-insensitive, uses the last dot of the last segment, and handles both separators", () => {
		expect(extensionOf("/a/b.ZIP")).toBe(".zip");
		expect(extensionOf("C:\\x\\y.tar.GZ")).toBe(".gz");
		expect(extensionOf("/a.b/noext")).toBe("");
		expect(extensionOf("/a/.bashrc")).toBe(".bashrc");
	});

	it("extension filters apply to files only, and match case-insensitively", () => {
		const allowed = [".ZIP"];
		expect(rejectionReasonFor(item("/x/a.zip"), "all", allowed)).toBeNull();
		expect(rejectionReasonFor(item("/x/a.Zip"), "all", allowed)).toBeNull();
		expect(rejectionReasonFor(item("C:\\x\\a.ZIP"), "all", allowed)).toBeNull();
		expect(rejectionReasonFor(item("/x/a.zip.bak"), "all", allowed)).toBe(
			"extension",
		);
		expect(rejectionReasonFor(item("/x/noext"), "all", allowed)).toBe(
			"extension",
		);
		expect(
			rejectionReasonFor(item("/x/folder.zip", "directory"), "all", allowed),
		).toBeNull();
	});

	it("maps each classification to its rejection reason", () => {
		const cases: Array<[DropPathKind, DropAccept, string | null]> = [
			["missing", "all", "unreadable"],
			["inaccessible", "files", "unreadable"],
			["other", "all", "not-accepted-type"],
			["file", "folders", "not-accepted-type"],
			["directory", "files", "not-accepted-type"],
			["file", "files", null],
			["directory", "folders", null],
		];
		for (const [kind, accept, expected] of cases) {
			expect(rejectionReasonFor(item("/x", kind), accept, [])).toBe(expected);
		}
	});

	it("evaluateDropItems splits accepted paths from rejected items", () => {
		const result = evaluateDropItems(
			[item("/a.zip"), item("/b.txt"), item("/c", "missing")],
			"files",
			[".zip"],
		);
		expect(result).toEqual({
			accepted: ["/a.zip"],
			rejected: [
				{ path: "/b.txt", reason: "extension" },
				{ path: "/c", reason: "unreadable" },
			],
		});
	});
});

describe("observe", () => {
	function record(ctx: Ctx) {
		const seen: Array<{
			type: string;
			point: Point | null;
			hits: Element[];
		}> = [];
		const stop = ctx.controller.observe((observation) => {
			seen.push(observation);
		});
		return { seen, stop };
	}

	it("reports each enter and over with the same top-first hit list", () => {
		const ctx = setup();
		const target = el();
		ctx.setHits([target]);
		const { seen } = record(ctx);

		ctx.controller.handle({ type: "enter", paths: ["/a.jar"], position: at });
		ctx.controller.handle({ type: "over", position: { x: 9, y: 9 } });

		expect(seen.map((o) => o.type)).toEqual(["move", "move"]);
		expect(seen[1].point).toEqual({ x: 9, y: 9 });
		expect(seen[1].hits).toEqual([target]);
	});

	it("works with no registered zones", () => {
		const ctx = setup();
		const { seen } = record(ctx);
		ctx.controller.handle({ type: "enter", paths: ["/a.jar"], position: at });
		expect(seen).toHaveLength(1);
	});

	it("reports drop with the drop hit list, then end on leave", async () => {
		const ctx = setup();
		const target = el();
		ctx.setHits([target]);
		const { seen } = record(ctx);
		await startDrag(ctx, ["/a.jar"], [item("/a.jar")]);
		seen.length = 0;

		ctx.controller.handle({ type: "drop", paths: ["/a.jar"], position: at });
		expect(seen.map((o) => o.type)).toEqual(["drop"]);
		expect(seen[0].hits).toEqual([target]);

		// A leave while the drop is still resolving is ignored, so finish it first.
		resolvePending(ctx, 1, [item("/a.jar")]);
		await ctx.settle();
		ctx.controller.handle({ type: "leave" });
		expect(seen.at(-1)?.type).toBe("end");
		expect(seen.at(-1)?.hits).toEqual([]);
	});

	it("reports end when the drag is cancelled, but only if one was live", () => {
		const ctx = setup();
		const { seen } = record(ctx);

		ctx.controller.cancel();
		expect(seen).toEqual([]);

		ctx.controller.handle({ type: "enter", paths: ["/a.jar"], position: at });
		ctx.controller.cancel();
		expect(seen.map((o) => o.type)).toEqual(["move", "end"]);
	});

	it("does not report moves for an over with no live session", () => {
		const ctx = setup();
		const { seen } = record(ctx);
		ctx.controller.handle({ type: "over", position: at });
		expect(seen).toEqual([]);
	});

	it("stops reporting after unsubscribe and after dispose", () => {
		const ctx = setup();
		const { seen, stop } = record(ctx);
		stop();
		ctx.controller.handle({ type: "enter", paths: ["/a.jar"], position: at });
		expect(seen).toEqual([]);

		const second = record(ctx);
		ctx.controller.dispose();
		ctx.controller.handle({ type: "over", position: at });
		expect(second.seen).toEqual([]);
	});

	it("a throwing observer does not break routing or other observers", async () => {
		const ctx = setup();
		const a = makeZone("a", el());
		ctx.controller.register(a.reg);
		ctx.setHits([a.element]);
		ctx.controller.observe(() => {
			throw new Error("boom");
		});
		const { seen } = record(ctx);

		await startDrag(ctx, ["/a.jar"], [item("/a.jar")]);
		expect(seen).toHaveLength(1);
		expect(a.states).toEqual(["active"]);
	});
});
