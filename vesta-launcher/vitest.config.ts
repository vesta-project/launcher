import * as path from "node:path";
import solidPlugin from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [solidPlugin({ hot: false })],
	test: {
		environment: "jsdom",
		globals: true,
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
	resolve: {
		conditions: ["development", "browser"],
	},
});
