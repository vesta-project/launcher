import { getInstanceId } from "./instances";

describe("instances util", () => {
	test("getInstanceId returns null for INIT ids", () => {
		const inst = {
			id: { INIT: null },
			name: "Before",
			minecraft_version: "1.0",
			modloader: null,
			modloader_version: null,
			java_path: null,
			java_args: null,
			game_directory: null,
			width: 1,
			height: 1,
			memory_mb: 1024,
			icon_path: null,
			last_played: null,
			total_playtime_minutes: 0,
			created_at: null,
			updated_at: null,
		};
		expect(getInstanceId(inst as any)).toBe(null);
	});

	test("getInstanceId returns numeric value for VALUE ids", () => {
		const inst = {
			id: { VALUE: 42 },
			name: "After",
			minecraft_version: "1.0",
			modloader: null,
			modloader_version: null,
			java_path: null,
			java_args: null,
			game_directory: null,
			width: 1,
			height: 1,
			memory_mb: 1024,
			icon_path: null,
			last_played: null,
			total_playtime_minutes: 0,
			created_at: null,
			updated_at: null,
		};
		expect(getInstanceId(inst as any)).toBe(42);
	});
});
