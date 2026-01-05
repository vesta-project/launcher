import * as path from "node:path";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import solidSvg from "vite-plugin-solid-svg";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
	plugins: [solidPlugin(), solidSvg()],

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		watch: {
			// 3. tell vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
	},

	resolve: {
		// Provide a default `conditions` set to avoid plugin runtime lookups
		// (prevents incompatible calls to `defaultServerConditions` in some environments)
		conditions: ["solid"],
		alias: [
			{
				find: "@components",
				replacement: path.resolve(__dirname, "src/components"),
			},
			{
				find: "@ui",
				replacement: path.resolve(__dirname, "ui"),
			},
			{
				find: "@assets",
				replacement: path.resolve(__dirname, "src/assets"),
			},
			{
				find: "@utils",
				replacement: path.resolve(__dirname, "src/utils"),
			},
			{
				find: "@stores",
				replacement: path.resolve(__dirname, "src/stores"),
			},
			{
				find: "~",
				replacement: path.resolve(__dirname, "src"),
			},
		],
	},
}));
