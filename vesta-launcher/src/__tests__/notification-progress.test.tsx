/* @refresh skip */

import { fireEvent, render, screen } from "@solidjs/testing-library";
import { NotificationItem } from "@ui/notification/notification-item";
import { describe, expect, it, vi } from "vitest";

vi.mock("@assets/icons/status/bell.svg", () => ({
	default: (props: any) => <svg data-testid="info-icon" {...props} />,
}));

vi.mock("@assets/icons/actions/close.svg", () => ({
	default: (props: any) => <svg data-testid="close-icon" {...props} />,
}));

vi.mock("@assets/icons/status/error.svg", () => ({
	default: (props: any) => <svg data-testid="error-icon" {...props} />,
}));

vi.mock("@assets/icons/content/cube.svg", () => ({
	default: (props: any) => <svg data-testid="instance-icon" {...props} />,
}));

vi.mock("@utils/notifications", () => ({
	PROGRESS_INDETERMINATE: -1,
	getNotificationContext: (metadata?: string | null) =>
		metadata ? JSON.parse(metadata).context : undefined,
}));

describe("Notification progress rendering", () => {
	it("renders a determinate progress bar at 0 percent", () => {
		const { container } = render(() => (
			<NotificationItem
				id={1}
				title="Installing Fabric API"
				notification_type="progress"
				progress={0}
				current_step={0}
				total_steps={3}
			/>
		));

		const progress = container.querySelector(
			'[role="progressbar"]',
		) as HTMLElement | null;

		expect(progress).toBeTruthy();
		expect(progress?.style.getPropertyValue("--progress-fill-width")).toBe(
			"0%",
		);
		expect(screen.getByText("0/3")).toBeTruthy();
	});

	it("renders an indeterminate progress bar", () => {
		const { container } = render(() => (
			<NotificationItem
				id={2}
				title="Installing Sodium"
				notification_type="progress"
				progress={-1}
			/>
		));

		const progress = container.querySelector(
			'[role="progressbar"]',
		) as HTMLElement | null;

		expect(progress).toBeTruthy();
		expect(progress?.style.getPropertyValue("--progress-fill-width")).toBe(
			"100%",
		);
	});

	it("keeps the instance icon primary and renders failure as an X badge", () => {
		const { container } = render(() => (
			<NotificationItem
				id={3}
				severity="error"
				metadata={JSON.stringify({
					context: { kind: "instance", id: "404", label: "Missing" },
				})}
			/>
		));

		expect(screen.getByTestId("instance-icon")).toBeTruthy();
		expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
	});

	it("clamps overflowing descriptions and exposes More and Less", async () => {
		const scrollHeight = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			"scrollHeight",
		);
		const clientHeight = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			"clientHeight",
		);
		Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
			configurable: true,
			get: () => 40,
		});
		Object.defineProperty(HTMLElement.prototype, "clientHeight", {
			configurable: true,
			get: () => 20,
		});

		try {
			render(() => (
				<NotificationItem
					id={4}
					description="A long notification description that takes more than two lines."
				/>
			));
			await Promise.resolve();

			fireEvent.click(await screen.findByRole("button", { name: "More" }));
			expect(screen.getByRole("button", { name: "Less" })).toBeTruthy();
		} finally {
			if (scrollHeight) {
				Object.defineProperty(
					HTMLElement.prototype,
					"scrollHeight",
					scrollHeight,
				);
			}
			if (clientHeight) {
				Object.defineProperty(
					HTMLElement.prototype,
					"clientHeight",
					clientHeight,
				);
			}
		}
	});
});
