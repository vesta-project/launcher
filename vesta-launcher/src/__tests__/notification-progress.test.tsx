/* @refresh skip */

import { render, screen } from "@solidjs/testing-library";
import { NotificationItem } from "@ui/notification/notification-item";
import { describe, expect, it, vi } from "vitest";

vi.mock("@assets/bell.svg", () => ({
	default: (props: any) => <svg data-testid="info-icon" {...props} />,
}));

vi.mock("@assets/close.svg", () => ({
	default: (props: any) => <svg data-testid="close-icon" {...props} />,
}));

vi.mock("@assets/error.svg", () => ({
	default: (props: any) => <svg data-testid="error-icon" {...props} />,
}));

vi.mock("@utils/notifications", () => ({
	PROGRESS_INDETERMINATE: -1,
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
});
