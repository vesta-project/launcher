import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const appSource = readFileSync(join(projectRoot, "src/app.tsx"), "utf8");
const shellSource = readFileSync(
	join(projectRoot, "src-tauri/src/startup/shell.rs"),
	"utf8",
);

describe("file-drop startup policy", () => {
	it("leaves the main native handler enabled independently of debug diagnostics", () => {
		const mainWindow = shellSource
			.split("fn build_main_window(")[1]
			.split("fn native_file_drop_probe_enabled()")[0];
		expect(mainWindow).toContain('WebviewWindowBuilder::new(app, "main"');
		expect(mainWindow).not.toContain("disable_drag_drop_handler");
		expect(mainWindow).not.toContain("if native_file_drop_probe");
		expect(mainWindow).not.toContain("cfg!(debug_assertions)");
	});

	it("keeps the diagnostic probe debug-only and explicitly opt-in", () => {
		const probe = shellSource
			.split("fn native_file_drop_probe_enabled()")[1]
			.split("fn create_tray(")[0];
		expect(probe).toContain("cfg!(debug_assertions)");
		expect(probe).toContain('std::env::var("VESTA_NATIVE_FILE_DROP_PROBE")');
		expect(probe).toContain('Ok(value) if value == "1"');
	});

	it("owns native delivery without also installing the legacy sniffer path", () => {
		expect(appSource).toContain("startNativeFileDrop()");
		expect(appSource).toContain("disposeNativeFileDrop()");
		expect(appSource).not.toContain("getDropZoneManager");
		expect(appSource).not.toContain("initializeFileDropSystem");
		expect(appSource).not.toContain("cleanupFileDropSystem");
		expect(appSource).not.toMatch(
			/window\.addEventListener\(["'](?:dragenter|dragover|dragleave|drop)["']/,
		);
	});
});
