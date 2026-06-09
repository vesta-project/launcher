import { describe, expect, it } from "vitest";
import {
	applyHeaderCollapseToElement,
	findPageScrollContainer,
	isHeaderCollapseEnabled,
	resetHeaderCollapseElement,
	shouldUseCssDrivenHeaderProgress,
	supportsScrollDrivenHeaderCollapse,
} from "./resource-details-header-scroll";

describe("isHeaderCollapseEnabled", () => {
	it("is disabled on mobile or when reduced motion is enabled", () => {
		expect(isHeaderCollapseEnabled(false, false)).toBe(false);
		expect(isHeaderCollapseEnabled(true, true)).toBe(false);
	});

	it("is enabled on desktop without reduced motion", () => {
		expect(isHeaderCollapseEnabled(true, false)).toBe(true);
	});
});

describe("shouldUseCssDrivenHeaderProgress", () => {
	it("returns false when reduced motion is enabled", () => {
		expect(shouldUseCssDrivenHeaderProgress(true)).toBe(false);
	});

	it("matches scroll support when reduced motion is disabled", () => {
		expect(shouldUseCssDrivenHeaderProgress(false)).toBe(
			supportsScrollDrivenHeaderCollapse(),
		);
	});
});

describe("findPageScrollContainer", () => {
	it("prefers the marked page scroll container", () => {
		const main = document.createElement("main");
		main.setAttribute("data-page-scroll-container", "");
		const pageRoot = document.createElement("div");
		main.appendChild(pageRoot);
		document.body.appendChild(main);

		expect(findPageScrollContainer(pageRoot)).toBe(main);

		document.body.removeChild(main);
	});
});

describe("applyHeaderCollapseToElement", () => {
	it("sets the css variable in js-driven mode", () => {
		const header = document.createElement("div");
		applyHeaderCollapseToElement(header, 0.5, false, {
			compact: "compact",
			floating: "floating",
		});

		expect(header.style.getPropertyValue("--header-collapse-progress")).toBe("0.5");
		expect(header.classList.contains("floating")).toBe(true);
		expect(header.classList.contains("compact")).toBe(false);
	});

	it("leaves css progress to scroll-driven animation in css-driven mode", () => {
		const header = document.createElement("div");
		header.style.setProperty("--header-collapse-progress", "0.25");

		applyHeaderCollapseToElement(
			header,
			0.5,
			true,
			{ compact: "compact", floating: "floating" },
			true,
		);

		expect(header.style.getPropertyValue("--header-collapse-progress")).toBe("");
		expect(header.classList.contains("compact")).toBe(true);
	});

	it("resets classes and inline progress", () => {
		const header = document.createElement("div");
		applyHeaderCollapseToElement(header, 1, true, {
			compact: "compact",
			floating: "floating",
		});

		resetHeaderCollapseElement(header, { compact: "compact", floating: "floating" });

		expect(header.classList.contains("compact")).toBe(false);
		expect(header.classList.contains("floating")).toBe(false);
	});
});
