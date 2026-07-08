/* @refresh skip */

import { render } from "@solidjs/testing-library";
import { IconPicker } from "@ui/icon-picker/icon-picker";
import { DEFAULT_ICONS } from "@utils/instances";
import { describe, expect, it, vi } from "vitest";

vi.mock("@assets/cube.svg", () => ({
	default: (props: any) => <svg data-testid="modpack-badge" {...props} />,
}));

vi.mock("@ui/popover/popover", () => ({
	Popover: (props: any) => <div>{props.children}</div>,
	PopoverCloseButton: (props: any) => (
		<button {...props}>{props.children}</button>
	),
	PopoverContent: (props: any) => <div {...props}>{props.children}</div>,
	PopoverTrigger: (props: any) => <button {...props}>{props.children}</button>,
}));

const iconOptions = (container: HTMLElement) =>
	Array.from(container.querySelectorAll<HTMLElement>("[data-icon-option]"));

const selectedOptions = (container: HTMLElement) =>
	iconOptions(container).filter((option) => option.dataset.selected === "true");

const modpackOptions = (container: HTMLElement) =>
	iconOptions(container).filter(
		(option) => option.dataset.modpackOption === "true",
	);

describe("IconPicker", () => {
	it("selects and badges the modpack icon only once when it is the current value", () => {
		const modpackIcon = "data:image/png;base64,modpack";

		const { container } = render(() => (
			<IconPicker
				value={modpackIcon}
				uploadedIcons={[modpackIcon]}
				modpackIcon={modpackIcon}
				allowUpload={false}
			/>
		));

		expect(selectedOptions(container)).toHaveLength(1);
		expect(modpackOptions(container)).toHaveLength(1);
		expect(selectedOptions(container)[0]).toBe(modpackOptions(container)[0]);
	});

	it("dedupes modpack-equivalent uploaded icons with different data URL mime types", () => {
		const currentIcon = "data:image/png;base64,same-image";
		const modpackIcon = "data:image/jpeg;base64,same-image";

		const { container } = render(() => (
			<IconPicker
				value={currentIcon}
				uploadedIcons={[currentIcon, modpackIcon]}
				modpackIcon={modpackIcon}
				allowUpload={false}
			/>
		));

		expect(
			iconOptions(container).filter(
				(option) => option.dataset.iconOption === "uploaded",
			),
		).toHaveLength(1);
		expect(selectedOptions(container)).toHaveLength(1);
		expect(modpackOptions(container)).toHaveLength(1);
		expect(selectedOptions(container)[0]).toBe(modpackOptions(container)[0]);
	});

	it("keeps the current selected image when a modpack-equivalent option appears first", () => {
		const currentIcon = "data:image/png;base64,same-image";
		const modpackIcon = "data:image/jpeg;base64,same-image";

		const { container } = render(() => (
			<IconPicker
				value={currentIcon}
				uploadedIcons={[modpackIcon, currentIcon]}
				modpackIcon={modpackIcon}
				allowUpload={false}
			/>
		));

		expect(
			iconOptions(container).filter(
				(option) => option.dataset.iconOption === "uploaded",
			),
		).toHaveLength(1);
		expect(selectedOptions(container)).toHaveLength(1);
		expect(modpackOptions(container)).toHaveLength(1);
		expect(selectedOptions(container)[0]).toBe(modpackOptions(container)[0]);
	});

	it("badges but does not select a different modpack icon", () => {
		const currentIcon = "data:image/png;base64,current";
		const modpackIcon = "data:image/png;base64,modpack";

		const { container } = render(() => (
			<IconPicker
				value={currentIcon}
				uploadedIcons={[currentIcon]}
				modpackIcon={modpackIcon}
				allowUpload={false}
			/>
		));

		expect(selectedOptions(container)).toHaveLength(1);
		expect(modpackOptions(container)).toHaveLength(1);
		expect(selectedOptions(container)[0]).not.toBe(
			modpackOptions(container)[0],
		);
		expect(modpackOptions(container)[0]?.dataset.selected).toBe("false");
	});

	it("selects builtin icons by stable id", () => {
		const { container } = render(() => (
			<IconPicker
				value="builtin:placeholder-1"
				uploadedIcons={[]}
				allowUpload={false}
			/>
		));

		expect(selectedOptions(container)).toHaveLength(1);
		expect(selectedOptions(container)[0]?.dataset.iconOption).toBe("default");
		expect(selectedOptions(container)[0]?.style.backgroundImage).toContain(
			DEFAULT_ICONS[0],
		);
	});
});
